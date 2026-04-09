# 透干/藏而不透 Interaction Card Refinement (Option A)

## Context

The 命盤互動 (interaction card) currently duplicates 宮位解讀 content. When user clicks a hidden stem, the interaction card appends the same Layer B pillar meaning that's already shown above in 宮位解讀. User feedback: feels redundant.

**Goal**: Replace duplicated content with NEW pillar-aware modifier text that explains HOW the 透干/藏而不透 state modifies the 宮位解讀 meaning. Also fix: Layer C still contains "如果X透出天干" conditional sentences that should be shortened.

## Review Round 1 — Issues Addressed

| # | Severity | Issue | Resolution |
|---|----------|-------|------------|
| 4 | Medium | 80 entries with no quality gate | Added programmatic validation test |
| 5 | Medium | Regex removal of Layer C is fragile | Changed to: shorten (not remove) — keep generic note, remove conditional detail |
| 6 | Medium | Fallback text underspecified | Defined explicit fallback: "此藏干的透干狀態會影響其在此宮位的表現力度。" |
| 7 | Medium | Verify `_HIDDEN_STEMS_TEMPLATES` not used elsewhere | Added grep verification step |
| 8 | Medium | No test for modifier content in API response | Added specific test assertions |
| 9 | **High** | Day pillar DM edge case | Day pillar modifiers reference self/inner nature instead of marriage. Content guideline updated. |
| 10 | **High** | Removing Layer C conditional text breaks non-interaction path | Changed approach: SHORTEN Layer C text (keep "透干與否會影響此力量的表現"), don't fully remove. Interaction card provides the detailed pillar-specific explanation. |

## What Changes

### 1. New JSON template file: `tougan_modifiers.json`
**Path**: `packages/bazi-engine/data/explanations/interactions/tougan_modifiers.json`

80 entries: 10 stems × 2 states (tougan/cang) × 4 pillars

Structure:
```json
{
  "甲": {
    "tougan": {
      "year": "由於甲木已透出天干，你家族那份正直剛毅的基因不是隱藏的...",
      "month": "...",
      "day": "由於甲木已透出天干，你內在那份剛正的核心特質充分展現...",
      "hour": "..."
    },
    "cang": {
      "year": "由於甲木藏而不透，這份家族中的正直特質比較內斂...",
      "month": "...",
      "day": "由於甲木藏而不透，你內在這份剛正特質只是潛藏的傾向...",
      "hour": "..."
    }
  }
}
```

**Day pillar special rule**: When the hidden stem appears in the day branch, the `day` modifier references self-identity/inner nature (NOT marriage), because the day branch is both 配偶宮 and the DM's seat. Content focuses on "你內在的核心特質" rather than "你的另一半".

### 2. Update `cross_pillar.py` — use modifier templates instead of Layer B
**Path**: `packages/bazi-engine/app/cross_pillar.py`

Changes:
- Load `tougan_modifiers.json` at module import time (via existing `_load_interaction_templates()`)
- In `_detect_tougan()`: replace `pillar_meaning = layer_b.get(pillar, '')` with `pillar_meaning = modifiers[value]["tougan"][pillar]`
- In 藏而不透 block: use `modifiers[value]["cang"][pillar]`
- Remove `_load_hidden_stems_templates()` and `_HIDDEN_STEMS_TEMPLATES` (verify no other callers via grep first)
- Explicit fallback: `"此藏干的透干狀態會影響其在此宮位的表現力度。"` + log.warning when triggered

### 3. SHORTEN (not remove) "如果X透出天干" from Layer C in `hidden_stems.json`
**Path**: `packages/bazi-engine/data/explanations/hidden_stems.json`

25 entries in Layer C contain long conditional "如果X透出天干，這種負面效果會更加明顯" sentences.

**New approach**: Replace each conditional sentence with a SHORT generic note:
- Before: `"如果乙木透出天干，這種負面效果會更加明顯。"`
- After: `"此藏干是否透出天干，會影響其實際作用的強弱。"`

This keeps the concept accessible to users who DON'T trigger interaction detection, while the interaction card provides the detailed pillar-specific explanation.

Pattern: Manual review of all 25 entries, replace conditional sentences with the standardized short note. NOT a blanket regex delete.

### 4. Tests

**Regression test** (`test_explanations.py`):
- No Layer C entry contains "如果" + "透出天干" (the old long conditional format)
- Every Layer C entry MAY contain "是否透出天干" (the new short note — optional)

**Modifier validation test** (`test_cross_pillar.py`):
- All 80 keys exist (10 stems × 2 states × 4 pillars)
- No entry is empty or shorter than 20 chars
- Pillar domain sanity: `year` entries contain "家族" or "成長" or "童年", `month` contains "事業" or "職場" or "工作", `day` contains "內在" or "核心" or "自我" (NOT "婚姻" — day pillar focuses on self), `hour` contains "子女" or "晚年"

**API response test** (`test_cross_pillar.py`):
- Stem X is tougan in year → interaction description contains modifier from `["X"]["tougan"]["year"]`
- Stem Y is cang in month → contains `["Y"]["cang"]["month"]`
- Missing stem fallback → returns generic fallback text

## Content Writing Strategy

Each modifier should answer: "因為透干/藏而不透，宮位解讀的效果會怎樣？"

**透干 modifiers** should convey:
- This energy is ACTIVE and fully expressed
- The pillar's life domain is clearly shaped by it
- It's visible to others, not just an internal tendency
- 1-2 sentences

**藏而不透 modifiers** should convey:
- This energy is LATENT — still present but subtle (~30-40% power)
- The pillar's life domain is influenced quietly, not obviously
- Others may not notice it; it takes time/events to surface
- Brief 大運/流年 activation mention
- 1-2 sentences

**Pillar domains** (strict mapping):
- 年 = 家族/成長環境/童年
- 月 = 事業/職場/社會舞台
- 日 = 自我/內在特質/核心性格 (NOT marriage — day branch is DM seat for hidden stems)
- 時 = 子女/晚年/後半生

**Tone**: Professional warm (專業溫暖型), 中學 level, direct address (你)

## Implementation Steps

### Step 1: Verify `_HIDDEN_STEMS_TEMPLATES` usage
Grep for all references. Confirm only used in `_detect_tougan` for Layer B text.

### Step 2: Write `tougan_modifiers.json` (80 entries)
Sub-agent writes all entries following content strategy above.

### Step 3: Shorten Layer C conditional sentences
Manual review + replacement of 25 entries in `hidden_stems.json`. Replace each "如果X透出天干..." long sentence with "此藏干是否透出天干，會影響其實際作用的強弱。"

### Step 4: Update `cross_pillar.py`
- Load `tougan_modifiers.json` via `_load_interaction_templates()`
- Use modifier text in descriptions
- Add fallback with log.warning
- Remove `_HIDDEN_STEMS_TEMPLATES` loading

### Step 5: Add tests
- Modifier validation (80 entries, pillar domain sanity)
- API response assertions
- Layer C regression (no long conditional format)

### Step 6: Run full test suite + API verification

## Key Files
- CREATE: `packages/bazi-engine/data/explanations/interactions/tougan_modifiers.json`
- MODIFY: `packages/bazi-engine/app/cross_pillar.py`
- MODIFY: `packages/bazi-engine/data/explanations/hidden_stems.json` (Layer C shorten)
- MODIFY: `packages/bazi-engine/tests/test_explanations.py` (regression test)
- MODIFY: `packages/bazi-engine/tests/test_cross_pillar.py` (modifier + API tests)

## Verification
1. `python -m pytest tests/test_cross_pillar.py tests/test_explanations.py -v` — all pass
2. API test: `curl POST /explain-element` with hidden_stem + four_pillars → interaction card shows modifier text (NOT Layer B duplicate)
3. API test: 藏而不透 case → shows 藏 modifier text with pillar-specific content
4. API test: Layer C (godRoleMeaning) contains short note, not long conditional
5. Browser test: click 藏干 → 宮位解讀 and 命盤互動 show DIFFERENT content (no duplication)
