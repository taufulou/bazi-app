/**
 * Traditional → Simplified display-layer conversion (繁 → 簡).
 *
 * Source of truth stays Traditional everywhere (DB / engine / prompts / caches).
 * This module converts to Simplified ONLY at the display edge, for `zh-CN` users,
 * via OpenCC `tw → cn` (Taiwan-Traditional → Simplified, character-level + minimal
 * phrase segmentation; verified: 比劫奪財→比劫夺财, 用神/甲子 unchanged, 裡→里, 著→着).
 *
 * `opencc-js` is **lazy-loaded** (dynamic import) so it never bloats first paint or
 * the bundle for zh-TW users. Two consumption modes:
 *   1. Render-time: `convertText(s)` — synchronous; returns input unchanged until the
 *      converter has loaded (caller kicks off `ensureConverter()` early).
 *   2. DOM-walk: `convertSubtree(root)` + `startObserver()` — converts existing + newly
 *      added/changed CJK text nodes, honouring the skip-list.
 *
 * Idempotent + loop-safe: each converted text node records its produced output, so a
 * MutationObserver firing on our own write is a no-op (no infinite loop).
 */

type Converter = (input: string) => string;

let converter: Converter | null = null;
let converterPromise: Promise<Converter> | null = null;

/** Lazy-load + memoize the OpenCC `tw → cn` converter. Safe to call repeatedly. */
export async function ensureConverter(): Promise<Converter> {
  if (converter) return converter;
  if (!converterPromise) {
    converterPromise = import('opencc-js').then((OpenCC) => {
      const conv = OpenCC.Converter({ from: 'tw', to: 'cn' });
      converter = conv;
      return conv;
    });
  }
  return converterPromise;
}

/** True once the converter chunk has loaded and `convertText` will actually convert. */
export function isConverterReady(): boolean {
  return converter !== null;
}

// CJK Unified (incl. Ext A) + compatibility ideographs — the only ranges where
// Traditional/Simplified differ. Bopomofo/punctuation/Latin are skipped (cheap guard).
const CJK_RE = /[㐀-鿿豈-﫿]/;

/** Cheap test: does the string contain any Han characters worth converting? */
export function isCJK(s: string): boolean {
  return CJK_RE.test(s);
}

/**
 * Synchronous string conversion for render-time use (chat assistant prose, fortune
 * narratives, share cards). No-op (returns input) when the converter hasn't loaded
 * yet or the string has no Han chars — so it's safe to call on the server / pre-load.
 */
export function convertText(s: string): string {
  if (!converter || !s || !CJK_RE.test(s)) return s;
  return converter(s);
}

// ── DOM walking ────────────────────────────────────────────────────────────────

const SKIP_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'SCRIPT', 'STYLE', 'NOSCRIPT']);

/**
 * Should this node (or any ancestor) be left untouched?
 *  - form controls (user input) + contenteditable (user-typed text)
 *  - SCRIPT/STYLE/NOSCRIPT
 *  - anything opted out via `data-no-zh` or `translate="no"`
 * (Admin pages are handled upstream — the provider never activates under /admin.)
 */
function isSkipped(node: Node): boolean {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    // `isContentEditable` covers inherited editability in real browsers; the explicit
    // attribute check is the ancestor-walk backstop (and is what works under jsdom).
    if ((el as HTMLElement).isContentEditable) return true;
    const ce = el.getAttribute('contenteditable');
    if (ce === '' || ce === 'true' || ce === 'plaintext-only') return true;
    if (el.hasAttribute('data-no-zh')) return true;
    if (el.getAttribute('translate') === 'no') return true;
    el = el.parentElement;
  }
  return false;
}

// Records the last output we wrote per text node. If the node's current value equals
// what we produced, skip — this breaks the observer→write→observe→… loop and makes
// re-runs idempotent. When React rewrites the node with fresh Traditional, the value
// differs from our recorded output → we reconvert once.
const lastOutput = new WeakMap<Text, string>();

function convertTextNode(t: Text): void {
  const cur = t.nodeValue;
  if (!cur || !CJK_RE.test(cur)) return;
  if (lastOutput.get(t) === cur) return; // already our output → no-op (loop guard)
  if (isSkipped(t)) return;
  const next = converter ? converter(cur) : cur;
  if (next !== cur) t.nodeValue = next;
  lastOutput.set(t, next);
}

/**
 * Convert every (non-skipped) CJK text node under `root`. `root` may be an Element or
 * a Text node. No-op on the server or before the converter has loaded.
 */
export function convertSubtree(root: Node): void {
  if (!converter || typeof document === 'undefined') return;

  if (root.nodeType === Node.TEXT_NODE) {
    convertTextNode(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) {
    return;
  }
  // Bail early if the whole root is inside a skipped region.
  if (isSkipped(root)) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const v = node.nodeValue;
      if (!v || !CJK_RE.test(v)) return NodeFilter.FILTER_REJECT;
      if (isSkipped(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const batch: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    batch.push(n as Text);
    n = walker.nextNode();
  }
  for (const t of batch) convertTextNode(t);
}

// ── MutationObserver (dynamic / late-arriving content) ───────────────────────────

let observer: MutationObserver | null = null;
let scheduled = false;
const pendingRoots = new Set<Node>();

function flush(): void {
  scheduled = false;
  const roots = Array.from(pendingRoots);
  pendingRoots.clear();
  for (const r of roots) {
    if (r.isConnected) convertSubtree(r);
  }
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  // rAF coalesces token-stream bursts into one pass/frame; fall back to microtask.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
  else queueMicrotask(flush);
}

/** Start watching `document.body` for new/changed CJK text. Idempotent. */
export function startObserver(): void {
  if (observer || typeof document === 'undefined' || !document.body) return;
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'characterData') {
        if (m.target.nodeType === Node.TEXT_NODE) pendingRoots.add(m.target);
      } else if (m.type === 'childList') {
        m.addedNodes.forEach((node) => pendingRoots.add(node));
      }
    }
    if (pendingRoots.size) schedule();
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
}

/** Stop the observer (e.g. on revert to Traditional before a reload). */
export function stopObserver(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  pendingRoots.clear();
  scheduled = false;
}
