# 八字時辰未知 (Unknown Birth Hour) — Session Handoff

**Read this first to pick back up after compaction.**

## Status: Phase 1 SHIPPED (committed `354bebe` on branch `feat/unknown-birth-hour`, NOT pushed, NOT in main)

Feature: a first-class **「時辰未知」** path that produces an honest **3-pillar (年/月/日)** Bazi reading when the user doesn't know their birth hour. Phase 1 = **LIFETIME (八字終身運) only + make-it-not-crash**. Other reading types are Phase 2/3.

## Key documents (read in this order)
1. **Approved implementation plan + full review/impl log:** `/Users/roger/.claude/plans/i-just-switch-to-quizzical-church.md` — the canonical plan (12 decisions D1–D12, Central engine strategy, §1–8, Phasing, Verification, Round 1–3 staff-engineer review log, Phase 1 IMPLEMENTED + browser-test log). **Source of truth.**
2. Comprehensive design doc (repo): `.claude/plans/plan-unknown-birth-hour.md`
3. Research memo (gold standard / competitors / engine impact): `.claude/plans/research-unknown-birth-hour.md`
4. Staff-engineer review files (Round 1–3): `.claude/plans/i-just-switch-to-quizzical-church-agent-{a5dca…, a2ba…, abf9…}.md`

## Locked product decisions (D1–D12) — see plan for full table
D1 first-class 時辰未知 → honest 3-pillar, never silent-guess for analysis. D2 no in-place unlock CTA (only a NEW reading with the hour). D3 immutable hour state (set at creation). D4 keep exact time picker + toggle. D5 no 定盤/tiers. D6 acknowledgement at the spend-credits step (NOT at 排盤) — revised 2026-06-13. D7 用神 "A + auto-detect tail". D8 in-place 「需要出生時辰」 notes + global hint. D9 compat partial (Phase 3). D10 fortune available (Phase 2). D11 ZWDS ignored/dropped. D12 header basis line + 三柱 badge.

## What Phase 1 delivered (architecture)

**Central engine strategy** (the load-bearing bit): when `hour_known=false`, use a **transient NOON placeholder** for y/m/d + 大運 datetime internals (noon avoids the 23:00 子時 day boundary), then **blank the hour pillar** (empty stem/branch) before `calculate_four_pillars` returns. The empty hour stem is the canonical "unknown" signal (`is_hour_unknown`). Every analytical loop has a **skip-when-empty guard** (`if not pillar['stem']: continue`) so 五行/strength/十神/從格 compute on 3 pillars without KeyError. 命宮/身宮 → null (need 時支); 胎元 (month) / 胎息 (day) survive.

**Hour-dependence (engine-verified):** SURVIVE = 日主, 年/月/日 三柱, 月令格局, 配偶宮=日支 + 紅鸞/沖日支, 胎元/胎息, 大運 sequence, 生肖. LOST = 時柱 + 時柱十神/神煞, 子女宮, 晚年, 命宮/身宮, 時支神煞. DEGRADED = 用神/五行比重 (3-pillar, flagged), 起運 age (≤±2mo via noon), 神煞 completeness.

**D7 用神 flags** (on `dayMaster`): `hourUnknown:true`, `yongShenConfidence:'reduced'`, `yongShenCaveat:'borderline'` when V2 score within ±3 of a band boundary (boundaries `(25,40,55,70)`), `geJuStatus:'undetermined_without_hour'` when 從格 detected.

**API:** FastAPI `BirthDataInput.birth_time` Optional + `hour_known` field; Prisma `birthTime String?` + `hourKnown Boolean @default(true)` migration; NestJS DTO `@ValidateIf((o)=>o.hourKnown!==false)`; `hour_known` threaded NestJS→FastAPI→engine; cache hash sentinel `?? 'HOUR_UNKNOWN'`; **deterministic AI suppression block** in `interpolateLifetimeV2Fields` (gated `data['hourKnown']===false` → cache-safe).

**AI suppression block** (`ai.service.ts::interpolateLifetimeV2Fields`) enforces: no fabrication/detail of hour items; **in-place 「需要出生時辰」 note, NOT silent omission** (D8); **神煞 false-negative guard** (禁止「命中無某神煞」); 用神「（時辰未知，僅供參考）」; 格局待確認 when undetermined; **D2-aligned 補時辰 phrasing** (「日後得知時辰，可另建新的命盤查看完整分析」, never 「我可以為你提供」).

**Frontend:** `BirthDataForm.tsx` 時辰未知 toggle **below the time row** (disables time dropdowns + plain hint); **no submit-time modal** — 開始排盤 → free 3-pillar preview directly, and the acknowledgement rides inside the shared `UnlockConfirmModal` via a `hourUnknown` prop (gated `!!chartData && !chartData.fourPillars?.hour?.stem`) at 解鎖完整報告; `BaziChart.tsx` 時柱 column placeholder + header tag + basis line (`text-align:left`) + 公曆「（時辰未知）」; nullable `birthTime` types across `birth-profiles-api`/`readings-api`/`date-time-utils`. Wording is plain/beginner-friendly throughout (revised 2026-06-13 — see refinements below).

## Phase 1 UI/UX refinements (2026-06-13) — browser-verified. **These set the style Phase 2/3 must follow.**
Owner-feedback polish on the shipped LIFETIME flow. Full rules in the master plan (D6, D8, §5, §6, §7 + the "Phase 1 UI/UX refinements" review-log entry). The four changes:
1. **Toggle below the time picker** — `我不知道出生時辰` sits under the 時／分／午別 row (was above) + plain hint on tick. `BirthDataForm.tsx` (+`.module.css`).
2. **Acknowledgement at unlock, not at 排盤** (D6) — deleted the submit-time modal (JSX + state + dead `.modal*` CSS); `handleSubmit`→`performSubmit()`. Warning now rides inside `UnlockConfirmModal` via `hourUnknown` prop, gated `hourUnknown={!!chartData && !chartData.fourPillars?.hour?.stem}`. **Reuse this prop on every paywall surface** — LIFETIME/LOVE/CAREER/ANNUAL share `UnlockConfirmModal` (free); **FORTUNE (`FortuneUpgradeModal`) + COMPATIBILITY must port the block in Phase 2/3.**
3. **Plain wording everywhere** (D8) — basis line / form hint / unlock-modal warning / AI in-place notes all lead with 「由於未提供出生時辰…」, gloss 時柱→「出生時辰那一柱」. Keep the unlock-modal list ↔ AI in-place notes in sync.
4. **Basis line left-aligned** — `.hourUnknownBasis { text-align:left; }` (sits in a centered header). `BaziChart.tsx` (+`.module.css`).

Files touched: `BirthDataForm.tsx`/`.module.css`, `UnlockConfirmModal.tsx`/`.module.css`, `BaziChart.tsx`/`.module.css`, `reading/[type]/page.tsx`. Frontend-only (no engine/NestJS rebuild). Browser E2E (fresh chart 1995-11-08 時辰未知): toggle-below + plain hint ✓; 開始排盤 → free preview, no popup ✓; basis line `text-align:left` + plain copy ✓; 解鎖完整報告 → `UnlockConfirmModal` warm-amber warning block (5 plain bullets + 「僅供參考」 + 「另建新命盤」) above feature grid + 💎 cost ✓; cancelled (no credits); zero console errors.

## Verification (all green)
- Engine: **9 new `test_unknown_hour.py`** (Roger neutral + Laopo weak-DM no-crash) + **2944 suite pass** (only the documented pre-existing `test_roger_laopo_full_preanalysis` fails). API `tsc` clean; web `tsc` only the pre-existing ChatDrawer JSX-identity error.
- **3-parallel line audit** caught 2 criticals my single-anchor test missed (`check_cong_ge` crash on weak DM; frontend `callDirectEngine` never sent `hour_known` → 422) + 3 high/med — all fixed & re-verified.
- **Browser E2E (LIFETIME, signed-in real flow): PASS** — toggle→modal→engine→chart→**live Claude AI**, no 422, no crash, zero fabricated hour content, 角色卡 rendered. Re-verified the in-place 子女關係 「⚠️時辰未知限制說明」 note on a fresh chart. 6 test credits used.

## Calibration anchors
- Roger `1987-09-06 16:11 吉打 male` known = 丁卯/戊申/戊午/庚申, DM 戊; **unknown-hour** = 丁卯/戊申/戊午/(blank), 用神 火, 旺衰 中和 42分 (borderline), 食神格. y/m/d byte-identical to known.
- Laopo `1987-01-25 12:00 台北 female` = 丙寅/辛丑/甲戌/壬申, DM 甲 weak — the weak-DM `check_cong_ge` regression anchor.

## ⚠️ DEFERRED — do NOT assume these work
- **CHAT is Phase 2 + currently UNGUARDED**: building chat-context for an hour-unknown profile merges all 4 pipelines (love/career/annual unguarded) → **would crash**; no chat suppression directive yet. Readings show a 「問 AI 命理師」 button — DON'T use on hour-unknown profiles until Phase 2.
- **Non-LIFETIME reading types** (CAREER/ANNUAL/LOVE/COMPAT/FORTUNE/ZWDS): engines unguarded for blanked hour → **500 if a user picks them for an hour-unknown profile**. User decided NOT to add a frontend availability gate (app not live). Phase 2 guards these.
- Other deferrals: ElementExplanation 時柱-click note; UpdateBirthProfileDto birthTime immutability (latent inconsistency, benign — engine keys off hourKnown); modal focus/Escape a11y; ProfileCard 時辰未知 marker; API-jest + Web-RTL test coverage.

## Phase 2 plan (next)
LOVE + CAREER + ANNUAL + FORTUNE: per-module deref-audit (guard every `['hour']` deref → null/flag per matrix) + apply the SAME AI suppression block shape (in-place notes + 神煞 guard + D2 phrasing — §5 of the plan) to each reading-type injector + **chat AI guard** (guard the engine chat-context pipelines + add suppression). Phase 3 = COMPATIBILITY partial + 神煞 partial-scan + polish.

## Gotchas carried forward (IMPORTANT)
- **Servers must be restarted DETACHED** (`nohup … & disown`), NOT via `run_in_background` — the latter gets killed between turns. Engine: `cd packages/bazi-engine && source .venv/bin/activate && nohup uvicorn app.main:app --host 0.0.0.0 --port 5001 > /tmp/bazi-engine.log 2>&1 & disown`. NestJS (after `nest build`): `cd apps/api && export ANTHROPIC_API_KEY="$(grep '^ANTHROPIC_API_KEY' .env | cut -d= -f2)" && nohup node --import tsx dist/main.js > /tmp/nestjs.log 2>&1 & disown`. Next: `cd apps/web && nohup npx next dev --port 3000 > /tmp/nextjs.log 2>&1 & disown`.
- **After editing `ai.service.ts`/services → REBUILD NestJS** (`../../node_modules/.bin/nest build`) + restart; the running PID has stale code.
- **Next.js HMR stale across session boundary** → hard-reload (Cmd+Shift+R) or restart the dev server; the toggle/changes won't show otherwise.
- **Browser:** use `http://127.0.0.1:3000` (HSTS dodge); Clerk handshake makes you signed-in (Roger). Fill React-controlled inputs via the native-setter + dispatch input/change pattern.
- **Reading cache has NO prompt version** in its key (`birthDataHash` = birthDate|birthTime-sentinel|city|gender|readingType|targetYear). A prompt change won't reflect for the SAME chart unless you flush Redis or use a DIFFERENT birth date.
- **Migration applied non-destructively** on dev DB (direct `ALTER` + `prisma migrate resolve --applied`) because `prisma migrate dev` wanted to RESET (pre-existing folk-content migration checksum drift — chronic, unrelated). For prod: `prisma migrate deploy` applies `20260609000000_add_hour_known_to_birth_profiles` cleanly.

## Deploy notes (when this reaches main)
- `prisma migrate deploy` (applies `hour_known` + nullable `birth_time`). No new env vars.
- No mass cache bust needed for known-hour (suppression is gated `hourKnown===false`; hour-unknown is a new chart hash). If the LIFETIME prompt block changes, bump nothing in the reading cache (no version field) — flush Redis if you want existing hour-unknown readings regenerated.
- ZWDS being dropped — left compile-only widened with TODO markers.
