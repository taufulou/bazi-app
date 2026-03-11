# 事業詳批 (Career Detailed Reading) — Research, Strategy & Decisions

This document captures all research findings, architectural decisions, and calculation methodology for the 事業詳批 feature. Created during the planning phase through 3 rounds of bazi master review and comprehensive online research.

**Implementation plan:** `.claude/plans/radiant-petting-frost.md`

---

## Feature Overview

**What:** Replace the existing 4-section, 2-credit 事業財運 with a comprehensive 16+ section 事業詳批 matching rival app Seer's feature depth.

**Workflow:** Chart-first, pay-later (Phase 1: free chart → Phase 2: 3 credits for AI report)

**Architecture:** Same three-layer pattern as 八字終身運 (Python Engine → Pre-Analysis Anchoring → AI Narration with SSE streaming)

---

## Research Methodology

- Rival analysis: Seer's 八字事業詳批 (265 lines, 16 sections) via screenshots + text file
- 3 rounds of bazi master engineer review (15 → 7 → 6 issues, final APPROVED)
- Deep online research on career-specific Bazi calculations across Taiwan, HK, Malaysia sources
- Classical text validation: 《子平真詮》, 《三命通會》, 《滴天髓》, 《淵海子平》, 《窮通寶鑑》

---

## Key Calculation Decisions

### 1. Five Element Weight System (五行比重) → System A "Equal Base"

**Decision:** Use engine's existing `_accumulate_raw_element_scores()` (stems=1.0, branches=1.0 distributed via hidden stems) + seasonal multiplier.

**5 systems researched:**

| System | 天干 | 地支 | Stem:Branch | Used By |
|--------|------|------|-------------|---------|
| **A: Equal 100** ✅ | 100 | 100 (split) | 1:1 total | Most commercial sites (易安居, 水墨先生, 神巴巴) |
| B: 40/100 | 40 | 100 | 1:2.5 | 新派命理 (李涵辰) |
| C: 360° / 周天 | 36° | 30° | 1.2:1 | Some quantitative practitioners |
| D: 36/100 | 36 | 100 | 1:2.78 | 算準網 |
| E: Pillar Position | ~35% | ~65% | 1:1.86 | Force distribution theorists |

**Classical consensus:** All schools agree 地支 is inherently stronger than 天干. System A handles this via fragmentation — a branch's 100 points split across 1-3 hidden stems, so a single manifest stem (100 pts, one element) is actually more concentrated than a branch's main qi (60 pts).

**Rationale:** System A is most common commercially, consistent with our engine's internal calculations (`determine_favorable_gods()`, `check_cong_ge()`, `calculate_strength_score_v2()`), and users comparing our results to reference sites will see consistent numbers.

### 2. 旺相休囚死 Multiplier → Engine's 3.6:1 Calibrated Ratio

**Decision:** Use `SEASON_MULTIPLIER` (旺=1.8, 相=1.4, 休=1.0, 囚=0.7, 死=0.5)

**Classical alternative:** 100/80/60/40/20 (ratio=5:1). Engine's 3.6:1 is more moderate, calibrated against 易安居, 水墨先生, 神巴巴 reference sites. The 5:1 ratio causes extreme results where one element dominates.

### 3. Hidden Stem Proportions → Engine's 60:20:20

**Decision:** Use existing `HIDDEN_STEM_WEIGHTS` (0.6/0.2/0.2 for triple branches, 0.7/0.3 for double)

**Classical standard:** 《三命通會》uses 60:30:10. Our engine uses 60:20:20. Both are commercially accepted. No change needed for consistency.

### 4. Reputation Score (名聲地位) → 格局-Conditional Composite

**Decision:** 0-100 composite mapped from classical qualitative tiers (上上格/上格/中格/下格)

**Classical basis:** 《子平真詮》格局高低 — assessment based on 有情 (harmony) + 有力 (strength). Real masters don't use numerical scores; we quantify for UX.

**Sub-scores:**
- 格局清純度 (30%): 《子平真詮》清濁 framework — 5 purity conditions, 6-8 turbidity penalties, 正官格 9 taboos
- 官星力量 (25%): Presence, root, seasonal strength, position bonus, 官印相生 chain
- 用神力量 (20%): Presence, root depth, seasonal strength, stem exposure
- 印星輔助 (15%): Presence, DM support chain, 官印相生
- 刑沖扣分 (10%): From `analyze_branch_relationships()`

**從格 conditional:** Different weight distributions per pattern type (e.g., 從官格 boosts 官星力量 to 35%).

### 5. Wealth Score (財富格局) → 5-Factor Progressive System

**Decision:** 0-100 composite + 4-tier classification (小富/中富/大富/巨富)

**Classical basis:** Professional masters' 5-factor assessment: 喜忌 → 實虛 → 位置 → 旺衰 → 庫生

**Sub-scores:**
- 財星喜忌 (25%): Is wealth element 用神/忌神/閒神? + position bonus
- 財星實虛 (20%): Present? Rooted (實) or rootless (虛)?
- 食傷生財 (20%): Output generating wealth chain intact?
- 財庫 (15%): Classical 逢沖開庫 vs 逢沖破庫 decision tree (depends on 身強弱 + 財為喜忌)
- 大運配合 (20%): Current/next 大運 supports wealth?

### 6. 大運+流年 Combined Auspiciousness → 4-Level Matrix

**Decision:** Qualitative 4-level matrix, not numerical weighting

**Classical basis:** "流年為君，大運為臣，命局為民" (《三命通會》)

| Combined | Result |
|----------|--------|
| 大運吉 + 流年吉 | 大吉 |
| 大運吉 + 流年凶 | 吉中有凶 |
| 大運凶 + 流年吉 | 凶中有吉 (temporary improvement only) |
| 大運凶 + 流年凶 | 大凶 |

**Contested area:** No academic consensus on 大運 vs 流年 weighting (ranges from "大運 is 10x" to "roughly equal"). The 4-level matrix avoids the ratio debate while respecting the classical hierarchy.

**Practical consensus:** 大運 favorable is prerequisite; 流年 favorable within unfavorable 大運 = fleeting benefit only.

### 7. 空亡 Interpretation → Nuanced, Not Binary

**Decision:** Context-dependent analysis (not simply "career blocked")

**Key principle:** 用神逢空=凶, 忌神逢空=吉
- If 官星 (career star) encounters 空亡 → career stagnation
- If 忌神 sits in 空亡 → beneficial (harmful element neutralized)
- 填實 (filling the void): When 流年 branch matches void branch, activates dormant stars

### 8. 驛馬 Interpretation → Direction-Aware

**Decision:** Favorable vs unfavorable based on 喜忌
- 驛馬 branch = 喜用 → voluntary positive change (promotion/relocation/international)
- 驛馬 branch = 忌神 → involuntary unwanted change (forced transfer)

### 9. Monthly Forecast → Subordinate to Annual

**Decision:** Monthly luck is subordinate to yearly luck per classical principle

**Classical basis:** "流月包含于流年之中，斷流月一定要以流年為本"

| Combined | Result |
|----------|--------|
| 流月吉 + 流年吉 | 大吉 (best month) |
| 流月吉 + 流年凶 | 曇花一現 (fleeting good) |
| 流月凶 + 流年吉 | 凶中有吉 (manageable) |
| 流月凶 + 流年凶 | 凶上加凶 (worst month) |

### 10. Career Position Archetypes → 格局 + 透干 Based

**Decision:** Three-tier approach (not just 月支本氣)
1. Primary: 格局 ten god → position archetype
2. Secondary: 透干 (which ten gods appear as manifest stems)
3. Tertiary: 月支本氣 + combination enhancements

Position archetypes validated against classical sources (《淵海子平》, 《三命通會》, 蘇民峰, Nova Masters).

### 11. Entrepreneurship Assessment → Research-Confirmed Indicators

**Primary entrepreneurship stars:** 七殺, 偏財, 傷官, 劫財
**Key combinations:** 偏財+七殺, 偏財+傷官, 傷官+七殺, 食神生偏財
**Prerequisite:** 身強 or legitimate 從格 (身弱 → not_recommended)
**Anti-indicators:** 正官/正印/正財 dominant

### 12. Career Timing Indicators → Specific Flags

Research-backed career-specific timing indicators for annual forecasts:
- 流年正官 as 喜用 → promotion/salary increase
- 流年正印 as 喜用 → 貴人 support, career stability
- 傷官見官 → "為禍百端" (most dangerous career indicator)
- 官殺混雜 → authority confusion, career instability
- 比劫奪財 → financial disputes, competitive losses
- 食神生財 → wealth through creativity
- 偏財 as 喜用 → entrepreneurial/windfall opportunity

### 13. Career Shensha → Expanded Beyond Basic

Career-relevant shensha from existing engine:
- 天乙貴人: Most important ("turns inauspiciousness to auspiciousness")
- 將星: Management/leadership ability
- 國印貴人: National authority
- 文昌: Academic/intellectual careers
- 華蓋: Artistic/creative careers
- 太極貴人: Intelligence, scholarly achievements
- 天德/月德: Workplace harmony

Career antagonist mapping (四惡星 as 忌神):
- 七殺 → aggressive authority 小人
- 偏印 → deceptive 小人
- 劫財 → wealth-stealing 小人
- 傷官 → verbal 小人

### 14. Ten God Percentages (十神比重) → Modern Commercial UX

**Decision:** Kept for Seer parity, honestly disclosed as non-classical

Traditional masters do NOT calculate ten god percentages — they assess qualitatively. The percentage display is a modern commercial UX feature (Seer, 科技紫微, etc.). The underlying categorical associations (ten god → capability) ARE classically grounded.

### 15. Suitable Positions (利於發揮能力的職位) → 格局 + 透干

Position archetypes by 格局 (classically validated):
- 正官格: 管理層、主管、行政、公務員、法律
- 七殺格: 軍警、外科醫師、工程、危機管理
- 正財格: 財務、會計、穩定企業、不動產
- 偏財格: 業務、投資、貿易、零售
- 食神格: 餐飲、藝術、教育、心理諮詢
- 傷官格: 律師、設計師、工程師、創新研發
- 正印格: 教育、研究、醫療、宗教、出版
- 偏印格: 技術研究、哲學、另類醫學、策略顧問
- 比肩格: 合夥事業、團隊運動、仲介
- 劫財格: 競爭性行業、業務、投機

### 16. Company Type Fit (穩定 vs 創新) → 正/偏 Dichotomy

Maps to classical 正/偏 ten god dichotomy:
- 正 stars (正官/正財/正印/食神/比肩) dominant → 穩定型
- 偏 stars (七殺/偏財/偏印/傷官/劫財) dominant → 創新型

---

## Engine Capabilities Already Implemented (Reuse)

| Capability | Engine Location | Status |
|-----------|-----------------|--------|
| 格局 (Pattern) | `get_prominent_ten_god()` + `PATTERN_TYPES` | ✅ 10 basic patterns |
| 從格 (Following Pattern) | `check_cong_ge()` in `interpretation_rules.py` | ✅ 4 subtypes |
| 大運 (Luck Periods) | `calculate_luck_periods()` in `luck_periods.py` | ✅ Full precision |
| 空亡 (Void) | `calculate_kong_wang()` in `shen_sha.py` | ✅ Per-pillar + display |
| 驛馬星 (Travel Star) | `YIMA` in `constants.py` | ✅ By year/day branch |
| 天乙貴人/文昌/天德/月德/將星/華蓋/國印/太極 | `shen_sha.py` + `constants.py` | ✅ All implemented |
| 地支合沖刑害 | `analyze_branch_relationships()` | ✅ 7 types + interactions |
| 旺相休囚死 | `SEASON_STRENGTH` + `SEASON_MULTIPLIER` | ✅ Calibrated 3.6:1 |
| 命宮/胎元/胎息 | `four_pillars.py` | ✅ In /calculate response |
| 用神/喜神/忌神/仇神 | `determine_favorable_gods()` | ✅ System A convention |
| Five Elements Balance | `_accumulate_raw_element_scores()` | ✅ System A weights |

## Still Needs Implementation

| Capability | File | What |
|-----------|------|------|
| 身宮 | `four_pillars.py` | `(月支序 + 時支序) % 12` + 五虎遁 |
| Weighted Five Elements | `five_elements.py` | Reuse `_accumulate_raw_element_scores()` + seasonal multiplier |
| Weighted Ten Gods | `ten_gods.py` | Same weight system grouped by ten god |
| Career Pre-Analysis | `career_enhanced.py` (NEW) | 10 deterministic functions (scores, positions, allies, forecasts) |
| Enhanced Annual/Monthly | `luck_periods.py` | 大運+流年 combined + career indicators |
| Career V2 Prompts | `prompts.ts` | 3 parallel AI calls with anti-hallucination anchoring |
| Career V2 Streaming | `ai.service.ts` + `bazi.service.ts` | Enable SSE for career reading |
| Frontend Components | 6 new components | ScoreBar, ElementCapabilityChart, TenGodCapabilityChart, AnnualForecastTimeline, MonthlyFortuneGrid, CareerPaywallCTA |
| Two-Phase Workflow | `reading/[type]/page.tsx` | Chart-first (free) → pay-later (3 credits) |

---

## Research Sources

### Classical Texts
- 《子平真詮》— 格局清濁 framework, 正官格 taboos, 有情有力 criteria
- 《三命通會》— "流年為君，大運為臣" principle, hidden stem weights
- 《淵海子平》— Ten god career associations
- 《滴天髓》— Branch root vs manifest stem strength

### Online Sources (Taiwan/HK/Malaysia)
- 三精閣 (sanjingge.com) — 大運流年吉凶判斷
- 謝詠命理 (sina.cn) — 大運流年作用命局步驟
- 算准網 (suanzhun.net) — 空亡, 流年流月, career change indicators
- 靈匣網 (lnka.tw) — 驛馬星, shensha guides
- 闡微堂 (chanweitang.com) — 十神 career analysis
- 華易網 (k366.com) — 五行計算方法
- 網易 (163.com) — 大運vs流年力量, 流月分析
- 知乎 — 八字旺衰精算法, 命犯小人特徵
- vocus.cc — 空亡分析, 傷官見官
- 蘇民峰 (masterso.com) — 命宮計算
- Nova Masters — Entrepreneurship indicators
- FateMaster.ai — Decade luck theory
- 筱竹命理 — 大運流年月日運作方式
