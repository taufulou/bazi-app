# Implementation Plan: Compatibility V2 AI Accuracy Fixes (Rev 2)

## Context
AI interpretation review scored 88/100. One critical error (合化 victim misattribution), one engine bug (strength label), and gaps in anti-hallucination rules compared to Love V2 and Career V2.

## Staff Engineer Review — Issues Addressed in Rev 2
- ✅ Issue 1: Merged F3+F5 into single block (no duplication)
- ✅ Issue 2: F1+F4 now target correct code path (`generateCompatibilityReadingV2()` line 4580, not `interpolateCompatPreAnalysisForV2()`)
- ✅ Issue 3: Python source fix for "甲方"/"乙方" AND "A方"/"B方" at source level
- ✅ Issue 4: Affected-party detection handles dual-taboo edge case
- ✅ Issue 5: Fixed enum values — `very_weak`/`very_strong`/`neutral` (matching engine output)
- ✅ Issue 6: Fixed `balanced` → `neutral` in ALL maps

## Fixes Overview

| # | Fix | Priority | Files |
|---|-----|----------|-------|
| F1 | Fix 合化 victim attribution — Python source + NestJS interpolation | CRITICAL | `compatibility_romance_preanalysis.py`, `ai.service.ts` |
| F2 | Fix enum mismatch in strength maps (`extremely_weak` → `very_weak`, `balanced` → `neutral`) | HIGH | `compatibility_romance_preanalysis.py` |
| F3 | Strengthen anti-hallucination rules (merged with FORBIDDEN list) | HIGH | `prompts.ts` |
| F4 | Add ten-god translation authority to interpolation | MEDIUM | `ai.service.ts` |

---

## F1: Fix 合化 Victim Attribution (CRITICAL)

### Problem
The `combined_crisis_analysis` section has warningFlags like:
```json
{"flag": "合化忌神", "desc": "丁壬合化木（甲方忌神）", "severity": "warning"}
```
"甲方" is ambiguous. The AI misinterprets it as 女方 (because Laopo's DM is 甲木). Also, noteFlags use "A方"/"B方" format which is equally ambiguous.

### Root Cause
Python source generates "甲方"/"乙方" and "A方"/"B方" labels. NestJS passes raw `JSON.stringify(combinedCrisis)` into the prompt at line ~4580 without any resolution.

### Fix Part A — Python Source (`compatibility_romance_preanalysis.py`)

In `compute_combined_crisis_assessment()`, find ALL places where "甲方"/"乙方" or "A方"/"B方" are used in flag descriptions and replace with "男方"/"女方":

```python
# Line ~1515 (warningFlags for 合化忌神):
# Before: f'{sa}{partner}合（{combo_name}）化{result_element}（{"甲方" if result_element == taboo_a else "乙方"}忌神）'
# After:  f'{sa}{partner}合（{combo_name}）化{result_element}（{"男方" if result_element == taboo_a else "女方"}忌神）'

# Handle dual-taboo case: if result_element is taboo for BOTH parties
if result_element == taboo_a and result_element == taboo_b:
    who = "雙方"
elif result_element == taboo_a:
    who = "男方"
elif result_element == taboo_b:
    who = "女方"
else:
    who = ""  # not a taboo for either

# Line ~1538, 1545 (noteFlags for branch clashes):
# Before: f'A方{pos_names_zh[i]}支{br}沖B方日支{day_br_b}'
# After:  f'男方{pos_names_zh[i]}支{br}沖女方日支{day_br_b}'
```

Search ALL occurrences of "甲方", "乙方", "A方", "B方" in the function and replace.

### Fix Part B — NestJS Pre-processing (`ai.service.ts`)

**Target**: `_executeStreamCompatRomanceV2()` (or `generateCompatibilityRomanceV2()`) at the point where `romancePA['combinedCrisis']` is serialized (~line 4580).

**NOT** in `interpolateCompatPreAnalysisForV2()` — that function handles different data.

```typescript
// Before (line ~4580):
const combinedCrisisStr = JSON.stringify(romancePA['combinedCrisis'] || {}, null, 2);

// After: Pre-process to add explicit affected-party annotations
const combinedCrisis = romancePA['combinedCrisis'] as Record<string, unknown> || {};
const processedCrisis = this.annotateCombinedCrisisFlags(combinedCrisis);
const combinedCrisisStr = JSON.stringify(processedCrisis, null, 2);
```

Add helper method:
```typescript
private annotateCombinedCrisisFlags(crisis: Record<string, unknown>): Record<string, unknown> {
  const result = { ...crisis };
  // Add ⚠️ direction annotation to each warningFlag
  const wFlags = (crisis['warningFlags'] as any[]) || [];
  result['warningFlags'] = wFlags.map(f => ({
    ...f,
    desc: (f.desc || '').replace(/甲方/g, '男方').replace(/乙方/g, '女方'),
    // Belt-and-suspenders: also add explicit annotation
    affectedPartyNote: f.desc?.includes('男方忌神') ? '⚠️受影響方：男方'
      : f.desc?.includes('女方忌神') ? '⚠️受影響方：女方'
      : f.desc?.includes('雙方忌神') ? '⚠️受影響方：雙方'
      : undefined,
  }));
  // Same for noteFlags
  const nFlags = (crisis['noteFlags'] as any[]) || [];
  result['noteFlags'] = nFlags.map(f => ({
    ...f,
    desc: (f.desc || '').replace(/A方/g, '男方').replace(/B方/g, '女方')
      .replace(/甲方/g, '男方').replace(/乙方/g, '女方'),
  }));
  return result;
}
```

### Fix Part C — Prompt constraint

Add to `combined_crisis_analysis` section's user prompt template in `prompts.ts`:
```
⚠️ 關鍵約束：警告旗標中的「受影響方」（男方/女方）已明確標註，
你必須嚴格按照標註的方向描述影響。「男方忌神」≠「女方忌神」，絕對不可搞混。
```

---

## F2: Fix Enum Mismatch in Strength Maps (HIGH)

### Problem
The `_get_strength_v2()` helper returns classifications from `calculate_strength_score_v2()` which uses:
- `very_weak`, `weak`, `neutral`, `strong`, `very_strong`

But `cls_zh_map` at lines ~288 and ~477 uses:
- `extremely_weak`, `balanced`, `extremely_strong`

These don't match, so `very_weak` and `very_strong` fall through to the default `'中和'`.

### Fix Locations (2 maps in the same file)

**Location 1**: `_get_strength_label()` function (~line 288):
```python
# Before:
cls_zh_map = {
    'extremely_weak': '極弱', 'weak': '偏弱', 'balanced': '中和',
    'strong': '偏旺', 'extremely_strong': '極旺',
}
# After:
cls_zh_map = {
    'very_weak': '極弱', 'weak': '偏弱', 'neutral': '中和',
    'strong': '偏旺', 'very_strong': '極旺',
}
```

**Location 2**: `compute_individual_love_personality()` (~line 477):
```python
# Before:
cls_zh_map = {
    'extremely_weak': '極弱', 'weak': '偏弱', 'balanced': '中和',
    'strong': '偏旺', 'extremely_strong': '極旺',
}
# After:
cls_zh_map = {
    'very_weak': '極弱', 'weak': '偏弱', 'neutral': '中和',
    'strong': '偏旺', 'very_strong': '極旺',
}
```

**Location 3**: `_get_strength_classification()` fallback default (~line 279):
```python
# Before: sv2.get('classification', 'balanced')
# After:  sv2.get('classification', 'neutral')
```

**Location 4**: `_get_strength_v2()` / `_get_strength_label()` fallback default (~line 285):
```python
# Before: sv2.get('classification', 'balanced')
# After:  sv2.get('classification', 'neutral')
```

**Location 5**: Same fallback in `compute_individual_love_personality()` (~line 476):
```python
# Before: sv2.get('classification', 'balanced')
# After:  sv2.get('classification', 'neutral')
```

**Location 6**: Same fallback in `compute_love_readiness_score()` (~line 720):
```python
# Before: sv2.get('classification', 'balanced')
# After:  sv2.get('classification', 'neutral')
```

**Location 7**: `compute_love_readiness_score()` scoring conditionals (~lines 721-727):
```python
# Before:
if cls in ('strong', 'extremely_strong'):
    dm_score = 20
elif cls == 'balanced':
    dm_score = 15
# ...
# elif cls == 'extremely_weak':

# After:
if cls in ('strong', 'very_strong'):
    dm_score = 20
elif cls == 'neutral':
    dm_score = 15
# ...
# elif cls == 'very_weak':
```

**Total: 7 locations** — 2 `cls_zh_map` dicts + 4 `.get()` defaults + 1 scoring conditional block.

### Verification
After fix:
- Roger (classification=`weak`, score=39) → "偏弱（39分），包容型"
- Laopo (classification=`very_weak`, score=20.6) → "極弱（20.6分），極度包容型"
- A `very_strong` DM gets 20 pts (not 15 via `balanced` fallthrough)
- A `neutral` DM gets 15 pts (not 5 via `else` fallthrough)

---

## F3: Strengthen Anti-Hallucination Rules + FORBIDDEN List (HIGH)

### Problem
Compatibility V2 has 14 rules. Love V2 has 30. Key gaps in translation authority, five-element inference, shensha whitelist, LP date fabrication, scenario completeness.

### Fix Location
`apps/api/src/ai/prompts.ts` — `COMPAT_ROMANCE_V2_ANTI_HALLUCINATION`

### Fix Approach
Add 8 new rules (15-22) **AND** append a FORBIDDEN section at the end of the same block (no separate constant — avoids duplication per staff engineer Issue 1):

```typescript
// Append after existing Rule 14:

'15. ⚠️ 十神翻譯權威規則：十神翻譯以錨點數據中「→」符號後的翻譯為唯一正確翻譯，不可自行翻譯或使用其他表述',
'16. 禁止自行推導五行缺失（如「缺水」「缺金」），除非預分析數據中明確標記。所有五行分析必須基於提供的五行比重數據',
'17. 只有預分析中明確列出的神煞名稱才可出現在分析中，此名單之外的神煞名稱禁止出現',
'18. 禁止自行推導跨盤五行生剋影響（如「男方的土生助女方的金」），除非預分析明確提供此分析。用神互補分析必須嚴格引用預分析數據',
'19. 禁止自行推算大運的西曆年份範圍，只可使用預分析提供的年齡區間（如「30-39歲」），不可轉換為具體年份',
'20. ⚠️ 流年感情運的每個訊號必須完整提供3種情境（單身/熱戀/已婚），缺一不可。不可合併或省略任何情境',
'21. 所有分數（甜蜜度、穩定度、旺夫/旺妻、婚變風險分數、配對指數）必須在正文中明確引用預分析的確切數字，不可模糊化',
'22. ⚠️ 天干合化的受影響方必須嚴格引用錨點標註的方向（男方/女方），絕對不可搞混。「男方忌神」和「女方忌神」是完全不同的概念',

// Then append FORBIDDEN section (same block, not separate constant):
`
【絕對禁止事項】
- 禁止推測具體結婚年份或離婚年份
- 禁止預測配偶的具體外貌、身高、體重
- 禁止使用未在預分析出現的神煞名稱
- 禁止自行推算大運的西曆年份（只用年齡區間）
- 禁止自行判斷五行缺失（如「你缺水」），除非預分析明確標記
- 禁止自行推導跨盤五行生剋影響，除非預分析提供
- 禁止使用「一定會」「必須」「絕對」等絕對性用語，改用「傾向」「建議」「可能」
- 禁止在感情運中合併或省略任何一種情境（單身/熱戀/已婚）
`
```

---

## F4: Add Ten-God Translation Authority to Interpolation (MEDIUM)

### Fix Location
`apps/api/src/ai/ai.service.ts` — in `interpolateCompatPreAnalysisForV2()` where cross ten gods are formatted.

### Fix Approach
When formatting cross ten gods:
```typescript
// Current:
ctLines.push(`男方在女方命盤中的角色：${aInB['tenGod']}（${aInB['meaning']}）`);
// Enhanced:
ctLines.push(`男方在女方命盤中的角色：${aInB['tenGod']}→${aInB['meaning']}（⚠️此翻譯為唯一正確翻譯）`);
```

Same for bInA.

---

## Implementation Order

1. **F2** — Fix Python enum maps (2 maps, same file)
2. **F1 Part A** — Fix Python "甲方"/"乙方"/"A方"/"B方" → "男方"/"女方" at source
3. **F1 Part B** — Add `annotateCombinedCrisisFlags()` helper in NestJS (belt-and-suspenders)
4. **F1 Part C + F3** — Update prompts.ts (combined_crisis constraint + rules 15-22 + FORBIDDEN)
5. **F4** — Update ten-god translation format in interpolation
6. **Verify** — Rebuild + test

## Testing

1. Run Python tests: `cd packages/bazi-engine && python -m pytest tests/ -v -k "romance_preanalysis"`
2. Rebuild NestJS: `cd apps/api && ../../node_modules/.bin/nest build`
3. Submit new test with Roger36 + Laopo16
4. Review all 17 sections for:
   - combined_crisis says "男方忌神" (not 女方/甲方)
   - love_personality_b says "極弱" (not 中和)
   - No five-element deficiency claims unless in pre-analysis
   - No fabricated LP Western calendar years
   - All scores cited as exact numbers
