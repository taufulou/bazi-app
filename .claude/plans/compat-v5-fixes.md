# Compatibility V5 Fixes — Harmful Element Advice + Summary LP Characterization (Rev 2)

## Problem Statement

Two remaining AI accuracy issues from v4 review (91/100):

### Issue 1 (MEDIUM): spouse_enrichment_a gives harmful five-element advice
- AI says "多補充命局缺失的元素（水和木）"
- Roger's 忌神=木, 仇神=水 — supplementing these is HARMFUL
- Root cause: `fiveElementAssessmentA` has `status` (偏少/適中/偏多) + `percentage` but NO god role info
- The AI sees `木: 偏少 7%` and naively says "supplement wood" without knowing 木 is the 忌神

### Issue 2 (LOW): Summary LP characterization misleading
- Summary says "男方在乙巳大運中...運勢穩健"
- marriage_wealth_a correctly says same LP is "忌仇神主導，運勢較差"
- Root cause: Summary (Call 3) doesn't receive LP element-role context

---

## Fix 1: Enrich fiveElementAssessment with god role (Python)

**File**: `packages/bazi-engine/app/compatibility_romance_preanalysis.py`

**What**: Modify `_build_five_element_assessment()` to accept optional `effective_gods` param and add `godRole` + `advice` fields.

**Key implementation details** (from staff review):
1. `effective_gods` dict stores elements as **flat strings** (e.g., `effective_gods.get('usefulGod')` returns `'木'`, NOT `{'element': '木'}`)
2. Use existing `_element_role()` helper at line 352, OR build the mapping manually with flat string access
3. Variables `effective_gods_a` and `effective_gods_b` are already in scope at lines 1846-1847 where `_build_five_element_assessment` is called at lines 1919-1920
4. NO new import needed — `_get_effective_gods()` is already local at line 173

**Modified function**:
```python
def _build_five_element_assessment(chart, effective_gods=None):
    """Build five element assessment with god role cross-reference."""
    # ... existing percentage + status calculation ...

    if effective_gods:
        # Map element → god role (effective_gods values are flat strings, NOT nested dicts)
        ELEMENT_GOD_ROLE = {}
        for role_key, role_label in [
            ('usefulGod', '用神'), ('favorableGod', '喜神'),
            ('tabooGod', '忌神'), ('enemyGod', '仇神'), ('idleGod', '閒神')
        ]:
            element = effective_gods.get(role_key, '')  # returns '木' directly
            if element:
                ELEMENT_GOD_ROLE[element] = role_label

        for element, info in result.items():
            god_role = ELEMENT_GOD_ROLE.get(element, '閒神')
            info['godRole'] = god_role
            # Key logic: determine if low status is good or bad
            if info['status'] == '偏少':
                if god_role in ('忌神', '仇神'):
                    info['advice'] = '偏少有利，無需補充'
                elif god_role in ('用神', '喜神'):
                    info['advice'] = '偏少不利，宜適當補充'
                else:
                    info['advice'] = '影響不大'
            elif info['status'] == '偏多':
                if god_role in ('忌神', '仇神'):
                    info['advice'] = '偏多不利，宜注意'
                elif god_role in ('用神', '喜神'):
                    info['advice'] = '偏多有利'
                else:
                    info['advice'] = '影響不大'
            elif info['status'] == '完全缺失':
                if god_role in ('忌神', '仇神'):
                    info['advice'] = '缺失有利'
                else:
                    info['advice'] = '缺失需注意'
            else:  # 適中
                info['advice'] = '適中均衡'
    else:
        # Guard: if no effective_gods, log warning and add safe defaults
        import logging
        logging.warning("_build_five_element_assessment called without effective_gods — godRole annotations will be missing")

    return result
```

**Call sites to update** (2 locations):

1. **Line ~1919-1920** (top-level orchestrator return dict):
```python
'fiveElementAssessmentA': _build_five_element_assessment(chart_a, effective_gods_a),
'fiveElementAssessmentB': _build_five_element_assessment(chart_b, effective_gods_b),
```

2. **Line ~547** (inside `compute_individual_love_personality`):
```python
# effective_gods is already computed at line 381 in this function
'fiveElementAssessment': _build_five_element_assessment(chart, effective_gods),
```

---

## Fix 2: Compute LP elementRole in Python (not TypeScript)

**File**: `packages/bazi-engine/app/compatibility_romance_preanalysis.py`

**Why Python not TypeScript**: Staff review Issue 7 — checking only LP stem ignores the branch. The Python engine already has the ten-god/element-role machinery. Computing in Python is more robust.

**What**: In `_extract_current_lp()` (or where `currentLuckPeriodA/B` is built), add `elementRole` field:

```python
def _extract_current_lp(chart, effective_gods):
    """Extract current luck period with element role assessment."""
    # ... existing extraction logic ...

    if current_lp:
        gan_zhi = current_lp.get('ganZhi', '')
        if len(gan_zhi) >= 1:
            stem = gan_zhi[0]
            stem_element = STEM_ELEMENT.get(stem, '')
            useful = effective_gods.get('usefulGod', '')
            favorable = effective_gods.get('favorableGod', '')
            taboo = effective_gods.get('tabooGod', '')
            enemy = effective_gods.get('enemyGod', '')

            if stem_element == taboo or stem_element == enemy:
                current_lp['elementRole'] = '忌仇神主導，大運整體偏弱'
            elif stem_element == useful or stem_element == favorable:
                current_lp['elementRole'] = '喜用神主導，大運整體有利'
            else:
                current_lp['elementRole'] = '大運整體中性'

    return current_lp
```

**Note**: Also check branch as secondary signal. If stem is neutral but branch is taboo, add "(地支偏弱)" qualifier.

---

## Fix 3: Add anti-hallucination rules (NestJS prompts)

**File**: `apps/api/src/ai/prompts.ts`

**New rule 23** (in `COMPAT_ROMANCE_V2_STYLE_RULES`):
```
23. ⚠️ 五行補充建議的「默認拒絕」原則：禁止建議「補充」「加強」「增加」「彌補」任何五行元素，除非該元素的 advice 欄位明確包含「宜適當補充」。
    - 忌神/仇神的元素「偏少」是有利的，代表命局自然壓制不良能量
    - 只有 godRole 為用神/喜神且 advice 為「偏少不利，宜適當補充」的元素才可建議補充
    - 若 fiveElementAssessment 中沒有 godRole 欄位，則禁止給出任何五行補充建議
```

**Update FORBIDDEN list** — add:
```
- 禁止建議「補充」「加強」「增加」「彌補」任何五行元素，除非預分析的 advice 欄位明確寫「宜適當補充」（默認拒絕原則）
```

**New summary LP rule** (add to Call 3 section or general rules):
```
24. summary 提及當前大運時，必須引用 currentLuckPeriod 中的 elementRole 欄位（如「忌仇神主導，大運整體偏弱」），不可自行推斷大運好壞。流年好壞≠大運好壞：即使流年訊號良好，若大運為忌仇神主導仍應如實描述「大運整體偏弱，但今年流年訊號良好」
```

---

## Fix 4: Pass preAnalysis to contextBridge2 builder (NestJS)

**File**: `apps/api/src/ai/ai.service.ts`

**What**: `buildCompatV2ContextBridge2()` currently only receives `romancePA`. It needs `yongshenAnalysis` from `preAnalysis` to enrich LP lines with element-role context.

**BUT**: Since we're now computing `elementRole` in Python (Fix 2), it's already in `romancePA.currentLuckPeriodA.elementRole`. So we DON'T need to pass `preAnalysis` separately. Just read the `elementRole` from the enriched currentLuckPeriod:

```typescript
if (clpA) {
  const elementRole = clpA['elementRole'] || '';
  lines.push(`男方當前大運${clpA['ganZhi']}（${clpA['period']}），${elementRole}。`);
}
```

This is simpler and avoids the cross-object dependency.

**Also for STEM_TO_ELEMENT**: Still add it in case other NestJS code needs it, but it's not needed for the LP enrichment anymore (done in Python).

---

## Implementation Order

| Step | File | Change | Lines |
|------|------|--------|-------|
| 1 | `compatibility_romance_preanalysis.py` | Add `effective_gods` param to `_build_five_element_assessment()` + god role mapping | ~30 lines |
| 2 | `compatibility_romance_preanalysis.py` | Update 2 call sites (orchestrator + love_personality) | ~4 lines |
| 3 | `compatibility_romance_preanalysis.py` | Add `elementRole` to `_extract_current_lp()` | ~15 lines |
| 4 | `prompts.ts` | Add rule 23 (default-deny) + rule 24 (summary LP) + FORBIDDEN entry | ~8 lines |
| 5 | `ai.service.ts` | Update `contextBridge2` LP lines to include `elementRole` | ~5 lines |
| 6 | `ai.service.ts` | Add `STEM_TO_ELEMENT` mapping (utility) | ~3 lines |
| 7 | Rebuild + test | NestJS build + verify | — |

**Total**: ~65 lines across 3 files

---

## Verification Criteria

After fixes:
1. `fiveElementAssessmentA.木` → `"godRole": "忌神", "advice": "偏少有利，無需補充"`
2. `fiveElementAssessmentA.水` → `"godRole": "仇神", "advice": "偏少有利，無需補充"`
3. `currentLuckPeriodA.elementRole` → `"忌仇神主導，大運整體偏弱"` (乙=木=忌神)
4. AI should NOT say "多補充水和木" — should acknowledge 偏少 is beneficial for these elements
5. Summary should NOT say "運勢穩健" for 乙巳 LP — should say "大運整體偏弱，但今年流年訊號良好"
6. `contextBridge2` includes LP element role assessment
7. If `effective_gods` is somehow empty, a warning is logged and the default-deny prompt rule prevents harmful advice
