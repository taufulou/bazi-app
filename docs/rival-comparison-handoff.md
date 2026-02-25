# Rival Seer Comparison — Research & Implementation Handoff

## Origin & Context

We compared **Laopo10's 八字命盤** (born 1987-01-25 16:00, female, 丙寅/辛丑/甲戌/壬申, DM=甲木) from our Bazi engine output against a **rival seer app's** (八字終身運) results. Screenshots of the rival seer's app and the text file of their full reading are attached for reference.

**The comparison revealed that our core Bazi calculation is accurate** — four pillars, 藏干, ten gods, 格局 (正官格), 大運 sequence, and 喜用神 all match perfectly. However, we identified several discrepancies and missing features worth investigating and potentially implementing.

---

## Research Items

### R1: 五行旺衰 — 旺相休囚死 Seasonal State Labels

**What**: The rival seer displays `土旺 / 金相 / 火休 / 木囚 / 水死` — these are the **Five Phases seasonal state labels** based on the birth season (月令). Our engine does NOT compute or display these.

**Why this matters**: This is a **standard Bazi concept** shown in virtually every professional Bazi app. It tells users which elements are prosperous, declining, or dead in the birth season. It's simple to compute and adds professional credibility.

**Theory**:
- Each season empowers one element and weakens others in a fixed cycle:
  - 旺 (Prosperous) — the element ruling the season
  - 相 (Strong) — the element produced by the prosperous element
  - 休 (Resting) — the element that produces the prosperous element
  - 囚 (Imprisoned) — the element that controls the prosperous element
  - 死 (Dead) — the element controlled by the prosperous element
- For Laopo10 (born 丑月 = winter/late winter, 土月 or 水旺 depending on school):
  - Rival shows: 土旺 金相 火休 木囚 水死
  - This follows the interpretation that 丑月 = 土旺 (earth month), which is one valid school of thought

**Action**: Research the exact mapping for all 12 monthly branches (including 四季月 辰戌丑未), implement as a lookup table, and expose in API output.

---

### R2: 桃花年 Discrepancy

**What we output**: 2023, 2026, 2030, 2031, 2034
**What rival shows**: 2030, 2031, 2033

**Overlap**: 2030 and 2031 match ✅

**Discrepancies**:
| Year | Our Engine | Rival | Notes |
|------|-----------|-------|-------|
| 2023 | ✅ (六合日支, primary) | ❌ | We detected 卯 六合 戌(日支). Rival may not include this |
| 2026 | ✅ (三合日支, secondary_b) | ❌ | We detected 午 as part of 寅午戌 三合. Rival may not use 三合 |
| 2030 | ✅ (配偶星天干, secondary_a) | ✅ | Both agree — 庚 year, 庚=偏官 for 甲木女命 |
| 2031 | ✅ (配偶星天干, secondary_a) | ✅ | Both agree — 辛 year, 辛=正官 for 甲木女命 |
| 2033 | ❌ | ✅ | Rival has this but we don't. 2033=癸丑, need to check what triggers it |
| 2034 | ✅ (三合日支, secondary_b) | ❌ | We detected 寅 as part of 寅午戌 三合 |

**Research needed**:
1. Why does the rival show 2033 (癸丑) as a romance year? What trigger logic could produce this?
   - 丑 is 日支戌's 六合 partner? No, 丑午 is not a 六合.
   - 丑 contains hidden stem 辛 (正官)? Maybe the rival checks hidden stems of annual branch
2. Should we filter out 三合 triggers (2026, 2034) from the romance year list? They are weaker signals
3. Does the rival use a completely different romance year methodology (e.g., only checking 天干 spouse star + 紅鸞/天喜 stars)?
4. Check if the #1e time-window filter we just implemented might affect which years show up

**Action**: Research the rival's likely methodology, compare with our `_compute_romance_candidates()` logic in `lifetime_enhanced.py`, and decide if adjustments are needed.

---

### R3: 父母健康危險年 Discrepancy

**What we output**:
- Father: 2022, 2024, 2025, 2034, 2035
- Mother: 2018, 2019, 2021, 2028, 2029

**What rival shows**:
- Father (土): 2034, 2035 (木主導流年，木克土)
- Mother (水): 2027, 2030 (土主導流年，土克水)

**Partial overlap**:
- Father 2034, 2035 match ✅
- Mother years completely different ❌

**Analysis**:
- The rival's logic is straightforward: **identify the parent's element, then find future years where the controlling element dominates**
  - Father = 財星 = 土 → 木克土 → wood-dominant years (2034甲寅, 2035乙卯) ✅
  - Mother = 印星 = 水 → 土克水 → earth-dominant years (2027丁未, 2030庚戌)
- Our engine uses a more complex approach checking **both 天干 AND 地支本氣** (implemented in item #5 of rival-comparison-research.md)
- The discrepancy likely comes from:
  1. We include MORE years (casting a wider net by checking both stem and branch)
  2. We include PAST years (2018, 2019, 2021, 2022) while rival only shows future years
  3. Our filtering criteria may differ for what counts as a "dominant" controlling element year

**Research needed**:
1. Verify our `compute_parent_health_years()` logic — is it too aggressive in flagging years?
2. Should we add a time-window filter (similar to #1e romance years) to only show relevant future years?
3. Why do our mother years (2028, 2029) differ from rival's (2027, 2030)? Check the element mapping for each year:
   - 2027 = 丁未 (火天干, 土地支) — rival considers this earth-dominant
   - 2028 = 戊申 (土天干, 金地支) — we consider this earth-dominant (土克水)
   - 2029 = 己酉 (土天干, 金地支) — we consider this earth-dominant
   - 2030 = 庚戌 (金天干, 土地支) — rival considers this earth-dominant
4. The difference may be: rival focuses on **地支本氣** while we focus on **天干** (or vice versa)

**Action**: Research and potentially adjust our parent health year detection logic.

---

### R4: 忌神/仇神 Mapping Swap

**What we output**: 喜神=水, 用神=木, 閒神=火, **忌神=金, 仇神=土**
**What rival shows**: 喜神=水, 用神=木, 閒神=火, **忌神=土, 仇神=金**

**The unfavorable elements are the same (金 and 土)** — they're just labeled in reverse order.

**Background**:
- 忌神 (Taboo God) = the element most harmful to the day master
- 仇神 (Enemy God) = the element that supports/produces the taboo god
- For 甲木 身弱:
  - **School A** (our engine): 金 directly controls 木 → 金=忌神; 土生金 → 土=仇神
  - **School B** (rival): 土 drains 木's resource (水) and is the strongest unfavorable element in the chart → 土=忌神; 金 assists the draining → 金=仇神

**Research needed**:
1. Which school is more mainstream in Taiwan/HK Bazi practice?
2. Is the rival's logic based on "strongest unfavorable element = 忌神" (quantitative) vs our "direct controller = 忌神" (theoretical)?
3. Should we make this configurable or switch to match the more common convention?
4. Check our `favorable_gods` calculation in `five_elements.py` — what's the exact logic?

**Action**: Research the convention debate, check if our logic should be adjusted.

---

### R5: 空亡 (Kong Wang) — Two Pairs vs One

**What we output**: `kongWang: ['申', '酉']` (day pillar only in main field)
**What rival shows**: `空亡：戊亥 申酉` (appears to show TWO pairs)

**Investigation findings**:

Our engine actually DOES compute kong wang per pillar in `kongWangPerPillar`:

| Pillar | Stem+Branch | Kong Wang |
|--------|-------------|-----------|
| Year (年柱) | 丙寅 | **戌亥** |
| Month (月柱) | 辛丑 | 辰巳 |
| Day (日柱) | 甲戌 | **申酉** |
| Hour (時柱) | 壬申 | 戌亥 |

**Correction from previous session**: I previously said the rival showed "年柱空亡=戊亥" — this was WRONG. Looking at the rival screenshot again:
- The rival displays `空亡：戊亥 申酉`
- `戊亥` = branches 戌+亥 (likely displayed in a stem-like format, but these ARE the year pillar's kong wang: 丙寅→戌亥)
- `申酉` = the day pillar's kong wang: 甲戌→申酉

**So the rival shows YEAR pillar kong wang + DAY pillar kong wang** (the two most commonly used in Bazi practice).

**Our engine situation**:
- `kongWang` (main field): Only shows day pillar → `['申', '酉']`
- `kongWangPerPillar`: Has all 4 pillars computed ✅
- BUT the main display/AI prompt only uses the day pillar kong wang

**Action**: Consider exposing year pillar kong wang alongside day pillar kong wang in the main output and AI prompts.

---

### R6: 納音 (NaYin) Usage in Readings

**What we have**: Our engine computes 納音 for each pillar:
- 丙寅 = 爐中火, 辛丑 = 壁上土, 甲戌 = 山頭火, 壬申 = 劍鋒金

**What rival shows**: Same values (confirmed match)

**Current status**: We compute 納音 but do NOT use it in lifetime readings or AI prompts.

**Research needed**:
1. Is 納音 widely used in modern Bazi interpretation? Or is it considered supplementary/old-school?
2. What interpretive value does it add? (e.g., 日柱納音=山頭火 for 甲戌 — does this affect personality/fortune readings?)
3. Some Bazi masters use 納音五行 for compatibility analysis — should we incorporate this?
4. Rival seer's text file mentions 胎元壬辰(長流水), 命宮丙申(山下火), 胎息己卯(城墻土) — these use 納音

**Recommendation**: Low priority unless we implement 胎元/命宮 (which traditionally display 納音).

---

## New Features to Implement

### F1: 胎元 (Tai Yuan) & 命宮 (Ming Gong)

**What**: Supplementary pillars commonly shown in Bazi apps.
- **胎元** (Conception Pillar): Derived from month pillar — represents prenatal influences
  - Formula: Month stem + 1, Month branch + 3
  - For Laopo10: 辛丑 → 壬辰 (rival confirms: 壬辰 長流水)
- **命宮** (Life Palace): Derived from birth month and hour
  - Formula varies by school, but commonly: count from birth month branch to birth hour branch
  - For Laopo10: Rival shows 丙申 (山下火)
- **胎息** (Tai Xi / Fetal Breath): Another supplementary pillar
  - For Laopo10: Rival shows 己卯 (城牆土)

**Why**: These are standard displays in professional Bazi apps and add perceived depth. They're purely computational (deterministic formulas).

**Action**: Research the exact formulas for all three, implement, and expose in API output.

---

### F2: 起運精確日期 (Precise Luck Period Start Date)

**What**: The rival shows `交運：1993年8月4日` and `出生後6年5月起大運`. Our engine only shows `startAge: 6, startYear: 1993`.

**Why**: More professional appearance. Users and Bazi masters expect to see the exact date when luck periods change, not just the year.

**How it works**:
1. Calculate the distance (in days) from birth date to the next/previous seasonal node (節氣)
2. Convert: 3 days of real time = 1 year of luck period
3. Apply to birth date to get exact 交運 date

**Current state**: Our engine already calculates seasonal nodes for month pillar determination. The additional computation to derive the exact 交運 date should be feasible.

**Action**: Implement precise 起運 date calculation, expose `luckPeriodStartDate` in API output.

---

## Technical Background: V1 vs V2 Strength Scoring

### V1 (Legacy, kept for backward compatibility)

**Location**: `app/five_elements.py` → `analyze_day_master_strength()`

**Formula**: `score = (season_normalized × 0.4 + support_ratio × 0.6) × 100`
- Season factor: 40% weight, normalized from `SEASON_STRENGTH` (0-5 scale)
- Support ratio: 60% weight, counts supporting vs draining stems/branches

**Output fields in API**: `dayMaster.strength`, `dayMaster.strengthScore`, `dayMaster.sameParty`, `dayMaster.oppositeParty`

**Classification thresholds**: very_strong ≥70, strong ≥55, neutral ≥45, weak ≥30, very_weak <30

### V2 (Current Standard — THIS IS WHAT WE USE)

**Location**: `app/interpretation_rules.py` → `calculate_strength_score_v2()`

**Formula**: 3-factor model
- **得令 (50%)**: Seasonal element strength, mapped via `SEASON_DELING_SCORE`
- **得地 (30%)**: Root depth in branch hidden stems, weighted by pillar importance (月35%/日30%/時20%/年15%)
- **得勢 (20%)**: Supporting elements count from manifest stems + branch 本氣

**Output fields in API**: `dayMaster.strengthScoreV2.score`, `.classification`, `.factors`

**Classification thresholds**: very_strong ≥70, strong ≥55, neutral ≥40, weak ≥25, very_weak <25

### Which Is Used Where?

| Context | V1 | V2 |
|---------|----|----|
| API output `dayMaster` | ✅ Exposed (legacy) | ✅ Exposed (primary) |
| AI prompts (`prompts.ts`) | ⚠️ "舊版旺衰，僅供參考" | ✅ Primary with ⚠️ warning |
| `lifetime_enhanced.py` narrative anchors | ❌ Not used | ✅ Exclusively used |
| `_build_personality_anchors()` | ❌ | ✅ V2 classification drives Layer 4 |
| Pre-analysis patterns | ❌ | ✅ V2 determines 從格 etc. |

**Bottom line**: V2 is the standard. V1 is kept only for backward compatibility in the API. All new features and AI interpretation use V2 exclusively.

### Comparison for Laopo10:
- **V1**: weak (38% 同黨 / 62% 異黨), strengthScore=38
- **V2**: very_weak (score=20.6), factors: 得令=12, 得地=2.7, 得勢=5.9
- **Rival**: 身弱 (25% 同黨 / 75% 異黨)
- V2 score (20.6) is closer to rival's 25% than V1's 38%

---

## Summary Checklist

| # | Item | Type | Priority | Complexity |
|---|------|------|----------|------------|
| R1 | 五行旺相休囚死 seasonal labels | Research + Implement | High | Low (lookup table) |
| R2 | 桃花年 discrepancy analysis | Research | Medium | Medium |
| R3 | 父母健康年 discrepancy analysis | Research | Medium | Medium |
| R4 | 忌神/仇神 mapping convention | Research | Medium | Low |
| R5 | 空亡 display (year+day pillar) | Research + Implement | Low | Low |
| R6 | 納音 usage in readings | Research | Low | N/A |
| F1 | 胎元/命宮/胎息 computation | Implement | Medium | Medium |
| F2 | 起運精確日期 | Implement | Medium | Medium |

---

## Files & References

- **Our engine output**: Query `POST /calculate` with `{"birth_date":"1987-01-25","birth_time":"16:00","birth_city":"吉隆坡","birth_timezone":"Asia/Kuala_Lumpur","gender":"female","reading_type":"lifetime"}`
- **Rival seer screenshots**: Attached (5 images showing 八字排盤, 五行能量/個數/含藏干數, 大運/流年/流月)
- **Rival seer text file**: `/Users/roger/Documents/Bazi APP/八字終身運.txt` (full lifetime reading text)
- **Previous research file**: `docs/rival-comparison-research.md` (all items ✅ implemented)
- **Bazi engine**: `packages/bazi-engine/app/lifetime_enhanced.py` (main enhanced logic)
- **Strength V1**: `packages/bazi-engine/app/five_elements.py`
- **Strength V2**: `packages/bazi-engine/app/interpretation_rules.py`
- **Kong wang**: `packages/bazi-engine/app/shen_sha.py`
- **Tests**: `packages/bazi-engine/tests/test_lifetime_enhanced.py` (946 pass, 1 skip)
