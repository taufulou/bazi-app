# Fix 1a Validation Harness — Run Report (2026-04-28)

**Status**: Harness operational. Gate flip BLOCKED on classified-diff review (Bazi-master sign-off skipped per user direction; mechanical re-run can be repeated any time).

## Headline numbers

| Metric                       | Flag OFF | Flag ON | Δ           |
|------------------------------|----------|---------|-------------|
| 用神 agreement (50 charts)   | 42.0%    | 58.0%   | **+16 pp**  |
| Dominant agreement (50 charts) | 64.0%  | 94.0%   | **+30 pp**  |

**Conclusion**: Fix 1a's weighted 透干/藏干 dominance detection materially improves classical-text agreement on every dimension. The +30pp dominant-classification jump is the load-bearing improvement the change was designed for.

## Diff classification

| Bucket                      | Count | Gate impact                       |
|-----------------------------|-------|-----------------------------------|
| (a) was-wrong-now-right     | 9     | Justifies flag flip               |
| (b) was-right-now-wrong     | 1     | **REGRESSION — needs review**     |
| (c) unchanged disagreement  | 20    | Engine gap unaddressed by Fix 1a  |
| Both modes correct          | 20    | Regression guard                  |

### (a) Wins under Fix 1a (9 charts)
- `laopo` — 木→水 ✓ (canonical, matches CLAUDE.md doctrine)
- `anchor_xue_xianggong_guansha_mixed` — 木→水 ✓ (官殺混雜 anchor)
- `ziping_li_canzheng` — 木→水 ✓
- `ziping_fan_taifu` — 土→火 ✓
- `ziping_cai_guifei` — 金→土 ✓
- `ziping_jin_chengxiang` — 火→土 ✓
- `dts_hezhi_rich2` — 金→水 ✓
- `dts_hezhi_noble2` — 金→水 ✓
- `edge_guansha_mixed_boundary` — 木→水 ✓

### (b) The single regression
- `ziping_zeng_canzheng` — flag-OFF gives 用神=木 (matches expected); flag-ON gives 用神=火.
- **This is the MUST-INVESTIGATE item** — either:
  - The expected label is wrong (flag-ON is classically correct → update fixture), OR
  - The weighting algorithm has an edge case bug (flag-ON is wrong → fix code), OR
  - Both are defensible (ambiguous → choose canonically and document).

### (c) Unchanged disagreements (20 charts) — engine gaps
The flag flip changes nothing on these. These represent unresolved Phase 12+ engine work, not Fix 1a's responsibility:

- 11 ziping_zhenquan disagreements
- 5 ditian_sui disagreements
- 2 qiongtong_baojian disagreements
- 2 edge cases (`edge_cong_sha_boundary`, `edge_shishang_strong_jia`)

Notable: `anchor_cong_cai_yiwuming` (從財 boundary) — engine gives 用神=火 but expected=金. The engine's `is_cong_ge=True` propagation may not be reaching this code path; needs a downstream check in `generate_pre_analysis()` overrides.

## Gate verdict (flag=ON)

| Gate | Threshold | Actual | Pass? |
|------|-----------|--------|-------|
| 1. Overall 用神 agreement | ≥ 95% | 58.0% | ❌ |
| 2. Anchor disagreements   | 0      | 1 (anchor_cong_cai_yiwuming) | ❌ |
| 3. Textbook disagreements | ≤ 2    | 18 | ❌ |

**Overall: 3/3 gates fail.** The flag flip remains correctly blocked.

## Interpretation for the operator

The 58% agreement is NOT a failure of Fix 1a — Fix 1a improves the number from 42% to 58%. The remaining 42% gap is a combination of:

1. **Other engine refinements still needed** (3-stem branch transparency edge cases, 從格 boundary detection improvements, 調候-conditioned 用神 reconciliation, etc.) — Phase 12d+ scope.
2. **Possible label errors in the corpus** — the research agent extracted 50 charts in ~15 min; some 用神 verdicts may need expert verification. Confidence flags in the JSON corpus help triage (34 high, 8 medium, 8 low).
3. **Genuinely ambiguous cases** — classical 子平 has multiple defensible 用神 schools (e.g., 沈孝瞻 vs 任鐵樵 disagree on several charts). The corpus reflects one school; the engine encodes another.

## What this enables

- ✅ The harness is reproducible: `python tests/validation/run_imbalance_validation.py` (off mode by default; flag set inside the script for both modes).
- ✅ Each future engine improvement can be measured against the same 50-chart baseline. If a refactor regresses the number, CI catches it.
- ✅ The gate is honest: it does not silently pass with a partial corpus.

## What this does NOT enable (requires Bazi-master review)

- Flipping `BAZI_USE_WEIGHTED_IMBALANCE` default to `'1'` in production. Per the gate doctrine, that requires:
  1. Triage of the 1 regression (`ziping_zeng_canzheng`) — likely fixture, possibly code.
  2. Triage of the 18 textbook disagreements — classify each as (a) update fixture, (b) fix engine, (c) doctrinal split.
  3. Independent compatibility-test review on the 3 known regressions in `test_compatibility_gold_standard.py`.

These three steps are explicitly the "Phase 2" the user opted out of.

## Files produced

- `.claude/plans/validation_corpus.json` — 50-chart JSON corpus with citations, reasoning, confidence flags
- `packages/bazi-engine/tests/validation/expert_labeled_charts.csv` — flat CSV consumed by the harness
- `packages/bazi-engine/tests/validation/build_csv_from_corpus.py` — JSON→CSV converter with parity validation + dedup
- `packages/bazi-engine/tests/validation/run_imbalance_validation.py` — harness with both-mode runner, diff classifier, 3-gate evaluator
- `.claude/plans/validation_harness_report.txt` — verbatim harness output from this run
