# Phase 12g — Love Reading Doctrine Fixes

**Status**: Approved (V2.1, staff engineer reviewed twice). Ready for implementation.
**Estimated**: ~32 hours across 6 sub-phases.
**Source**: 7 doctrine + coverage gaps found by Laopo 八字愛情姻緣 vs Seer comparison (2026-05-05).

---

## Goal

Resolve 7 doctrine + coverage issues from Laopo 八字愛情姻緣 audit, while preventing cross-module doctrinal divergence (Laopo single-chart vs Laopo×Roger compat).

## The 7 issues being fixed

1. **Personality narrative misses 善良正直/正義感** (正官格 doctrine missing — engine has flat ten-god dict, no 月令格主導 / 月干透 layer)
2. **Spouse trait misses 漫不經心/揮霍/不上進 when 偏財為忌** (existing `ten_god_archetype` dict is polarity-blind)
3. **官殺混雜 cross-module inconsistency**: love module uses raw count, ignores Phase 12 Fix 1b weighted+ratio threshold + 露官藏殺只論官 doctrine. **Same bug in 4 compat module sites.**
4. **傷官見官 layering missing**: engine treats 命局藏餘氣 + 大運透 indistinguishable from 雙透 命局; no favorability awareness (when 官 is 忌神, 傷官見官 actually 制忌官 = beneficial)
5. **Spouse appearance internal contradiction**: 戌墓庫=穩重 + 偏財=外向 emitted in same paragraph without doctrinal priority rule (form vs personality分層 missing)
6. **2031 正官透流年 missed 正緣桃花年 label**: 流年 stem = 配偶星 should promote to top-level label; current emits only 紅鸞/天喜
7. **2036 沖配偶宮 single-direction misleading**: 沖宮 = 動 (bidirectional), should not be labeled as just 合婚年

## Architecture decision

**Partial Option B** (minimum centralization to prevent divergence):
- New shared module: `personality_library.py` (data + loader for polarity-aware ten god lookups)
- Existing canonical helper: `interpretation_rules::check_guan_sha_hunza` (Phase 12 Fix 1b) — extended consumption
- Full `chart_doctrine.py` extraction (傷官見官/比劫奪財/財星混雜) → deferred to Phase 12h

---

## Sub-phase breakdown

### Phase 12g.0 — Polarity data file + canonical loader (~3h)

**Why**: Polarity-aware ten god dict is implicitly needed by love (Fix 1, 4), lifetime, career, compat. Creating it inside love module = guarantees divergence. Extract on day 0.

**Deliverables**:
- `packages/bazi-engine/data/personality/ten_god_personality.json` — 10 ten gods × 3 polarities × 4 fields = 120 cells
- `packages/bazi-engine/app/personality_library.py` — JSON loader + `role_to_polarity()` selector
- `tests/test_personality_library.py` — schema + polarity reversal coverage

**Clean-revert guarantee**: 12g.0 ships as a single commit containing ONLY the 3 files above. NO consumer modifications. Subsequent phases (12g.1+) are the first commits that `import personality_library`.

**Env flag**: None (data + loader are behavior-neutral).

---

### Phase 12g.1 — Fix 2 (官殺混雜) + compat dedup + xfail audit (~3h)

**Critical scope**: Includes ALL `compatibility_romance_preanalysis.py` + `compatibility_enhanced.py` 官殺混雜 sites. Cannot defer to Phase 12h — Laopo×Roger contradiction is direct customer-facing risk.

**Modify**:
- `love_enhanced.py::compute_spouse_star_analysis` (line 589-611) — call `check_guan_sha_hunza(...)` from `interpretation_rules`
  - Adapter pattern: preserve legacy `challenges[].type='官殺混雜'` + `guanCount`/`shaCount` fields (frontend backward-compat); ADD `doctrineType`, `doctrineDetail` as optional new fields
  - Add `// DEPRECATED in Phase 12h` comment
- `compatibility_romance_preanalysis.py:766, 1248, 1414` — replace bare count with helper call
- `compatibility_enhanced.py::_detect_cross_guan_sha_hun_za` (line 578) — suppress when natal `doctrineType in ('lu_guan_cang_sha', 'lu_sha_cang_guan')`
- `prompts.ts::LOVE_V2_PROMPTS::natal_marriage` — add 「若 challenges 中無 doctrineType=guan_sha_hunza → 禁止提及官殺混雜/第三者風險」 anti-hallucination clause; add positive narrative for 露官藏殺/露殺藏官 informational note

**Acceptance criteria**:
- [ ] Laopo love `challenges` no longer contains 官殺混雜 entry
- [ ] Laopo love narrative snapshot does NOT mention 第三者風險 / 官殺混雜
- [ ] Laopo×Roger compat 官殺混雜 score = 0 (was high pre-12g.1)
- [ ] True 雙透 fixture STILL emits high-severity challenge
- [ ] AI prompt contract test passes (5 asserts — see "Prompt contract test specification")
- [ ] **Phase 12d xfail audit**: 5 `@pytest.mark.xfail(strict=False)` markers in `test_compatibility_gold_standard.py` re-run; any `XPASS` triggers explicit decision (flip to `passed`, or update reason text)

**Env flag**: `PHASE_12G_FIX2_GUANSHA_CANONICAL=1`
**Cache**: LOVE → v1.4.0 (NEW entry — was using fallback v1.1.0)

---

### Phase 12g.2 — Fix 5 (正緣桃花年) + Fix 6 (沖宮 bidirectional) (~5h)

**Fix 5**:
- `lifetime_enhanced.py::_compute_romance_candidates` — add `romance_archetype` field when 流年 stem = 配偶星 (正官 for female, 正財 for male)
- `tag_romance_years_with_dayun` — add promotion rule using new `ROMANCE_LABEL_PRIORITY` constant; 正緣桃花年 trumps 紅鸞/天喜/桃花合 in UI label

**Fix 6 (CRITICAL — single-entry, NOT dual-list)**:
- 沖宮 valence computed from co-occurring signals:
  - 沖 + 配偶星透 → `valence='positive'` label='正緣動年' (good_years only)
  - 沖 + 紅鸞/天喜 → `valence='positive'` label='喜事動年' (good_years only)
  - 沖 alone → `valence='mixed'` label='婚動年' + `bidirectional=true` (good_years only, NOT both lists)
  - 沖 + 比劫透 OR 桃花劫煞 → `valence='negative'` label='婚變年' (change_years only)
- **Year MUST appear in only ONE list** (frontend invariant)

**Modify**:
- `prompts.ts::LOVE_V2_PROMPTS::romance_good_years` + `marriage_change_years` — when `bidirectional=true`, AI must write 「未婚者... / 已婚者...」 dual perspective; forbid pure positive/negative framing for `valence='mixed'`

**Acceptance criteria**:
- [ ] Laopo 2031 `goodYearType == '正緣桃花年'`
- [ ] Laopo 2036 single entry, `bidirectional=true, valence='mixed'`
- [ ] No year duplicated across good_years/change_years
- [ ] AI narrative for Laopo 2036 contains "未婚者" AND "已婚者"
- [ ] AI prompt contract test passes

**Env flags**: `PHASE_12G_FIX5_ZHENGYUAN_LABEL=1`, `PHASE_12G_FIX6_CHONGGONG_VALENCE=1`
**Cache**: LIFETIME v2.7.0→v2.8.0, LOVE v1.4.0→v1.5.0

---

### Phase 12g.3 — Fix 3 (傷官見官 layered + favorability) (~6h)

**Modify** `love_enhanced.py::compute_spouse_star_analysis` (line 614-634):
- Layer A (natal): transparency-weighted detection (Phase 12 Fix 1a weights — 透干=3.0, 本氣=2.0×司令1.5, 中氣=1.0, 餘氣=0.5)
  - Both ≥2.0 → `natalSeverity='critical'`
  - Stronger ≥2.0 + weaker ≥1.0 → `natalSeverity='high'`
  - Both <2.0 → `natalSeverity='latent'` (Laopo case — 丁餘氣 only)
- Layer B (transient): scan current LP + flow years; emit `transientActivations: [...]`
- Layer C (favorability — copy `career_enhanced.py:2249` pattern):
  - 正官=忌神/仇神 → `valence='beneficial'` (傷官 制忌官)
  - Else → `valence='harmful'`

**Output structure** (extends existing challenge with new optional fields):
```python
{
  'type': '傷官見官',
  'severity': '...', 'description': '...',  # legacy
  'natalSeverity', 'natalDetail', 'transientActivations', 'valence', 'officerRole', 'permanentRisk',  # NEW optional
}
```

**Acceptance criteria**:
- [ ] Laopo: `natalSeverity='latent'`, `transientActivations[0].period=='2023-2032'`, `valence='beneficial'`
- [ ] Classic 雙透 + 正官=用神 fixture: `natalSeverity='critical'`, `valence='harmful'`
- [ ] AI narrative for Laopo reads 反常解讀 ("正官為忌神，傷官制官反為調節"), NOT pure negative
- [ ] AI prompt contract test passes

**Env flag**: `PHASE_12G_FIX3_SHANGGUAN_LAYERED=1`
**Cache**: LOVE v1.5.0→v1.6.0

---

### Phase 12g.4 — Fix 1 (personality polarity) + Fix 4 (spouse structured) (~10h)

**Pre-step (Issue #12)**: Snapshot Roger's `compute_personality_narrative` output BEFORE any 12g.4 changes. After Fix 1, run snapshot test: must equal pre-12g output OR explicit "approved-changed" annotation. Same for Laopo.

**Fix 1**:
- `love_enhanced.py::compute_love_personality` — add 月令格主導 layer (Layer 1) + 月干透副主導 layer (Layer 2) using `personality_library.load_ten_god_personality()`
- DELETE `TEN_GOD_LOVE_ARCHETYPE` (line 934-945) — all callers go through loader

**Fix 4**:
- `compute_marriage_palace_analysis` returns structured `{appearance, personality, meta}` PLUS legacy fields (backward-compat)
- Bifurcate `ten_god_archetype` (line 728) by polarity
- `prompts.ts::LOVE_V2_PROMPTS::spouse_appearance` — add Agent D's B9 layer-aware clause + 16 polarity rules + 禁用對比連詞

**Acceptance criteria**:
- [ ] Laopo personality narrative contains "正直" OR "正義感"
- [ ] Laopo spouse narrative contains "漫不經心" OR "花費重" OR "不上進"
- [ ] Roger lifetime personality narrative snapshot equal pre-12g
- [ ] Roger love narrative snapshot equal pre-12g
- [ ] AI prompt contract test passes (interpolation of new structured fields)

**Env flags**: `PHASE_12G_FIX1_POLARITY_PERSONALITY=1`, `PHASE_12G_FIX4_SPOUSE_LAYERED=1`
**Cache**: LOVE v1.6.0→v1.7.0, LIFETIME v2.8.0→v2.9.0

---

### Phase 12g.5 — Validation corpus (~5h)

**Deliverables**:
- `packages/bazi-engine/tests/validation/romance_label_corpus.csv` — 30+ fixtures across 6 charts, 8-column schema
- `tests/validation/run_romance_label_validation.py` — harness with strict 0-regression gate + ≥95% agreement gate (with `--accept-doctrinal-splits` flag mirroring lifetime harness)
- `LABEL_CATALOG` constant documenting all 16 catalog labels + classical citations

**Schema**:
```csv
chart_id,year,gender,expected_archetype,expected_co_signals,expected_valence,doctrinal_split,citation
laopo,2031,female,正緣桃花年,"紅鸞",positive,no,八字应用阐微·婚姻篇
laopo,2036,female,婚動年,"沖配偶宮",mixed,no,滴天髓·夫妻論
```

**Coverage**: 正緣/偏緣/紅鸞/天喜/六合/沖宮/六害/三刑/桃花劫/紅艷/伏吟 across 男/女 charts.

---

## AI prompt contract test specification

For each phase that changes engine output OR prompt template, the contract test asserts:

1. **Engine emits expected fields** — frozen test fixture (Laopo); snapshot deterministic dict; assert specific keys present
2. **Prompt template references emitted fields** — extract all `{{...}}` placeholders; assert every NEW field is referenced; assert no placeholder references missing fields
3. **Deterministic injector wires correctly** — `ai.service.ts::buildLoveV2Prompts` interpolates ALL new structured fields; render with frozen fixture; assert no `{{undefined}}` artifacts
4. **Anti-hallucination clauses present** — assert prompt contains required `若...禁止` clauses (mirror Phase 12c pattern)
5. **Snapshot rendered prompt** — commit as `tests/snapshots/love_prompt_laopo_phase12g_X.txt`; diff requires explicit approval

---

## Cache invalidation map fix (CRITICAL — Issue #7 from V1 review)

**Current bug** (`apps/api/src/ai/ai.service.ts:6998-7002`): `LOVE` and `COMPATIBILITY` missing from `PRE_ANALYSIS_VERSIONS` map → falls through to default `v1.1.0` → cache never invalidates on engine bumps.

**Phase 12g revision**:
```ts
const PRE_ANALYSIS_VERSIONS: Partial<Record<ReadingType, string>> = {
  [ReadingType.LIFETIME]: 'v2.9.0',     // bumped through 12g.2 + 12g.4
  [ReadingType.CAREER]: 'v2.5.0',
  [ReadingType.ANNUAL]: 'v2.3.0',
  [ReadingType.LOVE]: 'v1.7.0',         // NEW entry — bumped through 12g.1, 12g.2, 12g.3, 12g.4
  [ReadingType.COMPATIBILITY]: 'v1.6.0', // NEW entry — bumped for 12g.1
};
```

**Deploy cost note**: Bumping LOVE + COMPATIBILITY invalidates ALL cached readings. For paid-tier readings, regen = real Claude API spend. Operator MUST:
1. Confirm with product owner that cache bust is acceptable
2. Stage deploy outside peak read traffic
3. Monitor Anthropic API spend dashboard for 48h post-deploy
4. Document expected regen volume in deploy ticket

---

## Per-rule env flags (final list)

```bash
PHASE_12G_FIX1_POLARITY_PERSONALITY=1   # personality polarity bifurcation
PHASE_12G_FIX2_GUANSHA_CANONICAL=1      # 官殺混雜 canonical helper
PHASE_12G_FIX3_SHANGGUAN_LAYERED=1      # 傷官見官 layered + favorability
PHASE_12G_FIX4_SPOUSE_LAYERED=1         # 配偶宮 structured output
PHASE_12G_FIX5_ZHENGYUAN_LABEL=1        # 正緣桃花年 promotion
PHASE_12G_FIX6_CHONGGONG_VALENCE=1      # 婚動年 valence + bidirectional
```

12g.0 has no flag (data-only). 12g.5 has no flag (test-only).

---

## TypeScript types (all new fields optional)

`packages/shared/src/types.ts` additions (all optional `?` for backward-compat):

- `SpouseStarChallenge`: `doctrineType?`, `doctrineDetail?`, `natalSeverity?`, `natalDetail?`, `transientActivations?`, `valence?`, `officerRole?`, `permanentRisk?`
- `RomanceTimelineEntry` / annual forecast: `romance_archetype?`, `valence?`, `bidirectional?`
- `MarriagePalaceLayered` (new optional sub-object): `appearance?`, `personality?`, `meta?`
- `PersonalityLayer` (new): for `personalityDimensions?: PersonalityLayer[]`

Engine ALWAYS emits new fields (with null/empty-array defaults for legacy paths).

---

## CLAUDE.md updates (6 sections)

1. Add new section `## 八字愛情姻緣 Calculation — Phase 12g Doctrine Fixes` (mirror "八字流年運勢 Calculation — Phase 12 / 12b / 12c Fixes")
   - 7 fixes summary + classical citations
   - Laopo love calibration anchor table (11 years × expected labels)
   - Roger love calibration anchor table
2. Update "Per-rule env flags (rollback path)" consolidated table — add 6 Phase 12g flags
3. Update "Cache invalidation post-deploy" block — bump LOVE/LIFETIME/COMPATIBILITY versions; add deploy cost note
4. Update "Phase Status" line — add `Phase 12g complete`
5. Update "Files Reference" lists — add `personality_library.py` + structured output references
6. Update "Test suite sizes" counts post-12g

---

## Phase 12h candidates (deferred from 12g)

- Centralized `chart_doctrine.py` module (傷官見官/比劫奪財/財星混雜 across all readings)
- `career_enhanced.py` / `annual_enhanced.py` 傷官見官 favorability propagation
- Deprecate `love_enhanced.py` legacy `challenges[].guanCount`/`shaCount` fields after frontend migration
- Phase 12d Pattern 3a `PHASE_12D_PATTERN_3A_CONG_QIANG_DETECTOR` flag-flip (independent of 12g)

---

## Implementation runbook

For each phase: green light condition is "all acceptance criteria pass + Phase 12d xfail markers status documented + AI prompt contract test passes".

Iteration order (dependency-driven):
1. 12g.0 first (data + loader, clean revert)
2. 12g.1 (Fix 2 + compat dedup + xfail audit gate)
3. 12g.2 (Fix 5 + Fix 6) — independent of 12g.3
4. 12g.3 (Fix 3) — independent of 12g.2
5. 12g.4 (Fix 1 + Fix 4) — depends on 12g.0
6. 12g.5 (corpus) — last

Approved: V2.1, staff engineer review (2 rounds).
