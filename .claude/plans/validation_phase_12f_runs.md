Loaded 50 chart(s) from expert_labeled_charts.csv
  ⚠️  Accepting 16 doctrinal-split charts as agreement (per CLAUDE.md Phase 12d).
========================================================================
Mode comparison:
  flag=OFF  用神 agreement: 38/50 ( 76.0%)  dominant agreement: 36/50 ( 72.0%)
  flag=ON   用神 agreement: 49/50 ( 98.0%)  dominant agreement: 48/50 ( 96.0%)

Diff classification (flag-OFF → flag-ON, 用神 only):
  (a) was-wrong-now-right   :  11
        + laopo: OFF=木✗ → ON=水✓ (expected=水)
        + anchor_xue_xianggong_guansha_mixed: OFF=木✗ → ON=水✓ (expected=水)
        + ziping_li_canzheng: OFF=木✗ → ON=水✓ (expected=水)
        + ziping_fan_taifu: OFF=土✗ → ON=火✓ (expected=火)
        + ziping_ma_canzheng: OFF=木✗ → ON=土✓ (expected=土)
        + ziping_cai_guifei: OFF=金✗ → ON=土✓ (expected=土)
        + ziping_jin_chengxiang: OFF=火✗ → ON=土✓ (expected=土)
        + dts_hezhi_rich2: OFF=金✗ → ON=水✓ (expected=水)
        + dts_hezhi_noble2: OFF=金✗ → ON=水✓ (expected=水)
        + dts_hezhi_yao_pinwo: OFF=火✗ → ON=木✓ (expected=木)
        + edge_guansha_mixed_boundary: OFF=木✗ → ON=水✓ (expected=水)
  (b) was-right-now-wrong   :   0
  (c) unchanged disagreement:   1  (review — flag flip changes nothing here)
        ? ziping_wu_xianggong_qu_zhi: OFF=金 ON=金 (expected=木; src=ziping_zhenquan)

Gate evaluation (flag=ON):
  ✅ All 3 gates PASSED. Flag flip is unblocked from harness perspective.
     (Bazi-master sign-off on compat regressions still required separately.)
