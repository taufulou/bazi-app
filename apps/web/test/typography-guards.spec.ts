/**
 * Static typography guards for apps/web. Mirrors
 * `apps/mobile/src/theme/__tests__/typography-guards.test.ts`.
 *
 * WHY THIS EXISTS
 * ---------------
 * A measured audit found 461 of 977 type sites below the 14px content floor and
 * 814 of 957 CSS rules setting a `font-size` with NO `line-height` — a
 * leading:size ratio of 0.15, statistically identical to the defect mobile's
 * roles were introduced to kill. Web had no typography token system at all.
 *
 * RATCHET DIRECTION — read before "fixing" a failure
 * --------------------------------------------------
 * During the migration (Phases 1-4) these are ONE-SIDED: they fail when a count
 * INCREASES and tolerate a decrease. Pinning them two-sided mid-migration would
 * fail every intermediate commit for "count fell without re-pinning". Flip to
 * two-sided at Phase 6.
 *
 * EVERY exception is an allowlist entry WITH A REASON — an exception you have to
 * type out is one someone decided on, rather than one that merely exists.
 *
 * ⚠️ DESIGN NOTE — guards must not be repayable by making things WORSE.
 * A line audit measured three ways the first version could be satisfied while the
 * real problem grew: moving a rule to an inline style repaid Guard B; rewriting
 * `fontSize="11"` as `fontSize={11}` left Guard A; converting a declaration to
 * `font-size: var(...)` removed it from Guard A's resolvable set entirely. Each
 * of those is a shape the MIGRATION ITSELF introduces, so they are closed below.
 */
import * as fs from 'fs';
import * as path from 'path';

const APP = path.resolve(__dirname, '../app');
const TOKEN_FILE = path.join(APP, 'styles/type.module.css');

// ─────────────────────────────────────────────────────────── scope

/** Fixed-canvas capture surfaces: a 1200x1600 coordinate space, not screen text. */
const CAPTURE = /Shareable\w+\.module\.css$|[/\\]api[/\\]og[/\\]/;
/** Owner-excluded: admin is internal tooling; ZwdsChart is out of scope. */
const EXCLUDE = /(^|[/\\])admin[/\\]|Zwds/i; // NB: rel() has no leading slash
/**
 * The token file DEFINES the scale; it is not a usage site. Counting its own
 * `label`/`meta`/`caption` rules as sub-14 "violations" would make the scale
 * self-incriminating. (Same class of error as counting mobile's theme role
 * definitions as usage — caught in review twice. Do not reintroduce.)
 */
const IS_TOKEN_FILE = /styles[/\\]type\.module\.css$/;

const inScope = (r: string) =>
  !CAPTURE.test(r) && !EXCLUDE.test(r) && !IS_TOKEN_FILE.test(r);

function walk(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '.next') walk(full, ext, out);
    } else if (ext.test(e.name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(APP, f);

/** Blank comments WITHOUT eating newlines, so line numbers stay true. */
const blankComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

const ROOT_PX = 16;

/** Role -> px, parsed from the token file so `var(--t-x-size)` stays measurable. */
const ROLE_PX: Record<string, number> = {};
{
  const t = blankComments(fs.readFileSync(TOKEN_FILE, 'utf8'));
  for (const m of t.matchAll(/\.([A-Za-z_][\w-]*)\s*\{([^}]*)\}/g)) {
    const size = /font-size:\s*([\d.]+)rem/.exec(m[2]);
    if (size) ROLE_PX[m[1]] = parseFloat(size[1]) * ROOT_PX;
  }
}

function toPx(raw: string): number | null {
  const v = raw.trim().replace(/\s*!\s*important\s*$/i, '');
  let m = /^([\d.]+)rem$/.exec(v);
  if (m) return parseFloat(m[1]) * ROOT_PX;
  m = /^([\d.]+)px$/.exec(v);
  if (m) return parseFloat(m[1]);
  m = /^clamp\(\s*([\d.]+)(rem|px)/.exec(v);
  if (m) return parseFloat(m[1]) * (m[2] === 'rem' ? ROOT_PX : 1);
  // Carve-out form. Resolving it keeps the ~96 planned var conversions VISIBLE
  // to Guards A and D — otherwise the migration would shrink Guard A's count by
  // making declarations unreadable rather than by fixing them.
  m = /^var\(\s*--t-([\w-]+)-size\s*\)$/.exec(v);
  if (m) return ROLE_PX[m[1]] ?? null;
  return null; // em / calc / unknown var
}

interface Decl {
  file: string;
  line: number;
  selector: string;
  raw: string;
  px: number | null;
  inAtRule: boolean;
  hasLineHeight: boolean;
  simpleSelector: boolean;
  composesRole: string | null;
  kind: 'css' | 'svg-attr' | 'inline-style';
}

const SIMPLE = /^\.[A-Za-z_][\w-]*$/;
/** Not just @media: @container is the modern responsive-shrink mechanism, and
 *  §5 of the standard forbids shrinking below the floor by ANY means. */
const AT_RULE = /@(media|supports|container|layer|scope)[^{]*\{/g;

function cssDecls(): Decl[] {
  const out: Decl[] = [];
  for (const file of walk(APP, /\.css$/)) {
    const r = rel(file);
    if (!inScope(r)) continue;
    const text = blankComments(fs.readFileSync(file, 'utf8'));

    const atRules: Array<[number, number]> = [];
    for (const m of text.matchAll(AT_RULE)) {
      let d = 0;
      let i = m.index! + m[0].length - 1;
      for (; i < text.length; i++) {
        if (text[i] === '{') d++;
        else if (text[i] === '}' && --d === 0) break;
      }
      atRules.push([m.index!, i]);
    }

    // `font-size:` plus the `font:` SHORTHAND, which otherwise hides a size
    // entirely (`font: 700 11px/1.4 serif` moved every counter by zero).
    const SIZE_DECL = /(?:font-size\s*:\s*([^;}]+))|(?:(?:^|[;{])\s*font\s*:\s*([^;}]+))/g;

    for (const m of text.matchAll(SIZE_DECL)) {
      const isShorthand = m[2] !== undefined;
      const rawVal = (m[1] ?? m[2]).trim();
      if (isShorthand && /^inherit$/i.test(rawVal)) continue; // button resets

      const head = text.slice(0, m.index!);
      const ob = head.lastIndexOf('{');
      const selBlob = head.slice(0, Math.max(ob, 0));
      const cut = Math.max(selBlob.lastIndexOf('}'), selBlob.lastIndexOf('{'));
      const selectorFull = selBlob.slice(cut + 1).trim().replace(/\s+/g, ' ');

      let d = 0;
      let j = ob;
      for (; j < text.length; j++) {
        if (text[j] === '{') d++;
        else if (text[j] === '}' && --d === 0) break;
      }
      const block = text.slice(ob, j);
      const sels = selectorFull.split(',').map((s) => s.trim()).filter(Boolean);
      const composes = /composes:\s*([\w-]+)\s+from\s+["'][^"']*type\.module\.css["']/.exec(block);

      // A shorthand carries its own leading as `size/leading`.
      const shorthandSize = isShorthand
        ? /(^|\s)([\d.]+(?:px|rem|em))(?:\s*\/\s*([\d.]+\S*))?/.exec(rawVal)
        : null;

      out.push({
        file: r,
        line: head.split('\n').length,
        selector: selectorFull, // FULL — truncate only for display
        raw: isShorthand ? `font: ${rawVal}` : rawVal,
        px: isShorthand ? (shorthandSize ? toPx(shorthandSize[2]) : null) : toPx(rawVal),
        inAtRule: atRules.some(([a, b]) => a <= m.index! && m.index! <= b),
        hasLineHeight: /line-height\s*:/.test(block) || Boolean(shorthandSize?.[3]),
        simpleSelector: sels.length > 0 && sels.every((s) => SIMPLE.test(s)),
        composesRole: composes ? composes[1] : null,
        kind: 'css',
      });
    }
  }
  return out;
}

/**
 * SVG `fontSize=` attrs and inline `style={{ fontSize }}`.
 * A stylesheet-only audit is blind to these — how 11px CJK survived in the
 * compatibility radar chart. Both the quoted AND braced JSX forms are matched:
 * `fontSize={11}` is the natural shape of the FIX for that chart, so a guard
 * that only saw `fontSize="11"` would go blind exactly when it mattered.
 */
function tsxDecls(): Decl[] {
  const out: Decl[] = [];
  const ATTR = /\bfontSize\s*=\s*(?:["']([^"']+)["']|\{\s*([^}]+?)\s*\})/g;
  const INLINE = /\bfontSize\s*:\s*(?:["']([^"']+)["']|([\d.]+)|(`[^`]*`))/g;
  const numeric = (s: string) => (/^[\d.]+$/.test(s.trim()) ? `${s.trim()}px` : s.trim());

  for (const file of walk(APP, /\.tsx$/)) {
    const r = rel(file);
    if (!inScope(r)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((ln, i) => {
      const push = (v: string, kind: Decl['kind'], note: string) =>
        out.push({
          file: r, line: i + 1, selector: note, raw: v, px: toPx(numeric(v)),
          inAtRule: false, hasLineHeight: /lineHeight/.test(ln),
          simpleSelector: true, composesRole: null, kind,
        });
      for (const m of ln.matchAll(ATTR)) push(m[1] ?? m[2], 'svg-attr', 'svg fontSize=');
      for (const m of ln.matchAll(INLINE)) push(m[1] ?? m[2] ?? m[3], 'inline-style', 'inline fontSize');
    });
  }
  return out;
}

const CSS = cssDecls();
const TSX = tsxDecls();
const ALL = [...CSS, ...TSX];
const resolvable = ALL.filter((d) => d.px !== null);

const fmt = (d: Decl) =>
  `${d.file}:${d.line} ${d.selector.slice(-70)} = ${d.raw} (${d.px ?? '?'}px)`;

// ────────────────────────────────────────────────────── Guard A

describe('Guard A — content floor (14px) and hard floor (12px)', () => {
  const BUDGET_SUB_14 = 20; // Phase 2

  /**
   * ⚠️ A site that COMPOSES A ROLE is compliant even when it lands below 14 —
   * `caption` is 12 and `label`/`meta` are 13 BY DESIGN, for units, disclaimers
   * and field labels. Counting those as violations conflates "arbitrary small
   * text" with "correctly-sized caption", and makes the ratchet un-zeroable: it
   * would plateau at however many captions the app has. The violation is
   * small text whose size was NOT decided by the scale.
   */
  it(`has no more than ${BUDGET_SUB_14} UNROLED sites below the 14px content floor`, () => {
    const bad = resolvable.filter(
      (d) => d.px! < 14 && !d.composesRole && !/^var\(\s*--t-/.test(d.raw));
    if (bad.length > BUDGET_SUB_14) {
      throw new Error(
        `Sub-14px sites rose to ${bad.length} (budget ${BUDGET_SUB_14}).\n` +
          `New offenders must compose a role from app/styles/type.module.css.\n` +
          bad.slice(0, 25).map(fmt).join('\n'),
      );
    }
    expect(bad.length).toBeLessThanOrEqual(BUDGET_SUB_14);
  });

  /** A non-literal size is not "clean" — it is UNMEASURABLE, and silently
   *  leaving the resolvable set is how a ratchet gets repaid without a fix. */
  /**
   * Pinned at the TRUE count (1: narrative-utils.module.css:62 `0.90em`, the one
   * parent-relative declaration, dispositioned in PLAN §3d as "resolve to a role
   * at migration"). It was briefly set to 3 "for slack" — which meant a probe
   * introducing a new unresolvable size did NOT fail. A budget with headroom is
   * a budget a violation can hide inside; pin at the real number.
   */
  const BUDGET_UNRESOLVABLE = 0; // Phase 2 — the last `em`-relative size is gone

  it(`has no more than ${BUDGET_UNRESOLVABLE} sizes the guard cannot resolve`, () => {
    const opaque = ALL.filter((d) => d.px === null);
    if (opaque.length > BUDGET_UNRESOLVABLE) {
      throw new Error(
        `Unresolvable sizes rose to ${opaque.length} (budget ${BUDGET_UNRESOLVABLE}).\n` +
          `Use a literal, a role class, or var(--t-<role>-size) so it stays measurable.\n` +
          opaque.map(fmt).join('\n'),
      );
    }
    expect(opaque.length).toBeLessThanOrEqual(BUDGET_UNRESOLVABLE);
  });
});

// ────────────────────────────────────────────────────── Guard B

describe('Guard B — size must travel with leading', () => {
  /**
   * THE load-bearing guard. CJK at 17px with inherited Latin ~1.2 leading reads
   * WORSE than 13.6px done right.
   *
   * Counts CSS **and** TSX: an inline `style={{fontSize}}` cannot compose a role
   * and cannot carry a pair, so it is strictly the worse artefact. The first
   * version excluded TSX, which meant moving a rule out of CSS into an inline
   * style REPAID a unit of budget (measured: B 815 -> 814).
   */
  /**
   * 814 -> 840 when TSX joined the count. That is the guard's SCOPE widening,
   * not quality regressing: the extra 26 are inline/SVG sites that were always
   * unleaded and simply invisible. Re-pinned deliberately, with the reason, so a
   * future reader does not read a rising budget as tolerated decay.
   */
  const BUDGET_UNLEADED = 60; // Phase 2

  const unleaded = ALL.filter((d) => !d.hasLineHeight && !d.composesRole);

  it(`has no more than ${BUDGET_UNLEADED} sites setting a size without leading`, () => {
    if (unleaded.length > BUDGET_UNLEADED) {
      throw new Error(
        `Unleaded sites rose to ${unleaded.length} (budget ${BUDGET_UNLEADED}).\n` +
          `Compose a role, or declare line-height alongside.\n` +
          unleaded.slice(0, 25).map(fmt).join('\n'),
      );
    }
    expect(unleaded.length).toBeLessThanOrEqual(BUDGET_UNLEADED);
  });

  /**
   * The cascade rule (standard §3 rule ②): never override a composed role's
   * font-size — pick a different role. PLAN §3e claimed this was "enforceable by
   * Guard B"; measured, it fired NOTHING. The justification for the rule is that
   * the winner depends on emitted chunk order, which can differ dev vs prod — so
   * the one rule whose stated risk is nondeterminism had no check at all.
   */
  it('never overrides a composed role’s font-size', () => {
    const bad = CSS.filter((d) => d.composesRole).map(fmt);
    expect(bad).toEqual([]);
  });

  /**
   * Same hazard, other properties. Some roles set `font-weight` and/or
   * `font-family` (the four heading roles set both; `label` sets weight). A
   * consumer that re-declares either has EQUAL specificity with the token class,
   * so the winner depends on emitted source order — which can differ between dev
   * and prod chunking, exactly as for font-size.
   *
   * This also catches the defect that flipped 16 CTAs to Noto Serif TC: they
   * composed `subsection` for its 17px and inherited its serif family as a side
   * effect. The fix was `control`, which sets ONLY size and leading.
   *
   * ONE-SIDED ratchet — a large pre-existing population is tolerated, but it may
   * not grow. Budget emitted by running this guard.
   */
  const ROLE_SETS = (() => {
    const t = blankComments(fs.readFileSync(TOKEN_FILE, 'utf8'));
    const out: Record<string, { weight: boolean; family: boolean }> = {};
    for (const m of t.matchAll(/\.([A-Za-z_][\w-]*)\s*\{([^}]*)\}/g)) {
      out[m[1]] = {
        weight: /font-weight\s*:/.test(m[2]),
        family: /font-family\s*:/.test(m[2]),
      };
    }
    return out;
  })();

  const BUDGET_WEIGHT_FAMILY_OVERRIDES = 43; // Phase 2: 153 -> 43. The 113 removed were byte-identical to their role.
  // The 43 that remain declare a DIFFERENT value (mostly weight 600 against a
  // heading role that binds 700) — a design decision, not duplication, so they
  // are left for the owner rather than silently restyled.

  it(`has no more than ${BUDGET_WEIGHT_FAMILY_OVERRIDES} blocks re-declaring a role's weight/family`, () => {
    const bad: string[] = [];
    for (const file of walk(APP, /\.css$/)) {
      const r = rel(file);
      if (!inScope(r)) continue;
      const text = blankComments(fs.readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/\.([\w-]+)[^{}]*\{([^{}]*)\}/g)) {
        const body = m[2];
        const c = /composes:\s*(\w+)\s+from\s+["'][^"']*type\.module\.css["']/.exec(body);
        if (!c) continue;
        const role = ROLE_SETS[c[1]];
        if (!role) continue;
        if (role.weight && /font-weight\s*:/.test(body)) bad.push(`${r} .${m[1]} weight`);
        if (role.family && /font-family\s*:/.test(body)) bad.push(`${r} .${m[1]} family`);
      }
    }
    if (bad.length > BUDGET_WEIGHT_FAMILY_OVERRIDES) {
      throw new Error(
        `Role weight/family overrides rose to ${bad.length} ` +
          `(budget ${BUDGET_WEIGHT_FAMILY_OVERRIDES}). Equal specificity means the winner ` +
          `depends on chunk order — pick a role that does not set the property instead.\n` +
          bad.slice(0, 20).join('\n'),
      );
    }
    expect(bad.length).toBeLessThanOrEqual(BUDGET_WEIGHT_FAMILY_OVERRIDES);
  });
});

// ────────────────────────────────────────────────────── Guard C

describe('Guard C — focusable controls never below 16px (iOS zoom)', () => {
  /**
   * Mobile Safari force-zooms when a focused input/select/textarea is under 16px
   * and does NOT zoom back out. BEHAVIOURAL, not aesthetic.
   *
   * Static half only — CSS text cannot know a class lands on an <input>. The REAL
   * proof is the live DOM check in scripts/type-sweep.js.
   */
  const CONTROL_SELECTOR = /^\.(input|select|textarea|[\w-]*(Input|Select|Textarea|Field))$/;
  const BUDGET_CONTROL_CLASSES = 0;

  it(`has no more than ${BUDGET_CONTROL_CLASSES} control-like classes under 16px`, () => {
    const offenders = CSS.filter(
      (d) => d.px !== null && d.px < 16 &&
        d.selector.split(',').some((s) => CONTROL_SELECTOR.test(s.trim())),
    );
    if (offenders.length > BUDGET_CONTROL_CLASSES) {
      throw new Error(
        `Control-like classes under 16px rose to ${offenders.length} ` +
          `(budget ${BUDGET_CONTROL_CLASSES}). These make iOS Safari zoom on focus — ` +
          `compose the \`control\` role.\n` + offenders.map(fmt).join('\n'),
      );
    }
    expect(offenders.length).toBeLessThanOrEqual(BUDGET_CONTROL_CLASSES);
  });

  it('has no literal input/select/textarea element selector under 16px', () => {
    const bad = CSS.filter(
      (d) => d.px !== null && d.px < 16 &&
        /(^|[\s>+~,])(input|select|textarea)\b/.test(d.selector),
    );
    const ALLOW = new Set([
      // Third-party react-datepicker chrome: non-module global stylesheet and a
      // descendant selector, so it cannot compose (Carve-out B). Phase 1 target.
      'components/DateTimePickerTheme.css',
    ]);
    expect(bad.filter((d) => !ALLOW.has(d.file)).map(fmt)).toEqual([]);
  });
});

// ────────────────────────────────────────────────────── Guard D

describe('Guard D — at-rules must not push below the floor', () => {
  /**
   * Small viewports get relief from LAYOUT, never from shrinking type. Covers
   * @media AND @supports/@container/@layer/@scope — @container is the modern
   * responsive-shrink mechanism and was invisible to the first version.
   */
  const BUDGET_AT_RULE_SUB_14 = 14; // Phase 2

  it(`has no more than ${BUDGET_AT_RULE_SUB_14} at-rule declarations below 14px`, () => {
    const bad = CSS.filter((d) => d.inAtRule && d.px !== null && d.px < 14);
    if (bad.length > BUDGET_AT_RULE_SUB_14) {
      throw new Error(
        `At-rule sub-14 rose to ${bad.length} (budget ${BUDGET_AT_RULE_SUB_14}).\n` +
          bad.slice(0, 20).map(fmt).join('\n'),
      );
    }
    expect(bad.length).toBeLessThanOrEqual(BUDGET_AT_RULE_SUB_14);
  });
});

// ────────────────────────────────────────────────────── Guard E

describe('Guard E — composed role names must exist', () => {
  /**
   * MANDATORY, and proven necessary by the Phase 0 smoke test rather than
   * assumed: `composes: bodyy from "../styles/type.module.css"` — valid path,
   * BAD NAME — compiles CLEAN in Turbopack and emits an EMPTY rule. The element
   * then gets no size AND no leading. Nothing else catches it: not the compiler,
   * not Guard B, not RTL (CSS is identity-obj-proxy).
   */
  const tokenNames = new Set(Object.keys(ROLE_PX));

  it('token file exposes the documented roles', () => {
    for (const r of ['display', 'title', 'section', 'subsection', 'body', 'control',
      'bodyTight', 'cell', 'label', 'meta', 'caption']) {
      expect(tokenNames.has(r)).toBe(true);
    }
  });

  it('every `composes: X from <token file>` names a role that exists', () => {
    const bad: string[] = [];
    for (const file of walk(APP, /\.css$/)) {
      const text = blankComments(fs.readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/composes:\s*([^;]+?)\s+from\s+["']([^"']+)["']/g)) {
        if (!/type\.module\.css$/.test(m[2])) continue;
        for (const name of m[1].trim().split(/\s+/)) {
          if (!tokenNames.has(name)) {
            bad.push(`${rel(file)}:${text.slice(0, m.index!).split('\n').length} composes '${name}' — NOT a role`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * Flags EVERY `from global`, not only names that resemble a role. The first
   * version required the name to contain a known role, so `composes: bdy from
   * global` passed — and `bdy` is the literal example in the standard and the
   * plan as THE silent-failure form. There is no legitimate `from global` here.
   */
  it('nothing uses the silent-failure `composes: … from global` form', () => {
    const bad: string[] = [];
    for (const file of walk(APP, /\.css$/)) {
      const text = blankComments(fs.readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/composes:\s*([^;]+?)\s+from\s+global/g)) {
        bad.push(`${rel(file)} composes '${m[1].trim()}' from global — use the file-path form`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ────────────────────────────────────────── Guard F (token integrity)

describe('Guard F — token file and custom properties cannot drift', () => {
  const tokenCss = blankComments(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const globals = blankComments(fs.readFileSync(path.join(APP, 'globals.css'), 'utf8'));

  const roles: Record<string, { size?: string; lead?: string }> = {};
  for (const m of tokenCss.matchAll(/\.([A-Za-z_][\w-]*)\s*\{([^}]*)\}/g)) {
    const size = /font-size:\s*([\d.]+rem)/.exec(m[2]);
    const lead = /line-height:\s*([\d.]+)/.exec(m[2]);
    if (size) roles[m[1]] = { size: size[1], lead: lead?.[1] };
  }
  const vars: Record<string, { size?: string; lead?: string }> = {};
  for (const m of globals.matchAll(/--t-([\w-]+)-size:\s*([\d.]+rem)/g))
    (vars[m[1]] ??= {}).size = m[2];
  for (const m of globals.matchAll(/--t-([\w-]+)-leading:\s*([\d.]+)/g))
    (vars[m[1]] ??= {}).lead = m[2];

  it('every role has a matching custom-property pair, and vice versa', () => {
    expect(Object.keys(vars).sort()).toEqual(Object.keys(roles).sort());
  });

  it('sizes and leadings match exactly between the two files', () => {
    const drift = Object.entries(roles)
      .filter(([n, v]) => vars[n]?.size !== v.size || vars[n]?.lead !== v.lead)
      .map(([n, v]) => `${n}: class(${v.size}/${v.lead}) vs var(${vars[n]?.size}/${vars[n]?.lead})`);
    expect(drift).toEqual([]);
  });

  it('every role size resolves to a whole pixel at the 16px root', () => {
    const bad = Object.entries(roles)
      .map(([n, v]) => [n, parseFloat(v.size!) * ROOT_PX] as const)
      .filter(([, px]) => !Number.isInteger(px))
      .map(([n, px]) => `${n} -> ${px}px`);
    expect(bad).toEqual([]);
  });

  it('no role sits below the 12px hard floor', () => {
    const bad = Object.entries(roles)
      .filter(([, v]) => parseFloat(v.size!) * ROOT_PX < 12)
      .map(([n, v]) => `${n} = ${v.size}`);
    expect(bad).toEqual([]);
  });

  /**
   * The whole rem scale is justified on "root is the browser default 16px".
   * If anyone adds the common `html { font-size: 62.5% }`, every role silently
   * becomes a 10px scale (caption -> 7.5px) while every check above still passes,
   * because they all multiply by a hardcoded 16.
   */
  it('nothing in scope redefines the root font-size', () => {
    const bad: string[] = [];
    for (const file of walk(APP, /\.css$/)) {
      const text = blankComments(fs.readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/(^|\})\s*(html|:root|body)[^{}]*\{([^}]*)\}/g)) {
        if (/font-size\s*:/.test(m[3])) bad.push(`${rel(file)} — ${m[2]} sets font-size`);
      }
    }
    expect(bad).toEqual([]);
  });
});
