# V7 — Score Recalibration + UX Enhancement Plan (Rev 2)

## Overview
5 improvements inspired by Seer comparison, but done better.

## Staff Review Resolutions (Rev 2)

| # | Issue | Resolution |
|---|-------|-----------|
| 1 (Low) | Label thresholds conflict with shared constants | Create `COMPATIBILITY_LABELS_ROMANCE` as romance-specific override, don't change shared constants |
| 2 (Low) | Peach blossom count discrepancy (1 vs Seer's 2) | Document as known limitation. Our methodology counts branches matching TAOHUA targets from year+day branches — this is the standard approach. Seer may use an extended lookup. |
| 3 (Low) | 姻緣星 hidden stem scope | Documented as intentional: only count day branch hidden stems (spouse palace). More meaningful than counting all hidden stems. |
| 4 (Medium) | Label lookup lives in different module | Import `COMPATIBILITY_LABELS` from `compatibility_constants.py` directly. For `specialLabel`, preserve the original value (don't recompute after recalibration). |
| 5 (Medium) | Mutation pattern is fragile | Store original structural score as `structuralScore` before overwriting `adjustedScore`. This preserves the original for logging/debugging. |
| 6 (Medium-High) | 60/40 blend edge case pathologies | Add guardrails: (a) Skip blend if 天剋地沖 hard floor was applied. (b) Cap max offset to ±25 points from structural baseline. |
| 7 (High) | 命理師導覽 needs post-recalibration score | Compute Proposal A/C/D narratives in the **frontend** (TypeScript), NOT in Python. The frontend receives both `compatibilityPreAnalysis.adjustedScore` and `romancePreAnalysis` and can interpolate all needed values. |
| 8 (High) | 半合 strength levels | Distinguish 3 types: 生合 (strongest), 墓合 (moderate), 缺旺 (weakest). Use `type` field to specify strength. For 寅戌 (缺旺), use softer signal text: "配偶宮半合（較弱），感情有輕微進展機會". |

---

## 1. Score Recalibration

### Problem
Roger+Laopo scores: 甜蜜度95 + 穩定度100 + 危機等級輕微 → overall 36分 (挑戰重重). This is contradictory. Seer gives 87 (inflated). A real master would say ~60-70.

### Root Cause
The 8-dimension overall score is computed in `compatibility_enhanced.py` (lines 1546-1628) and has **zero connection** to the romance pre-analysis experiential scores (sweetness, stability, crisis). These two systems are architecturally isolated.

The 36 is driven by:
- 用神互補: raw=11 (weight 20%) ← massive drag
- 日柱天干: raw=25 (weight 15%) ← 戊剋甲 penalty
- 五行互補: raw=0 (weight 10%) ← zero score
- Knockout: -5 (用神衝突)
- Total weighted: ~37 → adjusted ~36

### Fix: "Experiential Quality Offset"

Add a new post-adjustment step in `compatibility_enhanced.py` (after line 1626, before final clamp) that blends experiential scores into the overall:

```python
# === V7: Experiential Quality Offset ===
# Romance pre-analysis scores (sweetness, stability, crisis) are computed
# independently but should influence the overall score to prevent contradictions.
# A couple with 甜蜜95+穩定100 should NOT get overall 36.

if comparison_type == 'romance' and romance_pre_analysis:
    pmq = romance_pre_analysis.get('postMarriageQuality', {})
    sweetness = pmq.get('sweetness', {}).get('score', 50)
    stability = pmq.get('stability', {}).get('score', 50)
    crisis_a = romance_pre_analysis.get('crisisRiskA', {}).get('riskScore', 50)
    crisis_b = romance_pre_analysis.get('crisisRiskB', {}).get('riskScore', 50)
    avg_crisis = (crisis_a + crisis_b) / 2

    # Experiential composite: high sweetness+stability with low crisis = good marriage
    experiential_composite = (sweetness * 0.35 + stability * 0.35 + (100 - avg_crisis) * 0.30)
    # e.g., Roger+Laopo: 95*0.35 + 100*0.35 + (100-12.5)*0.30 = 33.25 + 35 + 26.25 = 94.5

    # Blend: 60% structural (8-dim score) + 40% experiential
    STRUCTURAL_WEIGHT = 0.60
    EXPERIENTIAL_WEIGHT = 0.40
    blended = adjusted_score * STRUCTURAL_WEIGHT + experiential_composite * EXPERIENTIAL_WEIGHT
    # e.g., 36*0.60 + 94.5*0.40 = 21.6 + 37.8 = 59.4

    # Guardrail 1: Skip blend if 天剋地沖 hard floor was applied
    has_tkdc = any(kc.get('type') == 'tian_ke_di_chong' for kc in knockout_conditions)
    if has_tkdc:
        # Do NOT blend — 天剋地沖 is a hard structural deal-breaker
        pass
    else:
        # Guardrail 2: Cap max offset to ±25 from structural baseline
        MAX_OFFSET = 25
        blended = adjusted_score * STRUCTURAL_WEIGHT + experiential_composite * EXPERIENTIAL_WEIGHT
        offset = blended - adjusted_score
        capped_offset = max(-MAX_OFFSET, min(MAX_OFFSET, offset))
        adjusted_score = round(adjusted_score + capped_offset)

    # Store original for logging
    result['structuralScore'] = original_adjusted_score
```

**Roger+Laopo expected result**: structural=36, experiential=94.5, raw_blend=59.4, offset=+23.4 (within ±25 cap) → **59** (from "挑戰重重" to "需要經營")

**Edge case: High structural + low experiential**: structural=80, experiential=20.5, raw_blend=56.2, offset=-23.8 (within cap) → **56**. The cap prevents extreme drag-down.

**Edge case: 天剋地沖**: Blend skipped entirely. Structural score preserved.

### Label Thresholds Update
Current thresholds may need adjustment. In `compatibility_constants.py`, check and update:
- 85+ → 天作之合
- 70-84 → 良緣佳配
- 55-69 → 需要經營
- 40-54 → 挑戰較多
- <40 → 挑戰重重

### Files Changed
- `compatibility_enhanced.py`: Add experiential offset after line 1626 (~15 lines)
- `compatibility_constants.py`: Update label thresholds if needed
- Need to **pass** `romance_pre_analysis` into the score calculation function (currently it doesn't receive this data)

### Architecture Change Required
The score is computed in `compatibility_enhanced.py` → `generate_compatibility_pre_analysis()`, which is called BEFORE `generate_romance_pre_analysis()`. So the experiential scores don't exist yet when the base score is computed.

**Solution**: Add a **post-calibration step** in the orchestrator (`generate_compatibility_romance_combined()` in `compatibility_romance_preanalysis.py` line ~1960). After both base and romance pre-analysis are computed, recalibrate:

```python
def generate_compatibility_romance_combined(chart_a, chart_b):
    # Step 1: Base compatibility (8-dim score)
    base = generate_compatibility_pre_analysis(chart_a, chart_b, 'romance')

    # Step 2: Romance-specific pre-analysis (sweetness, stability, crisis, etc.)
    romance = generate_romance_pre_analysis(chart_a, chart_b, base)

    # Step 3: V7 — Recalibrate overall score using experiential data
    recalibrated_score = _recalibrate_romance_score(
        base['adjustedScore'],
        romance['postMarriageQuality'],
        romance['crisisRiskA'],
        romance['crisisRiskB']
    )
    base['adjustedScore'] = recalibrated_score
    base['label'] = _get_label_for_score(recalibrated_score)  # Update label
    base['labelDescription'] = _get_label_desc(recalibrated_score)

    return {**base, 'romancePreAnalysis': romance}
```

Wait — checking the actual orchestrator location. Let me clarify:

The orchestrator is in `calculator.py` (line ~506) which calls `generate_compatibility_pre_analysis()` from `compatibility_enhanced.py`, then separately calls `generate_romance_pre_analysis()` from `compatibility_romance_preanalysis.py`. The recalibration should happen in `calculator.py` after both calls return.

### Implementation Location
- File: `packages/bazi-engine/app/calculator.py` — after both `generate_compatibility_pre_analysis()` and romance pre-analysis complete
- Add `_recalibrate_romance_score()` helper function in `compatibility_romance_preanalysis.py`
- The helper reads sweetness, stability, crisis scores and adjusts the overall

---

## 2. Detect 夫妻宮受合 via 半合 (Half-Combination)

### Problem
Seer detects "夫妻宮受合" for Laopo in 2026. Our system only checks 六合 (full combination: 卯戌, 寅亥, etc.). 2026寅 + Laopo日支戌 = 半合火局 (missing 午), which we don't detect.

### Current Logic
`compatibility_romance_preanalysis.py` line 1784-1798:
```python
if _is_liuhe(current_year_branch, day_branch):  # Only checks 六合
    signals.append({'signal': '夫妻宮受合', ...})
elif _is_liuchong(current_year_branch, day_branch):  # Only checks 六沖
    signals.append({'signal': '夫妻宮受沖', ...})
```

### Fix: Add 半合 (half-combination) check

After the 六合 check, add 半合:

```python
# 三合 half-combination pairs with strength levels
# 生合 (生+旺): strongest — active, generative energy
# 墓合 (旺+墓): moderate — contracting, stabilizing energy
# 缺旺 (生+墓): weakest — incomplete, some masters don't count this
SANHE_HALF = {
    # 火局: 寅(生) 午(旺) 戌(墓)
    ('寅', '午'): '生合', ('午', '寅'): '生合',
    ('午', '戌'): '墓合', ('戌', '午'): '墓合',
    ('寅', '戌'): '缺旺', ('戌', '寅'): '缺旺',
    # 水局: 申(生) 子(旺) 辰(墓)
    ('申', '子'): '生合', ('子', '申'): '生合',
    ('子', '辰'): '墓合', ('辰', '子'): '墓合',
    ('申', '辰'): '缺旺', ('辰', '申'): '缺旺',
    # 金局: 巳(生) 酉(旺) 丑(墓)
    ('巳', '酉'): '生合', ('酉', '巳'): '生合',
    ('酉', '丑'): '墓合', ('丑', '酉'): '墓合',
    ('巳', '丑'): '缺旺', ('丑', '巳'): '缺旺',
    # 木局: 亥(生) 卯(旺) 未(墓)
    ('亥', '卯'): '生合', ('卯', '亥'): '生合',
    ('卯', '未'): '墓合', ('未', '卯'): '墓合',
    ('亥', '未'): '缺旺', ('未', '亥'): '缺旺',
}

SANHE_HALF_MESSAGES = {
    '生合': {
        'signal': '夫妻宮半合（強）',
        'singleImplication': '配偶宮被強力半合帶動，感情有重大進展機會',
        'datingImplication': '配偶宮半合活躍，關係明顯升溫，適合深化關係',
        'marriedImplication': '配偶宮半合帶來活力，家庭氛圍和諧喜慶',
    },
    '墓合': {
        'signal': '夫妻宮半合',
        'singleImplication': '配偶宮半合帶來穩定能量，感情緣分在醞釀中',
        'datingImplication': '配偶宮半合帶來穩定感，關係走向長期化',
        'marriedImplication': '配偶宮半合穩固，婚姻關係穩定和諧',
    },
    '缺旺': {
        'signal': '夫妻宮微合',
        'singleImplication': '配偶宮有微弱合動，感情有輕微進展但需主動把握',
        'datingImplication': '配偶宮微合，關係有小幅改善但不宜過度期待',
        'marriedImplication': '配偶宮微合，婚姻平穩中帶有小確幸',
    },
}

# In the signal detection:
if _is_liuhe(current_year_branch, day_branch):
    signals.append({
        'signal': '夫妻宮受合',
        'type': '六合',
        'singleImplication': '...',
        'datingImplication': '...',
        'marriedImplication': '...',
    })
else:
    half_type = SANHE_HALF.get((current_year_branch, day_branch))
    if half_type:
        msg = SANHE_HALF_MESSAGES[half_type]
        signals.append({**msg, 'type': f'半合({half_type})'})

if _is_liuchong(current_year_branch, day_branch):
    signals.append({...})
```

### Verification
2026寅 + Laopo戌 → (寅,戌) is in SANHE_HALF_PAIRS (火局) → ✅ Signal detected

### Files Changed
- `compatibility_romance_preanalysis.py`: Add `SANHE_HALF_PAIRS` constant + `_is_sanhe_half()` + signal detection (~20 lines)

---

## 3. 老師寄語 + Educational Framing (Done Better Than Seer)

### Seer's Approach
Seer adds a "老師寄語" paragraph before each major section — generic, template-like text that frames expectations. E.g.:
- "傳統八字合婚，不是單獨參考生肖合沖..."
- "婚前戀愛態度，不決定婚後夫妻態度..."
- "從八字性格分析看自己和伴侶旺夫旺妻的情況..."

### Our Better Approach: "命理師提醒" — Context-Aware Framing

Instead of generic templates, our framing should be **data-driven** and specific to the couple's chart. This is a deterministic UI element (not AI-generated) rendered BEFORE the AI section content.

**Implementation**: Add a `masterNote` field to each section in the romancePreAnalysis. This is a 1-2 sentence deterministic framing based on the pre-analysis data.

Examples:

```typescript
// chart_profile section:
masterNote: "以下分析基於雙方八字命盤的核心結構，幫助你了解彼此的本質特質。"

// spouse_enrichment section (data-driven):
masterNote: score >= 60
  ? "旺夫/旺妻不代表讓對方發大財，而是在婚姻中能給對方帶來正面能量和支持。你們的互旺程度良好。"
  : "旺夫/旺妻程度一般不代表婚姻不好，很多幸福婚姻的夫妻互旺程度也不高。重要的是雙方的經營和包容。"

// combined_crisis (data-driven):
masterNote: destructiveLevel === '輕微'
  ? "合婚危機分析是幫助你們提前了解潛在挑戰，以便更好地預防和化解。你們的危機等級較低，不必過度擔心。"
  : "以下分析指出需要注意的地方，但命理只是參考，夫妻感情的好壞更多取決於雙方的經營態度。"
```

### 克夫克妻 Educational Section

We already have `KeFuKeQiEducation` component (rendered after `love_personality_b`). Enhance it:

Currently it's a static card. Make it **data-aware**:
- If either person's enrichment score < 30, show reassuring message
- If 合化 involves 忌神, explain what this means in modern terms
- Add "命理師小課堂" badge design

### Implementation Location: Frontend (TypeScript)
Per staff review, the opening narrative (Proposal A) and closing card (Proposal C) need the post-recalibration score, which is only available after `calculator.py` finishes. So ALL UX proposals (masterNote, opening narrative, closing card, low-score reassurance) are computed in the **frontend** where both `compatibilityPreAnalysis.adjustedScore` and `romancePreAnalysis` are available.

### Files Changed
- `apps/web/app/reading/compatibility/page.tsx`: Add opening narrative (Proposal A), closing card (Proposal C), low-score reassurance (Proposal D), and `masterNote` per section — all as deterministic TypeScript template interpolation
- `apps/web/app/reading/compatibility/page.module.css`: Add styling for narrative card, closing card, reassurance banner, masterNote tip box

---

## 4. 桃花/姻緣星 Count Display

### Seer's Display
```
桃花 2朵    桃花 0朵
姻緣星 3顆  姻緣星 2顆
```

### Our Better Approach
Show these as visual badges in the **top BaziChart section** (pre-paywall), making them shareable teasers.

### Calculation
**桃花 count**: Count how many natal branches match the peach blossom target(s).
```python
def count_peach_blossoms(chart):
    branches = [chart['fourPillars'][p]['branch'] for p in ['year','month','day','hour']]
    taohua_targets = set()
    for b in [chart['fourPillars']['year']['branch'], chart['fourPillars']['day']['branch']]:
        target = TAOHUA.get(b)
        if target:
            taohua_targets.add(target)
    count = sum(1 for b in branches if b in taohua_targets)
    return count
```

**姻緣星 count**: Count spouse star appearances in stems + hidden stems.
```python
def count_spouse_stars(chart, gender):
    spouse_star = '正財' if gender == 'male' else '正官'
    dm = chart['dayMasterStem']
    count = 0
    # Count in stems
    for p in ['year','month','day','hour']:
        stem = chart['fourPillars'][p]['stem']
        if derive_ten_god(dm, stem) == spouse_star:
            count += 1
    # Count in hidden stems (day branch = spouse palace)
    day_hidden = HIDDEN_STEMS.get(chart['fourPillars']['day']['branch'], [])
    for hs in day_hidden:
        if derive_ten_god(dm, hs) == spouse_star:
            count += 1
    return count
```

### Verification (Roger)
Roger's pillars: 丁卯 戊申 戊午 庚申, DM=戊
- 桃花: TAOHUA['午']=卯, TAOHUA['卯']=子. Roger has 卯 in year branch → 1 peach blossom. Roger has 午 in day branch, target is 卯 which he has → another count? No, we count how many BRANCHES match targets. Branches: 卯申午申. Targets: {卯, 子}. 卯 matches → **1朵** (but Seer says 2). Let me re-examine...

Seer says Roger has 2朵桃花. The difference might be that Seer counts ALL four pillar branches as sources for taohua lookup, not just year+day. Or counts from both year AND day branches separately. Need to check Seer's methodology.

Actually, the standard TAOHUA lookup table uses year branch OR day branch:
- Roger year=卯: TAOHUA[卯]=子 → check if 子 in {卯,申,午,申} → NO
- Roger day=午: TAOHUA[午]=卯 → check if 卯 in {卯,申,午,申} → YES, 卯 is year branch → 1朵

Seer gets 2 — they may count the peach blossom star itself AND the branch that triggers it. Or they may use a different lookup table. This needs research but is not blocking.

### UI Display
Add to `BaziChart.tsx` or compatibility page top section:
```tsx
<div className={styles.peachBlossomBadge}>
  🌸 桃花 {count}朵
</div>
<div className={styles.spouseStarBadge}>
  💫 姻緣星 {count}顆
</div>
```

Style as pill badges with warm pink/gold backgrounds.

### Files Changed
- `compatibility_romance_preanalysis.py`: Add `count_peach_blossoms()` and `count_spouse_stars()`, include in orchestrator output (~25 lines)
- `apps/web/app/reading/compatibility/page.tsx`: Display badges in top chart section
- `apps/web/app/reading/compatibility/page.module.css`: Badge styling

---

## 5. Consultation-Style Presentation (Brainstorm)

### Current UX Problem
Our presentation feels like a **report card** (scores + sections + bullets). Seer feels like a **consultation** (teacher voice + narrative flow + emotional framing).

### Proposals to Discuss

**Proposal A: "命理師導覽" Flow**
Add a narrative opening after the score display, before the first AI section. This is a deterministic summary that reads like a master's opening remarks:

```
"根據雙方命盤分析，你們是一對「前期磨合、後期甜蜜」的組合。
配對指數雖然 59 分（需要經營），但婚後甜蜜度高達 95 分、
穩定度 100 分滿分。這說明只要撐過交往初期的磨合，
你們的婚姻品質會是令人羨慕的。"
```

This is NOT AI-generated — it's a template that interpolates the actual scores.

**Proposal B: Section Transition Sentences**
Between each group (命局→旺夫旺妻→財富→甜蜜→危機→建議), add a 1-sentence transition:

```
"了解了雙方的基本命局特質後，接下來看看你們在婚姻中能給對方帶來什麼..."
"甜蜜度和穩定度分析完畢，接下來看看需要注意的風險因素..."
```

**Proposal C: "最終寄語" Closing Card**
After the summary, add a beautifully designed closing card with:
- A warm, encouraging quote (deterministic, based on overall assessment)
- The couple's "relationship archetype" label (e.g., "前期磨合、後期甜蜜型")
- A shareable visual (future: image export)

**Proposal D: Warm Framing for Low Scores**
If overall score < 55, add a special reassurance card:
```
"配對指數不代表婚姻好壞。很多幸福的夫妻配對指數並不高，
但他們用理解和包容經營出了令人羨慕的婚姻。
以下分析的目的是幫助你們了解需要注意的地方，
而不是判定你們是否適合在一起。"
```

### Confirmed: Implement A + C + D (skip B transitions)

**Proposal A**: "命理師導覽" opening narrative — deterministic template with score interpolation
**Proposal C**: "命理師最終寄語" closing card — relationship archetype + scores + warm message
**Proposal D**: Low-score reassurance banner — shows only when overall < 55

---

## Implementation Order

| Step | Item | Files | Lines |
|------|------|-------|-------|
| 1 | Score recalibration (60/40 blend + guardrails) | `calculator.py` + `compatibility_romance_preanalysis.py` + `compatibility_constants.py` | ~40 lines |
| 2 | 夫妻宮半合 detection (3 strength levels) | `compatibility_romance_preanalysis.py` | ~45 lines |
| 3 | 桃花/姻緣星 count computation | `compatibility_romance_preanalysis.py` | ~30 lines |
| 4 | Frontend UX: opening narrative (A) + closing card (C) + low-score reassurance (D) + masterNote per section | `page.tsx` + `page.module.css` | ~120 lines |
| 5 | Frontend: 桃花/姻緣星 badge display | `page.tsx` + `page.module.css` | ~20 lines |

**Total**: ~255 lines across 5 files
**No prompt changes needed** (all deterministic)
**Romance-specific label override**: Add `COMPATIBILITY_LABELS_ROMANCE` to constants (don't change shared labels)
