# Fix 1a Validation Harness

**Status**: Scaffold only. The canonical 50+ chart CSV must be completed
before `BAZI_USE_WEIGHTED_IMBALANCE=1` is flipped to default ON in
production.

## Gate (all three must hold before prod flip)
1. ≥ 95% agreement across full CSV
2. **Zero** disagreements on the 5 canonical anchor charts
   (`CANONICAL_ANCHOR_CHART_IDS` in `run_imbalance_validation.py`)
3. ≤ 2 absolute disagreements across 《子平真詮》/《滴天髓》 textbook subset

## Expected CSV contents (50+ rows)

| id | label_source | dm_stem | pillars | gender | strength_label | expected_dominant | expected_yongshen | expected_xishen | notes |
|----|---------------|---------|---------|--------|----------------|-------------------|-------------------|-----------------|-------|
| roger              | canonical_anchor   | ... | 1988-07-28 ... | male   | weak      | 官殺旺 | 水 | 木 | Canonical |
| laopo              | canonical_anchor   | 甲  | 丙寅辛丑甲戌壬申 | female | very_weak | 官殺旺 | 水 | 木 | Canonical; flips under Fix 1a |
| ziping_anchor_01   | canonical_anchor   | ... | ...            | ...    | ...       | ...    | ... | ... | 《子平真詮》 worked example |
| ...                | ziping_worked      | ... | ...            | ...    | ...       | ...    | ... | ... | 《子平真詮》 (25 charts) |
| ...                | ditian_worked      | ... | ...            | ...    | ...       | ...    | ... | ... | 《滴天髓》 (15 charts) |
| edge_tied_counts   | edge_case          | ... | ...            | ...    | ...       | ...    | ... | ... | Tied raw counts |
| edge_cong_boundary | edge_case          | ...                                                                                                       |
| edge_neutral       | edge_case                                                                                                                      |
| edge_混雜_boundary | edge_case                                                                                                                      |
| edge_all_hidden    | edge_case                                                                                                                      |

## Running the harness

```bash
cd packages/bazi-engine
source .venv/bin/activate
python tests/validation/run_imbalance_validation.py
# Flag ON
BAZI_USE_WEIGHTED_IMBALANCE=1 python tests/validation/run_imbalance_validation.py
```

The harness prints:
- Agreement rate per mode
- Per-chart disagreement table
- Pass/fail per gate criterion

## Classified diff table requirement

Fix 1a PR description must include a table of every fixture diff classified
as:
- **(a) was-wrong-now-right** — update fixture, cite classical rule
- **(b) was-right-now-wrong** — BLOCK: fix weighting bug
- **(c) ambiguous** — requires Bazi-master review before merge

Roger's `strength` classification is expected **unchanged**. Any shift
blocks merge until investigated.

## Known flag-on test regressions (for PR classified-diff review)

When `BAZI_USE_WEIGHTED_IMBALANCE=1`, the following tests change behavior
and require classification before the flag is flipped:

- `tests/test_compatibility_gold_standard.py::TestScoreRanking::test_divorced_couples_score_low`
- `tests/test_compatibility_gold_standard.py::TestScoreRanking::test_bigs_wang_palace_clashes_severe`
- `tests/test_compatibility_gold_standard.py::TestScoreRanking::test_score_spread_meaningful`

These test a 5-celebrity-couple score spread. Under Fix 1a, some charts
produce different 用神 → different compatibility inputs → compressed score
spread (17 pts vs required 20 pts). This is a textbook "ambiguous" case
requiring Bazi-master review: is the new 用神 assignment classically
correct, and should the gold-standard thresholds be recalibrated accordingly?

---

# Compatibility Pair Corpus

A second, separate harness covering pair-based regression for the
compatibility (感情合盤) module. **Different scope from Fix 1a above** —
this corpus tests pair-interaction tag detection + engine output
regression, not 用神 doctrine.

## What it tests

| Layer | Columns | Failure means |
|---|---|---|
| **Doctrinal** (HARD fail) | `expected_findings_types`, `expected_findings_absent`, `expected_lookup_dim_scores` | Doctrine and engine diverged. Real conversation needed. |
| **Regression** (HARD fail) | `expected_knockout_types` (exact-set), `expected_dim_score_bands` (±2.0), `expected_special_findings` (exact via SPECIAL_FINDINGS_PATHS) | Engine output drifted. Could be a fix, could be a regression. |
| **Warn-only** | `adjusted_score_baseline` (±10) | Score baseline drifted; informational. |

⚠️ **This corpus does NOT measure engine accuracy against expert-labeled
ground truth.** That gate lives elsewhere (planned
`compatibility_calibration_anchors.csv`, separate PR). Build-mode columns
test regression only — author "review" of build output is spot-checking
coherence with doctrinal columns, not classical validation.

## Coverage (53 pairs, 9 sections)

| Section | Pairs | Locks |
|---|---|---|
| A 夫妻宫六合 | 6 | `spousePalace.findings[].type contains '六合'` |
| B 夫妻宫六沖 | 6 | `'六沖'` (3 pure) or `'天剋地沖'` (3 stem-clash) |
| C 夫妻宫六害 | 6 | `'六害'` per pair |
| E 刑/自刑 | 9 | 4 自刑 (doctrinal `'自刑'`); 1 子卯刑 (doctrinal `'子卯刑'`, Phase 12i); 4 三刑/半刑 (build-mode regression — Phase 12i adds detection; bands locked via `--build`, dual-tag annotation when 沖/合/害 already fired) |
| F 天干五合 | 5 | `combinationName` (中正/仁義/威制/淫慝/無情之合) |
| G 配偶星對應 | 5 | gender-conditional 配偶星 alignment |
| I 三合 cross-chart | 5 | `crossSanhe` populated |
| J Knockouts | 8 | one pair per knockout type: tian_ke_di_chong, guan_sha_hun_za, shang_guan_jian_guan, yongshen_conflict, tiangan_wuhe_adverse, guchen_guasu_both_day, both_unstable_marriage_palaces, both_yinyang_cuocuo |
| K1 高用神 天合地合 | 2 | `tianHeDiHe=true` AND `specialLabel='命中注定'` |
| K2 低用神 天合地合 | 1 | `tianHeDiHe=true`, no `specialLabel` (dim1 ≤ 70) |

Birth: Taipei / Asia/Taipei / 12:00 (matches `test_compatibility_gold_standard.py`).
真太陽時 OFF (production default per CLAUDE.md).

**Out of scope**: 子時/立春/節氣 boundary tests — those test `four_pillars.py`,
not compat. File a separate `test_pillar_boundaries.py` PR if needed.

## Files

- `compatibility_pair_corpus.csv` — the corpus (53 rows + comment header)
- `populate_initial_corpus.py` — generates the skeleton (regenerate when sections change)
- `build_compatibility_corpus.py` — `--build` mode populates regression columns from current engine
- `run_compatibility_pair_validation.py` — CLI runner (returns nonzero on hard failure)
- `../test_compatibility_pair_corpus_regression.py` — pytest integration (parametrized, ~0.3s)

## Running

```bash
# CLI (verbose summary)
cd packages/bazi-engine
source .venv/bin/activate
python tests/validation/run_compatibility_pair_validation.py
python tests/validation/run_compatibility_pair_validation.py --section J_knockout
python tests/validation/run_compatibility_pair_validation.py --pair K1_01_high_yongshen_thdh

# Pytest (CI integration)
python -m pytest tests/test_compatibility_pair_corpus_regression.py
```

## Refreshing build-mode columns after intentional engine changes

```bash
# All rows, all build-mode columns (requires confirmation prompt or --yes)
python tests/validation/build_compatibility_corpus.py build --yes

# Single pair
python tests/validation/build_compatibility_corpus.py build --pair=A01_zi_chou

# Single column across all pairs
python tests/validation/build_compatibility_corpus.py build \
    --column=adjusted_score_baseline --yes
python tests/validation/build_compatibility_corpus.py build \
    --column=expected_knockout_types --yes
```

## Frozen pairs

Set `frozen_pending_recalibration=true` on a row to downgrade all of its
assertions to warn-only. Mirrors the `DOCTRINAL_SPLIT_CHART_IDS` pattern in
`run_imbalance_validation.py`. Use when an engine change is recognized as
a doctrinal split rather than a regression and the corpus update is gated
on Bazi-master review.

## SPECIAL_FINDINGS_PATHS sanity warn

The harness logs a WARN whenever the engine emits a `specialFindings` key
not present in `SPECIAL_FINDINGS_PATHS` (defined in
`run_compatibility_pair_validation.py`). Surfaces engine drift to the next
corpus author — add the new key to the dict.

## Pre-flight verified facts (as of 2026-05-06)

Inlined as comments in `build_compatibility_corpus.py`:
1. cnlunar advances `day8Char` at 23:00 (傳統 子時)
2. `score_spouse_palace` does NOT detect 六破 (Section D originally planned, dropped)
3. 7 of 8 dim raw scores are floats (`round(x,1)`); only `dayStemRelationship` is int
4. `result['compatibilityEnhanced']['knockoutConditions']` is the top-level list
5. `tianHeDiHe` is day-pillar only; `specialLabel='命中注定'` requires both `tianHeDiHe` AND `dim1.rawScore > 70`
6. Full pipeline ~5ms/pair; 53 pairs × 5ms ≈ 265ms (pytest run ≈ 0.3s including overhead)
