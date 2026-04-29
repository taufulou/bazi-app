# Validation Disagreement Triage — 21 charts

Triage of every chart where the engine's 用神 disagrees with the corpus expectation under FLAG=ON. Each verdict is grounded in the diagnostic dump (V2 strength factors, weighted ten-god categories, 透干 counts, dominant detection) and the corpus' classical reasoning string.

## Classification summary

| Bucket | Count |
|---|---|
| (a) Corpus error | 0 |
| (b) Engine bug   | 10 |
| (c) Doctrinal split | 11 |

## Per-chart triage

---

### anchor_cong_cai_yiwuming  [CLASSIFICATION: b]

**Pillars**: 庚申 乙酉 丙申 己丑  DM=丙 very_weak  (corpus is_cong_ge=True)
**Engine ON**: dominant=cong_overridden ✓  用=火 ✗
**Corpus expected**: dominant=cong_overridden  用=金  喜=土
**Corpus reasoning**: 全局金土無火根 乙木合庚化金不化木 從財格成立 用神順從財星 (金) 喜土食傷生財

**Triage analysis**:
The engine correctly tags `dominant='cong_overridden'`, but the downstream 從格 override in `interpretation_rules.check_cong_ge()` does not fire — its precondition list rejects this chart because year-stem 乙 is counted as 印 (`yin_bijie`). Classical doctrine says 乙庚合化金, so 乙 ceases to function as 印; engine doesn't model 合化 inside `check_cong_ge`. The output 用=火 / 喜=木 is just `determine_favorable_gods`'s default-weak-DM-general path leaking through (line 585-586 sets `dominant='general'` after `cong_overridden` and proceeds to `用=比劫`). The corpus 用=金 is the standard 從財格 用=財星 rule (《子平真詮·論雜格》).

**Verdict**: (b) ENGINE BUG — 從格 detection blocked by un-applied 五合化氣; effectiveFavorableGods override never fires.

**Recommended action**:
- (b) → fix root cause: in `interpretation_rules.check_cong_ge`, before counting `yin_bijie`, suppress stems neutralised by an active 五合化氣 (here: 乙+庚 adjacent → 乙 transforms to 金, no longer 印). Alternatively, lower the `has_yin_bijie` test for yang DMs when the 印/比劫 stem is locked in 五合化異性 with a 透干 dominant element.

---

### ziping_jin_zhuangyuan  [CLASSIFICATION: c]

**Pillars**: 乙卯 丁亥 丁未 庚戌  DM=丁 neutral
**Engine ON**: dominant=官殺旺  用=木 ✗
**Corpus expected**: dominant=general  用=土  喜=金
**Corpus reasoning**: 月支亥未三合木局 印旺扶身 庚金正財坐戌庫 取財格並用財印 戊土食神洩秀為用

**Triage analysis**:
V2 says very_weak (12.9), but corpus says neutral. The chart is neutral once 亥未(三合木局) + 卯印 are counted, which the engine's V2 doesn't fully credit. Even granting V2's weak verdict, the engine then routes through "weak + 官殺旺 → 用=印=木"; the corpus instead invokes the 沈孝瞻 「並用財印 / 食神洩秀」 rule for a neutral 丁火 with surrounding 印 — taking 戊土食神 as 用神 to drain DM and produce 庚金財. Both 用=木(印) and 用=土(食神) are defensible; this is a textbook 並用財印 doctrinal call rather than an algorithmic flaw.

**Verdict**: (c) DOCTRINAL SPLIT — 沈孝瞻 (並用財印 / 食神洩秀) vs engine's mechanical 病藥取用法.

**Recommended action**:
- (c) → accept either; document classical 「並用財印」 doctrinal note in CLAUDE.md. Optional engine improvement: when V2 is borderline and there's a 三合 印局, raise strength toward neutral and re-route to default-strong-general (用=財).

---

### ziping_yang_dailang  [CLASSIFICATION: c]

**Pillars**: 壬寅 壬寅 庚辰 辛巳  DM=庚 neutral
**Engine ON**: dominant=財旺  用=金 ✗
**Corpus expected**: dominant=general  用=水  喜=木
**Corpus reasoning**: 雙壬食神透干洩秀生財 沈孝瞻謂食神生財 取壬水食神為用 喜寅木財星

**Triage analysis**:
V2=very_weak (19.7) but corpus=neutral. Even if you accept "very_weak", engine then runs "weak + 財旺 → 用=比劫=金". Corpus invokes 「食神生財」 (《子平真詮·論財》) — when 食神 透干 and chains into 財, it becomes the pivot 用神 even on a non-strong DM. Engine's 比劫敵財 doctrine and corpus' 食神生財 doctrine are both classical; here both 透干 双壬 + 寅(財) make 食神生財 the clearer literary read.

**Verdict**: (c) DOCTRINAL SPLIT — 沈孝瞻 食神生財 doctrine vs engine's 比劫敵財 default for 財旺.

**Recommended action**:
- (c) → accept either; document. Optional engine refinement: when 食傷 is 透干 ≥2 with `transparent_count_食傷 > transparent_count_比劫`, consider 食神生財 path instead of 比劫敵財 even with `dominant=財旺`.

---

### ziping_zeng_canzheng  [CLASSIFICATION: c]

**Pillars**: 乙未 甲申 丙申 庚寅  DM=丙 weak  (財旺, 印=6.2 weighted)
**Engine ON**: dominant=財旺  用=火 ✗
**Corpus expected**: dominant=財旺  用=木  喜=火
**Corpus reasoning**: 雙申金財旺 庚透干助財 取乙木甲木印生身為用 沈孝瞻謂財格佩印 喜寅中丙火比劫扶身

**Triage analysis**:
This is the canonical 沈孝瞻「財格佩印」 case (《子平真詮·論財》). Both engine and corpus agree on `dominant=財旺` and `weak DM`. The split is doctrinal: corpus picks 印 first (because 印 here is genuinely strong — weighted 印=6.2 with double 透干 甲乙), while the engine's CLAUDE.md table says "weak DM + 財旺 → 用=比劫, 喜=印". The corpus' choice is the textbook 真詮 prescription when both 印 and 比劫 are available and 印 is heavier.

**Verdict**: (c) DOCTRINAL SPLIT — 沈孝瞻 財格佩印 (印 priority) vs engine's 比劫 priority for weak+財旺.

**Recommended action**:
- (c) → accept either; document in CLAUDE.md as the canonical doctrinal-split pattern. Optional refinement: when weak+財旺 AND 印星 weighted > 比劫 weighted AND 印 has ≥2 透干, swap 用神/喜神 to mirror 真詮.

---

### ziping_wu_bangyan  [CLASSIFICATION: c]

**Pillars**: 庚戌 戊子 戊子 丙辰  DM=戊 weak (V2=30.2; corpus=neutral)
**Engine ON**: dominant=財旺  用=土 ✗
**Corpus expected**: dominant=general  用=金  喜=水
**Corpus reasoning**: 戊比劫透干 戌辰土根 中和略強 庚金食神洩秀 丙火印不礙食 沈孝瞻謂食與印不相礙 取庚金食神為用 喜子水財

**Triage analysis**:
V2 says weak (30.2), but corpus reasons that 戊+戌+辰 makes the chart neutral-or-slightly-strong, not weak. With 戊×2 透干 + 戌+辰 比劫根, this is a classic 「身根足堪洩」 setup — 沈孝瞻 「食神格用食 / 食與印不相礙」 takes 庚金食神洩秀. Engine sees weak + 財旺 → 用=比劫=土 (the wrong direction; you don't strengthen an already-rooted DM with more 比劫). The mismatch is partly a strength-borderline call (which is already a doctrinal area) and partly a classical doctrine the engine doesn't encode (食神洩秀).

**Verdict**: (c) DOCTRINAL SPLIT — 食神洩秀 (《子平真詮·論食神》) vs engine's 比劫敵財 — with secondary borderline-strength call.

**Recommended action**:
- (c) → accept either; document. Engine refinement candidate: when V2 is in [28,35] AND 比劫 weighted ≥ 5 AND 食傷 透干 ≥1, treat as neutral and route 食傷 as 用神.

---

### ziping_wu_xianggong_qu_zhi  [CLASSIFICATION: b]

**Pillars**: 癸亥 乙卯 乙未 壬午  DM=乙 very_strong  (corpus is_cong_ge=True, 曲直格)
**Engine ON**: dominant=cong_overridden ✓  用=土 ✗
**Corpus expected**: dominant=cong_overridden  用=木  喜=火
**Corpus reasoning**: 亥卯未三合木局 雙水印生 全局木氣專一 沈孝瞻明列為曲直仁壽格 用神順從旺神 (木) 喜午火食傷洩秀

**Triage analysis**:
This is 曲直仁壽格 — a 一行得氣 special form where DM is 旺極, not weak. V2=78.3 (very_strong) is correct, and the engine correctly tags `dominant='cong_overridden'`. But `check_cong_ge` in `interpretation_rules.py` requires `score < 35` (line 239), which immediately rejects all 從強/從旺/曲直/炎上/稼穡/從革/潤下 special forms. So the override path never executes; output falls back to `determine_favorable_gods` strong+general → 用=財=土. The corpus' 用=木 (順從旺神) is the universally-accepted 一行得氣格 prescription.

**Verdict**: (b) ENGINE BUG — `check_cong_ge` only handles 從弱 (從財/從官/從兒/從勢); 從強 / 一行得氣格 family entirely missing. cong_overridden detection succeeds in `_detect_dominant_imbalance` (which understands strong cases), but the override consumer rejects it.

**Recommended action**:
- (b) → file engine fix: extend `check_cong_ge` with a 從旺/曲直/炎上/稼穡/從革/潤下 detector. Trigger when V2 ≥ ~75, dm_element dominates ≥ 60% weighted (or DM-element + producing-element ≥ 70%), AND no transparent 官殺 of significant weight (the breaker). 用神 = dm_element, 喜神 = i_produce, 忌神 = overcomes_me.

---

### ziping_li_zhuangyuan  [CLASSIFICATION: c]

**Pillars**: 戊戌 乙卯 丙午 乙亥  DM=丙 strong  印旺 (weighted 印=8.8)
**Engine ON**: dominant=印旺 ✓  用=金 ✗
**Corpus expected**: dominant=印旺  用=土  喜=金
**Corpus reasoning**: 印旺極 取戊土食神洩秀為用 沈孝瞻謂印綬用傷食 戌中藏辛財 喜金財制印

**Triage analysis**:
Both agree on `dominant=印旺`. This is the canonical 沈孝瞻「印綬用傷食」(《子平真詮·論印綬》) — when 印旺身強, prefer 食傷 to drain (洩秀) AND 食傷 is more harmonious than 財 because 財克印 is a head-on collision while 食傷 is a downstream release. Engine's table says "印旺 → 用=財, 喜=食傷"; corpus inverts to 用=食傷, 喜=財. Both classical, this one is the prototypical split.

**Verdict**: (c) DOCTRINAL SPLIT — 沈孝瞻「印綬用傷食」 vs engine's 「印旺 → 財制印」.

**Recommended action**:
- (c) → accept either; document. Engine optional: when strong+印旺 AND 食傷 透干 OR 食傷 weighted ≥ 3, swap to 用=食傷, 喜=財.

---

### ziping_ma_canzheng  [CLASSIFICATION: b]

**Pillars**: 壬寅 戊申 壬辰 壬寅  DM=壬  (V2=neutral 53.7; corpus=strong)
**Engine ON**: dominant=官殺旺 ✗  用=金 ✗
**Corpus expected**: dominant=比劫旺  用=土  喜=木
**Corpus reasoning**: 三壬比劫透干 印旺身重 沈孝瞻謂身重印輕 取戊土七殺制比劫為用 寅木食傷洩秀生財 喜寅中甲木食傷

**Triage analysis**:
V2 misclassifies as `neutral` (53.7), so the engine routes through the weak/neutral branch. There it picks the largest of {食傷, 財, 官殺} — 官殺=5.95 wins by a hair over 比劫=5.35 — yielding `dominant=官殺旺`. Corpus correctly sees 三壬透干 + 申月令印 + 辰墓庫 as `strong` ("身重印輕"). Once classified strong, engine doctrine "比劫旺 → 用=官殺" actually agrees with corpus' 用=戊土七殺. So the failure is upstream: V2 strength scoring under-credits 三壬透干 + 申月令印 to fall short of 60.

**Verdict**: (b) ENGINE BUG — V2 strength scoring drops a clear "strong" chart into "neutral" (multi-透干 比劫 + 月令印 case under-counted); cascades into wrong dominant branch.

**Recommended action**:
- (b) → file engine fix: V2 `calculate_strength_score_v2` (in `interpretation_rules.py`) — boost `得勢` when transparent 比劫 count ≥ 3 AND month branch produces DM (印星月令). Possible add: `+10` per 比劫 透干 above 1. Verify against laopo/roger anchors don't regress.

---

### ziping_niu_jianbo  [CLASSIFICATION: c]

**Pillars**: 庚寅 乙酉 癸亥 丙辰  DM=癸 strong (V2=55.0)  印旺 (weighted 印=3.9)
**Engine ON**: dominant=印旺  用=火 ✗
**Corpus expected**: dominant=印旺  用=木  喜=火
**Corpus reasoning**: 寅木食傷透 乙庚合化金 沈孝瞻謂合財存食 取寅中甲木食傷洩秀為用 喜丙火財制印

**Triage analysis**:
Same family as 李狀元: 印旺身強 corpus invokes 「合財存食 / 食傷洩秀」 (《子平真詮·論印綬》) — picks 食傷 (寅中甲木) as 用. Engine takes 印旺 → 用=財 (火) as default. Even more pointedly, the chart's 乙庚合化金 (corpus reasoning) means 乙 isn't really a 財 — it has been transformed into 印, making 財 even less suitable as 用神. Engine doesn't apply 合化 in this layer, so it sees 火 as a clean 財 option.

**Verdict**: (c) DOCTRINAL SPLIT — 沈孝瞻 「合財存食 / 印綬用傷食」 vs engine's 印旺取財; secondary ingredient: 五合化氣 not modeled.

**Recommended action**:
- (c) → accept either; document. Same engine refinement as `ziping_li_zhuangyuan` would also fix this.

---

### ziping_liang_chengxiang  [CLASSIFICATION: b]

**Pillars**: 丁未 癸卯 癸亥 癸丑  DM=癸 neutral (V2=42.7)
**Engine ON**: dominant=食傷旺  用=金 ✗
**Corpus expected**: dominant=general  用=木  喜=火
**Corpus reasoning**: 三癸比劫扶身 亥卯未三合木局食神專旺 取卯木食神洩秀生財 沈孝瞻列為食神生財格

**Triage analysis**:
V2=neutral (42.7) — correct. But the engine's `_detect_dominant_imbalance` for neutral DM still tries to find ONE dominant from {食傷, 財, 官殺}; here weighted 食傷=4.2 > 財=2.4 > 官殺=2.6, so it stamps "食傷旺", then weak-branch doctrine "食傷旺 → 用=印=金". The corpus prescription "食神生財" wants 用=食傷 (木) — which is exactly what 食神 is in this 癸 chart. The engine's bug is that for a `neutral` DM, picking 食傷 as illness AND prescribing 印 is upside-down: the 食傷 is the chart's strength (洩秀生財), not the disease.

**Verdict**: (b) ENGINE BUG — for neutral DM, 食傷旺 should not auto-trigger 印 as 用 when DM is balanced; engine treats neutral identically to weak in `_detect_dominant_imbalance` candidate set.

**Recommended action**:
- (b) → file engine fix: in `_detect_dominant_imbalance` and `determine_favorable_gods`, treat `neutral` as a third branch (not weak). For neutral DM with 食傷 as the heaviest weighted category AND 食傷 is 透干, prescribe 用=食傷 (洩秀), 喜=財 — i.e., the 食神生財 path. This single change resolves several entries below.

---

### ziping_shen_lufen  [CLASSIFICATION: b]

**Pillars**: 丁亥 癸卯 癸卯 甲寅  DM=癸 neutral (corpus); V2=weak (34.1)
**Engine ON**: dominant=食傷旺  用=金 ✗
**Corpus expected**: dominant=general  用=木  喜=火
**Corpus reasoning**: 亥水比劫 全局木氣旺 甲透傷官 卯藏食神 沈孝瞻謂藏食露傷 取甲木傷官洩秀生財 喜丁火財

**Triage analysis**:
Same engine pattern as 梁丞相. V2=34.1 (weak by score, but borderline; corpus=neutral). Weighted 食傷=8.9 dominates everything; this is supposed to be the chart's STRENGTH (傷官洩秀生財), not a disease. Engine prescribes 用=印=金 to "fix" the supposed 食傷旺 imbalance — the opposite of what 沈孝瞻 「藏食露傷」 prescribes. Same root cause as `ziping_liang_chengxiang`.

**Verdict**: (b) ENGINE BUG — same as `ziping_liang_chengxiang`; neutral DM with 食傷 透干 should route to 食傷洩秀 not 印.

**Recommended action**:
- (b) → see `ziping_liang_chengxiang`. Single fix covers both.

---

### ziping_qin_longtu  [CLASSIFICATION: b]

**Pillars**: 己卯 丁丑 丙寅 庚寅  DM=丙 neutral (V2=weak 39.9; corpus=neutral)
**Engine ON**: dominant=食傷旺  用=木 ✗
**Corpus expected**: dominant=general  用=金  喜=土
**Corpus reasoning**: 雙寅卯印旺 丁火比劫助身 中和 己土傷官透干 庚金財透 沈孝瞻謂傷官生財 財傷有情 取庚金財為用 喜己土傷官生財

**Triage analysis**:
Same family. V2=39.9 (weak by score; corpus=neutral); weighted 食傷=5.6 highest. Corpus invokes 「傷官生財」(《子平真詮·論傷官》) — neutral DM with 食傷+財 透干 forms a 食傷生財 chain, take 財 as 用 (the destination). Engine's "食傷旺 → 用=印=木" goes the opposite direction (would block the 傷官生財 chain). Same root cause as the previous two: neutral DM with 食傷 透干 mis-treated as a weak-imbalance case.

**Verdict**: (b) ENGINE BUG — same family.

**Recommended action**:
- (b) → covered by the same fix proposed for `ziping_liang_chengxiang`. With 財 also 透干 (庚), the prescription should be 用=財 not 用=食傷; the trigger would be: neutral DM, 食傷 透干, 財 透干, 食傷生財 chain → 用=財, 喜=食傷.

---

### dts_hezhi_rich1  [CLASSIFICATION: c]

**Pillars**: 甲申 丙子 壬寅 辛亥  DM=壬 very_strong (V2=76.4)  比劫旺
**Engine ON**: dominant=比劫旺 ✓  用=土 ✗
**Corpus expected**: dominant=比劫旺  用=火  喜=木
**Corpus reasoning**: 申亥子水旺 辛印生身 身強印重 任鐵樵注財氣通門戶 取丙火財星為用 寅中甲木食傷生財

**Triage analysis**:
This is the prototypical 滴天髓「財氣通門戶」 case (《滴天髓闡微·何知章》). Both agree DM is very_strong + 比劫旺. Engine doctrine: 比劫旺 → 用=官殺=土. Corpus doctrine: when 食傷 is rooted (寅中甲) AND 財 is 透干 AND 比劫+印 are heavy, 食傷生財 chain provides natural 通關 — take 財 as 用 because the 食傷 bridge prevents 比劫直接克財. This is the 任鐵樵 滴天髓 reading; 沈孝瞻 真詮 would also accept "比劫旺 → 用=官殺" as engine does. Two valid schools.

**Verdict**: (c) DOCTRINAL SPLIT — 任鐵樵 滴天髓「財氣通門戶」 vs 沈孝瞻 真詮「比劫旺取官殺」.

**Recommended action**:
- (c) → accept either; document. Engine optional: detect 食傷生財 chain when 比劫旺+印旺 strong DM has both 食傷 rooted (透干 or 月令本氣) AND 財 透干 → swap to 用=財, 喜=食傷.

---

### dts_hezhi_noble3  [CLASSIFICATION: b]

**Pillars**: 甲午 丙寅 辛酉 己丑  DM=辛 neutral (V2=weak 29.7; corpus=neutral)
**Engine ON**: dominant=財旺  用=金 ✗
**Corpus expected**: dominant=general  用=水  喜=金
**Corpus reasoning**: 酉丑半合金局比劫 己土印生身 中和 寅午半合火局 丙火官殺透干 任鐵樵注財臨旺地官遇長生 取水食傷洩秀制官 喜金扶身

**Triage analysis**:
V2=29.7 (weak by score); corpus=neutral after counting 酉丑半合金局 (比劫). Engine then sees 財=4.8 < 官殺=5.2 actually — hmm, but engine flagged `財旺` not `官殺旺`. Looking again: `WEIGHTED CATEGORIES: 比劫=2.15, 食傷=0.7, 財星=4.8, 官殺=5.2, 印星=4.6` — 官殺=5.2 is the actual max. Looking at FLAG=ON, it printed `dominant: 財旺`. The harness shows 官殺 ≥ 財 by 0.4 weighted, but flag-ON dominance picked 財旺. This suggests the weighted detector may have a margin/threshold rule (20%/3.0-floor per docstring) and 官殺 didn't clear margin → fell back to next-best. Either way, this is a borderline neutral chart where corpus calls it general and prescribes 「食傷洩秀制官」.

The deeper issue: corpus says the chart is neutral because 酉丑半合金局 (比劫=金 strengthens DM 辛). Engine V2 doesn't credit 半合 transformation, so DM stays "weak". Prescribing 用=金=比劫 at least directionally agrees with "扶身", but corpus 用=水(食傷洩秀+制官) is a different doctrine.

**Verdict**: (b) ENGINE BUG — secondary cause: V2 doesn't model 半合金局 strengthening DM, so neutral charts get scored weak → wrong rule-branch fires.

**Recommended action**:
- (b) → file engine fix: V2 `得地` should give partial credit when DM-element appears as the formed element of an active 三合/半合 (here 酉丑→金). This is a known gap.

---

### dts_hezhi_long2  [CLASSIFICATION: c]

**Pillars**: 辛丑 癸巳 甲子 丙寅  DM=甲 neutral (V2=weak 36.7; corpus=neutral)
**Engine ON**: dominant=食傷旺  用=水 ✗
**Corpus expected**: dominant=general  用=火  喜=土
**Corpus reasoning**: 寅祿子印雙根 中和 丑藏辛官 巳火食神透丙 任鐵樵注五行元氣皆厚官坐財地 取丙火食神洩秀生財為用 喜土財

**Triage analysis**:
V2=36.7 (weak; corpus=neutral). Same neutral-DM-with-食傷-透干 pattern as the 癸 charts (`ziping_liang_chengxiang` etc.). Corpus 用=丙火食神洩秀, engine 用=水(印, weak+食傷旺 doctrine). The mismatch is the same family but the bug is on the borderline (corpus reasoning explicitly says 「中和」). Marking as (c) here because V2's "weak" verdict is a reasonable read for a 甲生巳月 with only 寅祿+子印 supporting; classical reasoning takes 「五行元氣皆厚」 as neutral but it's a softer call than the obvious-strong `dts_hezhi_rich1`.

**Verdict**: (c) DOCTRINAL SPLIT — borderline strength + 食神洩秀 vs 印化食. Doctrinal more than algorithmic.

**Recommended action**:
- (c) → accept either; document. Same neutral-DM-with-食傷-透干 fix proposed for `ziping_liang_chengxiang` would also flip this to corpus' 用神; whether to apply depends on whether you want the engine biased toward 真詮 mode.

---

### dts_hezhi_long_ji_dm  [CLASSIFICATION: b]

**Pillars**: 戊辰 庚申 己卯 戊辰  DM=己 neutral (V2=neutral 44.2)
**Engine ON**: dominant=食傷旺  用=火 ✗
**Corpus expected**: dominant=general  用=金  喜=水
**Corpus reasoning**: 雙戊辰土比劫透根 中和略強 庚金傷官透 卯木殺孤 任鐵樵注土金傷官正財歸庫 取庚金傷官洩秀為用 喜水財

**Triage analysis**:
V2 correctly says neutral (44.2). Same pattern: heaviest weighted category is 比劫=7.0 (and 食傷=6.0); engine for neutral routes through weak-branch candidates {食傷, 財, 官殺} and picks 食傷. But this chart is `中和略強` per corpus; even on engine's own doctrine, "neutral leaning strong with 食傷 透干" should be 食傷洩秀 (用=食傷=金) — same as corpus. Engine instead emits 用=印=火 (weak+食傷旺 doctrine), which is wrong for a neutral DM. Same root cause as the 食神生財 family (`liang_chengxiang`/`shen_lufen`/`qin_longtu`).

**Verdict**: (b) ENGINE BUG — same family.

**Recommended action**:
- (b) → covered by the same fix.

---

### dts_hezhi_yao_pinwo  [CLASSIFICATION: b]

**Pillars**: 辛丑 癸巳 丙子 丁酉  DM=丙 (V2=strong 62.2; corpus=very_weak)
**Engine ON**: dominant=官殺旺 ✓  用=土 ✗
**Corpus expected**: dominant=官殺旺  用=木  喜=火
**Corpus reasoning**: 丙生巳月建祿但時辰子水殺透癸 申酉丑金財旺 全局財官旺極而身根受傷 任鐵樵注日主虛弱極矣 取木印化煞生身為用 喜丁火比劫扶身

**Triage analysis**:
Strength classification mismatch. V2 awards 得令=50 for 巳月 (祿地) and arrives at 62.2 → strong. Corpus says very_weak: 巳火單根, 全局 三財官殺 (子癸丁傷+丑酉申金+ 丑藏癸殺) overwhelming. The corpus reading is the standard 滴天髓 line: 「日主雖坐祿地, 但四柱財官圍剋, 為虛弱」. Once strength is correctly weak/very_weak with 官殺旺, engine doctrine "weak + 官殺旺 → 用=印=木" matches corpus exactly. So the real bug is V2 strength.

**Verdict**: (b) ENGINE BUG — V2 over-credits 月令祿 in the surrounded-DM scenario (high enemy weight should partially neutralise 月令祿 credit).

**Recommended action**:
- (b) → file engine fix: V2 `得令=50` for 月令祿 should be moderated when (財 + 官殺) weighted ≥ ~10 AND 比劫+印 weighted ≤ ~5. Concretely: subtract `min(20, (enemy_weight - support_weight) * 2)` when surround condition holds.

---

### qiongtong_jia_xiaomu_one_qi  [CLASSIFICATION: c]

**Pillars**: 甲辰 甲戌 甲辰 甲戌  DM=甲 neutral (V2=weak 27.2; corpus=neutral)
**Engine ON**: dominant=財旺  用=木 ✗
**Corpus expected**: dominant=general  用=火  喜=金
**Corpus reasoning**: 四甲透干 辰戌沖開土庫 中和 窮通寶鑑謂天元一氣 富貴壽考 一才一用 取火食傷洩秀為用 喜金官殺修剪

**Triage analysis**:
天元一氣 special form with 四甲透干. V2=27.2 misses the 四透干 amplification (transparent 比劫=3, but the 四甲 一氣 should be even higher). Corpus says neutral; even if you accept "weak" route, the 一氣 chart with 食傷 outlet should prescribe 食傷, not 比劫. The corpus' 火食傷洩秀+金修剪 is the 窮通寶鑑 special-form reading. Engine's 用=比劫 for weak+財旺 is its own doctrine — but for a 一氣格 (essentially semi-從旺), you should take 食傷 as 用. This is more doctrinal than algorithmic since 天元一氣 is a 雜格.

**Verdict**: (c) DOCTRINAL SPLIT — 窮通寶鑑「天元一氣」雜格 doctrine vs engine's mainstream 病藥取用法.

**Recommended action**:
- (c) → accept either; document. Engine optional: detect 天元一氣 (4 identical year/month/day/hour stems) and route through 一氣特格 logic (用=食傷洩秀, 喜=官殺修剪).

---

### qiongtong_ren_summer_needs_geng  [CLASSIFICATION: c]

**Pillars**: 丙午 甲午 壬午 辛丑  DM=壬 very_weak (V2=very_weak 17.5; both agree)
**Engine ON**: dominant=財旺 ✓  用=水 ✗
**Corpus expected**: dominant=財旺  用=金  喜=土
**Corpus reasoning**: 三午火財旺極 丙透干助財 弱身遇財重 窮通寶鑑謂夏壬用庚辛印 取辛金印生身且制傷 喜丑中己土食傷生印

**Triage analysis**:
Strength + dominant match. The split is purely doctrinal: engine "weak + 財旺 → 用=比劫=水", corpus 「夏壬用庚辛」 (《窮通寶鑑·三夏壬水》) — this is the 調候用神 doctrine which prescribes 印 (金) regardless of 比劫 availability when DM is summer 壬. 病藥取用法 (engine) and 調候取用法 (corpus) are two parallel classical methods; both are valid, but for summer-fire 壬 the 調候 reading is the literary canonical answer.

**Verdict**: (c) DOCTRINAL SPLIT — 窮通寶鑑 調候取用法 vs engine's 病藥取用法.

**Recommended action**:
- (c) → accept either; document. CLAUDE.md already lists 調候 as a separate advisory (Phase 12 Fix 2); the current implementation surfaces it as a structured advisory but doesn't override 用神. A future toggle could promote the 調候 element to 用神 when (a) DM is summer/winter weak AND (b) classical 調候 prescription element is available in chart.

---

### edge_cong_sha_boundary  [CLASSIFICATION: c]

**Pillars**: 辛酉 丁酉 辛酉 戊戌  DM=辛 very_strong (V2=92.1)  比劫旺
**Engine ON**: dominant=比劫旺 ✓  用=火 ✗
**Corpus expected**: dominant=比劫旺  用=水  喜=木
**Corpus reasoning**: 雙辛三酉戌金比劫旺極 戊土印生 但丁火七殺透干通根戌中藏丁 不從 取水食傷洩秀為用 (亦可制丁) 喜木財通關 從旺boundary但丁火破局故不成從

**Triage analysis**:
比劫旺極 unambiguous. Engine doctrine "比劫旺 → 用=官殺=火" is classically valid — and indeed 丁火 IS present (透干). Corpus prefers 「強者宜洩」 (《滴天髓》) — when 比劫 is so heavy that direct 官殺 attack would clash dangerously, take 食傷 to drain instead. Both readings are textbook; 滴天髓 leans toward 洩 for very_strong, 真詮 leans toward 克. This is the classic "強者宜剋 vs 強者宜洩" doctrinal split.

**Verdict**: (c) DOCTRINAL SPLIT — 滴天髓「強者宜洩」(食傷) vs 真詮「比劫旺取官殺」(engine).

**Recommended action**:
- (c) → accept either; document. Engine optional: when V2 ≥ 85 (extreme strength) AND 食傷 ≥ a small threshold, swap to 食傷洩秀 path.

---

### edge_shishang_strong_jia  [CLASSIFICATION: b]

**Pillars**: 丙寅 甲午 甲寅 丁卯  DM=甲 (V2=neutral 49.5; corpus=strong)
**Engine ON**: dominant=食傷旺 ✗  用=水 ✗
**Corpus expected**: dominant=比劫旺  用=土  喜=金
**Corpus reasoning**: 雙寅卯比劫透甲 旺強 丙丁食傷透干洩秀 寅午半合食傷局 食傷洩身強旺勢 取土財為用 (洩食傷生官) 喜金官殺修剪比劫

**Triage analysis**:
V2 says neutral (49.5); corpus says strong. With 三比劫透干 (甲×2 + 寅×2 比劫根 + 卯) and 卯月 (羊刃地), this should easily clear 60. V2 under-counts again. Once strong, weighted 食傷=8.4 vs 比劫=7.4 — 食傷 narrowly wins, so even if classified strong, engine would still pick 食傷旺 not 比劫旺. But the corpus argues 比劫 is the underlying source (透干 比劫>食傷; 食傷 just drained from 比劫 root). For corpus' 用=土(財), the 比劫旺 doctrinal output is 用=官殺=金 in the engine table — corpus' 用=土 is actually 喜神 in engine doctrine. So even fixing dominant to 比劫旺 won't immediately yield 用=土.

Looking deeper: corpus reasoning is "取土財為用 (洩食傷生官) 喜金官殺修剪" — they're picking 財 because 食傷 already drains, so adding 食傷 again would over-drain; go to next station 財. This is the strong+general doctrine "用=財, 喜=食傷". The cleanest read is corpus considers this "strong but balanced enough that direct 比劫旺 rule doesn't apply" — i.e., 比劫旺 is partially neutralised by 食傷 sequestration → fall through to general → 用=財.

**Verdict**: (b) ENGINE BUG — V2 under-counts 三比劫透干 + 月令羊刃; cascading 食傷-vs-比劫 dominant disambiguation issue. Even with V2 fixed, the dominant 食傷 vs 比劫 choice when 食傷 is purely drained-from-比劫 needs special handling.

**Recommended action**:
- (b) → file engine fix (two parts): (1) V2 strength: 比劫 透干 ≥3 + 月令本氣比劫 should clear 60 (same fix as `ziping_ma_canzheng`). (2) `_detect_dominant_imbalance` strong-branch: when 比劫 weighted ≥ 7 AND 食傷 weighted is roughly equal but 食傷 has no 印 to back it, prefer 比劫 as dominant since 食傷 is downstream.

---

## Engine bug patterns

The 10 (b) verdicts cluster into 3 root causes:

### Pattern 1: Neutral-DM-with-食傷-透干 routed as weak+食傷旺 (4 charts)
Charts: `ziping_liang_chengxiang`, `ziping_shen_lufen`, `ziping_qin_longtu`, `dts_hezhi_long_ji_dm`.

**Root cause**: `_detect_dominant_imbalance` in `five_elements.py:498-501` lumps `neutral` into the weak/neutral branch with candidates {食傷, 財星, 官殺}; `determine_favorable_gods` then applies the weak-branch doctrine (食傷旺 → 用=印). For a TRULY weak DM that's correct (印 strengthens DM and restrains 食傷). For a neutral DM with 食傷 透干, the 食傷 IS the chart's natural outlet (洩秀生財) and should be 用神 itself.

**Fix sketch**: introduce a third branch for `strength == 'neutral'` in both functions. For neutral DM: when 食傷 is the heaviest weighted category AND 食傷 has 透干 ≥1, route to 用=食傷 (洩秀); if 財 also 透干, route to 用=財 with 喜=食傷 (食神生財 chain).

### Pattern 2: V2 strength under-counts multi-透干 比劫 + 月令印 strong charts (3 charts)
Charts: `ziping_ma_canzheng`, `dts_hezhi_yao_pinwo` (over-credits 月令祿 instead, opposite direction), `edge_shishang_strong_jia`.

**Root cause**: V2 `calculate_strength_score_v2` produces neutral / weak / strong scores that don't match the obvious classical read. Specifically:
- Multi-透干 比劫 (≥3) + 月令印 case → V2 gives neutral; classical = strong.
- 月令祿 + 全局財官圍攻 → V2 gives strong; classical = very_weak.

Because dominant detection uses the weak-vs-strong branch as a switch, an off-by-one in strength misroutes the entire downstream chain.

**Fix sketch**: 
- Add `+10` per 比劫 透干 above the second one when DM month branch is 印星 (cooperative reinforcement).
- When `(財 + 官殺) weighted ≥ 10` AND `(比劫 + 印) weighted ≤ 5`, dampen `得令=50` 月令祿 credit by `(enemy_weight - support_weight) * 2` (max 20pt cut). This handles the `dts_hezhi_yao_pinwo` 「日主虛弱極矣」 case.
- Credit DM via 半合/三合 formed-element matches (e.g., 酉丑 → 金 strengthens 辛 DM) — affects `dts_hezhi_noble3`.

### Pattern 3: 從格 detection too narrow (2 charts)
Charts: `anchor_cong_cai_yiwuming`, `ziping_wu_xianggong_qu_zhi`.

**Root cause**: `check_cong_ge` in `interpretation_rules.py:208` covers only 從弱 family (從財/從官/從兒/從勢), gates entirely on `score < 35`, and counts 印/比劫 stems literally without applying 五合化氣.

**Fix sketch**: 
- Add 從強/從旺 / 一行得氣格 family detector (trigger when V2 ≥ 75, dominant element ≥ 60% weighted, no breaker 透干).
- Pre-process 五合化氣 when checking `has_yin_bijie`: a stem locked in active 五合化異性 with adjacent partner should not block 從格.

Note: `dts_hezhi_noble3` falls under Pattern 2 (sub-issue: 半合 not credited toward DM strength).

## Recommended next steps

1. **CSV updates (a verdicts)**: NONE required. No corpus errors identified. The corpus is robustly sourced.
2. **Phase 12d engine work, prioritised by frequency**:
   1. *(highest impact, 4 charts)* — Add a `neutral` branch in `_detect_dominant_imbalance` + `determine_favorable_gods`. Resolves Pattern 1 entirely.
   2. *(3 charts)* — V2 strength refinements: 比劫 透干 boost, 月令祿 surround-dampener, 半合 DM-element credit.
   3. *(2 charts)* — Extend `check_cong_ge` with 從強/從旺/一行得氣 + apply 五合化氣 in 從弱 root counting.
3. **Document doctrinal notes (c verdicts) in CLAUDE.md** under a new "Accepted doctrinal ambiguities" subsection:
   - 印旺身強: 真詮 食傷洩秀 vs 滴天髓 財制印 (`ziping_li_zhuangyuan`, `ziping_niu_jianbo`)
   - 財旺弱身: 真詮 財格佩印 (印 priority) vs engine 比劫敵財 (`ziping_zeng_canzheng`, `ziping_jin_zhuangyuan`, `ziping_wu_bangyan`)
   - 食神生財 / 並用財印: 真詮 用=食傷或財 vs engine 用=比劫 (`ziping_yang_dailang`, `dts_hezhi_long2`, `qiongtong_jia_xiaomu_one_qi`)
   - 比劫旺極: 滴天髓 食傷洩秀 vs 真詮 取官殺 (`edge_cong_sha_boundary`, `dts_hezhi_rich1`)
   - 調候 vs 病藥: 窮通寶鑑 用=印(金) vs 病藥 用=比劫 for summer 壬 (`qiongtong_ren_summer_needs_geng`)
4. **CI gating**: keep BAZI_USE_WEIGHTED_IMBALANCE OFF until Pattern 1 + 2 fixes land — flipping ON now would shift 7+ readings without corresponding doctrine changes.
