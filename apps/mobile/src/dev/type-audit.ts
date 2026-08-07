/**
 * DEV-ONLY typography measurement for the running app.
 *
 * WHY THIS EXISTS
 * ---------------
 * The web half of this migration got its confidence from MEASURING: a computed-style
 * sweep over every route, in both locales, at two viewports. Mobile had nothing
 * equivalent — its guards are a static parse of source files, which is a different
 * question from "what size is the text on this screen right now".
 *
 * That gap has a track record. The owner's note on the last mobile typography pass
 * records the same "still too small" complaint coming back THREE times, each fix
 * correct but under-scoped, and concludes: "Do a code scan AND a device walk; the
 * code scan alone already missed this once."
 *
 * A device walk done by eye is exactly the process that under-scoped three times.
 * This turns it into a measurement: it reads what every rendered <Text> actually
 * resolved to, so a screen either has sub-floor text or it does not, and nobody has
 * to squint at a screenshot to decide.
 *
 * HOW
 * ---
 * Walks the React fiber tree through the DevTools global hook — the same source
 * React DevTools reads — so it observes the real render without patching or
 * re-rendering anything. Results POST to a local collector (see
 * scripts/type-collector.js) because a console.log would land in Metro's terminal,
 * which is not scriptable from here.
 *
 * ⚠️ DEV ONLY. Guarded on `__DEV__` at both the import site and inside every export.
 * It must never run in a production bundle: it walks the entire tree on demand.
 */
import { StyleSheet, Platform } from 'react-native';

/** One rendered piece of text, with the size it actually resolved to. */
export interface TypeSample {
  text: string;
  fontSize: number | null;
  lineHeight: number | null;
  fontFamily: string | null;
  fontWeight: string | null;
  color: string | null;
  /** True when the string contains CJK — the floor that matters is stricter. */
  cjk: boolean;
  /** Nearest owning component, for locating the offender in source. */
  owner: string | null;
}

const CJK_RE = /[㐀-䶿一-鿿]/;

/**
 * The slice of React's internal fiber that this file reads. React does not publish
 * these types, and the project lints with `--max-warnings 0`, so a blanket `any`
 * would fail the build. Naming only the fields actually touched also documents the
 * coupling: if React renames one of them, this breaks at compile time rather than
 * silently walking nothing and reporting a clean app.
 */
interface FiberLike {
  type?: unknown;
  elementType?: unknown;
  memoizedProps?: Record<string, unknown> | null;
  child?: FiberLike | null;
  sibling?: FiberLike | null;
  return?: FiberLike | null;
}

interface NamedComponent {
  displayName?: string;
  name?: string;
}

interface DevToolsHook {
  renderers: Map<number, unknown>;
  getFiberRoots(id: number): Set<{ current: FiberLike }>;
}

/**
 * Android talks to the host through a loopback alias; `localhost` on the emulator is
 * the emulator itself. This is the same rewrite the app already needs for assetsUrl,
 * and getting it wrong there once meant the mascot art had NEVER loaded on Android.
 */
const COLLECTOR =
  Platform.OS === 'android' ? 'http://10.0.2.2:8099' : 'http://localhost:8099';

function displayNameOf(fiber: FiberLike | null | undefined): string | null {
  const t = fiber?.type ?? fiber?.elementType;
  if (!t) return null;
  if (typeof t === 'string') return t;
  const c = t as NamedComponent;
  return c.displayName ?? c.name ?? null;
}

/**
 * React Native primitives and framework wrappers. Capitalised, so a naive
 * "first capitalised ancestor" walk stops at `View` on essentially every node and
 * reports an owner that tells a reader nothing about where to go and edit.
 */
const NOT_AN_OWNER = new Set([
  'View', 'Text', 'ScrollView', 'Pressable', 'TouchableOpacity', 'TouchableHighlight',
  'TouchableWithoutFeedback', 'Animated', 'AnimatedComponent', 'SafeAreaView',
  'VirtualizedList', 'FlatList', 'SectionList', 'Modal', 'ActivityIndicator',
  'ImageBackground', 'Image', 'KeyboardAvoidingView', 'RCTScrollView', 'Suspense',
  'Fragment', 'StrictMode', 'Profiler', 'ForwardRef', 'Memo', 'Provider', 'Consumer',
]);

/** Walk up for the nearest APP component — the file a reader would open. */
function ownerOf(fiber: FiberLike): string | null {
  let f = fiber.return;
  let hops = 0;
  while (f && hops < 60) {
    const n = displayNameOf(f);
    // `*Context` / `*Provider` are React plumbing (ScrollViewContext,
    // TextAncestorContext) — they wrap almost everything and name no real file.
    const plumbing = /Context$|Provider$|Consumer$|^Anonymous$/.test(n ?? '');
    if (n && /^[A-Z]/.test(n) && !NOT_AN_OWNER.has(n) && !n.startsWith('RCT') && !plumbing) {
      return n;
    }
    f = f.return;
    hops += 1;
  }
  return null;
}

function childText(props: Record<string, unknown>): string {
  const c = props.children;
  if (typeof c === 'string' || typeof c === 'number') return String(c);
  if (Array.isArray(c)) {
    return c
      .filter((x) => typeof x === 'string' || typeof x === 'number')
      .join('')
      .trim();
  }
  return '';
}

/**
 * Collect every rendered <Text>.
 *
 * Matches the COMPOSITE `Text` rather than the host `RCTText`, because the composite
 * still carries the author-level `style` prop — which is what `text.*` roles and any
 * raw `fontSize` actually live in. By the host level the style has been flattened to
 * a registered ID and the role is no longer legible.
 */
export function collectTypeSamples(): { samples: TypeSample[]; diagnostic: string } {
  if (!__DEV__) return { samples: [], diagnostic: 'not-dev' };
  const hook = (globalThis as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__;
  // ⚠️ Distinguish "walked and found nothing" from "could not walk". A tool that
  // returns an empty array for both is the Phase 0.5 failure again — a sweep that
  // proved nothing and reported success. Jest's hook is a STUB (no getFiberRoots),
  // which is why this cannot be validated anywhere but a real device.
  if (!hook) return { samples: [], diagnostic: 'no-devtools-hook' };
  if (typeof hook.getFiberRoots !== 'function') {
    return { samples: [], diagnostic: 'hook-present-but-stubbed' };
  }

  const out: TypeSample[] = [];
  const seen = new Set<FiberLike>();

  const visit = (fiber: FiberLike | null | undefined, depth: number): void => {
    if (!fiber || depth > 400 || seen.has(fiber)) return;
    seen.add(fiber);

    const name = displayNameOf(fiber);
    if (name === 'Text') {
      const props = fiber.memoizedProps ?? {};
      const text = childText(props);
      if (text) {
        const flat = (StyleSheet.flatten(props.style) ?? {}) as Record<string, unknown>;
        out.push({
          text: text.slice(0, 40),
          fontSize: typeof flat.fontSize === 'number' ? flat.fontSize : null,
          lineHeight: typeof flat.lineHeight === 'number' ? flat.lineHeight : null,
          fontFamily: typeof flat.fontFamily === 'string' ? flat.fontFamily : null,
          fontWeight: flat.fontWeight != null ? String(flat.fontWeight) : null,
          color: typeof flat.color === 'string' ? flat.color : null,
          cjk: CJK_RE.test(text),
          owner: ownerOf(fiber),
        });
      }
    }
    visit(fiber.child, depth + 1);
    visit(fiber.sibling, depth + 1);
  };

  let roots = 0;
  for (const id of hook.renderers.keys()) {
    for (const root of hook.getFiberRoots(id)) {
      roots += 1;
      visit(root.current, 0);
    }
  }
  return {
    samples: out,
    diagnostic: `ok roots=${roots} fibers=${seen.size} text=${out.length}`,
  };
}

/**
 * Measure the current screen and ship the result to the collector.
 * `screen` is a label supplied by the walker so a report can be attributed.
 */
export async function reportCurrentScreen(screen: string): Promise<void> {
  if (!__DEV__) return;
  const { samples, diagnostic } = collectTypeSamples();
  try {
    await fetch(`${COLLECTOR}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ screen, platform: Platform.OS, samples, diagnostic }),
    });
  } catch {
    // Collector not running is not an error — the app must not care.
  }
}

/**
 * Install `globalThis.__typeAudit()`. Exposed as a global rather than wired into a
 * component so it can be invoked from anywhere without touching render code, and so
 * removing the feature is a one-line revert.
 */
export function installTypeAudit(): void {
  if (!__DEV__) return;
  (globalThis as unknown as { __typeAudit?: typeof reportCurrentScreen }).__typeAudit =
    reportCurrentScreen;
}
