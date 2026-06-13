# 八字時辰未知 — Phase 2 deref audit (4-parallel, 2026-06-13)

Read-only audit of the four Phase 2 pipelines (LOVE / CAREER / ANNUAL / FORTUNE) for hour-unknown crash + wrong-output sites. Master plan: `/Users/roger/.claude/plans/i-just-switch-to-quizzical-church.md`. Phase 1 (LIFETIME) shipped; this is the Phase 2 work-list.

**Big takeaway:** the engine is nearly crash-clean on a blank hour — most lookups use `.get(...)` defaults and branch-relationship helpers tolerate `''` (set-membership never matches). The real work is: **1 engine guard + thread `hour_known` through the all-pipelines/FORTUNE path + a few WRONG-OUTPUT phantom-hour cleanups + port the AI suppression block to 6 injectors + chat guard + UI port.**

## Sub-phasing (recommended order)

### 2a — Engine safety + threading (foundation; unblocks everything)
1. **CAREER crash (the only one):** `ten_gods.py:322-323` — add `if not pillar['stem']: continue` at the top of the `calculate_weighted_ten_gods` 4-pillar loop (mirrors the guard its sibling `_accumulate_raw_element_scores` already has at `five_elements.py:74`). Without it, `_get_seasonal_multiplier('')` → `STEM_ELEMENT['']` KeyError. Drops the hour's mass → valid 3-pillar 十神比重 (DEGRADED, must be flagged). Shared helper — fixes the only crash blocking both CAREER reading and the all-pipelines path.
2. **Thread `hour_known`** through `calculator.py::calculate_bazi_with_all_pipelines` (`:503`, currently no param → defaults `calculate_bazi(hour_known=True)` at `:541`) → `calculate_bazi`.
3. **Thread `hour_known`** through the 3 FORTUNE Pydantic DTOs in `main.py` (`DailyFortuneInput`, `MonthlyFortuneInput`, `YearlyFortuneInput`) + endpoints → the wrappers `monthly_enhanced.compute_single_month_by_yearmonth` + `yearly_enhanced.compute_year_by_year` → `monthly_enhanced._get_or_compute_chart_for_flow_year` (`:235`) → the chart call.
4. **Test:** `calculate_bazi_with_all_pipelines(hour_known=False)` for Roger + Laopo must complete without exception (runs love+career+annual+lifetime). Add to `tests/test_unknown_hour.py`.

### 2a — DONE + line-audited (2026-06-13) ✅
Implemented + independent line audit: **CORRECT + COMPLETE**, no BUG/INCOMPLETE. Verified: ten_gods guard drops only the blank hour (year/month/day incl. day hidden-stems preserved); **no second crash** on the all-pipelines path (every bare `STEM_ELEMENT[...]`/`STEM_INDEX`/`BRANCH_INDEX` is either day-master/constant-list or skip-empty-guarded); threading complete for all in-scope FORTUNE sites (chat = 2d + compat = Phase 3 correctly default `hour_known=True`, no crash); Pydantic DTOs accept `None+hour_known=False` / reject malformed time; `_flow_year_cache` key + `_compute_chart_hash(None)` collision-free; hour-known byte-identical (659 neighbouring regression tests green); `chartContext.hourKnown` propagates (daily/monthly/yearly). Fixed N2 inline (`_flow_year_cache` annotation → `Tuple[str,int,bool]`). Tests: `test_unknown_hour.py` 14 pass; full engine suite 2949 pass (only the documented pre-existing `test_roger_laopo_full_preanalysis` fails).

**Deferred NITs (not 2a defects — pre-existing Phase-1 / cosmetic):**
- **N1** (DTO hardening, conf 88): `birth_time=None + hour_known=True` (inconsistent combo) → `ValueError` → HTTP 400 (not 500). Pre-existing in Phase-1 `BirthDataInput` too; real NestJS caller never sends it. Optional: add a `@model_validator` requiring `birth_time` when `hour_known is True` to `BirthDataInput` + the 3 FORTUNE DTOs as one small "DTO hardening" cleanup.
- **N3** (conf 85): `calculate_bazi` / `four_pillars.calculate_four_pillars` still annotate `birth_time: str` (accept `None` at runtime since Phase 1). Annotation honesty only.
- **N4** (conf 80): `_l1b_daily_cache` key omits `hour_known` — cosmetic, no live collision (`chart_hash` encodes `birth_time`).

### 2b — WRONG-OUTPUT phantom-hour cleanups
- **ANNUAL** `annual_enhanced.compute_pillar_impact_analysis` (`:428-499`, esp. `491-497`): skip the hour pillar when `branch==''` (or tag `hourUnknown:True`). Cascades to `compute_annual_relationship_analysis` (`:909-951`, the false 「子女宮平穩」) and the TS injector leak (2c).
- **LOVE** `love_enhanced.py`: `compute_spouse_star_analysis` 晚婚指標/時支藏財 (`:569-591`) → `None`/skip when hour blank; `classify_peach_blossoms` 牆外桃花 loop (`:252-417`) → `if not p_branch: continue`; `compute_marriage_timing_indicators` (`:1573-1596`) visible-spouse/晚婚 → build from 3 known pillars, flag 時柱 as undetermined (never confirmed-absent).

### 2c — AI suppression injectors (port the LIFETIME block, gated `data['hourKnown']===false` → cache-safe)
LIFETIME reference: `ai.service.ts::interpolateLifetimeV2Fields` `:2854-2871`. `hourKnown` is on the top-level chart dict (`calculator.py:429` / `four_pillars.py:510`), reachable in every injector's `data` arg.
- `interpolateLoveV2Fields` (`ai.service.ts:3738`; inject at `~:3742` before the `enhanced` early-return). Reword for LOVE loss profile (子女; forbid asserting 晚婚/牆外/時支藏財 absence).
- `interpolateCareerV2Fields` (`ai.service.ts:2492`; invoked `:2453/:2454`). Add 用神/五行比重/十神比重 「就現有三柱，僅供參考」 + 時柱 position/officer/wealth bonuses not counted.
- `interpolateAnnualV2Fields` (`ai.service.ts:1914`; invoked `:1901/:1902`). Skip the `hour柱(子女宮)` line in `{{annualPillarImpacts}}` + emit in-place note + 神煞 false-negative guard.
- **FORTUNE (3 reading-page injectors)** in `fortune-prompt-builder.ts`: `interpolateFortuneV1Fields` (`:119`, DAY), `interpolateFortuneMonthlyFields` (`:418`), `interpolateFortuneYearlyFields` (`:575`). **Prereq:** add `hourKnown` to the engine `chartContext` emit (`main.py:710`, `monthly_enhanced.py:497`, `yearly_enhanced.py:513`) + the `FortuneChartContext` DTO, then gate each injector on it.

### 2d — Chat guard
- Chat-side fortune injectors mirror in `chat-context.service.ts` (`:1428/:1585/:1829`, dispatched from `chat-prompt-builder.ts:178-208`).
- Guard the engine chat-context pipelines (`chat_context.py` merges all 4 enhanced-insights — same crash surface, fixed by 2a) + add the suppression directive to the chat system prompt for hour-unknown.
- NestJS API threading: `bazi.service.ts` already threads `hour_known` (Phase 1); `fortune.service.ts` + `chat-context.service.ts` engine calls must pass `hour_known` (Phase 1 left these compile-only-widened).

### 2e — UI (paywall parity, per the 2026-06-13 style lock)
- Port the `UnlockConfirmModal` `hourUnknown` warning block into **FORTUNE's `FortuneUpgradeModal`** (FORTUNE has its own paywall surface). COMPATIBILITY is Phase 3.

## Per-pipeline crash/wrong-output detail

### LOVE (`love_enhanced.py`) — 0 CRASH
配偶宮 correctly keys off the DAY branch everywhere (love's structural strength — survives). Empty-safe helpers confirmed: `compute_stem_pressure_weight`, `check_branch_friction('', day)`, `check_sanxing_with_pool('', …)`. WRONG-OUTPUT: 晚婚指標/牆外桃花/時支藏財/visible-spouse false negatives (see 2b).

### CAREER (`career_enhanced.py`) — 1 CRASH (the ten_gods one, 2a-1)
No 時上格局/晚年/部屬 scoring in this module (those matrix items are N/A here). `:324` 時干財星 / `:1772` 時干官星 use `STEM_ELEMENT.get(...)` → correctly don't fire (degrade). `calculate_weighted_five_elements` already degrades correctly (its loop is guarded); only `calculate_weighted_ten_gods` lacks the guard. Both weighted-% charts are DEGRADED → must be flagged (2c).

### ANNUAL (`annual_enhanced.py`) — 0 CRASH
All Phase-12 Fix A–F natal-pillar loops already skip the blank hour (explicit `if not …: continue` guards). Branch-relationship helpers tolerate `''`. WRONG-OUTPUT: phantom 子女宮 row (2b) → leaks to AI via `{{annualPillarImpacts}}` (2c).

### FORTUNE (`daily_/monthly_/yearly_enhanced.py`, `folk_content.py`) — 0 FORTUNE-specific CRASH
The 5 dim dispatchers are hour-clean (桃花/紅鸞/驛馬 key on day/year branch, never hour). 黃道吉時 keys on day_branch only; 吉色/吉數/吉食 key on 用神 element — all hour-independent. The only blocker is the all-pipelines threading (2a-2/3). Latent WRONG-OUTPUT in the default-OFF Option 2.5 path (`_detect_shishen_zhisha_active` degraded rooting) — low priority, flag-gated OFF.

## Helper tolerance (verified empty-safe — do NOT add guards)
`derive_ten_god('')→''` (Phase-1), `get_life_stage('', …)→''` (Phase-1), `check_sanxing_with_pool` (set-subset, `''` never a member), `check_branch_friction` (`frozenset({'',x})` matches no SIX_CLASHES/THREE_PUNISHMENTS/SIX_HARMS/SIX_BREAKS), `compute_stem_pressure_weight` (`.get` + `''` matches no target), all `*.get(branch/stem, default)` constant lookups in annual/career/love.
