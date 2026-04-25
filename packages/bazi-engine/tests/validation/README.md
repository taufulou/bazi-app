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
