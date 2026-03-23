# Implementation Plan: Remaining Accuracy Fixes (Score 92→96+)

## Context
Post-fix review scored 92/100. Two remaining issues:
1. Fabricated LP branch "己丑" (should be "己亥") in marriage_wealth_b
2. "缺少水" soft claims in 2 sections, not backed by pre-analysis

---

## Issue 1: Fabricated LP Branch

### Problem
AI says Laopo's 16-25歲 LP is "己丑" but actual data is "己亥". The LP stem (己) is correct but the branch (丑) was hallucinated. The AI likely confused the natal month branch (丑) with the LP branch (亥).

### Root Cause
The marriage_wealth pre-analysis data stores LP findings as:
```python
{'type': '天干伏吟', 'period': '10-19歲', 'detail': '大運丁與命局正印重複...'}
```
Note: only the **stem** is mentioned in the `detail` text. The full GanZhi (stem+branch) is NOT in the pre-analysis findings. The AI sees the stem "己" and guesses the branch from the natal chart.

However, the full LP data WITH branches IS available in `chart['luckPeriods']` — it's just not included in the marriage_wealth pre-analysis output.

### Fix Approach
Include the full LP GanZhi in each marriage_wealth finding so the AI doesn't need to guess:

**File**: `packages/bazi-engine/app/compatibility_romance_preanalysis.py` — `compute_marriage_wealth_analysis()`

**Change**: When creating pre/post-marriage findings, add `lpGanZhi` field:

```python
# In the LP iteration loop (~line 860-920), when appending findings:
finding = {
    'type': '天干伏吟',
    'period': f'{start_age}-{end_age}歲',
    'detail': f'大運{lp_stem}與命局正印重複...',
    'lpGanZhi': f'{lp_stem}{lp_branch}',  # ADD THIS — e.g., "己亥"
}
```

This means the AI prompt will contain:
```json
{"type": "天干伏吟", "period": "16-25歲", "detail": "...", "lpGanZhi": "己亥"}
```

The AI can now narrate "16-25歲大運己亥" correctly without guessing.

**Specific locations to add `lpGanZhi`**: Every `append` to `pre_findings` and `post_findings` inside the LP iteration loop. The LP branch is available as `lp.get('branch', '')`. Add to every finding dict:
```python
'lpGanZhi': f"{lp.get('stem', '')}{lp.get('branch', '')}",
```

**Also add anti-hallucination anchor**: In `prompts.ts`, add to the marriage_wealth writing rules:
```
- 大運名稱必須使用預分析中的 lpGanZhi 欄位值（如「己亥」），禁止自行推算大運地支
```

---

## Issue 2: "缺少水" Soft Claims

### Problem
AI sees Roger's five-element raw counts "3金1木0水2火2土" and infers "缺少水的靈活變通". But:
- Roger's chart actually has water at 9.1% (from hidden stems in 申 branches)
- The raw counts only show stems+branches (0水), but hidden stems contain water
- The pre-analysis never explicitly says "缺水"
- The AI is making its own five-element inference, violating Rule 16

### Why "prohibit 缺少X phrasing" is wrong
Simply banning the phrase is too crude because:
- Sometimes an element IS genuinely absent (0% across all calculations)
- A real Bazi master would note genuine deficiencies
- The issue isn't the phrasing — it's that the AI is inferring deficiency from incomplete data

### Root Cause
The AI receives raw element counts like "3金1木0水2火2土" which shows stems+branches only. This makes water look absent (0). But the actual full five-element distribution (including hidden stems) shows water at 9.1%. The AI is making a judgment based on incomplete data.

### Correct Fix: Provide a deterministic "五行評估" anchor

Instead of letting the AI judge element sufficiency from raw counts, provide an explicit evaluation in the pre-analysis that the AI must narrate from.

**File**: `packages/bazi-engine/app/compatibility_romance_preanalysis.py` — `compute_individual_love_personality()`

**Add** a `fiveElementAssessment` field to the output:

```python
def _build_five_element_assessment(chart: Dict) -> Dict:
    """Build explicit five-element assessment with deficiency analysis.
    Uses FULL element distribution (including hidden stems) for accuracy."""
    # Get the comprehensive seasonal five-element balance (Chinese keys, includes seasonal weighting)
    # NOTE: Must use 'fiveElementsBalanceZh' (Chinese keys: 木/火/土/金/水)
    #        NOT 'fiveElementsBalance' (English keys: wood/fire/earth/metal/water)
    balance = chart.get('fiveElementsBalanceZh', {})
    # Also get raw counts for cross-reference
    elem_counts = chart.get('elementCounts', {})
    total = elem_counts.get('total', {})

    assessment = {}
    for element in ['木', '火', '土', '金', '水']:
        pct = balance.get(element, 0)  # Full percentage including hidden stems
        raw = total.get(element, 0)     # Raw count (stems + branches + hidden)

        if pct == 0 and raw == 0:
            status = '完全缺失'
        elif pct < 5:
            status = '極少'
        elif pct < 15:
            status = '偏少'
        elif pct < 30:
            status = '適中'
        elif pct < 45:
            status = '偏多'
        else:
            status = '極多'

        assessment[element] = {
            'percentage': round(pct, 1),
            'status': status,
        }

    return assessment
```

Add to `compute_individual_love_personality()` return value:
```python
result['fiveElementAssessment'] = _build_five_element_assessment(chart)
```

This gives the AI an **explicit, authoritative** assessment like:
```json
{
  "木": {"percentage": 12.5, "status": "偏少"},
  "火": {"percentage": 25.3, "status": "適中"},
  "土": {"percentage": 30.1, "status": "偏多"},
  "金": {"percentage": 23.0, "status": "適中"},
  "水": {"percentage": 9.1, "status": "偏少"}
}
```

Now water shows as "偏少" (9.1%), NOT "缺失". The AI must use this assessment instead of inferring from raw counts.

### Update anti-hallucination rule 16

**File**: `apps/api/src/ai/prompts.ts`

Change Rule 16 from:
```
16. 禁止自行推導五行缺失（如「缺水」「缺金」），除非預分析數據中明確標記
```
To:
```
16. 五行評估必須嚴格引用預分析中的 fiveElementAssessment 欄位。只有 status 為「完全缺失」的元素才可描述為「缺X」，status 為「偏少」只可描述為「X偏少」或「X較弱」，禁止誇大為「缺X」
```

This is precise and principled — not a blanket ban, but a rule that ties the AI's language to the deterministic assessment.

---

## Implementation Order

1. **Issue 1**: Add `lpGanZhi` field to marriage_wealth LP findings (Python)
2. **Issue 2**: Add `_build_five_element_assessment()` helper and wire into love_personality output (Python)
3. **Prompts**: Update Rule 16 + add marriage_wealth LP anchor rule (NestJS prompts.ts)
4. **Rebuild + Test**

## Testing

1. Run Python tests
2. Rebuild NestJS
3. Submit new test
4. Verify:
   - marriage_wealth_b says "己亥" (not "己丑")
   - No "缺少水" — should say "水偏少" or omit entirely
   - fiveElementAssessment in pre-analysis output matches expected values
