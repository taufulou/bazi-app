# Typography Standard — web + mobile

The canonical type scale for `apps/web` and `apps/mobile`. Read this before adding
or changing any `font-size`.

**Audience is zh-TW.** CJK is denser per character than Latin, so every rule here is
stricter than a Latin-only standard would be.

---

## 1. The scale

One scale, both platforms — CSS `px`/`rem` and RN `pt` are both density-independent.

**Relationship to `text.*` in `apps/mobile/src/theme/index.ts`** (verified by cross-check,
not asserted): the **10 roles shared by both platforms carry identical sizes**, and leading
matches within rounding — mobile expresses leading as an integer px `lineHeight`, web as a
unitless ratio, so e.g. mobile `caption` 12/17 = 1.42 vs web 1.45 is the same intent, not a
drift. The role *sets* are not identical:

| | |
|---|---|
| **Web-only** | `control` — see §4. Mobile has no browser-zoom bug to defend against. |
| **Mobile-only** | `ganzhi` (28) · `data` (15) · `dense` (12) · `dataSmall` (12) |

`dense` (12) and `dataSmall` (12) are **deliberately not offered on web.** They exist on
mobile because a 360dp phone column is genuinely width-bound; the web chart is not, and the
migration plan commits to raising those same cells to 13–14 with a layout change rather than
enshrining 12. Adding a 12pt web role would quietly re-authorise what that work exists to fix.

`ganzhi` and `data` are **real gaps, not omissions of principle** — web renders 干支 and
tabular figures too. They are deferred to the chart phase, where their font-family and
`font-variant-numeric` can be decided against the actual surface instead of guessed.

| Role | Size | Leading | web (`rem`) | Use |
|---|---|---|---|---|
| `display` | 34 | 1.25 | 2.125 | hero numerals, page display |
| `title` | 24 | 1.30 | 1.5 | card titles |
| `section` | 19 | 1.40 | 1.1875 | section headings inside a card |
| `subsection` | 17 | 1.35 | 1.0625 | sub-headings (weight/family carries it, not size) |
| **`body`** | **17** | **1.65** | **1.0625** | primary running prose |
| **`control`** | **17** | 1.40 | **1.0625** | **any focusable form control — §4** |
| `bodyTight` | 15 | 1.50 | 0.9375 | card descriptions, list subtitles |
| `cell` | 14 | 1.35 | 0.875 | width-bound table content |
| `label` | 13 | 1.40 | 0.8125 | field labels (weight + tracking) |
| `meta` | 13 | 1.45 | 0.8125 | row metadata (neutral) |
| `caption` | 12 | 1.45 | 0.75 | disclaimers, units, micro-notes |

**Pick a ROLE, not a number.** Roles bind size and leading together — see §2 for why
that is the load-bearing property, not a convenience.

### Floors
- **Readable floor = 14** — anything the user reads as *content*.
- **Ornament floor = 12** — units, badge counts, non-CJK digits/emoji. **Never CJK prose.**
- **Nothing below 12, ever.**

### Sources
| Source | Ruling |
|---|---|
| Apple HIG | Body **17pt**; absolute minimum 11pt |
| Material Design 3 | Body Large **16sp**; Body Small 12; Label Small 11 |
| WCAG / a11y consensus | No formal minimum; 16px accepted web body; **below 14px fails for mild low vision** |
| Typotheque (CJK) | CJK needs **~1.7 leading** vs Latin's 1.2 — higher information density per character |
| Bobby Tung (W3C CLReq editor) | Line-height 1.5–2.0em for Chinese |

> **Sourcing honesty.** The widely-repeated "16px is the minimum for Chinese on screen"
> could not be confirmed in a primary source — the CJK authorities give *leading*
> guidance and omit sizes. The floor here is **derived**, not cited: if 16px is the
> Latin body standard and CJK is authoritatively denser per character, CJK body cannot
> be *smaller* than 16px.

---

## 2. Why roles bind leading to size

A measured audit of `apps/web` found **814 of 957 in-scope CSS rules (85%) set a
`font-size` with no `line-height` at all** — a leading:size ratio of **143/957 = 0.15**.

`apps/mobile` had statistically the same defect before its own pass (87/589 = **0.15**),
and it is the stated reason roles exist there.

This matters more than it sounds. **CJK at 17px with an inherited Latin ~1.2 leading
reads *worse* than 13.6px with correct leading.** A token that describes only a size
lets every call site re-decide leading, and 85% of them decide wrong by omission.
Raising sizes without fixing leading would not have fixed the underlying complaint.

So each role carries size **and** leading. That pairing is the point.

---

## 3. How to use it — web

```css
/* Foo.module.css */
.summary {
  composes: body from "../styles/type.module.css";
  color: var(--text-primary);
}
```

### Three rules, each with a measured reason

**① Import by FILE PATH — never `from global`.**
Verified against lightningcss 1.32.0 and a real Turbopack build:

| Form | Result |
|---|---|
| `composes: bdy from global` (typo) | **compiles clean, emits an EMPTY rule** |
| `composes: body from "./nope.module.css"` (bad path) | ✅ **build fails** — `Module not found` |
| `composes: bodyy from "../styles/type.module.css"` (bad **name**) | ⚠️ **compiles clean** |

A silently-empty rule gives the element **no size and no leading** — it inherits 16px
at Latin default leading, which looks approximately right at a glance and is *worse*
for CJK. The file form at least turns a bad **path** into a build failure.

> ⚠️ **A bad class NAME is still silent** — this is why the guard cross-checks every
> composed name against `type.module.css`. Do not rely on the build to catch a typo.

**② Never override a composed role's `font-size`.** Pick a different role.
The token class and the consumer class have equal specificity, so the winner depends
on emitted source order. (Measured: consumer currently wins, identically in dev and
prod. But that is emergent chunk ordering, not a guarantee — and an overridden size is
an unaudited size.)

**③ `composes` is ILLEGAL in two places.** Use the custom properties instead:
- inside `@media` / any at-rule
- on non-simple selectors — `.a .b`, `div.a`, `.a:hover` (comma groups are fine)

```css
@media (max-width: 600px) {
  .cell { font-size: var(--t-cell-size); line-height: var(--t-cell-leading); }
}
```

The `--t-*-size` / `--t-*-leading` vars are declared in `globals.css`. **They are legal
ONLY in those two carve-outs** — using them where a role class would work is a defect,
and the guard enforces it. Always emit the size/leading pair together.

---

## 4. Form controls — a behavioural rule, not an aesthetic one

**Any focusable `input` / `select` / `textarea` takes `control` (17) — never
`bodyTight`, `cell`, or `label`.**

Mobile Safari force-zooms the viewport when a focused control is under 16px, and does
**not** zoom back out. The scale steps 15 → 17 with nothing at 16 precisely so that a
compact field cannot quietly land under the threshold.

---

## 5. Media queries must never shrink below the floor

A small viewport gets relief from **layout** — stack, wrap, scroll — never from
shrinking type. Reducing a *display* size (e.g. a 4rem hero → 3rem) is fine; pushing
any text below 14 is not.

---

## 6. Documented exceptions

Every exception is an allowlist entry with a stated reason, so exceptions must be
*decided on* rather than merely accumulate.

| Exception | Reason |
|---|---|
| `Shareable*.module.css` | A 1200×1600 PNG **capture coordinate space**, not screen text. Scales with the canvas. |
| `app/api/og/**` | Same category — OG-image capture space. |
| Mobile ornament allowlist (4 entries) | Bullet •, ornament glyph, 💎 emoji, Latin numeral badge — no CJK strokes, so density is not a factor. See `typography-guards.test.ts`. |
| Admin routes | Internal tooling, deliberately dense. |
| `ZwdsChart.*` | Out of scope. |

---

## 7. Enforcement

Web guards mirror `apps/mobile/src/theme/__tests__/typography-guards.test.ts`:

| Guard | Rule |
|---|---|
| **A** | Nothing below the floor outside the named allowlist — CSS **+ SVG `fontSize=` attrs + inline `style={{fontSize}}`** |
| **B** | A raw `font-size` must be accompanied by `line-height` in the same block, or come from a role class |
| **C** | No focusable control under 16px (static class list + a live DOM check) |
| **D** | No `@media` declaration below the floor |
| **E** | Every composed role name exists in `type.module.css` (a bad name compiles silently — §3①) |

Budgets are **emitted by `scratchpad/typeaudit/audit.py`**, never hand-derived.
Ratchets are one-sided (fail on increase) during migration, two-sided once final.

> **SVG and inline styles are in scope.** A stylesheet-only audit misses them — that is
> how 11px CJK survived in the compatibility radar chart. Any sweep must walk
> `svg text` nodes explicitly.
