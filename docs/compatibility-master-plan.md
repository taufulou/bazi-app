# Bazi 合盤 (Compatibility Analysis) — Deep Research & Feature Strategy

## Context

The user wants to enhance the Bazi 合盤 feature so users can combine their chart with another person's chart to see detailed compatibility across multiple life dimensions (love, work, creativity, family, friendship). The goal is to make users feel the analysis is **specifically calculated based on their unique Bazi**, not generic. This research covers competitor analysis, traditional methodology, technical algorithms, and implementation strategy.

### Review History
- **Round 1**: 3 expert agents (Bazi Domain Expert, Algorithm Engineer, UX Engineer) reviewed. Total 56 findings: 6 Critical, 18 High, 18 Medium, 14 Low. All Critical and High issues addressed in this revision. Most Medium issues addressed. Low issues noted for post-launch.

---

## Part 1: Competitor Analysis — What Works in the Market

### How Top Platforms Do 合盤

| Platform | Approach | Price | Key Innovation |
|---|---|---|---|
| **Click108** (科技紫微網) | 7-9 section deep analysis, advice-oriented | NT$320-380 | "地雷禁忌區" (Landmine warnings — what NOT to do) |
| **SeerOnNet** (先知命局) | Q&A-driven, users ask specific relationship questions | Points-based | "Does s/he like me?" format — 2.78M inquiries on one question alone |
| **TaoTaoXi** (桃桃喜) | Timing-focused, best/worst years, emotional hooks | NT$349-388 | **職場合盤** (workplace compatibility — unique!), "Does the other person like you?" section |
| **Linghit** (靈機八字) | Single score, simple and shareable | NT$390 | Viral hook: shareable compatibility percentage |
| **Shen-Shu.com** | 4-step analysis (individual → overlay → day pillar → strategies) | Subscription | Ten God role analysis, actionable strategies |
| **FateMaster.ai** | 4-dimension framework (elements, interactions, palace, family) | Subscription | Family harmony dimension |

### What Makes Users Feel It's Personalized (Not Generic)

1. **Specific pillar references**: "你的日柱甲子與他的日柱丁卯形成..." — cite actual stems/branches
2. **Timing predictions**: "2027年是你們關係的轉折年" — year-specific forecasts
3. **Landmine warnings**: Specific things NOT to do with each other (Click108's best idea)
4. **Emotional hooks**: "對方喜歡你嗎？" — questions that hit the heart
5. **Gender-specific analysis**: Different interpretations for male vs female charts
6. **Dual individual profiles FIRST**: Before comparing, show each person's relationship tendencies
7. **Cross-pillar specifics**: "Your hour pillar 庚 forms 天干合 with their month pillar 乙" — granular detail

### What Makes Compatibility Shareable/Viral

1. A single score ("We're 87% compatible!")
2. A catchy label (天生一對/相愛相殺/歡喜冤家)
3. Timing specifics ("Your best year together is 2027")
4. Surprising rare findings ("Your Day Masters form 天合地合 — only 1 in 30 chance!")

---

## Part 2: Traditional 合婚 Methodology — The 18 Methods

### The 7-Step Modern Professional Consensus (Priority Order)

| Priority | Method | What It Checks | Weight |
|---|---|---|---|
| **1 (Highest)** | 用神互補 | 5-god matrix (喜/用/閒/忌/仇) complementarity across all 5 elements | 25% |
| **2** | 十神交叉 | Asymmetric cross-chart Ten God analysis, spouse star clarity | 15% |
| **3** | 日柱天干合 | Day stem combinations + element relationship + 天干沖 | 15% |
| **4** | 日支配偶宮 | Spouse Palace interactions (六合/六沖/三合/三刑/六害/六破) | 15% |
| **5** | 五行互補 | Directional complementarity (A's excess fills B's deficit) | 10% |
| **6** | 四柱全盤互動 | All 16 stem pairs + 16 branch pairs with pillar weights + cross-chart 三合/三刑 | 10% |
| **7** | 神煞互動 | Marriage Shen Sha + 天德/月德 protective interaction + cross-chart matches | 5% |

### Key Concepts

**天合地合 (Heavenly Combine Earth Combine)**: When BOTH stems AND branches of two day pillars form combinations simultaneously — the highest grade of compatibility. For any given Day Pillar, exactly 1 out of 59 other Day Pillars forms 天合地合, giving ~1.7% probability for a random couple. There are 30 such pairs among the 60 Jiazi system.

**用神互補**: The #1 factor. Uses a **5-god matrix** (喜神/用神/閒神/忌神/仇神) across all 5 elements. Best case: A's 忌神 element serves as B's 忌神 too (shared enemy = alignment), AND A's 用神 restrains B's harmful elements. Worst case: A's 用神 is B's 忌神 (A's success harms B). The scoring evaluates ALL 5 elements' roles in both charts, not just binary 用/忌.

**Gender-specific Ten God rules**:
- Male: 正財 = wife star, 偏財 = romance
- Female: 正官 = husband star, 七殺 = romance
- 官殺混雜 (female only) = severe marriage warning — also detectable CROSS-CHART when male's DM adds missing 官/殺
- 傷官見官 (female only) = "marriage destroyer" — cross-chart when male's DM activates female's 傷官見官 conflict

**天德/月德 protective Shen Sha**: Critical for marriage analysis. When one person's chart has 天德 or 月德, it provides PROTECTION against negative indicators. "天德合月德，能解一切凶" — can neutralize 六沖, 三刑, and 官殺混雜 severity by 30-50%. **This is the most important positive Shen Sha for 合婚.**

---

## Part 3: 8-Dimension Scoring Algorithm (Revised)

### Score Engineering Principles

**Problem**: With 8 dimensions using 50% neutral defaults, the Central Limit Theorem predicts score clustering at 50-70 for ~68% of pairs. This defeats personalization.

**Solution** (3 mechanisms):
1. **Lower neutral defaults**: Set "no interaction" at 35-40% of dimension max (not 50%). Positive findings are rewarding, absence of interaction is slightly negative.
2. **Sigmoid amplification**: Apply S-curve to each dimension's raw score before weighting to compress the neutral zone and expand extremes.
3. **Knockout bonuses/penalties**: Binary events (天合地合, 日支六沖, 天剋地沖) add/subtract points AFTER weighted aggregation to push scores toward extremes.

**Target distribution**: Mean ~52, SD ~16-18, producing:
- <30: ~5% of pairs | 30-49: ~25% | 50-69: ~40% | 70-89: ~25% | 90+: ~5%

**Validation**: Run Monte Carlo simulation on 1000 random chart pairs before finalizing. If >50% cluster within a 15-point band, increase amplification.

### Scoring Formula

```python
def calculate_overall_score(dimension_scores, knockout_conditions, comparison_type):
    """
    1. For each dimension: apply sigmoid amplification to raw score (0-100)
    2. Multiply amplified score by dimension weight for this comparison_type
    3. Sum all weighted contributions → base_score (0-100)
    4. Apply knockout bonuses/penalties → adjusted_score
    5. Clamp to [5, 99] (never show 0 or 100)
    """
    weights = WEIGHT_TABLE[comparison_type]
    base_score = sum(
        sigmoid_amplify(dim.raw_score) * weights[dim.key]
        for dim in dimension_scores
    )
    knockout_adjustment = sum(k.score_impact for k in knockout_conditions)
    return clamp(base_score + knockout_adjustment, 5, 99)

def sigmoid_amplify(raw, midpoint=45, steepness=0.07):
    """Maps [0,100] to [0,100] with amplified extremes and compressed neutral zone."""
    return 100 / (1 + math.exp(-steepness * (raw - midpoint)))
```

### Dimension 1: 用神互補 (25% weight) — 5-God Matrix Scoring

**CRITICAL FIX**: Uses FULL 5-god matrix (喜/用/閒/忌/仇), not binary 用/忌 check.

**Data source**: MUST use `effectiveFavorableGods` from each chart's `preAnalysis` (handles 從格 inversion). NEVER use raw `determine_favorable_gods()`.

**5x5 Interaction Matrix** (A's element role × B's element role):

```
              B's role: 用神   喜神   閒神   忌神   仇神
A's role:
  用神              +50    +40    +20    -40    -30
  喜神              +40    +30    +15    -30    -20
  閒神              +20    +15    +10    -10     -5
  忌神              -40    -30    -10    +50    +40
  仇神              -30    -20     -5    +40    +30
```

Key insight: A's 忌神 = B's 忌神 is **POSITIVE** (+50) because shared enemy creates alignment. A's 用神 = B's 忌神 is **NEGATIVE** (-40) because A's success harms B.

**Algorithm**:
1. For each of 5 elements, get its role in A's chart and B's chart
2. Look up score in 5x5 matrix
3. Sum all 5 element scores → raw_yongshen_score
4. Normalize to 0-100 scale: `(raw + 200) / 400 * 100` (range is -200 to +200)

**Special handling**:
- **中和 (neutral) charts**: When either chart has `classification == 'neutral'`, dynamically reduce this dimension's weight from 25% to 15% and redistribute +5% to 日柱天干 and +5% to 十神交叉. Add `yongshenConfidence: 'low'` flag for AI to soften its language.
- **從格 charts**: Already handled by using `effectiveFavorableGods` (inverted gods). Add `congGeAffectsYongshen: true` warning flag.
- **Negative scores allowed**: Raw score can go negative. At aggregation, use the full range (sigmoid will handle distribution). Track scores < -10 as knockout warning: "用神嚴重衝突".

### Dimension 2: 日柱天干關係 (15% weight) — Day Stem Relationship

**FIXED**: Split into sub-scores. Added 天干沖 detection.

**Sub-scoring**:
| Interaction | Score |
|---|---|
| 天干五合 (day stems combine) | 95 |
| 天干五合 + 合化元素 is both charts' 用神 | 100 |
| 相生 (production cycle) | 75 |
| 比和 (same element, different stem) | 60 |
| 同柱 (identical stem) | 50 |
| No special relationship | 40 |
| 相克 (overcoming cycle) | 25 |
| 天干七沖 (甲庚/乙辛/丙壬/丁癸) | 10 |

### Dimension 3: 日支配偶宮 (15% weight) — Spouse Palace

**FIXED**: Severity-differentiated 六沖 scoring. Reduced 六合/六沖 gap.

| Interaction | Score | Note |
|---|---|---|
| 六合 | 85 | Reduced from 90; some 六合 produce harmful elements |
| 三合 with cross-chart branch | 70 | Day branches + third branch from either chart |
| No interaction | 50 | Neutral baseline |
| 六害 | 30 | |
| 六沖 (丑未/辰戌, Earth-Earth) | 35 | Resolvable clashes |
| 六沖 (寅申/卯酉, Wood-Metal) | 25 | Moderate severity |
| 六沖 (子午/巳亥, Water-Fire) | 15 | Irreconcilable opposition |
| 三刑 | 15 | Cross-chart 三刑 activation |
| 天剋地沖 (stem克 + branch沖) | 5 | Worst case — triggers knockout |

**天德/月德 mitigation**: If either person's chart has 天德 or 月德 in the day pillar, reduce any negative spouse palace score by 30%. If BOTH have 天德/月德, reduce by 50%.

### Dimension 4: 十神交叉 (15% weight) — Asymmetric Ten God Cross-Analysis

**CRITICAL FIX**: Computed ASYMMETRICALLY with two-directional scoring.

**Algorithm**:
1. **A→B**: Derive A's DM as Ten God from B's DM perspective. Score what this means FOR B.
2. **B→A**: Derive B's DM as Ten God from A's DM perspective. Score what this means FOR A.
3. **Final score** = (A→B score × 0.5) + (B→A score × 0.5), adjusted by gender.

**Gender-specific romance scoring** (A→B direction):

| A's role in B's chart | If B is Male | If B is Female |
|---|---|---|
| 正財 (I overcome, diff polarity) | 50 (generic financial) | 90 (wife star!) |
| 偏財 (I overcome, same polarity) | 45 (generic) | 75 (romance, passion) |
| 正官 (overcomes me, diff polarity) | 90 (husband star!) | 50 (authority) |
| 七殺/偏官 (overcomes me, same polarity) | 75 (romance, intense) | 40 (domination risk) |
| 食神 (I produce, diff polarity) | 80 (nurturing) | 80 (nurturing) |
| 傷官 (I produce, same polarity) | 55 (creative tension) | 35 (critical/demanding) |
| 正印 (produces me, diff polarity) | 70 (protective) | 85 (maternal care) |
| 偏印 (produces me, same polarity) | 45 (intellectual) | 55 (complex dynamic) |
| 比肩 (same element, same polarity) | 55 (competitive) | 55 (competitive) |
| 劫財 (same element, diff polarity) | 40 (rivalry) | 40 (rivalry) |

**Business comparison type**: Within Dimension 4, add 格局 complementarity sub-factor (~40% of dimension score). Complementary pairs: 正官格 + 食神格 (+90), 正財格 + 偏印格 (+80). Conflicting pairs: 劫財格 + 正財格 (-60), 傷官格 + 傷官格 (-50).

**Same-sex couples**: Use element-dynamic interpretation WITHOUT spouse star labels. Focus on supportive (印/比) vs challenging (官殺/財) dynamics. Skip spouse star scoring; redistribute that portion to element interaction scoring. Add `sameGenderMode: true` flag.

**Cross-chart 官殺混雜 detection** (female romance only):
1. Check if Female's chart already has both 正官 AND 七殺 in manifest stems
2. Check if Male's DM, as a Ten God from Female's DM perspective, completes the 官殺混雜 pattern (e.g., Female has 正官 in her chart, Male's DM is her 七殺)
3. If triggered → add to knockout warnings with severity "critical"

**Cross-chart 傷官見官 detection**:
1. Check if Female has prominent 傷官 (2+ occurrences or month-pillar 傷官)
2. Check if Male's DM, as Ten God from Female's DM perspective, is 正官
3. If both true → Male's presence "activates" Female's 傷官見官 conflict → knockout warning

### Dimension 5: 五行互補 (10% weight) — Directional Complementarity

**FIXED**: Replaced naive average with directional complementarity algorithm.

**Algorithm**: For each of 5 elements:
```python
complementarity_score = min(a_excess, b_deficit) + min(b_excess, a_deficit)
# Where excess = max(0, percentage - 20), deficit = max(0, 20 - percentage)
```

Sum across all 5 elements, normalize to 0-100. This captures **mutual benefit** — A's surplus fills B's deficit and vice versa. Two charts both with 40% Fire average to 40% (penalized by old algorithm), but have zero complementarity (same excess, no mutual filling).

### Dimension 6: 全盤互動 (10% weight) — Full Pillar Interactions

**Includes**:
- 16 cross-chart branch pairs (4×4) with pillar-pair weights
- 15 cross-chart stem pairs (4×4 minus day-day which is Dimension 2)
- Cross-chart 三合/三會 detection (combine all 8 branches, find formations spanning both charts)
- Cross-chart 三刑 detection (formations only possible when two people are together)

**Cross-chart stem pair rules** (FIXED: no adjacency constraint across charts):
- All 16 pairs checked for 天干合 and 天干沖
- Pillar importance weights: day×day=excluded (Dim 2), month×month=0.8, year×year=0.6, hour×hour=0.4, cross-pillar=0.3
- Deduplication: if A has same stem in multiple pillars, count best single match only

**Branch pair aggregation** (FIXED: dual-tracking, no silent cancellation):
```python
# Track positive and negative SEPARATELY — never cancel
dimension_score = (positive_weighted / max_positive) * max_dim * 0.6 + \
                  (1 - negative_weighted / max_negative) * max_dim * 0.4
# Also compute: interaction_intensity = (positive + negative) / max_total
# High intensity + mixed signs = volatile relationship (flag for AI)
```

**Cross-chart 三合 bonus**: When a 三合 formation spans both charts (at least 1 branch from each person) and is NOT already complete in either individual chart → +15 bonus. Especially powerful when the resulting element matches either person's 用神 → additional +5.

**Cross-chart 三刑 penalty**: When a 三刑 pattern spans both charts → -10 penalty. Severity reduced to 0.7× compared to within-chart 三刑 since branches are from different people.

**六沖 severity differentiation**: Use existing `branch_relationships.py` severity scores. Map inversely: severity 90 (子午沖) → compatibility 10, severity 70 (丑未沖) → compatibility 30.

### Dimension 7: 神煞互動 (5% weight) — Shen Sha Cross-Chart Analysis

**CRITICAL FIX**: Added 天德/月德 protective interaction.

**Scoring model**:

| Finding | Score Impact (out of 5) |
|---|---|
| **天德/月德 mutual protection** (A has 天德, B has 月德 or vice versa) | +4 (ALSO reduces Dim 3/6 negatives by 30-50%) |
| **天乙貴人 cross-match** (A's 天乙 branch = B's day branch) | +3 (B is A's "noble helper") |
| Both have 紅鸞 or 天喜 activated in same year | +3 ("命中注定的相遇年") |
| A's 桃花 branch = B's day branch | +2 (strong physical attraction) |
| One has 桃花 + other has 紅鸞/天喜 | +2 |
| Both have 華蓋 | +1 (intellectual/spiritual bond, but can be "too detached") |
| Both have 驛馬 | +1 (shared nomadic lifestyle) |
| One has 孤辰/寡宿 | -2 |
| Both have 孤辰/寡宿 | -4 (compound loneliness risk) |
| No marriage Shen Sha in either chart | 2.5 (neutral) |

Clamp to [0, 5].

**Na Yin**: Dropped from scored dimensions (was 5% — low ROI, no consensus across schools). If desired, add as informational finding only. Redistributed 5% → Dimension 7 (神煞) now effectively has the old Na Yin's contribution through expanded checks.

### Weight Variation by Relationship Type (Revised, 7 dimensions)

| Dimension | Romance | Business | Friendship | Parent-Child |
|---|---|---|---|---|
| 用神互補 | 25% (15% if 中和) | 30% | 15% | 20% |
| 日柱天干 | 15% (20% if 中和) | 10% | 15% | 10% |
| 日支配偶宮 | 15% | 5% | 10% | 10% |
| 十神交叉 | 15% (20% if 中和) | 25% | 20% | 25% |
| 五行互補 | 10% | 15% | 20% | 15% |
| 全盤互動 | 15% | 15% | 15% | 15% |
| 神煞互動 | 5% | 0% | 5% | 5% |

### Knockout Conditions (Post-Aggregation Adjustments)

Applied AFTER dimension aggregation. Displayed prominently in UI regardless of overall score.

| Condition | Score Impact | Severity |
|---|---|---|
| 天合地合 detected | **+15 bonus** | Premium positive |
| Day stem 天干五合 with DM involved | +8 bonus | Positive |
| Cross-chart 三合 completing 用神 element | +5 bonus | Positive |
| Day branch 六沖 (子午/巳亥, Water-Fire) | **-10 penalty** | Critical warning |
| 天剋地沖 of day pillars | **-12 penalty** | Critical warning |
| 官殺混雜 cross-chart (female romance) | -8 penalty | Critical warning |
| 用神 mutual conflict (raw score < -10) | -5 penalty | High warning |
| Both 孤辰/寡宿 in day pillar | -5 penalty | Warning |

**天德/月德 mitigation**: When present, knockout penalties (except 天剋地沖) are reduced by 30-50%. Display: "雖有X沖突，但有天德/月德化解" in the AI narration.

### Compatibility Labels (Revised)

| Score Range | Label (zh-TW) | Meaning |
|---|---|---|
| 90-100 | 天作之合 | Match made in heaven |
| 80-89 | 天生一對 | Natural pair |
| 70-79 | 相得益彰 | Mutually enhancing |
| 60-69 | 互補雙星 | Complementary stars |
| 50-59 | 歡喜冤家 | Joy and conflict intertwined |
| 40-49 | 需要磨合 | Requires adjustment |
| 30-39 | 挑戰重重 | Significant challenges |
| <30 | 宜友不宜親 | Better as friends |

**Special labels** (override linear labels when specific conditions met):
- **相愛相殺**: Day stems combine BUT Day branches clash → passionate but volatile
- **前世冤家**: High 用神互補 BUT multiple branch clashes → deep connection with friction
- **命中注定**: 天合地合 + 用神互補 > 70 → extremely rare, fateful connection

### Identical Charts Edge Case

Two identical charts (same birthday + time) should score ~45-55 (mediocre). This naturally follows from the algorithms:
- 用神互補: No complementarity (identical gods = no mutual filling) → low score
- 天干合: Same stem = 比和 (50), not 天干合 (95) → moderate
- 六合: Same branch cannot form 六合 → neutral or 自刑
- 十神交叉: Identical charts → no spouse star activation → neutral

Add `identicalChartWarning` flag when birth data matches exactly. Validation test: identical charts MUST score between 40-60; if >75, the algorithms are biased toward similarity over complementarity.

---

## Part 4: Gap Analysis — Current vs Enhanced

### What Exists in `compatibility.py` (323 lines)

| Feature | Status | Quality |
|---|---|---|
| Day Master element interaction | Done | Basic (5 elements only) |
| Day Stem 天干合 | Done | Day stems only |
| Day Branch 六合/六沖/六害 | Done | Missing 三合/三刑/六破, no severity differentiation |
| 4×4 branch brute force | Done | No pillar-pair weights |
| Five Elements complementarity | Done | Naive average (MUST replace with directional) |
| **Gender awareness** | Missing | Critical gap |
| **用神互補 (5-god matrix)** | Missing | HIGHEST priority gap |
| **Asymmetric Ten God cross-analysis** | Missing | Critical gap |
| **天合地合 detection** | Missing | High-value rare finding |
| **天德/月德 protective interaction** | Missing | Critical Shen Sha gap |
| **Knockout conditions** | Missing | Score override system |
| **Shen Sha cross-chart interactions** | Missing | Medium priority |
| **Spouse star analysis** | Missing | Critical for romance |
| **Pillar-pair weighting** | Missing | Quality improvement |
| **Comparison type differentiation** | Stub exists | `comparison_type` param unused |
| **Luck cycle sync** | Missing | Timing enhancement |
| **Pre-analysis for compatibility** | Missing | AI quality improvement |
| **Cross-chart 三合/三刑 detection** | Missing | Cross-chart triple formation |
| **Cross-chart 官殺混雜** | Missing | Female romance critical |
| **Cross-chart 傷官見官** | Missing | Female romance warning |

### What's Already Computed (Reusable)

All data needed for the enhanced compatibility is **already calculated** by existing modules:
- `five_elements.py` → `favorableGods` (用神/忌神/喜神/仇神/閒神 — all 5 gods)
- `interpretation_rules.py` → `effectiveFavorableGods` (handles 從格 inversion), `strengthScoreV2`, `congGe` detection
- `ten_gods.py` → `derive_ten_god()` for cross-chart analysis
- `constants.py` → NAYIN table, element relationships, ELEMENT_INTERACTIONS
- `shen_sha.py` → 27 Shen Sha types including 桃花/紅鸞/天喜/天德/月德/孤辰/寡宿/天乙貴人/華蓋/驛馬
- `branch_relationships.py` → full 7-type relationship analysis with severity scores
- `stem_combinations.py` → 天干合 + 天干七沖
- `luck_periods.py` → 大運/流年 data
- `timing_analysis.py` → 歲運並臨/伏吟/反吟/天剋地沖 detection

**No new computation modules needed** — the enhancement is purely cross-chart analysis logic.

---

## Part 5: Proposed Feature Design

### Relationship Types to Support (V1: 4 types)

1. **愛情姻緣合盤** (Romance/Marriage) — primary, highest demand (3 credits)
2. **職場合盤** (Workplace) — unique differentiator, only TaoTaoXi does this (2 credits)
3. **親子合盤** (Parent-Child) — no competitor does this (2 credits)
4. **朋友合盤** (Friendship) — lighter analysis (2 credits)

**Removed**: 創意合盤 (Creative Partnership) — insufficient traditional basis, no differentiation from Workplace, no competitor offers it, no evidence of user demand. Can re-introduce post-launch if demand emerges with clear 食傷/偏印 focus definition.

**Parent-Child Ten God mapping**: Replace spouse star logic with: Parent's 食神/傷官 = children (male chart); Parent's 正官/偏官 = children (female chart). Focus on 印/比 (nurturing) vs 官殺 (discipline) dynamics.

### Report Sections (Romance — Most Detailed)

**FIXED: Reordered for engagement optimization. Score first (what users came for), landmines strategic placement (invested but not overwhelmed), timing near end (creates urgency/return hook).**

| # | Section | Content | Personalization Hook |
|---|---|---|---|
| 1 | **緣分配對指數** | Overall score + label + dimension radar chart | Score reveal ceremony — shareable |
| 2 | 雙方個性剖析 | Individual personality profiles from each chart | "Based on YOUR Day Master 丁火..." |
| 3 | 日柱天命配對 | Day Pillar deep analysis (天合地合, 配偶宮) | "Your Day Pillars form rare 天干五合!" |
| 4 | 情感相處模式 | Ten God cross-analysis → interaction patterns | Gender-specific spouse star analysis |
| 4.5 | **對方心意分析** | "Does s/he like me?" — time-sensitive analysis | Premium emotional hook (see below) |
| 5 | 五行能量互補 | Combined element balance, 用神互補 analysis | "Your 用神木 perfectly restrains their 忌神木" |
| 6 | **地雷禁忌區** | 3-5 specific landmine warnings (trigger+avoid+suggest) | Most differentiating section |
| 7 | 最佳/最差年份 | Timing dimension from luck period sync | "2027 is your golden year together" |
| 8 | 經營建議 | Actionable relationship advice | Based on specific chart dynamics |

### "Does S/He Like Me?" Feature (Section 4.5)

**FIXED**: Added dedicated time-sensitive analysis based on 5 data signals.

**Data sources (all pre-computed, not AI-derived)**:
1. Person B's spouse star visibility: 透干 = actively seeking, 藏干 = emotionally guarded
2. Person B's Day Branch relationship to Person A's Day Branch: 六合 = natural attraction
3. Person B's 桃花 star status in current luck period: active = open to romance
4. Person A's DM element role in Person B's chart: equals spouse star element = predisposition
5. 紅鸞/天喜 timing: Person B in a 紅鸞/天喜 year = "romance window"

**Answer format**: 3 levels of signal strength → confident/nuanced/honest-but-constructive response.

**Time-sensitivity**: The answer CHANGES year by year (紅鸞/天喜 activation, luck period shifts). This drives repeat usage — users return annually to re-check.

**Pricing**: Bundled in full Romance report (3 credits). Also available standalone as 1-credit quick reading.

**Pre-analysis function**: `score_attraction_likelihood(chart_asker, chart_target, gender_asker, gender_target, current_year)`
- Static chemistry (from Ten God cross + 用神互補): ~50% weight
- Target's current romance activation (紅鸞/天喜/桃花): ~30% weight
- Asker's DM element in target's current 大運/流年: ~20% weight

### 地雷禁忌區 — 10 Explicit Trigger Conditions

**CRITICAL FIX**: Defined specific triggers. Each uses "trigger + avoid + suggest" format with 3 severity tiers.

**Tier 1: 重要提醒 (Structural — permanent)**
1. **日支六沖**: "避免在家中討論[沖方元素相關領域]" — e.g., 子午沖 = avoid discussing finances (Water) and career advancement (Fire) at home
2. **傷官見官 (female chart cross-activated)**: "女方避免在公開場合批評或糾正男方" — 傷官剋正官 = wife publicly undermining husband's authority
3. **官殺混雜 (female chart cross-activated)**: "避免與第三者過度社交接觸" — mixed authority stars indicate attraction to multiple partners
4. **雙方用神互克**: "你的存在對對方有壓制感，避免在對方壓力大時施加要求"

**Tier 2: 注意事項 (Situational — manageable)**
5. **桃花星交叉** (both have 桃花 in day/hour pillar): "雙方都有異性吸引力，建立明確的社交邊界"
6. **劫財在日支 (either chart)**: "一方花費無度，需建立共同財務規則"
7. **偏印在日支 (either chart)**: "一方思想獨特難以溝通，預留獨處空間"

**Tier 3: 小提醒 (Minor friction)**
8. **五行嚴重缺失** (combined chart >30% imbalance): "共同缺[element]元素，需刻意補充（顏色/方位/活動）"
9. **犯太歲年份重疊**: "[year]年雙方運勢低迷，避免重大決定（婚禮/買房/創業）"
10. **三刑激活** (cross-chart 三刑): "相處時容易互相激怒，尤其在[刑方旺季]月份"

**AI prompt constraint**:
```
地雷禁忌區規則：
- 必須輸出 3-5 條具體禁忌（不是所有10條都適用，只選匹配的）
- 每條禁忌必須引用雙方具體天干地支作為依據
- 每條禁忌必須包含「觸發場景 + 避免行為 + 建議替代方案」三部分
- 禁忌分為「重要提醒/注意事項/小提醒」三個等級
- 禁忌內容必須基於預分析結果，不可自行推導
```

### Timing Sync Algorithm (Explicitly Defined)

**FIXED**: Full algorithm specification.

**Scope**: Analyze next 10-20 years from `current_year`.

**Per-year individual scoring** (reuse `timing_analysis.py`):
- Good year: 大運 supports 用神, no 天剋地沖/伏吟/反吟 → score +2
- Neutral year: mixed signals → score 0
- Bad year: 大運 clashes natal pillars, or 犯太歲 → score -2

**Cross-person year scoring**:
- Both good: **"golden year"** → +3
- Both bad: **"mutual challenge year"** → -3
- One good, one bad: "imbalanced year" → -1
- Both neutral: 0

**Golden year detection**: Requires at least 2 of:
(a) 流年 天干 produces both people's 用神 element
(b) 流年 地支 forms 六合 with either person's day branch
(c) Either person has 紅鸞/天喜 activated that year
(d) Neither person has 太歲沖 that year

**Challenge year detection**: Requires any of:
(a) Both in unfavorable 大運 phases simultaneously
(b) 流年 forms 天剋地沖 with both natal charts
(c) 歲運並臨 for either person during other person's 六沖 period

**luckCycleSyncScore**: `(sum(yearly_cross_scores) + num_years * 3) / (num_years * 6) * 100`, clamped [0, 100].

**大運 alignment detection**: Flag when both transition to new 大運 within 2 years of each other as insight (not scored).

### UX Flow (Revised)

```
Step 0: Select relationship type (Romance/Work/Family/Friend)
    ↓
Step 1: Person A — auto-filled from primary saved profile if signed in
    ├── "使用 [name] 的資料" with checkmark + "更換" button
    ├── OR select from saved profiles
    └── OR enter new data
    ↓
Step 2: Person B — select from saved profiles OR enter new data
    ├── Saved profiles shown prominently with ProfileCard component
    ├── "不確定出生時間？" toggle for Quick Mode (3 pillars only)
    ├── Duplicate detection (warns if identical to Person A)
    └── "儲存此資料以便日後使用" checkbox (forced FAMILY/FRIEND tag)
    ↓
Step 3: Score Reveal Ceremony (3-5 seconds)
    ├── Loading: pulsing dual-orbit animation, "正在計算你們的命理緣分..."
    ├── Score count-up: 0 → final value with easing curve
    ├── Label reveal: fade-in with scale animation
    ├── Special finding sparkle (if 天合地合 or other rare finding)
    ├── 5 dimension bars animate from left to right
    └── CTA: "查看完整分析" + "分享結果"
    ↓
Step 4: Full Results (sticky section TOC for navigation)
    ├── Score + radar chart (free for all users)
    ├── 8 sections with AI narration (requires credits/subscription)
    ├── Shareable compatibility card generator
    └── Cross-sell: "也來看看你們的紫微合盤？"
```

**Unknown birth time — "Quick Mode"**: Removes hour pillar. Engine handles missing `birth_time`. Display note: "因缺少時柱，分析準確度約 75%。" Reduce price to 2 credits.

### Pricing Strategy (Revised)

| Access Level | What They Get |
|---|---|
| **Free** (no credit) | Both charts side-by-side, overall score + label + dimension bars |
| **Quick Report** (1 credit) | Score + label + 2-section summary (個性剖析 + 緣分指數) |
| **Full Report** (3 credits, 2 for Quick Mode) | All 8 sections with full AI narration |
| **Per-section unlock** | 1 credit or watch ad for any single section |
| **合盤全覽 Bundle** (5 credits) | All 4 comparison types for the same pair |
| **Annual Update** (1 credit) | Same pair, new year timing analysis only |
| **"Does s/he like me?" standalone** (1 credit) | Section 4.5 only |

---

## Part 6: Technical Implementation Plan

### Phase A: Enhanced Python Compatibility Engine (~4-5 days)

**File: `packages/bazi-engine/app/compatibility.py`** — Major enhancement

New/enhanced functions:

1. **`score_yongshen_complementarity(pre_analysis_a, pre_analysis_b)`** — 5-god matrix scoring
   - Uses `effectiveFavorableGods` from pre-analysis (handles 從格)
   - Returns raw score (-200 to +200), normalized to 0-100
   - Flags `yongshenConfidence: 'low'` for neutral charts
   - Flags `congGeAffectsYongshen: true` when 從格 inverts gods

2. **`score_ten_god_cross(chart_a, chart_b, gender_a, gender_b, comparison_type)`** — Asymmetric Ten God cross-analysis
   - Computes A→B direction AND B→A direction separately
   - Gender-specific scoring matrix (see Part 3)
   - Cross-chart 官殺混雜 detection (female romance)
   - Cross-chart 傷官見官 detection
   - 格局 complementarity sub-factor for business type
   - Same-sex mode (element dynamics without spouse star labels)

3. **`score_day_stem_relationship(stem_a, stem_b)`** — Enhanced day stem scoring
   - Sub-scores: 天干合 / 相生 / 比和 / 相克 / 天干七沖
   - Bonus when 合化 element is both charts' 用神

4. **`score_spouse_palace(branch_a, branch_b, shen_sha_a, shen_sha_b)`** — Enhanced day branch
   - Severity-differentiated 六沖 scoring
   - 三合 detection with cross-chart branches
   - 天德/月德 mitigation (reduce negative scores 30-50%)

5. **`detect_tianhe_dihe(day_pillar_a, day_pillar_b)`** — Premium 天合地合 detection
   - Returns boolean + description

6. **`score_shen_sha_interactions(shen_sha_a, shen_sha_b, branches_a, branches_b)`** — Expanded Shen Sha
   - 天德/月德 protective interaction (MOST IMPORTANT)
   - 天乙貴人 cross-match
   - 紅鸞/天喜 activation overlap
   - 桃花 cross-match
   - 孤辰/寡宿 compound risk
   - 華蓋/驛馬 lifestyle matching

7. **`analyze_cross_chart_branches(pillars_a, pillars_b)`** — All 16 pairs + triple formations
   - 7 relationship types per pair
   - Pillar-pair weights (Day-Day=1.0 down to Hour-Year=0.2)
   - Cross-chart 三合/三會 detection (combine 8 branches)
   - Cross-chart 三刑 detection
   - Dual-tracking aggregation (positive/negative separate)
   - Interaction intensity metric

8. **`analyze_cross_chart_stems(pillars_a, pillars_b)`** — All 15 stem pairs (excl day-day)
   - No adjacency constraint across charts
   - Pillar importance weights
   - Deduplication for repeated stems

9. **`score_element_complementarity(elements_a, elements_b)`** — Directional algorithm
   - A's excess fills B's deficit + B's excess fills A's deficit
   - NOT naive average

10. **`sync_luck_periods(luck_a, luck_b, pre_a, pre_b, current_year)`** — Timing sync
    - Per-year individual scoring (reuse timing_analysis.py)
    - Cross-person year scoring
    - Golden year detection (4 conditions)
    - Challenge year detection (3 conditions)
    - 大運 alignment detection

11. **`score_attraction_likelihood(chart_a, chart_b, gender_a, gender_b, current_year)`** — "Does s/he like me?"
    - Static chemistry (50%) + romance activation (30%) + DM presence (20%)
    - Time-sensitive output

12. **`detect_knockout_conditions(compat_data, gender_a, gender_b, comparison_type)`** — Knockout system
    - Returns list of bonuses (+天合地合, +天干合) and penalties (-日支六沖, -天剋地沖, -官殺混雜)
    - 天德/月德 mitigation applied to penalties

13. **`calculate_enhanced_compatibility(chart_a, chart_b, pre_analysis_a, pre_analysis_b, gender_a, gender_b, comparison_type, current_year)`** — Main orchestrator
    - Calls all scoring functions
    - Applies sigmoid amplification per dimension
    - Dynamic weight adjustment for 中和 charts
    - Knockout conditions applied post-aggregation
    - Special label assignment
    - Identical chart detection

**Key data structure** (revised):
```python
{
    'overallScore': 78,
    'adjustedScore': 86,  # After knockout bonuses
    'label': '天生一對',
    'specialLabel': None,  # Or '相愛相殺', '命中注定', etc.
    'labelDescription': '你們在多方面互相增益，是令人羨慕的組合',
    'dimensionScores': {
        'yongshenComplementarity': {
            'rawScore': 85,
            'weightedScore': 21.3,
            'maxWeighted': 25,
            'weight': 0.25,
            'confidence': 'high',  # or 'low' for 中和 charts
            'findings': [...]
        },
        'dayStemRelationship': {
            'rawScore': 95,
            'weightedScore': 14.3,
            'maxWeighted': 15,
            'weight': 0.15,
            'findings': [{'type': '天干五合', 'detail': '甲己合化土'}]
        },
        # ... (all 7 dimensions)
    },
    'knockoutConditions': [
        {
            'type': 'tianhe_dihe',
            'severity': 'premium_positive',
            'description': '天合地合 — 日柱甲子與己丑，天干甲己合+地支子丑合',
            'scoreImpact': +15,
        },
    ],
    'specialFindings': {
        'tianHeDiHe': True,
        'guanShaHunZa': False,
        'shangGuanJianGuan': False,
        'congGeAffectsYongshen': False,
        'identicalCharts': False,
        'tianDeMitigatesClash': True,  # 天德/月德 active
        'sameGenderMode': False,
    },
    'attractionScore': {  # Only for romance
        'score': 72,
        'signals': ['配偶星透干', '桃花星活躍'],
        'timeSensitive': True,
    },
    'timingSync': {
        'goldenYears': [{'year': 2027, 'reason': '...'}],
        'challengeYears': [{'year': 2029, 'reason': '...'}],
        'luckCycleSyncScore': 72,
        'dayunAlignmentYears': [2031],
    },
    'landmines': [
        {
            'severity': 'high',  # high/medium/low
            'triggerNumber': 1,   # References the 10 triggers
            'trigger': '金錢議題',
            'warning': '甲方偏財旺但乙方正財在忌神位',
            'avoidBehavior': '避免一方掌控所有財務決策',
            'suggestion': '建議設立共同帳戶，大額支出共同商議',
            'dataSource': '甲方偏財透干 + 乙方正財為忌神',
        },
    ],
    'strengthsDetailed': [...],
    'challengesDetailed': [...],
    'comparisonType': 'romance',
    'chartA': {...},
    'chartB': {...},
}
```

### Phase B: Compatibility Pre-Analysis for AI (~2-3 days)

**CRITICAL FIX**: Full structured pre-analysis JSON that leaves ZERO Bazi computation to the AI.

**File: `packages/bazi-engine/app/compatibility_preanalysis.py`** — New module (or add to `interpretation_rules.py`)

**Function**: `generate_compatibility_pre_analysis(chart_a, chart_b, compat_result, pre_analysis_a, pre_analysis_b, gender_a, gender_b, comparison_type)`

**Output structure** (this is what the AI receives — every cross-chart relationship is PRE-COMPUTED):

```python
{
    # Score and label
    "overallScore": 78,
    "adjustedScore": 86,
    "label": "天生一對",
    "specialLabel": None,

    # Cross-chart Ten God analysis (pre-computed, NOT AI-derived)
    "crossTenGods": {
        "a_daymaster_in_b": {
            "tenGod": "偏財",
            "meaning": "甲方在乙方命盤中扮演偏財角色",
            "forRomance": "代表甲方是乙方的異性緣/浪漫對象"
        },
        "b_daymaster_in_a": {
            "tenGod": "正官",
            "meaning": "乙方在甲方命盤中扮演正官角色",
            "forRomance": "代表乙方是甲方的正桃花/長期伴侶"
        },
        "a_spouse_star": {
            "star": "正財",
            "position": "月柱透干",
            "status": "透干且旺相",
            "implication": "甲方對婚姻態度積極且明確"
        },
        "b_spouse_star": {
            "star": "正官",
            "position": "日支藏干",
            "status": "藏而不透",
            "implication": "乙方內心渴望穩定感情但不善表達"
        }
    },

    # Specific pillar interaction findings
    "pillarFindings": [
        {
            "type": "天干五合",
            "pillarsInvolved": "甲方日干甲 + 乙方日干己",
            "description": "甲己合化土",
            "significance": "high",
            "narrativeHint": "日干天干合是合盤中最有力的正面信號"
        },
    ],

    # Landmine warnings (pre-computed with full reasoning)
    "landmines": [
        {
            "severity": "high",
            "trigger": "金錢議題",
            "warning": "甲方偏財旺但乙方正財在忌神位，金錢觀差異大",
            "avoidBehavior": "避免一方掌控所有財務決策",
            "suggestion": "建議設立共同帳戶，大額支出共同商議",
            "dataSource": "甲方偏財透干 + 乙方正財為忌神"
        }
    ],

    # Timing (pre-computed)
    "timingSync": {
        "goldenYears": [{"year": 2027, "reason": "雙方大運同時走正財運"}],
        "challengeYears": [{"year": 2029, "reason": "甲方逢沖太歲，乙方偏印運"}]
    },

    # 用神互補 detail
    "yongshenAnalysis": {
        "a_useful_element": "木",
        "b_useful_element": "金",
        "complementary": True,
        "explanation": "甲方用神木剋制乙方忌神土，乙方用神金生甲方喜神水",
        "score": 85,
        "confidence": "high"
    },

    # "Does s/he like me?" analysis (romance only)
    "attractionAnalysis": {
        "score": 72,
        "signalCount": 3,
        "signals": [
            "乙方配偶星（正官）在月柱透干，主動尋求伴侶",
            "乙方2026年紅鸞星動，正處於渴望愛情的時期",
            "甲方日主五行正好是乙方的配偶星五行"
        ],
        "conclusion": "strong"  # strong/medium/weak
    },

    # Narration guidance
    "narrationGuidance": {
        "addressA": "你",
        "addressB": "對方",
        "genderA": "male",
        "genderB": "female",
        "comparisonType": "romance",
        "positiveNegativeRatio": "6:4"
    }
}
```

### Phase C: Enhanced AI Prompts (~2-3 days)

**File: `apps/api/src/ai/prompts.ts`** — New compatibility prompts per comparison type

**New prompts**:
- `COMPATIBILITY_ROMANCE` — Full romance with gender-aware spouse star rules + "Does s/he like me?"
- `COMPATIBILITY_BUSINESS` — Reweighted for workplace dynamics + 格局 complementarity focus
- `COMPATIBILITY_FRIENDSHIP` — Lighter, personality-focused
- `COMPATIBILITY_PARENT_CHILD` — Family dynamics with 食傷/印 Ten God mapping

**Dual-chart anti-hallucination rules** (CRITICAL — add to each compatibility prompt):

```
雙人合盤絕對禁止：
1. 絕對不可以混淆甲方和乙方的天干地支。甲方的年柱是甲方的，乙方的年柱是乙方的。
2. 絕對不可以說「甲方的日柱是X」如果提供的數據中甲方日柱是Y。
3. 絕對不可以自行推算兩人之間的天干合或地支關係。系統已在【合盤預分析】中計算完畢。
4. 絕對不可以混淆男命和女命的十神解讀。男命正財=妻星，女命正官=夫星。
5. 提到任何分數時必須與【合盤數據】中的分數完全一致。
6. 所有「天干合」「地支六合」「六沖」「三刑」等關係必須來自預分析，不可自行判斷。
7. 用「你」稱呼甲方（使用者），用「對方」或「他/她」稱呼乙方。不要使用「甲方/乙方」。

性別十神規則：
- 男命：正財=妻星，偏財=情人
- 女命：正官=夫星，七殺=情人
- 官殺混雜 警告僅適用於女命
- 傷官見官 警告僅適用於女命

驗證規則（雙人版）：
- 提到甲方任何天干地支 → 必須與甲方四柱排盤完全一致
- 提到乙方任何天干地支 → 必須與乙方四柱排盤完全一致
- 提到整體分數 → 必須與合盤數據中的分數完全一致
- 提到任何天干合/地支關係 → 必須與合盤預分析中的計算結果一致

地雷禁忌區規則：
- 必須輸出 3-5 條具體禁忌
- 每條禁忌必須引用雙方具體天干地支作為依據
- 每條禁忌必須包含「觸發場景 + 避免行為 + 建議替代方案」三部分
- 禁忌分為「重要提醒/注意事項/小提醒」三個等級
- 禁忌內容必須基於預分析結果，不可自行推導

重要：以下所有分析結論都已由系統預先計算。你的任務是將這些結論用流暢的中文敘述出來，並連結成有邏輯的段落。絕對不可以自行計算任何十神、五行關係或天干地支互動。
```

**ai.service.ts changes**:
- Register `{{preAnalysisCompat}}` in `interpolateTemplate()` (single combined pre-analysis, not separate A/B)
- Fix: add `{{strengthV2A}}` and `{{strengthV2B}}` placeholders with ⚠️ markers
- Remove legacy `{{strengthA}}`/`{{strengthB}}` or keep but de-prioritize with warning

### Phase D: Tests (~3-4 days)

- **Dimension tests**: Each of 7 scoring dimensions independently
  - 用神互補: 5-god matrix edge cases (identical gods, inverted 從格, neutral charts)
  - Ten God cross: asymmetric scoring, gender-specific, same-sex, 官殺混雜/傷官見官 detection
  - Day stem: all interaction types including 天干七沖
  - Spouse palace: severity-differentiated 六沖, 天德/月德 mitigation
  - Element complementarity: directional vs naive average comparison
  - Full pillar: cross-chart 三合/三刑, dual-tracking aggregation
  - Shen Sha: 天德/月德 protection, 天乙 cross-match, 桃花 cross-match
- **天合地合 detection**: All 30 known pairs
- **Knockout conditions**: Bonus/penalty application, 天德/月德 mitigation
- **Score distribution**: Monte Carlo with 1000 random pairs, verify SD ≥ 15
- **Identical charts**: Must score 40-60, not high
- **Comparison type weights**: Same pair, different types → different scores
- **Timing sync**: Golden/challenge year detection, luckCycleSyncScore
- **Pre-analysis completeness**: All fields populated, all cross-chart data pre-computed
- **Real-world validation**: Known celebrity couples + published Bazi analyses
- **Landmine triggers**: All 10 conditions tested with matching chart pairs

### Phase E: Frontend Enhancement (~3-4 days)

- **Score Reveal Ceremony** (`CompatibilityScoreReveal.tsx`): 3-5s reveal sequence with count-up, label animation, special finding sparkle, dimension bars. CSS animations only.
- **DualBirthDataForm**: Two-step form (Person A → Person B) with saved profile integration, Quick Mode toggle, duplicate detection, save Person B checkbox
- **Radar chart**: 5 user-facing labels (collapse 7 dimensions to 5 visual axes), with expandable detail showing all 7 + calculation breakdown
- **User-facing dimension labels** (technical → accessible):
  - 用神互補 → 命格互補指數
  - 日柱天干 → 靈魂契合度
  - 日支配偶宮 → 婚姻宮互動
  - 十神交叉 → 角色互動
  - 五行互補 → 能量平衡
  - 全盤互動 → 整體相容
  - 神煞互動 → 緣分星曜
- **Shareable compatibility card**: Client-side image generation (`html-to-image`), OG image route (`/api/og/compatibility`), share URL (`/compatibility/share/[readingId]`). NO birth data on card (privacy). Contents: names + score + label + top 3 findings + rare finding callout + CTA.
- **Comparison-type theming**: Romance=warm pink, Business=blue/teal, Parent-Child=warm amber, Friendship=green. New `SECTION_THEMES` entries for compatibility sections.
- **Sticky section TOC**: IntersectionObserver-based navigation for 8-section reading
- **Methodology badge**: "本分析基於 7 大傳統合婚法則" banner at top of reading
- **Score transparency**: Expandable calculation breakdown per dimension showing exact pillar + score contribution
- **Knockout warning display**: Red warning boxes above dimension scores, regardless of overall score
- **Landmine presentation**: 3-tier severity icons (red triangle/yellow warning/blue info), "trigger + avoid + suggest" format

### Phase F: Retention Mechanisms (Post-launch, ~1-2 days)

- **Annual update**: Track `lastCalculatedYear` on `BaziComparison`. When new year begins, show "update available" badge.
- **Multi-partner comparison**: Allow comparing same Person A with multiple Person B entries. Show comparison table ranking.
- **Golden year alert**: Store timing predictions. Future cron job sends notification before golden year starts.

---

## Part 7: Why This Will Feel Personalized

The key insight from all research: **specificity creates trust**. Users feel analysis is custom when:

1. **Their actual pillars are cited**: "你的日柱甲子中，甲木為對方的偏財..." — not "木 element people tend to..."
2. **Rare findings are highlighted**: "你們的日柱形成天合地合，機率僅1.7%！" — statistical rarity callout
3. **Gender-specific language**: "作為女命，你的正官星在月柱..." — acknowledges gender role in Bazi
4. **Cross-pillar specifics**: "你的時柱庚金與對方的月柱乙木形成天干合" — shows 16-pair analysis depth
5. **Timing specifics**: "2027年是你們關係的黃金期，因為..." — year-specific advice
6. **Landmine warnings with triggers**: "當你們討論金錢時，避免..." + "建議改為..." — actionable, not generic
7. **用神 connection**: "你的用神木正好剋制對方的忌神土" — shows deep chart interaction
8. **Scoring transparency**: Each dimension expandable showing exact calculation → "WHY is the score 78?"
9. **天德/月德 protection**: "雖有日支六沖，但你的天德貴人能化解衝突" — nuanced, not just positive/negative
10. **"Does s/he like me?" with timing**: "對方今年紅鸞星動，正處於渴望愛情的時期" — changes year-to-year

### Trust-Building Elements

1. **Methodology badge** at top: "本分析基於 7 大傳統合婚法則：用神互補 | 日柱天干合 | 配偶宮 | 十神交叉 | 五行互補 | 地支互動 | 緣分星曜"
2. **Score transparency** per dimension: expandable breakdown showing exact pillar references and score contributions
3. **Rare finding callout** with statistics: "天合地合 — 僅 1.7% 機率" with explanation of the 60 Jiazi system

---

## Part 8: Verification Plan

### How to Test End-to-End

1. **Engine tests**: `python -m pytest tests/ -v` — all 451+ existing tests pass + new compatibility tests
2. **New compatibility tests**: Each of 7 scoring dimensions independently + knockout conditions + score distribution + identical charts
3. **Score distribution validation**: Monte Carlo 1000 pairs. Verify: mean ~52, SD ≥ 15, all 8 labels appear, <30 and >90 each ≥ 3%
4. **Identical charts**: Must score 40-60
5. **從格 charts**: Verify `effectiveFavorableGods` used, not raw gods
6. **中和 charts**: Verify dynamic weight reduction (25% → 15%) and confidence flag
7. **天德/月德 mitigation**: Chart pair with 日支六沖 + 天德 must score higher than same pair without 天德
8. **Real-world validation**: Known celebrity couples with published Bazi analyses
9. **AI reading quality**: Generate readings for 5+ test cases, verify:
   - Both charts' pillars cited correctly (no A/B confusion)
   - Gender-correct Ten God terminology
   - Pre-analysis findings reflected in narrative (not AI-computed)
   - No hallucinated stems/branches
   - Timing predictions reference actual luck periods
   - Landmine warnings cite specific pillars with trigger+avoid+suggest format
   - "Does s/he like me?" answer is time-sensitive with data citations
10. **Frontend**: Score reveal animation, radar chart, shareable card (no birth data), section TOC
11. **Comparison types**: Same pair, different types → verify different weights, scores, and AI sections
12. **Same-sex couples**: Verify Ten God scoring uses element dynamics without spouse star labels

### Key Files to Modify

| File | What Changes |
|---|---|
| `packages/bazi-engine/app/compatibility.py` | Major enhancement — 7 dimension scoring + knockouts |
| `packages/bazi-engine/app/compatibility_preanalysis.py` | NEW — cross-chart pre-analysis for AI |
| `packages/bazi-engine/app/main.py` | Update `/compatibility` endpoint to include new data |
| `packages/bazi-engine/app/constants.py` | Add YONGSHEN_MATRIX, KNOCKOUT_CONDITIONS |
| `packages/bazi-engine/tests/test_compatibility.py` | Major expansion |
| `packages/bazi-engine/tests/test_compatibility_preanalysis.py` | NEW |
| `apps/api/src/ai/prompts.ts` | 4 new comparison-type prompts + anti-hallucination rules |
| `apps/api/src/ai/ai.service.ts` | New placeholders, compatibility pre-analysis formatting |
| `apps/api/src/bazi/bazi.service.ts` | Pass gender + comparison type + pre-analysis to engine |
| `apps/web/app/components/CompatibilityScoreReveal.tsx` | NEW — score reveal ceremony |
| `apps/web/app/components/DualBirthDataForm.tsx` | NEW — two-person input form |
| `apps/web/app/reading/[type]/page.tsx` | Compatibility flow integration |

---

## Summary

This is a **competition-beating 7-dimension analysis** (previously 8, Na Yin dropped for low ROI) with:
- **5-god matrix** for 用神互補 (not binary 用/忌)
- **Asymmetric Ten God cross-analysis** with gender-specific scoring
- **天德/月德 protective Shen Sha** that mitigates clash severity by 30-50%
- **10 explicit landmine triggers** with "trigger + avoid + suggest" format
- **Score engineering** (sigmoid + knockouts) for healthy distribution
- **Full compatibility pre-analysis** that leaves ZERO computation to the AI
- **"Does s/he like me?"** with time-sensitive analysis
- **Score reveal ceremony** for viral sharing
- **4 comparison types** with distinct weights, prompts, and theming

The core advantage: all required data is already computed by our engine — we just need to cross-reference it intelligently between two charts.

Estimated total effort: **14-19 days** across Python engine, pre-analysis, NestJS API, AI prompts, tests, and frontend.
