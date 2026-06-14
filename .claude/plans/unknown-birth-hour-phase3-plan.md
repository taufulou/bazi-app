# 八字時辰未知 — Phase 3 (COMPATIBILITY / 合盤) Implementation Plan

**Status: DRAFT for review (staff-engineer + Bazi-master + calculation-correctness sub-agents).**
Branch `feat/unknown-birth-hour`. Master plan: `/Users/roger/.claude/plans/i-just-switch-to-quizzical-church.md` (D9 + §4 + §8). Phase 1/2 + (a) shipped; this is the last reading type.

---

## 1. Goal & scope

Make the COMPATIBILITY (合盤) reading produce an honest **partial** result when **one or both** parties don't know their birth hour, mirroring the Phase 1/2 pattern (3-pillar engine + per-party AI suppression + plain UI caveat). Per **D9**: «合盤 = allow partial when one/both lack the hour (day-branch 配偶宮 core survives); flag hour-dependent cross-interactions.»

Today compat **sidesteps** the feature: `toBirthDataFormValues` hard-codes `hourKnown:true` (with a "Phase 3" TODO comment), and `hour_known` is dropped at every integration layer, so an hour-unknown party would have its hour **fabricated** (NOON placeholder). There is also ONE real engine **score-distortion bug** (post-review: `compatibility_enhanced.py` Dim 6b only — blank-hour pairs inflate the `max_*` denominator). No crashes today — the risk is silent wrong output. **Plus a LIVE pre-existing 500** (§5): hour-unknown profiles created in Phase 1/2 are already selectable in the compat picker → the (a) N1 validator 422s → NestJS 500.

**In scope:** the `romance` comparison type (the live one). `business`/`friendship`/`parent_child` comparison types reuse the same engine path and get the same crash-safety + honest-score fix for free, but their bespoke AI/UI is out of scope for explicit verification (note in tests).

---

## 2. ⭐ D9 doctrine matrix — which compat signals survive / degrade / are withheld (REVIEW THIS FIRST)

This is the genuinely-new doctrine for Phase 3 and the focus of the Bazi-master review. Engine-grounded classification (from the deref audit), with the proposed Phase-3 treatment:

> **Review status (2026-06-14):** Bazi-master sub-agent **APPROVED** the doctrine (cited gold-standard sources) with 2 required annotations, now folded in below. Staff-engineer + calc-correctness sub-agents **corrected the score-distortion scoping** (see Row 6 + §4). This table is the post-review version.

| # | Dimension (engine fn) | Hour input? | Survives without hour? | Phase-3 treatment |
|---|---|---|---|---|
| 1 | 用神互補 `score_yongshen_complementarity` | uses each party's 用神 (already 3-pillar + `confidence:'reduced'` from Phase 1) | **SURVIVES — but materially degraded** | inherit the 用神 caveat; **AI/UI must present this (and Row 5) at VISIBLY LOWER confidence than 配偶宮** — per master, a missing hour genuinely weakens DM-strength(旺衰)→用神 selection, more than "inherit a caveat" implies. No compat-specific math change. |
| 2 | 日柱天干 `score_day_stem_relationship` | day stem only | **SURVIVES (full)** | none |
| 3 | 日支配偶宮 `score_spouse_palace` | **day branch** (the heart of 合盤) | **SURVIVES (full)** | none — Phase 12i 三刑 pool already excludes blank hour (guarded at `compatibility_enhanced.py:481-483`). Master confirms 日支夫妻宮 is the unanimous core of 合婚 and is date-derived (hour-independent). |
| 4 | 十神交叉 `score_ten_god_cross` (官殺混雜/傷官見官) | scans all 4 pillar stems cross-party | **DEGRADES — but already honest today** | `derive_ten_god('')→''` is an **intentional Phase-1 guard** (NOT an accident); the loops already skip `''` → the 官殺混雜/傷官見官 verdict is already computed honestly over the 3 known pillars. An explicit `if pillar=='hour' and unknown: continue` is **optional hygiene only (zero behavior change)** — do NOT budget it as a correctness fix. |
| 5 | 五行互補 `score_element_complementarity` | aggregate `fiveElementsBalance` (3-pillar for the unknown party, flagged) | **SURVIVES — degraded (inherits Row 1)** | inherit the reduced 用神/element-balance confidence; present below 配偶宮 confidence |
| 6 | 全盤互動 `analyze_cross_chart_branches` (6b, **scored**) + `analyze_cross_chart_stems` (6a, **findings-only**) | 4×4 cross-party stem/branch pairs incl. hour | **DEGRADES** | **THE one real score-distortion site = 6b only.** Its `max_positive`/`max_negative` denominators accumulate weight for EVERY pair incl. blank-hour ones → a missing hour inflates the denominator and dilutes the dim score (empirically 100→87.5). FIX: skip blank-branch pairs in the 6b loop so `max_*` excludes them. **6a has NO max-denominator and never feeds the score** (only `branch_analysis['rawScore']` enters the weighted sum) → its blank-skip is optional findings-honesty only. |
| 7 | 神煞互動 `score_shen_sha_interactions` | day-branch-keyed cross-party | **SURVIVES (full)** | per-party individual 神煞 lists may carry 時支 entries → mark `partial:true` (no false 「命中無」). Master: 神煞 like 桃花/驛馬/貴人 CAN sit on 時支, so absence is unprovable for an hour-unknown party — the 「命中無」 guard is load-bearing. |
| 8 | 大運同步 `sync_luck_periods` | 大運 sequence (hour-independent — Phase 1) | **SURVIVES (full)** | none |
| **NEW** | **子女緣 / 晚年同偕 compatibility** (時柱 = 子息宮 + 晚年) | hour branch/stem | **WITHHELD (for the hour-unknown party)** | Master-required addition: 時柱 is the 子女宮 + 晚年宮; children-compatibility and shared-late-life are legitimate 合婚 sub-topics that are **fully withheld** (not merely degraded) when a party lacks the hour. Not a scored engine dimension — enforced at the **AI suppression layer (§6)**: forbid any 子女緣/晚年 compatibility claim for the hour-unknown party. |
| — | basic `compatibility.py::calculate_compatibility` 4×4 branch loop | hour branches | **DEGRADES gracefully — NO distortion** | `all_branch_relationships` only ever holds *found* relationships (`analyze_branch_relationship('',X)→[]`); the score is a **ratio of real relationships** (`total=len(all_branch_relationships)`), already honest (empirically full==blank). **Flag only** — add `hourUnknownParties`/`partial` to the output; a defensive blank-skip is optional cosmetic, NOT a score fix. |
| — | romance pre-analysis (`compatibility_romance_preanalysis.py`, Phases 1-6) | various | **SURVIVES (already guarded)** | verify Phase 2/4 + ensure `hourUnknown` surfaced (already done for lovePersonality/crisis) |

**Headline doctrine claim — CONFIRMED by the Bazi-master review:** the heaviest 合盤 signals — 配偶宮(日支), 日柱 interaction, 用神/五行 complementarity, 大運 sync, day-branch 神煞 — are all hour-**independent**, so 合盤 degrades *gracefully* without the hour. The only genuine losses are hour-stem 十神 cross-mixing, hour-branch cross-pillar 合/沖/刑/害, and (newly explicit) 子女緣/晚年 compatibility. This matches the day-branch-配偶宮-centric nature of 合婚.

**Master's answers to the open questions:** (a) partial (3-pillar) 合婚 **is** accepted as a *preliminary* analysis (must be flagged 「僅供參考」, never a final verdict) — multiple consensus + 盲派 sources. (b) Do **NOT** numerically penalize the score — the degradation is *epistemic* (confidence), not *substantive* (吉凶); honesty lives in the partial-flag/confidence label, never in a score haircut. (c) Two reclassifications applied above: Row 1/5 framed at lower confidence; new WITHHELD row for 子女緣/晚年.

---

## 3. Central strategy (per-party, honest-partial)

1. **Per-party blank hour.** Each party's chart is built with that party's `hour_known`; the unknown party's hour pillar is blanked (Phase 1 machinery, proven). **Two engine entry points** (name both — they're different): the **reading** path uses `calculate_bazi(**birth_data_a)` (a dict splat, `calculator.py:670-700`); the **chat** path uses `calculate_bazi_with_all_pipelines(hour_known=…)` (`chat_context.py:192`). Adding `'hour_known'` to the per-party dicts threads both. Three cases must all work: A-only, B-only, both unknown.
2. **Honest partial score (load-bearing) — scoped to ONE site (post-review).** The ONLY score-distortion is `compatibility_enhanced.py::analyze_cross_chart_branches` (Dim 6b): its `max_positive`/`max_negative` denominators accumulate weight for blank-hour pairs, diluting the dim score (empirically 100→87.5). FIX: skip blank-branch pairs so `max_*` excludes them (→ honest 100). **The legacy `compatibility.py` 4×4 loop is already honest** (ratio of real relationships only) — flag-only, no score fix. Dim 6a + Dim 4 are already honest — optional hygiene only.
3. **Emit explicit signals, not sentinels.** Engine output gains a top-level `hourUnknownParties: []|['A']|['B']|['A','B']` + `partial: bool`, and per-dimension `partial:true` where a hour-keyed sub-signal was skipped. Mirrors `romance_preanalysis`'s existing per-party `hourUnknown`.
4. **Byte-identical when both hours known.** Every guard is gated on the blank-branch/blank-stem path only; a both-known compat is bit-for-bit unchanged (regression-locked by the 53-pair corpus + gold-standard suites — confirmed green today).
5. **N1 composes — but the form flip alone is NOT enough.** The compat DTOs already inherit `_HourKnownValidatedInput` (via nested `BirthDataInput`/`ChatContextInput`). The end-state: form sends `hourKnown:false + birthTime omitted` → NestJS profile-create stores `hourKnown=false, birthTime=null` → **§5 NestJS threading sends `hour_known:false` to FastAPI** → passes N1 → engine blanks the hour. **N1-pass depends on §5 (NestJS threading), not §7.1 (form flip) alone.** Until §5 lands, NestJS omits `hour_known` → FastAPI defaults `True` → N1 422s any null-time party (see the live-500 note in §5).

---

## 4. Engine work-list (grounded in the deref audit)

### 4a. `compatibility_enhanced.py::analyze_cross_chart_branches` (Dim 6b) — THE one real score fix
- **This is the only score-distortion site (confirmed empirically by 2 reviewers).** The loop (~966-1018) accumulates `max_positive += weight` (~977/987) and `max_negative += weight` (~995/1006) for EVERY iterated pair — including blank-hour pairs — while `positive_weighted`/`negative_weighted` only accumulate on real matches. The dim score (`~1079-1080`) divides by the inflated `max_*` → a missing hour dilutes it (empirically all-六合 pair: 100 both-known → **87.5** A-unknown).
- **Fix:** skip a pillar-pair when either branch is `''` so it never contributes to `max_*` (nor to the matched weights). Restores the honest score (→100) and is divide-by-zero-safe (both-unknown still leaves 3×3=9 real pairs; existing `max(…, 0.001)` guards at ~1072/1075/1094 backstop). The 三合/三刑 subset logic (~1031-1065) is already safe (`''` never in a 3-branch trio).

### 4b. `compatibility.py::calculate_compatibility` — FLAG ONLY (no score bug here)
- **Post-review correction:** the 4×4 loop (~194-202) only appends *found* relationships (`analyze_branch_relationship('',X)→[]`), so `all_branch_relationships` never contains blanks; the score is a **ratio of real relationships** (`total=len(all_branch_relationships)`, ~253), already honest (empirically full==blank: 42→42, 76→76). **NO score fix.** Just add `hourUnknownParties` + `partial` to the returned dict. (A defensive `if branch_a=='' or branch_b=='': continue` is optional cosmetic — changes no score.)

### 4c. `compatibility_enhanced.py` — other dimensions (mostly verify-only)
- **Dim 6a** `analyze_cross_chart_stems` (~889-920): has NO max-denominator and feeds the score only via `branch_analysis['rawScore']` (6a's `stemAnalysis` is findings metadata at ~1654). Already honest. Optional blank-stem skip = findings-cleanliness only; do NOT gate the slice on it.
- **Dim 4** `score_ten_god_cross` / `_detect_cross_guan_sha_hun_za` / `_detect_cross_shang_guan_jian_guan` (~726-791): already honest — `derive_ten_god('')→''` is an intentional Phase-1 guard; the loops skip `''`; the 官殺混雜/傷官見官 verdict is already correct over 3 pillars (no off-by-one in the threshold). An explicit hour-skip is optional readability hygiene (zero behavior change).
- **Dim 3** `score_spouse_palace`: already guarded (~481-483) — **regression test only, no code change.**
- **Dims 1/2/5/7/8:** hour-independent — verify, no change. For Dim 7, ensure any per-party individual 神煞 list with 時支 entries carries a `partial` marker (no false absence — master-confirmed load-bearing).
- Thread per-party `hour_unknown_a`/`hour_unknown_b` (via shared `is_hour_unknown` on each chart) into the dimension dispatch; add `hourUnknownParties`/`partial` to the result.

### 4c. `compatibility_romance_preanalysis.py`
- Already well-guarded (Phases 1/3/5 explicit `_hour_is_unknown`/`i==3`; Phase 2 degrades safe; lovePersonalityA/B + crisis already emit `hourUnknown`). **Verify Phase 2 (`compute_spouse_enrichment`) + Phase 4 (`compute_post_marriage_quality`)** carry the `partial` flag through to output. Replace the local `_hour_is_unknown` with the shared `four_pillars.is_hour_unknown` if trivial (consistency; optional).

### 4d. Shared
- Reuse `four_pillars.is_hour_unknown(chart)` everywhere (promoted in Phase 1) instead of the file-local `_hour_is_unknown`.
- **No new crashes possible** (audit confirmed empty string is dict-safe across all helpers); this is purely a wrong-output + honesty + threading change.

---

## 5. Integration threading work-list (the `hour_known` is dropped at every layer)

> ⚠️ **This section fixes a LIVE pre-existing 500 (staff-engineer finding, conf 85) — required REGARDLESS of the form flip.** A Phase-1/2-created hour-unknown profile (`birthTime=null, hourKnown=false`) is **already selectable** in the compat profile picker (`DualBirthDataForm.tsx:343` only filters out the already-chosen Person A, not hour-unknown profiles). Selecting one today: `callBaziCompatibility` sends `birth_time:null` + omits `hour_known` → FastAPI defaults `hour_known=True` → the (a)-shipped N1 validator 422s → NestJS catches → `InternalServerErrorException` (`bazi.service.ts:748`). So §12's "none in prod" applies only to the quick-create path; the cross-reading-type reuse path is **live-broken now**. §5.5/§5.6 (NestJS sends `hour_known: profileX.hourKnown`) is the fix and must land in slice **3b**, before any deploy that exposes hour-unknown profiles.

**FastAPI** (`packages/bazi-engine/app/main.py`):
1. `/compatibility` endpoint (~314-333): add `'hour_known': data.profile_a.hour_known` + `…profile_b…` to both per-party dicts.
2. `/build-chat-context-compat` (~470-487): same.

**Engine** (`packages/bazi-engine/app/chat_context.py`):
3. `build_chat_context_compat` (~158): extract `hour_known` from each `birth_data_*` dict and pass to `calculate_bazi_with_all_pipelines(hour_known=…)` (~192, ~202).
4. `_slim_party_for_compat` (~715-738): surface per-party `'hourKnown': ctx.get('hourKnown', True)` (mirror single-chart `build_chat_context:128`).

**NestJS** (`apps/api/src/`):
5. `bazi.service.ts::callBaziCompatibility` (~1310): widen both param types with `hourKnown: boolean`; add `hour_known: profileX.hourKnown` to both `profile_*` payload objects (~1318-1339); pass the already-loaded `profileA`/`profileB` from `createComparison` (~744).
6. `chat-context.service.ts::fetchChatContextFromEngineCompat` (~1279): add `hourKnown` to both param types + `hour_known: p.hourKnown` in `buildPayload`; `getChatContextForComparison` (~467) passes `profileA.hourKnown`/`profileB.hourKnown`.

(DB needs **no** change — `BaziComparison` references two `BirthProfile` rows; `hourKnown` is already reachable.)

---

## 6. AI suppression (per-party, compat-specific) — explicit spec (staff-engineer finding, conf 80)

The single-chart helper `buildHourUnknownSuppressionBlock(data, …)` **cannot be reused as-is** — it reads top-level `data['hourKnown']` and `data['dayMaster']`, neither of which exists in compat data (shaped `{chartA, chartB, …}`; the engine writes `hourKnown`/`dayMaster` **per chart** at `calculator.py:429`). And the chat directive at `chat-prompt-builder.ts:221` gates on a single top-level `chatContext.hourKnown` with single-chart wording — wrong for two parties. So:

**Reading path** (`ai.service.ts`):
- In `buildCompatibilityRomanceV2Prompts` (~4885) / `interpolateCompatV2ChartFields` (~5070): add a **compat-specific per-party** suppression builder. Gate per party on `chartA['hourKnown']===false` / `chartB['hourKnown']===false`; read `chartX['dayMaster']` for that party's `geJuStatus`. Emit a per-party block with **男方/女方** wording: forbid fabricating that party's 時柱十神/藏干/神煞, 命宮, 身宮 — **and (master-required WITHHELD row) that party's 子女緣/子女宮 compatibility + 晚年同偕**.
- Add a compat **cross-interaction** clause: «時辰未知的一方，其時柱與對方的合/沖/刑/害交互無法判斷，禁止編造」 + the 神煞 false-negative guard (神煞僅就現有三柱論述；禁止「命中無」). 
- Confidence-framing clause (master annotation): when a party is hour-unknown, present 用神互補/五行互補 as 「參考性較低」 relative to 配偶宮 — never with equal confidence.
- Home: the V2 system prompt is shared across call1/2/3, so the block belongs there (one injection), not per-call. Verify which template actually carries the per-party chart fields.

**Chat path** (`chat-prompt-builder.ts` + the compat slim): do NOT overload the top-level `chatContext.hourKnown`. The compat slim (`_slim_party_for_compat`) surfaces per-party `hourKnown` (§5.4); add a **compat-specific per-party branch** in `buildPrompt` that emits the same 男方/女方 directive when `chartA.hourKnown===false`/`chartB.hourKnown===false`.

- Plain wording per D8: lead with 「由於一方（或雙方）未提供出生時辰…」, gloss 時柱→「出生時辰那一柱」.
- **Cache:** all blocks gated on `hourKnown===false` → both-known prompts unchanged → **no `CHAT_PROMPT_VERSIONS`/pre-analysis-version bump, no mass eviction** (consistent with Phase 2).

---

## 7. Frontend work-list

1. **`date-time-utils.ts::toBirthDataFormValues`** (~116): replace the hard-coded `hourKnown: true` with the actual `quickMode`-derived value (`hourKnown: !quickMode`, omit `birthTime` when quick). This is the one-line unblock; the `PersonBirthFields` toggle UI already exists. (Composes with N1: now sends `hourKnown:false` + no time → passes.)
2. **`CompatibilityRomancePaywallCTA.tsx`**: add an `hourUnknown?: boolean` (or `hourUnknownParties`) prop; render the warm-amber warning block ported from `UnlockConfirmModal` (plain D8 copy, per-party wording «男方/女方時辰未知»). Mount-site (`compatibility/page.tsx` ~813) passes it from the engine output's `hourUnknownParties`.
3. **`AIReadingDisplay.tsx::CompatSectionBadge`** (~1220): gate hour-dependent badge content on the per-party `hourUnknown` (from `rpa.lovePersonalityA/B.hourUnknown`) — add an in-place 「需出生時辰」 note where a 時柱-keyed sub-signal is suppressed (mirror the annual_family note from (a)).
4. **Page banner** (`compatibility/page.tsx` ~852-859): **already exists** (fires on `lovePersonalityA/B.hourUnknown`) — keep; verify it reads the engine flag once threading lands. Optionally align copy with the D8 plain style.
5. Confirm `BirthProfile.hourKnown` flows through the compat profile-save + comparison-create path (the API lib already supports it).

---

## 8. Tests

**Engine pytest** (`tests/test_unknown_hour.py` + a compat section, or a new `test_compatibility_unknown_hour.py`):
- No exception for all 3 cases (A-only, B-only, both) through `calculate_compatibility` + `calculate_enhanced_compatibility` + the romance pre-analysis master orchestrator.
- **Pre-existing-500 regression (§5):** a comparison built from a Phase-1/2 **pre-existing** hour-unknown profile (not quick-create) must NOT 500 — i.e. NestJS threads `hour_known:false` → engine returns a partial result.
- **Honest-score regression (Dim 6b):** the Dim 6b score for an A-unknown pair must equal the score computed by manually dropping A's hour pillar from a both-known run (prove the `max_*` dilution is gone — e.g. an all-六合 pair returns 100, not 87.5). Assert no blank-branch pair appears in the Dim 6b cross-chart branch findings. (The legacy `compatibility.py` overall score is already a ratio — assert full==blank as a guard, not a fix.)
- 配偶宮 (Dim 3) score + 三刑/半刑 detection **unchanged** vs the day-branch-only expectation (survives).
- `hourUnknownParties` + `partial` flags set correctly per case.
- Per-party 神煞/十神-cross verdicts computed over 3 pillars (no phantom).
- **Byte-identical both-known:** a both-known compat (e.g. Roger×Laopo, both with hours) produces identical output pre/post Phase 3 (lock the existing compat gold-standard + pair-corpus suites stay green — 53-pair corpus + `test_compatibility_*`).

**NestJS jest:** `callBaziCompatibility` + `fetchChatContextFromEngineCompat` send `hour_known` per party (gate spec, mirror `fortune-prompt-builder.hour-unknown.spec.ts`); compat chat-context surfaces per-party hourKnown.

**Web RTL:** `toBirthDataFormValues` honors quickMode→hourKnown; `CompatibilityRomancePaywallCTA` renders the block when `hourUnknown`; `CompatSectionBadge` suppresses hour content.

**Calibration anchors:** Roger (`1987-09-06 16:11 吉打 male`) × Laopo (`1987-01-25 12:00 台北 female`), both-known = the regression baseline; then Roger-hour-unknown × Laopo-known, Roger-known × Laopo-unknown, both-unknown.

## 9. Verification (browser E2E, Claude in Chrome)
Create a compat with one party 時辰未知 → confirm: no 500; the result renders with the page banner + the per-party caveat; the overall score is honest (not artificially low); the paywall block shows the 時辰未知 warning; **live AI** never fabricates the unknown party's 時柱/子女/晚年/命宮/身宮 or hour-keyed cross-interactions, and never claims 「命中無」 a 神煞. Repeat for both-unknown. Confirm a both-known compat is unchanged.

## 10. Risks / open questions (Bazi-master + calc-correctness focus)
- **Doctrine (master):** §2's three open questions (partial 合婚 acceptance; confidence haircut yes/no; any mis-classified surviving signal).
- **Score honesty (calc):** is "exclude blank pairs from numerator+denominator" the correct way to keep the score honest, or does removing the hour change the *weighting* between dimensions in a way that needs renormalization? Does the spouse-palace floor / knockout logic interact badly with `partial`?
- **Both-unknown:** confirmed divide-by-zero-safe (calc review) — both-unknown leaves 3×3=9 real Dim-6b pairs, and existing `max(…, 0.001)` guards (~1072/1075/1094) + `compatibility.py`'s `total>0` guard (~250-254) backstop. The both-unknown test asserts an **honest score** (matches a manual-3-pillar baseline), not merely "no exception."
- **Comparison-type spread:** business/friendship/parent_child reuse the same engine — confirm the honest-score fix doesn't distort their (already-shipped) scoring.

## 11. Phasing (slices, each: implement → line-audit → browser/endpoint spot-check → commit)
- **3a — Engine honest-partial:** §4 (score-distortion fix + explicit hour-skip + `hourUnknownParties`/`partial` flags) + engine tests. The correctness core.
- **3b — Integration threading:** §5 (FastAPI + NestJS + chat-context) + gate specs. ⚠️ **Hard prerequisite for 3d** — the form flip (§7.1) sending `hourKnown:false` only works once 3b makes NestJS send `hour_known:false` to FastAPI; out of order → a user-facing 422. 3b also fixes the live pre-existing 500 (§5), so it can/should ship early.
- **3c — AI suppression:** §6 (per-party compat block + cross-interaction clause + chat parity).
- **3d — Frontend:** §7 (form flip + paywall block + badge gating + banner verify) + RTL.
- **3e — Browser E2E + comprehensive** (folds into the post-Phase-3 comprehensive run): §9 + the chart-diversity matrix + A2-style narrative QA.

## 12. Deploy notes
No migration. No env var. **No cache version bump** (all suppression gated `hourKnown===false`). Flush Redis only to regenerate existing hour-unknown compat readings/chats (there are none in prod — compat is currently hour-known-only). `npm install` where `html2canvas` missing.

---

## 13. Review log (2026-06-14) — 3 parallel sub-agents

Three independent reviews on the v1 draft. **Verdict: plan APPROVED after the corrections below** (folded into §2-§11 above). The reviews converged tightly — two reviewers independently + empirically caught the same mis-scoped score bug.

### Staff-engineer (NEEDS CHANGES → addressed)
- **[CRITICAL 90]** §4a mis-scoped the score bug: `compatibility.py`'s 4×4 loop has NO distortion (only appends found relationships; score is a ratio). The real + only distortion is `compatibility_enhanced.py` Dim 6b `max_positive`/`max_negative`. → §2/§3/§4 rewritten; §4a is now flag-only, §4a-new targets Dim 6b.
- **[HIGH 85]** Missed a LIVE pre-existing 500: hour-unknown profiles are already selectable in the compat picker → 422→500 today. → §5 ⚠️ note added; §8 regression test added; §11 marks 3b ship-early.
- **[HIGH 80]** §6 compat chat suppression under-specified (single-chart helper/gate can't handle two-party data). → §6 rewritten with explicit per-party reading + chat paths.
- **[MED 80]** §4b Dim 4 overstated (the `''` skip is an intentional guard, not an accident). → reclassified optional hygiene.
- **[MED 75]** §3 conflated the two engine entry points + the N1/form-flip dependency. → §3.1/§3.5 clarified.
- **[LOW 75]** §10 both-unknown guard largely redundant. → §10 corrected.

### Bazi-master, web-search (APPROVE — doctrine sound; 2 annotations → addressed)
Validated §2 against gold-standard sources (網易/知乎/華易網/神巴巴 + 盲派 + classical 合婚). **CONFIRMED:** partial 3-pillar 合婚 is accepted as *preliminary* (must flag 僅供參考); 配偶宮=日支 is the unanimous, hour-independent core; do **NOT** numerically penalize the score (degradation is epistemic, not 吉凶); the framing/ethics (plain caveat, no fabrication, no 「命中無」) match responsible-master practice.
- **Annotation 1:** frame 用神互補/五行互補 (Rows 1/5) at visibly LOWER confidence than 配偶宮 — a missing hour genuinely weakens DM-strength→用神. → applied to §2 Rows 1/5 + §6 confidence clause.
- **Annotation 2:** add an explicit **WITHHELD: 子女緣/晚年同偕** row — 時柱=子息宮+晚年, real 合婚 sub-topics, fully withheld for the hour-unknown party. → new §2 row + §6 suppression scope.

### Calculation-correctness, empirical (CALCULATION-SOUND — 2 scope corrections → addressed)
Ran the engine to confirm: legacy `compatibility.py` score is full==blank (42→42, 76→76 — no bug); Dim 6b is the sole distortion (100→87.5→100 with the fix); both-unknown leaves 9 real pairs (no divide-by-zero); dimension weights are fixed + pillar-count-independent (no renormalization needed); byte-identical when both known holds (53-pair corpus green). Dim 6a is findings-only (no score impact); Dim 4 explicit-skip == ''-accident (same count). → §4 scope trimmed accordingly; §11 ordering note added.

**Net:** the plan's central thesis (合盤 is 配偶宮-centric → degrades gracefully on 3 pillars; honest-partial via "fix the one real denominator + flag, don't penalize") is doctrinally + numerically sound. The corrections were scope/accuracy (one real fix = Dim 6b, not three) + two missed items (live 500; WITHHELD 子女/晚年 row), not a redesign.
