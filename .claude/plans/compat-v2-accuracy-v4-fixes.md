# Implementation Plan: Accuracy v4 Fixes — Top-Level Propagation (Score 88→95+)

## Context
Review v3 scored 88/100. Four remaining issues all caused by incomplete data propagation. This plan fixes them AND adds top-level shared data to prevent future hallucinations across ALL sections.

## Staff Engineer Review Notes (addressed in this revision)
- ✅ #1: Use `endAge` from LP data instead of `startAge + 9`
- ✅ #3: Call 3 gets shared data via context bridge (sufficient — no separate placeholders needed)
- ✅ #5: Keep `fiveElementAssessment` in BOTH lovePersonality AND top-level (don't remove from lovePersonality, just add to top-level) to avoid breaking tests
- ✅ #6: Add fallback replacements in the `else` branch for all new placeholders
- ✅ #7: Guard `_build_five_element_assessment` against empty `fiveElementsBalanceZh`

## Design Principle
**Any data the AI might reference in ANY section must be available as an authoritative anchor.**
Instead of duplicating data inside each function's output, shared data goes to **top-level keys** in the `romancePreAnalysis` dict — accessible by all AI calls.

---

## Fix Overview

| # | Fix | Approach |
|---|-----|----------|
| V4-1 | fiveElementAssessment | Move to **top-level** (not per-function) |
| V4-2 | luckPeriodSummary | Add at **top-level** (not inside marriageWealth) |
| V4-3 | Summary 旺妻/旺夫 "0分" | Fix field name `score` → `totalScore` in NestJS |
| V4-4 | dayBranchHiddenStems | Keep inside `spouseEnrichment` (section-specific) |
| V4-5 | currentLuckPeriod | Add at **top-level** (new) |

---

## V4-1: Top-Level fiveElementAssessment

### Problem
`fiveElementAssessment` was added inside `lovePersonality` output only. Other sections (chart_profile, marriage_wealth, spouse_enrichment, marriage_advice) can't access it → AI infers "缺水" from raw counts.

### Fix
**File**: `packages/bazi-engine/app/compatibility_romance_preanalysis.py` — orchestrator `compute_compatibility_romance_preanalysis()`

Keep `fiveElementAssessment` in `compute_individual_love_personality()` return (to avoid breaking existing tests) AND ALSO add at top-level:

```python
# In the orchestrator, AFTER computing all functions, BEFORE return:
return {
    # ... existing 12 keys (lovePersonalityA, spouseEnrichmentA, etc.) ...

    # Top-level shared data (accessible by ALL AI calls)
    'fiveElementAssessmentA': _build_five_element_assessment(chart_a),
    'fiveElementAssessmentB': _build_five_element_assessment(chart_b),
}
```

Keep the existing `fiveElementAssessment` inside `compute_individual_love_personality()` return dict — it's harmless duplication and avoids breaking existing test assertions.

**Guard for missing data**: Update `_build_five_element_assessment()` to detect empty `fiveElementsBalanceZh` and return an empty dict instead of garbage "完全缺失" for all elements:
```python
def _build_five_element_assessment(chart: Dict) -> Dict[str, Dict]:
    balance = chart.get('fiveElementsBalanceZh', {})
    if not balance:  # Guard: if no seasonal balance data, return empty
        return {}
    # ... rest of function
```

### NestJS Side
**File**: `apps/api/src/ai/ai.service.ts`

In the prompt interpolation for ALL 3 calls, inject the five-element assessment. Find where `romancePA` data is formatted into prompt templates. For each call, add:

```typescript
// Extract top-level five-element assessments
const feaA = romancePA['fiveElementAssessmentA'] as Record<string, unknown> | undefined;
const feaB = romancePA['fiveElementAssessmentB'] as Record<string, unknown> | undefined;

// Replace placeholders in all call templates
callTemplate = callTemplate.replace(/\{\{fiveElementAssessmentA\}\}/g,
  feaA ? JSON.stringify(feaA, null, 2) : '（資料未提供）');
callTemplate = callTemplate.replace(/\{\{fiveElementAssessmentB\}\}/g,
  feaB ? JSON.stringify(feaB, null, 2) : '（資料未提供）');
```

**IMPORTANT**: Also add the same replacements in the `else` branch (when romancePA is undefined) to clear placeholders:
```typescript
callTemplate = callTemplate.replace(/\{\{fiveElementAssessmentA\}\}/g, '（資料未提供）');
callTemplate = callTemplate.replace(/\{\{fiveElementAssessmentB\}\}/g, '（資料未提供）');
callTemplate = callTemplate.replace(/\{\{luckPeriodSummaryA\}\}/g, '（資料未提供）');
callTemplate = callTemplate.replace(/\{\{luckPeriodSummaryB\}\}/g, '（資料未提供）');
callTemplate = callTemplate.replace(/\{\{currentLuckPeriodA\}\}/g, '（資料未提供）');
callTemplate = callTemplate.replace(/\{\{currentLuckPeriodB\}\}/g, '（資料未提供）');
```

Add placeholder `{{fiveElementAssessmentA}}` and `{{fiveElementAssessmentB}}` to the Call 1 and Call 2 user prompt templates in `prompts.ts`, in a shared data section at the top of each call's data block:

```
【共用數據（所有 section 可引用）】
男方五行評估：{{fiveElementAssessmentA}}
女方五行評估：{{fiveElementAssessmentB}}
```

---

## V4-2: Top-Level luckPeriodSummary

### Problem
LP findings only appear when events exist (伏吟, clash, etc.). Periods with no events have no `lpGanZhi` → AI guesses wrong GanZhi (e.g., "丁酉" instead of "戊戌").

### Fix
**File**: `packages/bazi-engine/app/compatibility_romance_preanalysis.py` — orchestrator

Add at top-level in the return dict:

```python
# Build compact LP summaries for both parties
def _build_lp_summary(luck_periods: List[Dict]) -> List[Dict]:
    return [
        {
            'period': f"{lp.get('startAge', 0)}-{lp.get('endAge', lp.get('startAge', 0) + 9)}歲",
            'ganZhi': f"{lp.get('stem', '')}{lp.get('branch', '')}",
            'tenGod': lp.get('tenGod', ''),
            'isCurrent': lp.get('isCurrent', False),
        }
        for lp in luck_periods
    ]

# In the orchestrator return:
return {
    # ... existing keys ...
    'fiveElementAssessmentA': _build_five_element_assessment(chart_a),
    'fiveElementAssessmentB': _build_five_element_assessment(chart_b),
    'luckPeriodSummaryA': _build_lp_summary(luck_periods_a),
    'luckPeriodSummaryB': _build_lp_summary(luck_periods_b),
}
```

### NestJS Side
Same pattern as V4-1 — add placeholders to prompt templates:

```typescript
const lpsA = romancePA['luckPeriodSummaryA'];
const lpsB = romancePA['luckPeriodSummaryB'];
callTemplate = callTemplate.replace(/\{\{luckPeriodSummaryA\}\}/g,
  lpsA ? JSON.stringify(lpsA, null, 2) : '（資料未提供）');
callTemplate = callTemplate.replace(/\{\{luckPeriodSummaryB\}\}/g,
  lpsB ? JSON.stringify(lpsB, null, 2) : '（資料未提供）');
```

Add to Call 1 and Call 2 shared data section:
```
男方大運一覽：{{luckPeriodSummaryA}}
女方大運一覽：{{luckPeriodSummaryB}}
```

### Prompt Rule
**File**: `apps/api/src/ai/prompts.ts` — marriage_wealth writing rules + anti-hallucination

Update existing LP anchor rule:
```
- ⚠️ 所有大運名稱必須引用 luckPeriodSummary 中的 ganZhi 值，禁止自行推算大運地支
```

---

## V4-3: Fix enrichment score field name in context bridge

### Problem
`buildCompatV2ContextBridge()` (lines ~4788, ~4791) reads `seA['score']` but the Python return dict uses `'totalScore'`. Result: always falls back to `0`.

### Fix
**File**: `apps/api/src/ai/ai.service.ts` — `buildCompatV2ContextBridge()`, lines ~4788 and ~4791

```typescript
// Line ~4788 — change 'score' to 'totalScore':
lines.push(`旺妻程度${seA['level'] || '一般'}（${seA['totalScore'] || 0}分）。`);

// Line ~4791 — change 'score' to 'totalScore':
lines.push(`旺夫程度${seB['level'] || '一般'}（${seB['totalScore'] || 0}分）。`);
```

Do NOT add new lines — the enrichment section already exists.

---

## V4-4: Add dayBranchHiddenStems to spouseEnrichment

### Problem
AI sees 傷官 in 夫妻宮 but misattributes to wrong hidden stem (辛金=正官, not 傷官).

### Fix
**File**: `packages/bazi-engine/app/compatibility_romance_preanalysis.py` — `compute_spouse_enrichment()`

Add to the return dict (the imports `derive_ten_god`, `HIDDEN_STEMS`, `STEM_ELEMENT` are already available):

```python
# After computing dayBranchQuality, build hidden stem mapping:
day_branch = four_pillars.get('day', {}).get('branch', '')
hidden_stems_in_day = HIDDEN_STEMS.get(day_branch, [])
day_branch_ten_gods = []
for hs in hidden_stems_in_day:
    tg = derive_ten_god(dm_stem, hs)
    day_branch_ten_gods.append({
        'stem': hs,
        'tenGod': tg,
        'element': STEM_ELEMENT.get(hs, ''),
    })

# Add to return dict:
return {
    # ... existing keys ...
    'dayBranchHiddenStems': day_branch_ten_gods,
}
```

---

## V4-5: Top-Level currentLuckPeriod

### Problem
The AI sometimes references "current LP" incorrectly because no single authoritative source tells it which LP is current.

### Fix
**File**: `packages/bazi-engine/app/compatibility_romance_preanalysis.py` — orchestrator

```python
# Extract current LP for each person
def _extract_current_lp(luck_periods: List[Dict]) -> Optional[Dict]:
    for lp in luck_periods:
        if lp.get('isCurrent', False):
            return {
                'ganZhi': f"{lp.get('stem', '')}{lp.get('branch', '')}",
                'period': f"{lp.get('startAge', 0)}-{lp.get('endAge', lp.get('startAge', 0) + 9)}歲",
                'tenGod': lp.get('tenGod', ''),
                'startYear': lp.get('startYear', 0),
                'endYear': lp.get('endYear', 0),
            }
    return None

# In the orchestrator return:
return {
    # ... existing + V4-1 + V4-2 keys ...
    'currentLuckPeriodA': _extract_current_lp(luck_periods_a),
    'currentLuckPeriodB': _extract_current_lp(luck_periods_b),
}
```

### NestJS Side
Add to context bridge (`buildCompatV2ContextBridge()`):
```typescript
const clpA = romancePA['currentLuckPeriodA'] as Record<string, unknown> | undefined;
const clpB = romancePA['currentLuckPeriodB'] as Record<string, unknown> | undefined;
if (clpA) lines.push(`男方當前大運${clpA['ganZhi']}（${clpA['period']}）。`);
if (clpB) lines.push(`女方當前大運${clpB['ganZhi']}（${clpB['period']}）。`);
```

Add to shared data section in Call 1+2 prompt templates:
```
男方當前大運：{{currentLuckPeriodA}}
女方當前大運：{{currentLuckPeriodB}}
```

---

## Implementation Order

1. **V4-3**: Fix `score` → `totalScore` in NestJS context bridge (2 words)
2. **V4-4**: Add `dayBranchHiddenStems` to spouseEnrichment return (~8 lines Python)
3. **V4-1**: Move `fiveElementAssessment` to top-level in orchestrator (~3 lines Python)
4. **V4-2**: Add `luckPeriodSummary` to top-level in orchestrator (~10 lines Python)
5. **V4-5**: Add `currentLuckPeriod` to top-level in orchestrator (~12 lines Python)
6. **NestJS**: Add placeholders + interpolation for new top-level keys (~20 lines)
7. **Prompts**: Add shared data section + LP anchor rule (~10 lines)
8. **Rebuild + Test**

## Final Return Dict Structure

```python
{
    # Per-function outputs (existing)
    'lovePersonalityA': {...},
    'lovePersonalityB': {...},
    'spouseEnrichmentA': {..., 'dayBranchHiddenStems': [...]},  # V4-4
    'spouseEnrichmentB': {..., 'dayBranchHiddenStems': [...]},  # V4-4
    'marriageWealthA': {...},
    'marriageWealthB': {...},
    'postMarriageQuality': {...},
    'crisisRiskA': {...},
    'crisisRiskB': {...},
    'combinedCrisis': {...},
    'annualForecastA': {...},
    'annualForecastB': {...},

    # Top-level shared data (NEW — accessible by ALL AI calls)
    'fiveElementAssessmentA': {'木': {'percentage': 12.5, 'status': '偏少'}, ...},  # V4-1
    'fiveElementAssessmentB': {'木': {'percentage': 30.2, 'status': '偏多'}, ...},  # V4-1
    'luckPeriodSummaryA': [{'period': '6-15歲', 'ganZhi': '丁未', ...}, ...],       # V4-2
    'luckPeriodSummaryB': [{'period': '6-15歲', 'ganZhi': '庚子', ...}, ...],       # V4-2
    'currentLuckPeriodA': {'ganZhi': '乙巳', 'period': '30-39歲', ...},             # V4-5
    'currentLuckPeriodB': {'ganZhi': '戊戌', 'period': '26-35歲', ...},             # V4-5
}
```

## Testing

1. Run Python tests: `python -m pytest tests/test_compatibility_romance_preanalysis.py -v`
2. Rebuild NestJS: `nest build`
3. Submit new test
4. Verify:
   - ALL sections use "水偏少" (not "缺水") when referencing five elements
   - ALL LP references use correct GanZhi from summary
   - Summary says "旺妻40分" and "旺夫45分" (not "0分")
   - spouse_enrichment_b correctly says "丁火=傷官" (not "辛金=傷官")
   - Current LP correctly identified in all sections
