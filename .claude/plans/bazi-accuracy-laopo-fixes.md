# Bazi Accuracy — Laopo21 流年 Fixes (4-Fix Plan, v3 Approved)

**Origin**: Comparison of Laopo21 2026 流年運勢 engine output vs Seer app output identified 6 disputes; classical-source research confirmed engine is correct on 4/6 but has 4 actionable improvements. Staff engineer reviewed v1 (19 issues), v2 (5 conditions), v3 approved.

**Status**: Approved for implementation by staff engineer review agent.

---

## Rollout order (low → high risk)

1. **Fix 1b** — 官殺混雜 threshold refinement (love domain only, no flag)
2. **Fix 3 + Fix 4** (parallel) — 桃花方位 + 生肖貴人 + 文昌方位 (additive only)
3. **Fix 2** — 調候 advisory (additive, no 用神 override)
4. **Fix 1a** — Weighted 透干/藏干 dominance detection (behind flag, gated on 50+ chart validation)

---

## Fix 1b: 官殺混雜 threshold refinement

**Scope**: Love domain only. Narrative-only. Independent from Fix 1a's dominance tally.

**Problem**: Current 官殺混雜 detection flags any co-occurrence of 正官 + 偏官. Overclaims when one is transparent + other is trace 藏干.

**Change**: In `app/interpretation_rules.py` (`detect_guan_sha_hunza`):
- Require BOTH sides to have weight ≥ 2.0 (i.e., ≥本氣藏干 or ≥透干 — not just 餘氣)
- Weaker side's weight must be ≥ 50% of stronger side's weight
- Otherwise: label as "露殺藏官只論殺" or "露官藏殺只論官" (narrative relabel)

**Independence from Fix 1a** (load-bearing): The 露殺藏官只論殺 / 露官藏殺只論官 relabel is **narrative-only** and does NOT prune weights in Fix 1a's `_detect_dominant_imbalance` category tally. Dominance detection is about **total category pressure on DM**, not 格局 purity. A chart with 透殺 + 藏官 still exerts combined 官殺 pressure on a weak DM. Documented in docstring of both `_detect_dominant_imbalance` and `detect_guan_sha_hunza` with cross-reference.

**Calibration**: PR must include 10+ expert-labeled charts with 透/藏 variations showing which flip vs stay 混雜.

**Tests**: 8 new cases in `test_interpretation_rules.py`. Also a regression test `test_guan_sha_hunza_narrative_does_not_affect_dominance_tally` (polish #1 from reviewer).

**Risk**: LOW. Scoped to love domain; no cascade.

---

## Fix 3: 桃花方位 output

**Problem**: 桃花 detected as 神煞 tag; no direction emitted. Seer outputs wrong direction.

**Change**:
1. Add `BRANCH_DIRECTION_8` dict to `constants.py` (8-direction scheme; 羅盤24山 cited in docstring):
   ```python
   BRANCH_DIRECTION_8 = {
       '子':'正北','丑':'東北','寅':'東北','卯':'正東',
       '辰':'東南','巳':'東南','午':'正南','未':'西南',
       '申':'西南','酉':'正西','戌':'西北','亥':'西北',
   }
   ```
2. New `get_taohua_directions(year_branch, day_branch) -> Dict` in `shen_sha.py`:
   - Primary = 年支 → TAOHUA → direction
   - Secondary = 日支 → TAOHUA → direction (if different from primary)
   - Return structured only — no singles/married copy in engine
3. Wire into `calculator.py` → emit `taohuaDirections`.

**TS types**: `packages/shared/src/types/bazi.ts` adds optional `taohuaDirections?: TaohuaDirections`.

**Prompt**: `apps/api/src/ai/prompts.ts` handles singles vs married copy from structured field.

**Tests**: 4 cases (one per 三合組) in `test_shen_sha.py`.

**Risk**: LOW. Additive only.

---

## Fix 4: 生肖貴人 + 文昌貴人方位

**Problem**: Seer outputs fabricated "六合貴人" with age/name embellishments. We ship classical replacements.

**Change**:
1. Extract `_compute_zodiac_allies(year_branch, day_branch)` helper from existing `career_enhanced.py::compute_career_allies_enemies` into `shen_sha.py`. Career path imports it → preserves existing `careerAllies` output shape (no parallel implementation).
2. New `get_zodiac_benefactors(year_branch) -> Dict` in `shen_sha.py`:
   ```python
   # {
   #   'liuhe': {'branch': '亥', 'zodiac': '豬', 'kind': 'liuhe'},
   #   'sanhe': [{'branch': '午', 'zodiac': '馬'}, {'branch': '戌', 'zodiac': '狗'}],
   #   'provenance': 'folk_tradition',
   # }
   ```
   NO 方位/年齡/名字 fields. NO Chinese disclaimer string.
3. New `get_wenchang_direction(day_stem) -> Dict`:
   ```python
   # {'branch': '巳', 'direction': '東南'}
   ```
4. Wire into `calculator.py` → emit `zodiacBenefactors` (annual/lifetime) and `wenchangDirection` (all).

**TS types**: New optional `zodiacBenefactors?`, `wenchangDirection?` fields.

**Prompt**: Uses `provenance: 'folk_tradition'` flag to emit disclaimer copy.

**Tests**: 12 cases for 生肖貴人 + 10 for 文昌方位.

**Risk**: LOW. Additive only.

**Deferred**: Unify `zodiacBenefactors` and `careerAllies` shapes once prompts migrate (follow-up ticket).

---

## Fix 2: 調候 advisory (NO 用神 override)

**Problem**: 《窮通寶鑑》 調候 tradition is distinct from 《滴天髓》 扶抑 / 病藥 tradition. 用神 override would silently conflict with documented methodology.

**Change**:
1. New module `app/tiaohou.py`:
   ```python
   TIAOHOU_TABLE: Dict[Tuple[str, str], str]  # 10 DMs × 12 months → 調候神 stem
   TIAOHOU_SECONDARY: Dict[Tuple[str, str], Optional[str]]  # per month where applicable

   def classify_tiaohou_status(pillars, dm_stem, month_branch) -> Literal[
       'present_strong','present_weak','combined','clashed','absent'
   ]

   def compute_tiaohou_advisory(pillars, dm_stem, month_branch) -> Optional[Dict]:
       # Returns structured advisory (no narrative strings) or None.
   ```
2. NO narrative templates in engine. Engine emits structured keys; prompt layer renders Chinese.
3. NO 用神 override. `determine_favorable_gods` is untouched.
4. 從格 guard: advisory skipped for 從格 charts.
5. Wire into `calculator.py` → emit `tiaohou` field.

**TS types** (typed Literal union, with runtime guard):
```typescript
export type TiaohouClassicalPhraseKey =
  | 'cold_wood_needs_fire'    // 寒木向陽 (甲乙冬)
  | 'hot_wood_needs_water'    // 炎木需潤 (甲乙夏)
  | 'hot_fire_needs_water'    // 烈火需潤 (丙丁夏)
  | 'cold_fire_needs_wood'    // 寒火無焰 (丙丁冬)
  | 'cold_earth_needs_fire'   // 凍土難耕 (戊己冬)
  | 'hot_earth_needs_water'   // 焦土龜裂 (戊己夏)
  | 'cold_metal_needs_fire'   // 寒金難鑄 (庚辛冬)
  | 'hot_metal_needs_water'   // 頑金需淬 (庚辛夏)
  | 'cold_water_needs_fire'   // 凍水成冰 (壬癸冬)
  | 'hot_water_needs_metal';  // 沸水散氣 (壬癸夏)

export interface TiaohouAdvisory {
  primaryGod: string;
  secondaryGod: string | null;
  status: 'present_strong' | 'present_weak' | 'combined' | 'clashed' | 'absent';
  combinedBy: string | null;
  seasonalContext: 'cold_winter' | 'hot_summer' | 'transitional';
  classicalPhraseKey: TiaohouClassicalPhraseKey;
}
```

**Prompt**: `buildTiaohouSection` in `prompts.ts` — lookup table keyed on `TiaohouClassicalPhraseKey`. Unknown key → throw, caught by AI pipeline, logged to Sentry, advisory omitted.

**Tests**: 120 cases (10 DMs × 12 months smoke test against 《窮通寶鑑》 primary source) + 10 edge cases (combined/clashed/absent). Fixture-based test for `classicalPhraseKey` closure (polish #4).

**Risk**: MEDIUM. Additive only; no 用神 override.

---

## Fix 1a: Weighted 透干/藏干 dominance detection (high-risk, flagged)

**Problem**: `_detect_dominant_imbalance()` uses raw ten-god counts. For Laopo (丙寅 辛丑 甲戌 壬申 very_weak): 官殺=4 ties 財=4, tie→財, wrong 用神 output (用=木 instead of classically correct 用=水).

**Change**:
1. Add public functions **inside existing `ten_gods.py`** (not a new module):
   ```python
   # ======== Imbalance-detection weights (distinct from display weights) ========
   #
   # Weight-equivalence note (load-bearing, do not adjust without classical review):
   #
   #   Month 本氣 藏干 effective weight:
   #     IMBALANCE_STEM_POSITION_WEIGHT['hidden_benqi']  × 2.0
   #     PILLAR_ROLE_WEIGHT['month']                     × 1.0
   #     MONTH_BENQI_COMMANDER_MULTIPLIER                × 1.5
   #     = 3.0 (equals transparent_rooted)
   #
   # This equivalence is INTENTIONAL per 《子平真詮·論用神》「月令為提綱」—
   # the 月令 本氣 藏干 carries 司令 weight equal to a transparent stem
   # with root. Retuning any of the three constants without understanding
   # this equivalence will break classical alignment.
   # See docs/phase-12-specs.md §月令司令 for derivation.

   IMBALANCE_STEM_POSITION_WEIGHT = {
       'transparent_rooted':      3.0,  # 透干 with 本氣/中氣 root
       'transparent_weak_root':   2.5,  # only 餘氣 root
       'transparent_rootless':    1.5,  # 虛浮
       'hidden_benqi':            2.0,
       'hidden_zhongqi':          1.0,
       'hidden_yuqi':             0.5,
   }
   PILLAR_ROLE_WEIGHT = {'month': 1.0, 'day': 0.9, 'hour': 0.7, 'year': 0.6}
   MONTH_BENQI_COMMANDER_MULTIPLIER = 1.5
   ```
2. Modify `_detect_dominant_imbalance()` signature:
   ```python
   def _detect_dominant_imbalance(
       ten_god_dist: Dict[str, int],
       strength: str,
       pillars: Optional[Dict] = None,
       day_master_stem: Optional[str] = None,
       is_cong_ge: bool = False,
   ) -> str:
   ```
   - `pillars + day_master_stem` both provided → weighted mode
   - `is_cong_ge=True` → returns `'cong_overridden'` early
   - Neither → falls back to raw counts (backward compat)
3. Dominance rule (preserves "general" fallback):
   - `(top_score - second_score) / top_score >= 0.20` (20% margin)
   - `top_score >= 3.0` (absolute floor)
   - Otherwise → `'general'`
4. Tiebreak (deterministic): (a) month-branch 本氣 component, (b) transparent stem count, (c) fixed enum order `['官殺','財星','食傷','印星','比劫']`.
5. Wire in `determine_favorable_gods()` and `calculator.py:140` call site.

**Feature flag**: Env var `BAZI_USE_WEIGHTED_IMBALANCE` (default `"1"` dev, `"0"` prod initially), read once at import in `ten_gods.py`. pytest fixtures toggle per-test. CI runs full suite in both modes until deletion.

**Validation harness** (blocking before flag flip):
- New file `tests/validation/expert_labeled_charts.csv` — 50+ charts with expert-labeled 用神/喜神/dominant:
  - 5 canonical anchors (Roger, Laopo, 3 textbook 殺印相生/從格/官殺混雜)
  - 25 from 《子平真詮》 worked examples
  - 15 from 《滴天髓》 worked examples
  - 5 edge cases (tied counts, 從格 boundary, neutral strength, 官殺混雜 variants, all-hidden chart)
- Canonical anchor IDs pinned as `CANONICAL_ANCHOR_CHART_IDS` constant in harness code (polish #2).
- Script `tests/validation/run_imbalance_validation.py` runs both modes, outputs agreement % + diff table.

**Flag-flip gate** (all three must hold):
1. ≥ 95% agreement across full CSV
2. **Zero** disagreements on the 5 canonical anchor charts
3. ≤ 2 absolute disagreements across 《子平真詮》/《滴天髓》 textbook subset

**Deletion criteria**: ≥ 95% stable agreement, zero production rollbacks in 2 weeks, target removal 4 weeks after prod flip.

**Regression strategy**: Every fixture diff must be classified:
- (a) was-wrong-now-right (update fixture, cite classical rule)
- (b) was-right-now-wrong (BLOCK — fix weighting bug)
- (c) ambiguous (Bazi-master review required)

PR must include a classified diff table with sign-off column per row. Roger's classification is expected unchanged; any shift blocks merge.

**Rendered AI-output diff (blocking)**: PR must include side-by-side AI narrative diff for Roger + Laopo with fixed AI model + temperature + cached response. Must-diff sections: 喜用神 + 當前大運 + 財運 (polish #3). Reviewer signs off on prose-level change.

**Tests**:
- `tests/test_ten_gods_imbalance.py` (new, ~40 cases): transparent/hidden permutations, rootless transparent loses to benqi-hidden, 月令 司令 boost flip, 20% margin + 3.0 floor edges, 從格 guard, fixed enum tiebreak, all 5 labels reachable.
- `tests/test_five_elements.py`: Laopo → 用神=水, 喜神=木 (positive assertion). Roger → unchanged (regression guard).
- 5 golden charts: weak-食傷旺, weak-官殺旺, weak-財旺, strong-比劫旺, strong-印旺.

**Docs**: Write `docs/phase-12-specs.md §月令司令` derivation section as part of Fix 1a PR (polish #5).

**Risk**: HIGH. Cascades into career/lifetime/love/annual readings via 用神 classification.

---

## Global rules (every PR)

1. Bundle engine + `packages/shared` TS types + `apps/api/src/ai/prompts.ts` updates in the same PR. Engine-only PRs without prompt wiring are rejected (would ship dead fields).
2. Cache invalidation runbook (redis FLUSHALL + `DELETE FROM reading_cache` + rebuild NestJS) in PR description.
3. No disclaimer/advisory strings in engine output. AI/UI layer formats from structured flags.
4. Fix 1a exclusively: flag + validation harness + classified diff table + rendered AI-output diff required.
5. Check `node_modules/@repo/shared` symlink after touching `packages/shared` (worktree drift gotcha per CLAUDE.md).

## Non-blocking polish items (fold in during implementation)

1. Fix 1b: add regression test `test_guan_sha_hunza_narrative_does_not_affect_dominance_tally`
2. Fix 1a: pin `CANONICAL_ANCHOR_CHART_IDS` as harness constant
3. Fix 1a: specify must-diff AI sections (喜用神 + 當前大運 + 財運)
4. Fix 2: `classicalPhraseKey` test runs against engine-produced fixtures, not TS constants
5. Fix 1a: write `docs/phase-12-specs.md §月令司令` in the same PR

## Research sources

Classical: 子平真詮 (沈孝瞻), 滴天髓, 三命通會, 淵海子平, 窮通寶鑑, 《滴天髓》坎離論, 《窮通寶鑑》甲木篇丑月條.

Research chats (in-session sub-agents):
- Classical comparison verdict: 6 disputes analyzed
- Bazi master research 1: 透干 weighting + 調候 table
- Bazi master research 2: 桃花方位 + 六合貴人
- Staff engineer review v1 → v2 → v3 approved

## References in code

- `packages/bazi-engine/app/five_elements.py:433` `_detect_dominant_imbalance`
- `packages/bazi-engine/app/five_elements.py:483` `determine_favorable_gods`
- `packages/bazi-engine/app/ten_gods.py` — weighted calc (display) exists; add imbalance weighting here
- `packages/bazi-engine/app/shen_sha.py` — extend with 桃花方位 + 生肖貴人 + 文昌方位
- `packages/bazi-engine/app/constants.py:272` WENCHANG, `:288` TAOHUA, `:592` MUYU_TAOHUA (distinct, retained)
- `packages/bazi-engine/app/calculator.py:140` `determine_favorable_gods` call site
- `packages/bazi-engine/app/career_enhanced.py:783` `compute_career_allies_enemies` (shape to preserve)
- `apps/api/src/ai/ai.service.ts:2214` existing `三合/六合貴人生肖` emission (AI prompt)
- `packages/shared/src/types/bazi.ts` — TS type updates
- `apps/api/src/ai/prompts.ts` — prompt updates
