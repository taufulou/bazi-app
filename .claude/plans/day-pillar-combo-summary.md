# Day Pillar Combo Summary (日柱組合速覽)

## Goal
When user clicks the **日柱天干**, show a short "Day Pillar Combo" section (日柱組合) with:
- **Free tier**: Grade badge (上等/中等/下等) + teaser (~50 chars) + CTA
- **Paid tier**: Full summary (~150 chars) covering personality archetype + key traits
- Special label badges (六秀日, 八專日, 魁罡日, etc.) when applicable

The combo is determined by day stem + day branch (e.g., 戊午). Fully pre-computed, no AI, no chart dependency beyond identifying the day pillar pair.

## Key Files

### Create
1. `packages/bazi-engine/data/explanations/day_pillar_combos.json` — 60 entries
2. No new Python module needed — extends existing `explanations.py`

### Modify
3. `packages/bazi-engine/app/explanations.py` — load combos, return in response when stem+day
4. `packages/bazi-engine/app/main.py` — no change needed (four_pillars already passed)
5. `apps/web/app/lib/element-explanation-api.ts` — add `DayPillarComboData` type
6. `apps/web/app/components/ElementExplanation.tsx` — render combo section
7. `apps/web/app/components/ElementExplanation.module.css` — combo card styles
8. `packages/bazi-engine/tests/test_explanations.py` — add combo tests

## Data Structure

### `day_pillar_combos.json`
```json
{
  "甲子": {
    "grade": "上等",
    "gradeReason": "坐正印，天生帶貴人緣",
    "lifeStageSeat": "沐浴",
    "specialLabels": [],
    "teaser": "甲子日——甲木坐水，天生帶有學者氣質和貴人緣。",
    "summary": "甲子日生的人，像一棵生長在水邊的大樹——根基受到滋養，天生聰明、有學問、待人溫和。子水為正印，代表你天生有長輩緣和學習天賦，遇到困難時總有人願意幫助你。性格正直但偏保守，做事穩重但有時缺乏冒險精神。"
  }
}
```

Each entry:
- `grade`: "上等" | "中等" | "下等" (string, 3 values)
- `gradeReason`: 1 short sentence explaining why (string)
- `lifeStageSeat`: 十二長生位 name, e.g., "帝旺", "臨官", "沐浴" (string)
- `specialLabels`: Array of special day pillar category names. Can be empty. Values from: "六秀日", "八專日", "九醜日", "魁罡日", "陰陽差錯日", "十惡大敗日", "孤鸞煞", "金神日"
- `teaser`: ~40-60 chars, free tier display. Format: "{combo}——{1-sentence hook}" (string)
- `summary`: ~200-250 chars, paid tier display. Personality archetype + key traits + element-specific analogy (string)

**Total: 60 entries, ~20KB file**

## Step-by-Step Implementation

### Step 1: Write `day_pillar_combos.json` (sub-agent)
- 60 entries following the structure above
- Use classical sources (三命通會 grading, 十二長生 positions) for accuracy
- Mandatory samples for review:
  - 甲子 (上等, 坐正印)
  - 丙午 (上等, 六秀日, 坐帝旺)
  - 戊午 (中等, 六秀日, 坐帝旺)
  - 辛酉 (上等, 八專日+九醜日, 坐禄)
  - 庚辰 (上等, 魁罡日)
- Each teaser must be compelling enough to make free users want to upgrade
- Each summary uses element-specific analogy (like existing encyclopedia style)
- **Validation checklist** (sub-agent must verify before completing):
  1. All 60 甲子 combos present (甲子 through 癸亥)
  2. Grade distribution: ~21 上等, ~26 中等, ~13 下等 (±3 tolerance)
  3. Cross-reference grades with at least 2 sources (三命通會 + 華易網/cantian.ai)
  4. Special labels assigned using exact lookup tables defined in this plan
  5. No summary shorter than 150 chars or longer than 300 chars
  6. `lifeStageSeat` computed correctly per stem (use CHANGSHENG_BRANCH from constants.py)
  7. Label values use EXACTLY the strings in the special labels reference table (e.g., "六秀日" not "六秀")

### Step 2: Extend engine (`explanations.py`)
- Load `day_pillar_combos.json` at startup (add to `_load_templates()`)
- In `get_element_explanation()`: when `element_type == 'stem'` AND `pillar == 'day'`:
  - Extract day branch from `four_pillars['day']['branch']`
  - Construct combo key: `f"{value}{branch}"` (e.g., "戊午")
  - Look up combo in loaded templates
  - Add `dayPillarCombo` field to response dict

```python
# In get_element_explanation(), after building result dict:
if element_type == 'stem' and pillar == 'day' and four_pillars:
    branch = four_pillars.get('day', {}).get('branch', '')
    combo_key = f"{value}{branch}"
    combo_data = _DAY_PILLAR_COMBOS.get(combo_key)
    if combo_data:
        result["dayPillarCombo"] = combo_data
    else:
        logger.warning(f"Missing day pillar combo: {combo_key}")
```

- `_DAY_PILLAR_COMBOS` loaded from JSON at module import time (same pattern as other templates)
- No new endpoint needed — piggybacks on existing `/explain-element`

### Step 3: Update frontend types (`element-explanation-api.ts`)
```typescript
export interface DayPillarComboData {
  grade: string;           // "上等" | "中等" | "下等"
  gradeReason: string;     // Why this grade
  lifeStageSeat: string;   // 十二長生 position
  specialLabels: string[]; // ["六秀日", "八專日", ...]
  teaser: string;          // Free tier text
  summary: string;         // Paid tier text
}

// Add to ElementExplanationData:
export interface ElementExplanationData {
  // ...existing fields
  dayPillarCombo?: DayPillarComboData;
}
```

### Step 4: Update frontend rendering (`ElementExplanation.tsx`)

**Gating logic**: Engine always returns ALL combo data. Frontend gates: free users see only `teaser` + grade badge + CTA. Paid users see `summary` + grade + specialLabels + lifeStageSeat. Client-side gating is acceptable (matches existing encyclopedia pattern — all Layer B/C/D data is sent to free users too, frontend hides it).

**Free tier** (between Layer A keywords and the divider):
```
┌─────────────────────────────┐
│ 🏷️ 你的日柱：戊午日 [中等]   │
│ "戊午日——戊土坐帝旺..."      │
│ [🔓 解鎖日柱組合完整解讀]     │
└─────────────────────────────┘
```

**Paid tier** (new section after 宮位解讀, before 命盤互動):
```
┌─────────────────────────────┐
│ ▸ 日柱組合                   │
│ 戊午日 [中等] [六秀日]        │
│ 坐帝旺                       │
│ "戊午日生的人，像一座被烈日... │
│  照耀的高山..."               │
└─────────────────────────────┘
```

**Condition**: Only render when `data.dayPillarCombo` exists (only for day stem clicks).

### Step 5: CSS styles (`ElementExplanation.module.css`)
- `.comboCard` — Gold-bordered card, slightly different from interaction cards
- `.gradeBadge` — Color-coded: 上等=#2E7D32 (green), 中等=#D4A017 (gold), 下等=#8B7355 (muted)
- `.specialLabel` — Small pill badges. Colors by nature:
  - Auspicious (六秀日, 金神日): green tint
  - Cautionary (八專日, 九醜日, 孤鸞煞, 陰陽差錯日, 十惡大敗日): amber/red tint
  - Power (魁罡日): purple tint
- `.comboTeaser` — Free tier styled with blur overlay

### Step 6: Tests (`test_explanations.py`)
- `TestDayPillarCombos` class:
  - `test_all_60_combos_loaded`: Verify 60 entries exist
  - `test_combo_structure`: Each has grade/teaser/summary/specialLabels
  - `test_combo_returned_for_day_stem`: When stem+day+four_pillars → response has dayPillarCombo
  - `test_no_combo_for_non_day`: stem+month should NOT have dayPillarCombo
  - `test_no_combo_without_four_pillars`: Backward compat — no combo when four_pillars missing
  - `test_grade_values`: All grades are one of 上等/中等/下等
  - `test_special_labels_valid`: All labels from known set
  - `test_all_60_have_required_fields` (parameterized): Every entry has grade, teaser, summary, specialLabels, lifeStageSeat
  - `test_no_summary_too_short`: No summary under 150 chars

## Grade Distribution (from classical sources)

| Grade | Count | Basis |
|-------|-------|-------|
| 上等 | ~21 | Stem sits on favorable position (禄/帝旺/長生) or favorable ten god (正印/正財/食神) |
| 中等 | ~26 | Mixed — neither strongly favorable nor unfavorable |
| 下等 | ~13 | Stem sits on 死/墓/絕 or unfavorable ten gods (七殺/傷官 in branch) |

## Special Labels Reference

| Label | Day Pillars | Count |
|-------|------------|-------|
| 六秀日 | 丙午、丁未、戊子、戊午、己丑、己未 | 6 |
| 八專日 | 甲寅、乙卯、丁未、己未、庚申、辛酉、癸丑 | 7 |
| 九醜日 | 戊子、丁酉、丁卯、戊午、己酉、己卯、壬子、壬午、辛卯 | 9 |
| 魁罡日 | 庚戌、庚辰、壬辰、戊戌 | 4 |
| 陰陽差錯日 | 丙子、丙午、丁丑、丁未、戊申、戊寅、辛卯、辛酉、壬辰、壬戌、癸巳、癸亥 | 12 |
| 十惡大敗日 | 甲辰、乙巳、丙申、丁亥、戊戌、己丑、庚辰、辛亥、壬申、癸亥 | 10 |
| 孤鸞煞 | 乙巳、丁巳、辛亥、戊申、甲寅、丙午、戊午、壬子 | 8 |
| 金神日 | 乙丑、己巳、癸酉 | 3 |

## Edge Cases
1. **Day pillar not in NAYIN**: Impossible — all 60 甲子 are defined in `constants.py`
2. **No four_pillars passed**: Skip combo lookup, return standard stem response (backward compat)
3. **Grade disputes**: Some sources disagree on grading. We follow mainstream 三命通會 classification.
4. **Multiple special labels**: Some combos have 2-3 labels (e.g., 辛酉 = 八專日 + 九醜日). Show all as badges.

## Future Notes (八字終身運 full section — NOT for now)
- Expand each combo with `fullReading` object: personality (200), marriage (200), career (200), health (100)
- Display as a dedicated card section in the main reading page
- Could include 三命通會 classical excerpt
- Could cross-reference with 身強/身弱 for enhanced personalization
