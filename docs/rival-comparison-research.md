# Rival vs Our System: Methodology Research Report

## Test Subject
- **Name**: Laopo9
- **Birth**: 1987-01-25 16:44 female
- **Pillars**: 丙寅/辛丑/甲戌/壬申
- **DM**: 甲木 (very_weak, score 26.3)
- **格局**: 正官格
- **用神=木, 喜神=水, 忌神=金, 仇神=土**
- **空亡**: 申, 酉
- **Rival source**: 八字終身運.txt (professional seer app)

## Date: 2026-02-24

---

## 1. 正緣桃花年 (Romance/Marriage Years)

### Comparison
| | Years |
|---|---|
| **Rival** | 2030, 2031, 2033 |
| **Ours** | 2020, 2023, 2030, 2031, 2035 |
| **Overlap** | 2030, 2031 |

### Our Method (compute_romance_years in lifetime_enhanced.py)
- **Primary**: 六合日支 (annual branch 六合 with day branch 戌→卯)
- **Secondary A**: 流年天干帶配偶星 (annual stem = spouse star element)
- **Secondary B**: 三合日支 (annual branch in 三合 group with day branch)
- **Supplementary**: 桃花/紅鸞/天喜 (lowest priority tier)
- Filters: 空亡 excluded, 三刑日支 excluded
- Cap: max 5 years

### Rival's Likely Method
- **紅鸞天喜** as primary (2033 = 紅鸞 year)
- **配偶星天干** (2030 庚=金=配偶星, 2031 辛=金=配偶星)
- Possibly **大運配合** filtering (only shows years in favorable 大運)
- Likely future-years-only filter

### Mainstream Standard (Taiwan/China)
Professional 命理師 use 6 methods combined:

| Method | Priority | Description | Our System |
|--------|----------|-------------|------------|
| A. 咸池桃花 | Tier 1 | TAOHUA lookup from day branch → 桃花支 | ✅ Implemented (supplementary) |
| B. 紅鸞天喜 | **Tier 1** | From year branch. 紅鸞 is THE most cited marriage star in TW | ⚠️ Too low priority (supplementary) |
| C. 天干合日主 | Tier 2 | Annual stem 五合 with DM (甲合己) | ❌ NOT implemented |
| D. 六合日支 | Tier 2 | Annual branch 六合 with day branch | ✅ Implemented (primary) |
| E. 六沖日支 | Tier 2 | Annual branch 沖 day branch (opens spouse palace) | ❌ NOT implemented |
| F. 大運配合 | Tier 2 | LP context determines if romance can manifest | ❌ NOT incorporated |

### Analysis

**Our system is stronger in**: 六合日支 and 三合日支 detection — catches 2023 (卯) and 2035 (卯) which are objectively the **strongest** romance years (六合+桃花 double hit). The rival misses these entirely.

**Rival is stronger in**: 紅鸞 elevation — catches 2033 (丑=紅鸞). In mainstream TW practice, "紅鸞星動，婚姻將近" is the most commonly cited marriage timing indicator.

**Key gaps in our system**:
1. **紅鸞 should be elevated** from supplementary to at least secondary. It gets crowded out by the 5-year cap.
2. **天干合日主 missing** — For this chart, 甲合己, so 己 years (2029 己酉, 2039 己未) should be flagged. This is bread-and-butter for professional practitioners.
3. **六沖日支 missing** — 戌沖辰, so 辰 years (2024, 2036) could trigger spouse palace.
4. **No 大運 filtering** — A 桃花年 in a bad 大運 is meaningless. Professional practitioners never look at 流年 alone.
5. **2020 is past** — Should filter to future/near-future years only.

### Recommendation
- **Follow rival's approach?** Partially. Elevate 紅鸞 and add 天干合日主.
- **Keep our advantages**: 六合日支 as primary is correct and the rival is wrong to miss it.
- **Ideal output for this chart**: 2023, 2031, 2033, 2035 (+ 2029 if 空亡 isn't absolute filter)

---

## 2. 擇偶生肖 (Marriage Partner Zodiac)

### Comparison
| | Zodiacs |
|---|---|
| **Rival** | 馬, 狗 (年支三合 寅午戌) |
| **Ours** | 兔, 虎, 馬 (日支 六合+三合: 戌→卯兔, 寅午戌→虎馬) |

### Our Method (compute_partner_zodiacs in lifetime_enhanced.py)
- Uses **日支** (day branch 戌) as anchor
- 六合: 戌→卯(兔)
- 三合: 寅午戌 → 虎, 馬 (excluding day branch 戌=狗 itself... wait, 戌 IS the day branch)

### Rival's Method
- Uses **年支** (year branch 寅) as anchor
- 三合: 寅午戌 → 馬, 狗 (excluding self 寅=虎)

### Mainstream Standard
**Two legitimate approaches exist**:

| Approach | Used By | Basis | For This Chart |
|----------|---------|-------|---------------|
| **年支三合+六合** | 99% of popular apps, zodiac columns | Social/outward identity | 馬, 狗, 豬(六合) |
| **日支三合+六合** | Serious Bazi practitioners | Spouse palace (配偶宮) theory | 兔(六合), 虎, 馬 |

**Popular approach (年支)**: Nearly all online Bazi apps and zodiac compatibility charts use year branch. This is what the general public expects to see. The rival follows this convention.

**Advanced approach (日支)**: More technically correct per Bazi theory because the day pillar represents the self and spouse palace. Our system uses this approach.

### Analysis
- **Our approach is more technically sophisticated** but creates user confusion when they compare with other apps.
- **Both approaches produce 馬** as overlapping recommendation.
- **Our system correctly uses 日支** for partner analysis (日支=配偶宮 is canonical Bazi).
- **Inconsistency issue**: Our system uses 日支 for partners but 用神五行 for career benefactors — this is methodologically inconsistent (see item 3 below).

### Recommendation
- **Option A (match rival)**: Switch to 年支 for mass market appeal.
- **Option B (differentiated)**: Keep 日支 for partner, but add 年支 results as secondary. Explain the difference in AI narration.
- **Leaning**: Option B — our approach is defensible and more advanced.

---

## 3. 事業貴人生肖 (Career Benefactor Zodiac)

### Comparison
| | Zodiacs |
|---|---|
| **Rival** | 馬, 狗 (年支三合 寅午戌) |
| **Ours** | 豬, 兔, 羊 (用神木 → 三合木局 亥卯未) |

### Our Method (compute_benefactors in lifetime_enhanced.py)
- Uses **用神五行** (用神=木) as anchor
- ELEMENT_SANHE_BRANCHES['木'] = ['亥', '卯', '未'] → 豬, 兔, 羊
- This maps an element to its corresponding 三合 group

### Rival's Method
- Uses **年支** (year branch 寅) as anchor
- 三合: 寅午戌 → 馬, 狗 (same as 擇偶生肖)

### Mainstream Standard
**The rival is correct. Our method is non-standard.**

Career benefactor zodiac in virtually ALL mainstream Taiwanese/Chinese apps uses **年支三合+六合**:
- Logic: People whose year branches form 三合 or 六合 with yours naturally have harmonious energy
- This is a **branch relationship** concept, not a **five-element** concept
- Year branch represents social/outward identity (生肖 is public-facing)

Our current approach conflates two different systems. `ELEMENT_SANHE_BRANCHES` maps an element to its 三合 group, but benefactor zodiac recommendations are about **interpersonal branch harmony**, not about what elements you need.

### Analysis
- **Our method (用神→三合) is wrong for this purpose.** No mainstream practitioner would recommend 豬/兔/羊 as career benefactors for a 寅年生人 based on 用神=木.
- **The correct answer**: 年支寅 → 三合 寅午戌 = 馬, 狗 + 六合 寅→亥 = 豬 → **馬, 狗, 豬**
- **Root cause**: The `compute_benefactors()` function uses `ELEMENT_SANHE_BRANCHES[useful_god]` instead of branch-level 三合 of year_branch.

### Recommendation
- **Must fix**: Change `compute_benefactors()` to use year branch's 三合 + 六合, not 用神 element mapping. This is the single most clear-cut "we are wrong" finding in this research.

---

## 4. 有利投資方向 (Favorable Investment Directions)

### Comparison
| | Investments |
|---|---|
| **Rival** | 地產, 股權, 銀行理財 (土/金 oriented — 財星/穩健) |
| **Ours** | 綠色基金, 環保, 農林 (木 oriented — 用神) |

### Our Method
- Uses **用神五行** (用神=木, 喜神=水) → wood/water industries
- ELEMENT_FAVORABLE_INVESTMENTS mapping in lifetime_enhanced.py

### Rival's Method
- Appears to recommend **財星五行** industries (土/金 = what DM overcomes/overcomes DM)
- Or simply giving generic conservative financial advice unrelated to Bazi

### Mainstream Standard
**Our method is correct. The rival's approach is problematic.**

Mainstream Bazi investment advice is based on 用神五行:
- The 用神 is the element that **helps and balances** the chart
- Industries of 用神 element = natural affinity and luck
- For weak 甲木 chart: 木-related (education, publishing, agriculture, forestry, environmental) and 水-related (trade, IT, consulting)

**The rival recommending 土/金 for a weak 甲木 is contradictory**:
- 土 = 仇神 (wood wastes energy overcoming earth)
- 金 = 忌神 (metal attacks wood)
- Pursuing 忌神/仇神 industries for a weak DM is counterproductive per standard theory

**Exception**: 格局派 might argue 財 industries work if chart has strong 食傷生財 flow. But this chart doesn't have that structure.

### Analysis
- **Our system is methodologically correct.**
- The rival may not be using Bazi at all for investment advice (just giving generic financial advice).
- No changes needed.

### Recommendation
- **Keep our approach.** Optionally add 喜神 industries as secondary recommendations (already partially done).

---

## 5. 父母健康注意年份 (Parent Health Concern Years)

### Comparison
| | Father | Mother |
|---|---|---|
| **Rival** | 2034, 2035 | 2027, 2030 |
| **Ours** | 2024, 2025, 2034, 2035 | 2028, 2029, 2038, 2039 |

### Element Chain for DM=甲木
- Father star element = 土 (木克土, 財星)
- Mother star element = 水 (水生木, 印星)
- Father threat = 木 (木克土, what overcomes father)
- Mother threat = 土 (土克水, what overcomes mother)

### Our Method (compute_parent_health_years in lifetime_enhanced.py)
- Scans **流年天干 only** (line 708: `stem_el = STEM_ELEMENT.get(star['stem'], '')`)
- Father: years with 木天干 (甲/乙) → 2024甲辰, 2025乙巳, 2034甲寅, 2035乙卯
- Mother: years with 土天干 (戊/己) → 2028戊申, 2029己酉, 2038戊午, 2039己未

### Rival's Method
- Appears to check **地支本氣** as well (not just 天干):
  - Father 2034 (甲寅, 甲=木天干) ✅ and 2035 (乙卯, 乙=木天干) ✅ — matches our 天干 approach
  - Mother 2027 (丁未): 天干丁=火 (not 土), but 地支未 has 本氣 己土 (土克水) — **地支 approach**
  - Mother 2030 (庚戌): 天干庚=金 (not 土), but 地支戌 has 本氣 戊土 (土克水) — **地支 approach**
- Seems to show fewer years (more selective), likely filtering to specific 大運 context

### Mainstream Standard
**Both approaches are partially correct. Best practice uses BOTH 天干 AND 地支.**

Classical principle: "天干主事" (stem governs the first half of the year), "地支主事" (branch governs the second half). Most serious practitioners check both.

**However**:
- Our system's 天干-only approach catches 2028/2029 which are arguably more direct threats than 2027/2030
- The rival catches 2027/2030 via 地支 but misses 2028/2029 via 天干, which is strange
- The most complete approach would flag all of: 2024, 2025, 2027, 2028, 2029, 2030, 2034, 2035

### Analysis
- **Our system is defensible but incomplete** — missing 地支本氣 threat detection
- **The rival is also incomplete** — missing the obvious 天干 years 2028/2029 for mother
- **Both systems should ideally check both 天干 and 地支**

### Recommendation
- **Enhance** `compute_parent_health_years()` to also check 地支本氣 element, not just 天干
- Consider prioritization: 天干 threats = direct/obvious, 地支 threats = indirect/latent
- Consider filtering to future years and limiting to 大運-relevant window

---

## 6. 健康弱點分析 (Health Weakness Analysis)

### Comparison
| | Approach | Result |
|---|---|---|
| **Rival** | 最弱元素 only | 木→肝膽 |
| **Ours** | 過旺 + 不足 | 土→脾胃(過旺), 水→腎(不足) |

### Mainstream Standard
**Our approach is more correct and comprehensive.**

Traditional Chinese medicine-Bazi health framework operates on 五行偏枯 (imbalance):

1. **過旺 (excess)** → organ hyperactivity (實症). E.g., 土過旺 = 脾胃問題
2. **不足 (deficiency)** → organ weakness (虛症). E.g., 水不足 = 腎虛
3. **克洩chain** → excess element overcomes another, creating secondary weakness

The rival's "weakest element only" approach is an oversimplification. It misses:
- Excess element's own organ problems
- The chain effect (e.g., 土過旺 → 土克水 → further weakens 腎)

### Analysis
- **Our system is methodologically superior.**
- The rival's approach is commonly seen in low-quality apps.
- No changes needed.

### Recommendation
- Keep our approach. Optionally add the "weakest element" as a tertiary note for completeness.

---

## 7. 流年主導十神 (Annual Dominant Ten God)

### Comparison
| | Method | Result for 2026 |
|---|---|---|
| **Rival** | 大運天干 (丁) | 傷官 |
| **Ours** | 流年天干 (丙) | 食神 |

### Mainstream Standard
**Our method is correct.**

The standard formula:
- **大運** = the stage (10-year background energy)
- **流年** = the actor (specific year's energy)
- When asked "this year's dominant ten god," the answer is the **流年天干's** ten god relative to DM

For this chart in 2026:
- 流年天干 丙 relative to 甲木 = 食神 ✅ (our answer)
- 大運天干 丁 relative to 甲木 = 傷官 (the 10-year theme, not the year's specific energy)

The rival's "傷官主運" describes the 大運 background, not the annual ten god. Both pieces of information are useful, but calling the year "傷官" is incorrect — it's a "食神年 within a 傷官大運."

### Analysis
- **Our system is correct.**
- The rival conflates 大運 theme with annual ten god.
- No changes needed.

### Recommendation
- Keep our approach. Consider adding the 大運 ten god as contextual information alongside the annual ten god.

---

## 8. 性格主導十神 (Personality Dominant Ten God)

### Comparison
| | Method | Result |
|---|---|---|
| **Rival** | 十神數量統計 (most frequent) | 偏財 (highest count) |
| **Ours** | 格局 (pattern from 月令) | 正官格 |

### Mainstream Standard
**Our method is more correct per classical Bazi.**

格局 (pattern) is determined by the 月令 (month branch) and its hidden stems' ten god. This is the structural theme of the chart — the most important factor per《子平真詮》(the most authoritative classical text).

十神數量 is a secondary/supplementary factor. Having many 偏財 adds characteristics but doesn't override the 格局.

For this chart:
- 正官格: personality anchored in responsibility, integrity, structure
- 偏財 count is high: adds sociability, generosity, risk-tolerance
- Correct interpretation: "正官格命主, with strong 偏財 coloring"

### Analysis
- **Our system is methodologically superior.**
- The rival uses a simpler heuristic that misses structural analysis.
- No changes needed to core method.

### Recommendation
- Keep 格局 as primary. Optionally add the most numerous ten god as a **secondary modifier** for richer personality analysis.

---

## 9. isShishanSuppressed (食傷受印星壓制)

### Comparison
| | Result |
|---|---|
| **Rival** | true (印星制食傷) |
| **Ours** | false |

### Our Method (build_children_insights in lifetime_enhanced.py, line 426-430)
```python
yin_element = ELEMENT_PRODUCED_BY[dm_element]  # 印 = 水
yin_weight = five_elements_balance.get(yin_element, 0)  # 水 = 17.5%
shishan_weight = five_elements_balance.get(shishan_element, 0)  # 火 = 17.5%
is_suppressed = yin_weight > 25 and yin_weight > shishan_weight * 1.5
# 17.5 > 25 = FALSE → is_suppressed = False
```

### The Chart's Actual Situation
- 壬水 (hour stem) = 偏印 for 甲木 DM
- 丙火 (year stem) = 食神 for 甲木 DM
- Classical pattern: **偏印奪食** (偏印 seals/steals from 食神) — this is a SPECIFIC and important classical negative pattern

Key details:
- 壬水 has root in 申 (hour branch hidden stem 壬水) — 印 has strength
- 丙火 has root in 寅 (year branch hidden stem 丙火) — 食神 also has strength
- 辛金 (month stem) and 庚 (申 hidden stem) produce 水 via 金生水 — strengthening 印
- BUT: 土 (財星) is present in 戌/丑 branches and can control 印 via 土克水 (財制印)

### Mainstream Analysis
**The rival's assessment of "印制食傷=true" is reasonable but not absolute.**

In classical Bazi, the 偏印奪食 pattern is evaluated qualitatively:
1. ✅ Is there a 偏印 present (not 正印)? Yes — 壬 = 偏印 for 甲
2. ✅ Is there a 食神 present? Yes — 丙 = 食神 for 甲
3. ✅ Does the 偏印 have root? Yes — 壬 has root in 申
4. ⚠️ Is there 財 to control 印 (財制印)? Yes — 土(戌/丑) can control 水, providing protection
5. Net: **偏印奪食 pattern EXISTS but is partially mitigated by 財制印**

### Our System's Problem
Our weight-based threshold (yin > 25% AND > shishan × 1.5) **completely misses the pattern** because:
- Both 水(17.5%) and 火(17.5%) are below 25%
- The threshold is designed for "dominant 印" scenarios
- But 偏印奪食 is a **qualitative pattern** (presence of 偏印 + 食神), not just a weight comparison
- A 偏印 with root that's positioned to 克 食神 is concerning even if the percentage isn't dominant

### Analysis
- **Our system's weight-only approach misses the classical 偏印奪食 pattern.**
- The rival correctly identifies the pattern but may overstate its severity (without noting 財制印 mitigation).
- **The correct answer is nuanced**: The pattern exists (true-ish) but is partially mitigated by 財星.

### Recommendation
- **Should fix**: Add a qualitative check for 偏印奪食 pattern (presence of 偏印 stem + 食神 stem) as a secondary detection method alongside the weight-based threshold.
- Logic: If chart has both 偏印 and 食神 stems, AND the 偏印 has root in branches, flag `isShishanSuppressed = true` (or add a separate `hasYinDuoShi` flag for the specific 偏印奪食 pattern).
- Consider adding mitigation detection: If 財星 is also present and strong, note "偏印奪食有財制印，影響減輕."

---

## Summary: Action Items by Priority

### 🔴 MUST FIX (rival is clearly correct)
| # | Issue | Current | Should Be | File |
|---|-------|---------|-----------|------|
| 3 | 事業貴人生肖 | 用神五行→三合 | **年支三合+六合** | lifetime_enhanced.py:528 `compute_benefactors()` |

### 🟡 SHOULD IMPROVE (our approach is incomplete)
| # | Issue | Enhancement | File |
|---|-------|-------------|------|
| 1a | 桃花年: 紅鸞 priority too low | Elevate 紅鸞 from supplementary to secondary_a or higher | lifetime_enhanced.py:628 |
| 1b | 桃花年: 天干合日主 missing | Add Method C: annual stem 五合 DM | lifetime_enhanced.py:618-680 |
| 5 | 父母健康年: 地支 not checked | Add 地支本氣 element threat check | lifetime_enhanced.py:687-717 |
| 9 | isShishanSuppressed: misses 偏印奪食 | Add qualitative pattern detection | lifetime_enhanced.py:426-430 |

### 🟢 KEEP AS-IS (our approach is superior)
| # | Issue | Why |
|---|-------|-----|
| 4 | 有利投資 (用神 approach) | 用神五行 is the correct methodology; rival recommends 忌神/仇神 industries |
| 6 | 健康弱點 (過旺+不足) | More comprehensive than rival's "weakest only" |
| 7 | 流年十神 (流年天干) | Correct per classical formula; rival conflates 大運 with 流年 |
| 8 | 性格十神 (格局-based) | More authoritative per《子平真詮》; rival uses simplistic counting |

### ⚪ OPTIONAL ENHANCEMENTS
| # | Enhancement | Value |
|---|-------------|-------|
| 2 | 擇偶生肖: add 年支 results as secondary | Mass market user expectation |
| 1c | 桃花年: add 六沖日支 as supplementary | Professional completeness |
| 1d | 桃花年: incorporate 大運 filtering | Professional-level accuracy |
| 1e | 桃花年: filter to future years only | Practical user value |
| 8+ | 性格十神: add most-frequent as secondary | Richer personality profile |
| 10 | 空亡 vs key stars: flag when 紅鸞/天乙貴人/桃花 land in 空亡 | Accuracy + professional depth |

---

## 10. Key Stars Landing in 空亡 (New Finding from Joey Yap Cross-Validation)

### Problem
Our system calculates 空亡 and uses it to filter 桃花年, but does NOT flag when important natal stars (紅鸞, 天乙貴人, 桃花, 驛馬, etc.) themselves fall in 空亡 branches. This is a meaningful analytical insight that professional practitioners note.

### Evidence from Cross-Validation

**Roger (丁卯/戊申/戊午/庚申, DM=戊土)**:
- 空亡 = ['子', '丑']
- 紅鸞 = **子** → ⚠️ **落入空亡!** (Red Phoenix star is voided — marriage timing weakened)
- 天乙貴人 = **丑**, 未 → ⚠️ **丑 落入空亡!** (one of two nobility stars voided — noble person help reduced)

**Laopo9 (丙寅/辛丑/甲戌/壬申, DM=甲木)**:
- 空亡 = ['申', '酉']
- 驛馬 = 申 → ⚠️ **落入空亡!** (Sky Horse voided — travel/relocation energy weakened)
- Note: Laopo9's hour branch 申 is also in 空亡, which affects the hour pillar's effectiveness

### Why This Matters
In classical Bazi, a star landing in 空亡 means its energy is "empty" or "unrealized":
- **紅鸞 in 空亡**: Marriage timing from 紅鸞 years is weakened; the native may experience "almost" relationships that don't materialize
- **天乙貴人 in 空亡**: Noble person assistance is reduced; the native must rely more on self-effort
- **驛馬 in 空亡**: Travel/career mobility energy is weakened; relocation plans may stall
- **桃花 in 空亡**: Romance opportunities feel fleeting or superficial

### Recommendation
- **Should implement**: Add a `starsInKongWang` field to the pre-analysis or lifetime enhanced output
- Logic: Check if branches for 紅鸞, 天喜, 天乙貴人, 桃花, 驛馬, 文昌 fall within the chart's 空亡 set
- Output: List of affected stars with significance notes
- AI narration can then mention: "紅鸞落入空亡，婚緣需更主動爭取" etc.
- File: `lifetime_enhanced.py` — add check after computing shen sha stars

### Priority
🟡 SHOULD IMPROVE — This is a professional-level insight that differentiates from basic apps. Both Laopo9 and Roger have key stars in 空亡, so it's a common scenario worth handling.

---

## Joey Yap Cross-Validation Results

### Test Subject 1: Laopo9 / Evon Tan (1987-01-25 04:38PM Female)
- **Source**: Joey Yap BaZi Profiling System (PDF)
- **Birth time difference**: 04:38 (JY) vs 04:44 (ours) — same 申時, same pillars

| Item | Joey Yap | Our System | Match? |
|------|---------|------------|--------|
| 四柱 | 丙寅/辛丑/甲戌/壬申 | 丙寅/辛丑/甲戌/壬申 | ✅ |
| 日主 | 甲 Yang Wood | 甲木 | ✅ |
| **格局** | **正官格 (95%)** | **正官格** | ✅ |
| 桃花 | 卯 | 卯 | ✅ |
| 驛馬 | 申 | 申 | ✅ |
| 天乙貴人 | 未, 丑 | (standard for 甲DM) | ✅ |
| 藏干 (all 4) | 全部一致 | 全部一致 | ✅ |
| 5 Structures | Supporters 忠誠型 | — | Data point |

### Test Subject 2: Roger Lim (1987-09-06 04:11PM Male)
- **Source**: Joey Yap BaZi Profiling System (PDF)
- **Birth time**: 04:11PM — matches our 16:11

| Item | Joey Yap | Our System | Match? |
|------|---------|------------|--------|
| 四柱 | 丁卯/戊申/戊午/庚申 | 丁卯/戊申/戊午/庚申 | ✅ |
| 日主 | 戊 Yang Earth | 戊土 | ✅ |
| **格局** | **食神格 (100%)** | **食神格** | ✅ |
| 桃花 | 卯 | 卯 | ✅ |
| 驛馬 | 申 | 申 | ✅ |
| 天乙貴人 | 未, 丑 | (standard for 戊DM) | ✅ |
| 藏干 (all 4) | 全部一致 | 全部一致 | ✅ |
| 大運 (8 LPs) | 丁未→庚子 | 丁未→庚子 | ✅ |
| 5 Structures | Creators 創作型 | — | Data point |

### Cross-Validation Conclusions
1. **格局 confirmed × 2**: Joey Yap agrees with our system on BOTH charts (正官格 + 食神格), contradicting the rival seer's 十神-counting approach
2. **Core engine verified**: 四柱, 藏干, 大運, 神煞 all match a major commercial Bazi system
3. **事業貴人 bug confirmed × 2**: Roger's system gives 猴/鼠/龍 (用神水→三合水局) but should give 豬/羊/狗 (年支卯→三合+六合). Same class of error as Laopo9.
4. **空亡 vs key stars**: New finding — both charts have important stars in 空亡 (Roger: 紅鸞+天乙貴人; Laopo9: 驛馬). Should be flagged in output.

---

## References
- 《子平真詮》 — 格局 methodology, 印制食傷 theory
- 《滴天髓》 — 五行偏枯 health analysis
- 《三命通會》 — 桃花 derivation, 偏印奪食 pattern
- 《淵海子平》 — 天干五合 romance timing
- Mainstream TW sites: 易安居, 水墨先生, 神巴巴 — year-branch-based 三合貴人
- Joey Yap BaZi Profiling System — commercial cross-validation source
