# Phase 12 Specs: Bazi Accuracy Enhancements

> Extracted from CLAUDE.md. Read this when implementing Phase 12 (三合/三會 scoring, 從格 with 三合, 生化鏈).

These three enhancements address known accuracy gaps discovered during real-world validation against 4 historical charts (毛澤東, 蔣介石, 鄧小平, 周恩來). Each gap was confirmed by comparing our engine output against published professional Bazi analyses.

## 12A. 三合/三會 Element Boost in Strength Scoring

**Problem:** The current 3-factor `strengthScoreV2` (得令/得地/得勢) doesn't account for 三合/三會 formations that massively amplify element energy. Example: Zhou Enlai has 寅午戌三合火局 (full Fire triple harmony) which should make his Fire Day Master extremely strong, but scores 61.3 vs Chiang's 70.3 because the triple harmony boost isn't captured.

**Real-world impact:** ~15-20% of charts have 三合 or 三會 formations. Without this factor, strength scores for charts with powerful triple harmonies are systematically underestimated.

**Implementation:**

Add a 4th factor `得合` (alliance boost) to `calculate_strength_score_v2()` in `interpretation_rules.py`. Rebalance weights: 得令(40%) + 得地(25%) + 得勢(15%) + 得合(20%).

```python
# New factor: 得合 (20% weight) -- 三合/三會 element boost
#
# When branches form a 三合 or 三會, the resulting element is massively amplified.
# If that element equals or produces the Day Master element, it's a huge boost.
# If it opposes the Day Master element, it's a suppression factor.
#
# Scoring:
#   三會 forming DM element:          +20 (full boost)
#   三會 forming element that produces DM: +14
#   三合 forming DM element:          +18
#   三合 forming element that produces DM: +12
#   前半合/後半合 forming DM element:    +10/+8
#   三會/三合 forming element that drains/克 DM: -10 to -15
#   No relevant 三合/三會:              +0 (neutral)
#
# Cap at 20 (max boost) or floor at 0 (no negative -- suppression is handled by 得令).
```

**Data source:** Reuse `branch_relationships.py` output -- `analyze_branch_relationships()` already detects all 三合/三會/半合 with `resultElement`. Just need to cross-reference the result element against the Day Master element.

**Files to modify:**
- `interpretation_rules.py` -- add `_calculate_deye()` helper, update `calculate_strength_score_v2()` weight split and add 4th factor
- `test_interpretation_rules.py` -- add tests for charts with/without 三合/三會
- `test_real_world_validation.py` -- update expected scores and remove "known limitation" notes

**Validation:** Zhou Enlai should score higher than Chiang after this fix (寅午戌三合火 directly strengthens his 丁 Fire DM). Deng Xiaoping's score should drop further (申子辰三合水 opposes his 戊 Earth DM).

---

## 12B. 從格 Detection with 三合 Transformation

**Problem:** The current `check_cong_ge()` in `interpretation_rules.py` follows a strict rule from 《滴天髓》: Yang Day Masters cannot form 從格 if ANY 印/比劫 exists anywhere in the chart (including branch hidden stems). This fails for cases where 三合 transformation overwhelms residual roots.

**Real-world impact:** Deng Xiaoping (戊 Earth DM) has 申子辰三合水局 which is so powerful it effectively neutralizes the hidden 戊 root in 辰's tomb. Professional consensus considers him 從財格, but our engine misses it because 辰's hidden stems include 戊 (same element as DM).

**Implementation:**

Enhance `check_cong_ge()` to check whether 三合/三會 transformations "consume" residual roots before applying the strict Yang DM rule:

```python
# Enhanced 從格 detection algorithm:
#
# Step 1: Run existing check -- Day Master extremely weak (V2 < 25)?
# Step 2: Identify all 三合/三會 formations from branch_relationships output
# Step 3: For each formation that successfully transforms:
#   - The transformation element REPLACES the original element of participating branches
#   - Hidden stems of participating branches are "consumed" by the transformation
#   - E.g., 申子辰三合水 -> 辰's hidden [戊,乙,癸] are effectively overridden by Water
# Step 4: AFTER removing consumed roots, re-check the strict Yang DM rule:
#   - If the remaining (non-consumed) roots have 印/比劫 -> NOT 從格
#   - If all roots were consumed by 三合/三會 -> eligible for 從格
#
# Transformation consumption rules:
#   - Full 三合 (3 branches present): ALL hidden stems of participating branches consumed
#   - Full 三會 (3 branches present): ALL hidden stems of participating branches consumed
#   - 半合 (2 of 3 branches): partial consumption -- only the 帝旺 branch hidden stems
#     are consumed (e.g., in 申子辰, only 子's hidden stems). This is weaker and may
#     NOT be sufficient for 從格.
#   - Consumption ONLY applies when the 三合/三會 result element opposes the DM element
#     (i.e., it's draining/克 the DM). If the result element helps the DM, it's not
#     relevant to 從格 detection.
#
# Special case: 從兒格 still allows minimal DM root (strengthScoreV2 < 35) even without
# 三合 consumption -- this existing exception remains unchanged.
```

**Files to modify:**
- `interpretation_rules.py` -- enhance `check_cong_ge()` to accept branch_relationships output, add `_get_consumed_branches()` helper
- `test_interpretation_rules.py` -- add tests for 從格 with 三合 consumption (Deng Xiaoping case)
- `test_real_world_validation.py` -- unskip the Deng 從格 test, add expected 從財格 assertions

**Validation criteria:**
- Deng Xiaoping (戊 Earth, 申子辰三合水): Should detect 從財格. The 三合水 consumes 辰's hidden 戊 root.
- Charts with 三合 that HELPS the DM (e.g., 寅午戌三合火 for Fire DM): Should NOT trigger 從格.
- Charts with partial 半合 (only 2 of 3 branches): Should NOT consume roots.

---

## 12C. 生化鏈 (Element Flow Chain) Analysis

**Problem:** The current scoring evaluates each factor independently, but professional Bazi analysis considers **element production chains** -- whether supporting elements form an unblocked flow into the Day Master.

**Real-world impact:** Two charts with identical element counts can have vastly different effective strength if one has a clean production chain and the other has fragmented support.

**Implementation:**

Add a new module `element_flow.py` that analyzes production chains in the chart:

```python
# Element flow chain analysis
#
# Core concept: Five Elements production cycle 木→火→土→金→水→木
# A "chain" exists when elements in adjacent cycle positions are both present
# and connected (i.e., stem or main qi of one pillar feeds into an adjacent pillar).
#
# Analysis outputs:
# 1. flow_chains: List of detected chains, e.g. [('木','火'), ('火','土')]
# 2. chain_to_dm: Whether any chain flows INTO the Day Master element
# 3. chain_from_dm: Whether the DM element flows OUT (drains DM)
# 4. blocked_chains: Chains where an 克 element interrupts the flow
# 5. chain_quality: Score from 0-100 measuring how clean/unblocked the flow is
#
# Scoring rules:
#   - Unblocked chain into DM (2+ elements): +15 bonus to DM strength
#   - Unblocked chain into DM (3+ elements, 通關用神): +25 bonus
#   - Unblocked drain chain from DM (2+ elements): -10 penalty
#   - Blocked chain (克 element present): 50% reduction in chain bonus
#   - 通關用神 detection: bridging element resolves clash (e.g., 火 bridges 木 and 土)
#
# Integration: Option B -- post-hoc adjustment (multiply final score by chain quality factor)
#   Multiplier range: 0.85 (blocked/draining) to 1.15 (clean flow in).
```

**Pillar adjacency weights for chains:**
- Adjacent pillars (年月, 月日, 日時): full chain strength (1.0x)
- One-gap pillars (年日, 月時): reduced chain (0.7x)
- Opposite pillars (年時): weakest chain (0.4x)

**Files to create/modify:**
- `element_flow.py` (NEW) -- chain detection, 通關用神 detection, chain quality scoring
- `interpretation_rules.py` -- integrate chain analysis into `generate_pre_analysis()`, apply as V2 score modifier
- `test_element_flow.py` (NEW) -- chain detection tests, 通關用神 tests, blocked chain tests
- `test_real_world_validation.py` -- update with chain analysis assertions

**Validation cases:**
- Zhou Enlai: 甲(木)→丁(火) unblocked chain -> high chain quality, score boost
- Mao Zedong: chain exists but DM is seasonally dead -> moderate chain quality
- Deng Xiaoping: 壬(水)→甲(木) chain AWAY from 戊 Earth DM -> drain chain, score penalty

---

## Implementation Order

| Sub-phase | What | Impact | Effort | Dependencies |
|---|---|---|---|---|
| 12A | 三合/三會 element boost (4th factor) | HIGH | 1-2 days | None -- standalone |
| 12B | 從格 + 三合 consumption | HIGH | 2-3 days | 12A (needs updated scores) |
| 12C | 生化鏈 flow chain analysis | MEDIUM | 2-3 days | 12A (chain quality modifies score after 4th factor) |

**Total Phase 12 effort: 5-8 days**

**Prerequisite:** Phase 11 must be complete (especially 11D timing analysis). Phase 12 builds on `branch_relationships.py` and `interpretation_rules.py` infrastructure.
