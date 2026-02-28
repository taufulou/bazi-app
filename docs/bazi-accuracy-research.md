# Bazi Accuracy Research Items

> Findings from Bazi Master Engineer review of V1→V2 strength migration (2026-02-28).
> These items are NOT implemented yet — research and validate before implementing.

---

## 1. Neutral Sub-Split (HIGH priority)

**Problem**: `determine_favorable_gods()` uses a binary split — strong/very_strong gets drain path, everything else (including neutral) gets support path. A chart at 54.9 gets 用=比劫, while 55.1 gets 用=財 — a total 5-god inversion from 0.2 points difference.

**Proposed fix**: For neutral charts (score 40-54), split at score 50:
- Upper neutral (≥50): lean drain (same gods as strong)
- Lower neutral (<50): lean support (same gods as weak)

**Implementation**: Add optional `strength_score` param to `determine_favorable_gods()`:
```python
if strength in ('strong', 'very_strong') or (strength == 'neutral' and strength_score >= 50):
    # drain/control path
else:
    # support path
```

**Traditional basis**: 《子平真詮》states that for 中和 charts, 用神 should be determined by 月令透干 patterns, not blanket strong/weak prescriptions. The sub-split is an engineering approximation of this principle.

**Risk**: Low — only affects charts classified as "neutral". The midpoint split at 50 is conservative.

---

## 2. 專旺格 Detection (MEDIUM-HIGH priority)

**Problem**: `check_cong_ge()` handles extremely weak DMs (score < 35) by overriding gods to "follow the weakness". But the mirror case — 專旺格 for extremely strong DMs — has no detection. When a DM scores 80+ with overwhelming support, the correct treatment per《滴天髓》is to "follow the strength" (順其旺勢), not try to drain/control it.

**Subtypes**:
| Element | Name | Description |
|---------|------|-------------|
| 木 | 曲直格 | Wood extreme strength |
| 火 | 炎上格 | Fire extreme strength |
| 土 | 稼穡格 | Earth extreme strength |
| 金 | 從革格 | Metal extreme strength |
| 水 | 潤下格 | Water extreme strength |

**Detection conditions** (proposed):
1. V2 score ≥ 80
2. DM element + producing element ≥ 60% of chart energy
3. 官殺 (element that overcomes DM) < 10%

**God override when detected**:
- 用神: 比劫 (same element) or 印 (producing element)
- 忌神: 官殺 (overcomes me), 財 (I overcome, wastes energy)

**Implementation**: Add `check_zhuan_wang_ge()` function modeled after `check_cong_ge()` in `interpretation_rules.py`, with override in `effectiveFavorableGods`.

**Source**: 《滴天髓·專旺》, professional Bazi practice

---

## 3. 調候用神 (Seasonal Regulation) (MEDIUM priority)

**Problem**: For neutral-range charts, traditional practice applies seasonal regulation (調候) rather than generic strong/weak prescriptions. The current system ignores this entirely.

**Examples**:
- 戊土 born in winter (子/丑月) needs 丙火 for warmth, regardless of strength
- 甲木 born in summer (午/未月) needs 癸水 for moisture
- 庚金 born in summer needs 壬水 to temper (淬煉)

**Traditional basis**: 《窮通寶鑑》(also called 《造化元鑰》) provides month-by-month 用神 prescriptions for each of the 10 Heavenly Stems. This is considered essential by most professional masters.

**Implementation complexity**: HIGH — requires encoding 10 stems × 12 months = 120 rules from《窮通寶鑑》. Would be applied as an overlay for neutral/borderline charts, supplementing the strength-based gods.

**Recommendation**: Research and implement as Phase 13 deep pre-analysis feature. See `docs/future-enhancements.md`.

---

## 4. V2 Threshold Tuning (MEDIUM priority)

**Current V2 thresholds**:
```
very_strong >= 70
strong      >= 55
neutral     >= 40   ← concern
weak        >= 25   ← concern
very_weak   < 25
```

**V1 thresholds for comparison**:
```
very_strong >= 70
strong      >= 55
neutral     >= 45
weak        >= 30
very_weak   < 30
```

**Concern**: V2's neutral band (40-54) is 15 points wide. Roger12 scores 40.6 — barely above the neutral/weak boundary. Consider:
- Raising neutral from ≥40 to ≥42 (narrows neutral to 13 points, pushes more borderline cases to weak)
- This requires re-running all test cases and checking historical figure validations

**Impact**: Changing thresholds affects every chart's classification. Needs comprehensive testing with real-world birth data.

---

## 5. 旺相休囚死 Score Calibration (LOW-MEDIUM priority)

**Current 得令 mappings**:
```
旺(5) = 50分
相(4) = 40分
休(3) = 25分  ← concern
囚(2) = 12分
死(1) = 0分
```

**Concern**: The gap from 相(40) to 休(25) is 15 points — a 37.5% drop. 休 means "I produce the season" (resting state); it is below 相 but still has residual strength. This cliff may be slightly too steep.

**Proposed alternative**: 休=28 (or 休=30) to smooth the curve.

**Impact**: Changes 得令 factor for all charts where the DM element is in 休 state. Needs careful testing.

---

## 6. 合化 in V2 Strength (LOW priority)

**Problem**: V2 得勢 factor counts raw stem elements without considering whether stem combinations (甲己合化土, 乙庚合化金, etc.) have transformed elements. If 甲 combines with 己 to transform into 土, the effective element is 土, not 木 — but V2 still counts 甲 as 木.

**Traditional basis**: Whether a stem combination actually transforms (化) depends on month branch support. Many practitioners debate exact conditions.

**Impact**: Low — stem transformations are relatively rare and the effect on scoring is modest (affects 得勢 factor which is only 20% of total).

**Recommendation**: Future enhancement. Requires implementing stem transformation detection first.

---

## Validation Methodology

For any of the above changes, validate using:
1. The 4 historical figures in `test_real_world_validation.py` (毛澤東, 蔣介石, 鄧小平, 周恩來)
2. Real user charts (Roger12, Laopo14) — compare before/after god assignments
3. Run full test suite: `python -m pytest tests/ -v`
4. Cross-reference with professional Bazi software outputs if available
