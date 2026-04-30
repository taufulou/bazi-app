Loaded 50 chart(s) from expert_labeled_charts.csv
========================================================================
Mode comparison:
  flag=OFF  用神 agreement: 23/50 ( 46.0%)  dominant agreement: 28/50 ( 56.0%)
  flag=ON   用神 agreement: 33/50 ( 66.0%)  dominant agreement: 43/50 ( 86.0%)

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
  (b) was-right-now-wrong   :   1  ⚠️ REGRESSIONS — block merge until investigated
        ! ziping_zeng_canzheng: OFF=木✓ → ON=火✗ (expected=木)
  (c) unchanged disagreement:  16  (review — flag flip changes nothing here)
        ? ziping_jin_zhuangyuan: OFF=火 ON=木 (expected=土; src=ziping_zhenquan)
        ? ziping_yang_dailang: OFF=金 ON=金 (expected=水; src=ziping_zhenquan)
        ? ziping_wu_bangyan: OFF=土 ON=土 (expected=金; src=ziping_zhenquan)
        ? ziping_wu_xianggong_qu_zhi: OFF=金 ON=金 (expected=木; src=ziping_zhenquan)
        ? ziping_li_zhuangyuan: OFF=金 ON=金 (expected=土; src=ziping_zhenquan)
        ? ziping_niu_jianbo: OFF=火 ON=火 (expected=木; src=ziping_zhenquan)
        ? dts_hezhi_rich1: OFF=木 ON=木 (expected=火; src=ditian_sui)
        ? dts_hezhi_noble3: OFF=土 ON=金 (expected=水; src=ditian_sui)
        ? dts_hezhi_poor1: OFF=金 ON=金 (expected=火; src=ditian_sui)
        ? dts_hezhi_long2: OFF=木 ON=水 (expected=火; src=ditian_sui)
        ? qiongtong_jia_xiaomu_one_qi: OFF=木 ON=木 (expected=火; src=qiongtong_baojian)
        ? qiongtong_jia_chunmu_jinshi: OFF=火 ON=火 (expected=金; src=qiongtong_baojian)
        ? qiongtong_ren_summer_needs_geng: OFF=水 ON=水 (expected=金; src=qiongtong_baojian)
        ? edge_cong_sha_boundary: OFF=火 ON=火 (expected=水; src=edge_case)
        ? edge_shishang_strong_jia: OFF=火 ON=火 (expected=土; src=edge_case)
        ? edge_bijie_strong_jia: OFF=火 ON=火 (expected=金; src=edge_case)

Gate evaluation (flag=ON):
  ❌ 16 gate(s) FAILED:
    - Gate 1 FAIL: 用神 agreement 66.0% < 95%
    - Gate 3 FAIL: 14 textbook subset disagreement(s) > 2
    -     - ziping_jin_zhuangyuan (ziping_zhenquan): actual=木 expected=土
    -     - ziping_yang_dailang (ziping_zhenquan): actual=金 expected=水
    -     - ziping_zeng_canzheng (ziping_zhenquan): actual=火 expected=木
    -     - ziping_wu_bangyan (ziping_zhenquan): actual=土 expected=金
    -     - ziping_wu_xianggong_qu_zhi (ziping_zhenquan): actual=金 expected=木
    -     - ziping_li_zhuangyuan (ziping_zhenquan): actual=金 expected=土
    -     - ziping_niu_jianbo (ziping_zhenquan): actual=火 expected=木
    -     - dts_hezhi_rich1 (ditian_sui): actual=木 expected=火
    -     - dts_hezhi_noble3 (ditian_sui): actual=金 expected=水
    -     - dts_hezhi_poor1 (ditian_sui): actual=金 expected=火
    -     - dts_hezhi_long2 (ditian_sui): actual=水 expected=火
    -     - qiongtong_jia_xiaomu_one_qi (qiongtong_baojian): actual=木 expected=火
    -     - qiongtong_jia_chunmu_jinshi (qiongtong_baojian): actual=火 expected=金
    -     - qiongtong_ren_summer_needs_geng (qiongtong_baojian): actual=水 expected=金
