# Bazi Reference Data — Engine Validation Guide

## Purpose

This document catalogs trusted reference sources and cross-validated Bazi chart data for validating our engine's accuracy. The structured test data lives in `packages/bazi-engine/tests/fixtures/gold_standard_charts.json` and is tested by `test_gold_standard_validation.py`.

## Date: 2026-02-26

---

## 1. Trusted Online Bazi Calculators (by Tier)

### Tier 1 — Most Detailed (best for cross-validation)

| Site | URL | Key Strengths |
|------|-----|---------------|
| **漢程網** | life.httpcn.com | 五行比例 (weighted %), 十神 strength, 同類/異類, 格局, 用神 |
| **劍靈命理網** | dearmoney.com.tw | 合會沖化 analysis, 格局, 用神喜忌. Over 68M queries. zh-TW |
| **天天命盤** | pan.tthuangli.com | Classical text basis (三命通會/滴天髓/窮通寶鑑). Dedicated 身強身弱 and 用神 tools |
| **BaZi-Calculator.com** | bazi-calculator.com | Ten Gods %, Shen Sha, 3 HHS methods (Traditional/Modern/Ken Lai), manual transformations |

### Tier 2 — Good Detail

| Site | URL | Key Strengths |
|------|-----|---------------|
| **Fatew.com** | fatew.com | True Solar Time correction, multi-method 用神 (調候/通關/扶抑). Also has ZWDS |
| **神巴巴** | shen88.cn | Dedicated Shen Sha tool, 《三命通會》 basis, True Solar Time |
| **水墨先生** | smxs.com | General charting, good for Shen Sha verification |
| **易安居** | m.zhouyi.cc/bazi/pp/ | 胎元/命宮, 喜用神, 二十八星宿, 神煞 with explanations |
| **神機閣** | shenjige.cn/sizhu/base | 納音五行, 十神六親, 格局, 調候 |
| **卜易居** | pp.buyiju.com | True Solar Time, reverse-lookup (八字反推), multiple charting systems |

### Tier 3 — English / International

| Site | URL | Key Strengths |
|------|-----|---------------|
| **Joey Yap** | bazi.joeyyap.com | Brand trust, commercial PDF output. Good for basic pillar verification |
| **Mingli.info** | mingli.info/bazi | HHS, Qi phases, symbolic stars |
| **BaZi Lab** | bazi-lab.com | AI-enhanced, Five Elements balance visualization |

### Additional / Specialized

| Site | URL | Notes |
|------|-----|-------|
| **元亨利貞網** | china95.net/paipan/bazi/ | Operating since 2003, most widely used in China |
| **問真八字** | pcbz.iwzwh.com | Used by 1M+ practitioners, reverse birth-time lookup |
| **科技紫微網** | click108.com.tw | Largest fortune-telling site globally (10M+ charts) |
| **靈匣網** | lnka.tw/app/bazi.aspx | Comprehensive Shensha encyclopedia |
| **策天派** | cetianpai.com/ct/ | Unique quantitative 格神度數 scoring system |

### Access Note

Most calculators use JavaScript rendering and block automated access (HTTP 403). Manual verification is required for cross-validation. Joey Yap provides downloadable PDF reports.

---

## 2. Cross-Validation Strategy

### Which sources to use for each data point:

| Data Point | Primary | Secondary | Tertiary |
|---|---|---|---|
| **四柱** (Pillars) | BaZi-Calculator.com | 漢程網 | 天天命盤 |
| **十神** (Ten Gods) | BaZi-Calculator.com (%) | 漢程網 | 劍靈命理網 |
| **藏干** (Hidden Stems) | BaZi-Calculator.com (3 methods) | 漢程網 | Any Tier 1-2 |
| **身強身弱** (Strength) | 漢程網 | 天天命盤 | BaZi-Calculator.com |
| **格局** (Pattern) | 漢程網 | 劍靈命理網 | Fatew.com |
| **用神** (Useful God) | 漢程網 | 天天命盤 | Fatew.com |
| **神煞** (Shen Sha) | BaZi-Calculator.com | 神巴巴 | 水墨先生 |
| **五行比例** (Element %) | 漢程網 | BaZi-Calculator.com | 天天命盤 |
| **大運** (Luck Pillars) | Any Tier 1-2 | Joey Yap | BaZi-Calculator.com |

### Tolerance Levels

| Data Type | Tolerance | Rationale |
|---|---|---|
| Pillars | **0% — must match exactly** | Deterministic calculation |
| Ten Gods | **0% — must match exactly** | Deterministic given DM |
| Hidden Stems | **0% — must match exactly** | Standard lookup table |
| DM Strength (V2) | **±5 points** | Regression detection |
| Five Elements % | **±2%** | Seasonal weighting varies slightly |
| Pattern (格局) | **Match 2/3 sources** | School-dependent |
| Useful God (用神) | **Match 2/3 sources** | School-dependent |
| Shen Sha | **Core stars must match** | Lists vary by school |

---

## 3. Reference Charts — Our Validated Subjects

### Subject A: Laopo (1987-01-25 16:44, Female)

| Item | Value | Sources |
|------|-------|---------|
| **四柱** | 丙寅/辛丑/甲戌/壬申 | Joey Yap + Rival seer + Engine |
| **日主** | 甲木 (陽) | All agree |
| **格局** | 正官格 | Joey Yap (95%) + Rival + Engine |
| **身強弱** | very_weak (V2: 20.6) | All agree: weak |
| **用神** | 木 | Rival + Engine |
| **喜神** | 水 | Rival + Engine |
| **忌神** | 金 | Rival + Engine |
| **仇神** | 土 | Engine |
| **空亡** | 申, 酉 (day) | Engine |
| **桃花** | 卯 | Joey Yap confirmed |
| **驛馬** | 申 | Joey Yap confirmed |

### Subject B: Roger (1987-09-06 16:11, Male)

| Item | Value | Sources |
|------|-------|---------|
| **四柱** | 丁卯/戊申/戊午/庚申 | Joey Yap + Engine |
| **日主** | 戊土 (陽) | All agree |
| **格局** | 食神格 | Joey Yap (100%) + Engine |
| **身強弱** | neutral (V2: 40.6) | Engine |
| **用神** | 水 | Engine |
| **喜神** | 金 | Engine |
| **忌神** | 土 | Engine |
| **空亡** | 子, 丑 (day) | Engine |
| **桃花** | 卯 | Joey Yap confirmed |
| **驛馬** | 申 | Joey Yap confirmed |
| **大運** | 丁未→庚子 (8 periods) | Joey Yap confirmed match |

### Subject C: Standard Test (1990-05-15 14:30, Male)

| Item | Value | Sources |
|------|-------|---------|
| **四柱** | 庚午/辛巳/庚辰/癸未 | Engine + test_four_pillars.py |
| **日主** | 庚金 (陽) | Engine |
| **格局** | 偏官格 | Engine |
| **身強弱** | V1: neutral (45), V2: very_weak (14.0) | Engine (V1/V2 disagree) |
| **用神** | 金 | Engine |
| **特殊** | 魁罡日 + 十惡大敗日 | Engine |
| **三會** | 巳午未三會火局 | Engine |

---

## 4. Reference Charts — Historical Figures

### 毛澤東 (1893-12-26, 辰時)

| Item | Value | Sources |
|------|-------|---------|
| **四柱** | 癸巳/甲子/丁酉/甲辰 | 《千里命稿》+ Engine |
| **日主** | 丁火 (陰) | All agree |
| **格局** | 七殺格 (殺印相生) | Professional consensus |
| **身強弱** | 身極弱 | Professional consensus |
| **大運** | 癸亥→丙辰 (8→78歲) | Multiple published sources |

### 蔣介石 (1887-10-31, 午時)

| Item | Value | Sources |
|------|-------|---------|
| **四柱** | 丁亥/庚戌/己巳/庚午 | 《千里命稿》+ Engine |
| **日主** | 己土 (陰) | All agree |
| **格局** | 傷官佩印格 | 韋千里 analysis |
| **身強弱** | 身偏旺 (Engine V2: 70.3) | Professional consensus |
| **大運** | 己酉→辛丑 (9 periods) | Published sources |

### 鄧小平 (1904-08-22, 子時)

| Item | Value | Sources |
|------|-------|---------|
| **四柱** | 甲辰/壬申/戊子/壬子 | Engine (壬申 month version) |
| **日主** | 戊土 (陽) | All agree |
| **格局** | 從財格 (龍歸大海) | Professional consensus |
| **身強弱** | 身極弱 | Professional consensus |
| **關鍵** | 申子辰三合水局 | Defining feature |

**Note**: Birth month debated — some sources cite 癸酉 instead of 壬申.

### 周恩來 (1898-03-05, 午時)

| Item | Value | Sources |
|------|-------|---------|
| **四柱** | 戊戌/乙卯/丁卯/丙午 | Engine calculation |
| **日主** | 丁火 (陰) | All agree |
| **格局** | 從強格 | Professional consensus |
| **身強弱** | 身極旺 (Engine V2: 59.2) | Strong direction confirmed |

**Note**: Published sources cite 甲寅 for month pillar (assuming Mar 5 is before 驚蟄 of 1898). Our engine calculates 乙卯 based on astronomical solar term data. The `test_real_world_validation.py` uses the published version (甲寅) via manual pillar construction.

---

## 5. Celebrity Couple Validation Data

5 couples tested in `test_compatibility_gold_standard.py`:

| Couple | Status | Key Finding |
|--------|--------|-------------|
| 周杰倫 + 昆凌 | **Happy** | Same DM (乙木), 戊癸合, identical 用神 → HIGHEST score |
| 大S + 汪小菲 | Divorced | BOTH unstable marriage palaces (卯酉沖 + 子午沖), BOTH 陰陽差錯日 |
| 謝霆鋒 + 張柏芝 | Divorced | 戌酉六害, 用神互補 conflict |
| 王菲 + 謝霆鋒 | Separated | 卯戌六合 (positive), but other conflicts |
| 黃曉明 + Angelababy | Divorced | 甲己合(中正之合) but 用神 severely conflicting, 天克地冲 in Huang's chart |

Score expectation: Happy couple > all divorced couples.

---

## 6. Year Boundary Test Cases

| Date | Expected Year | Rationale |
|------|--------------|-----------|
| 1990-01-15 | **己巳** | Before 立春 (Feb 4), use previous year |
| 2026-02-03 | **乙巳** | Before 立春 2026 |
| 2026-02-05 | **丙午** | After 立春 2026 |

---

## 7. Accuracy Caveats

1. **Pillar calculation**: Should match 100% across all sources for dates after 1900. For dates before 1900, solar term boundary calculations may differ between astronomical and traditional (萬年曆) methods.

2. **格局/用神**: Professional practitioners disagree significantly. Online calculators claim ~55% error rate on 用神 determination. Match 2 of 3 sources = acceptable.

3. **True Solar Time**: Our engine has TST **DISABLED** (wall clock time used). Sites like Fatew.com and 神巴巴 use TST by default, which can shift the hour pillar for births near hour boundaries.

4. **School differences**:
   - **格局派** (Pattern school) vs **旺衰派** (Strength school) may assign different patterns
   - **子平法** vs **盲派** have different hidden stem conventions for some branches
   - BaZi-Calculator.com supports 3 HHS methods: Traditional (Zi Ping), Modern, and Ken Lai

5. **Historical figure birth times**: Subject to scholarly dispute. We use the most commonly cited versions. Some dates (e.g., Deng Xiaoping's birth month) have multiple versions in circulation.

---

## 8. How to Add New Reference Charts

1. Calculate the chart using our engine
2. Cross-validate pillars against at least 2 online calculators (manual check)
3. If possible, verify analytical outputs (格局, 用神) against a published analysis or Joey Yap
4. Add to `gold_standard_charts.json` following the existing schema
5. Add corresponding test cases in `test_gold_standard_validation.py`
6. Run `pytest tests/test_gold_standard_validation.py -v` to verify

---

## 9. File Locations

| File | Purpose |
|------|---------|
| `packages/bazi-engine/tests/fixtures/gold_standard_charts.json` | Structured reference data (machine-readable) |
| `packages/bazi-engine/tests/test_gold_standard_validation.py` | Automated validation tests (36 tests) |
| `packages/bazi-engine/tests/test_real_world_validation.py` | Historical figure analysis tests |
| `packages/bazi-engine/tests/test_compatibility_gold_standard.py` | Celebrity couple compatibility tests |
| `docs/rival-comparison-research.md` | 10-area comparison vs rival seer |
| `docs/rival-comparison-handoff.md` | Research items + implementation handoff |
| `docs/bazi-reference-data.md` | This document |
