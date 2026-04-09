# Plan: 天干 通根/虛浮 Pillar-Aware Modifiers (160 entries)

## Goal
Add pillar-aware modifier templates for 天干's 通根/虛浮無根 interaction cards, mirroring the existing 藏干 tougan_modifiers.json pattern. When a user clicks a 天干 (heavenly stem), the 命盤互動 section shows not just "庚通根（本氣）" but also a pillar-specific explanation of what that root strength means for THIS stem in THIS life domain.

## Why 160 separate entries (not reuse 藏干)
- 藏干 modifiers answer "Is hidden energy visible?" (bottom-up)
- 天干 modifiers answer "Does visible energy have real substance?" (top-down)
- Pillar domain context overlaps, but strength assessment framing is inverted
- Reusing 藏干 text would produce nonsensical phrases like "辛金已透出天干" when user clicked the 天干 itself

## JSON Schema (concrete)

File: `packages/bazi-engine/data/explanations/interactions/tonggen_modifiers.json`

Each entry is a **plain string** (no sub-fields like `text` or `content`) — matches `tougan_modifiers.json` pattern exactly:

```json
{
  "甲": {
    "strong_root": {
      "year": "甲木在年柱有本氣通根，你展現出來的成長力和領導潛質是從家庭根基中培養的真功底...",
      "month": "...",
      "day": "...",
      "hour": "..."
    },
    "moderate_root": {
      "year": "...", "month": "...", "day": "...", "hour": "..."
    },
    "weak_root": {
      "year": "...", "month": "...", "day": "...", "hour": "..."
    },
    "floating": {
      "year": "...", "month": "...", "day": "...", "hour": "..."
    }
  }
}
```

10 stems × 4 states × 4 pillars = **160 entries** (plain strings, no placeholders needed)

## Content Rules

### Entry lengths
- 1-2 sentences each (~40-80 chars)
- Shorter than 藏干 modifiers since 通根 is a simpler strength assessment

### Content rules per state

| State | Key | Framing | Tone |
|-------|-----|---------|------|
| 通根本氣 | `strong_root` | "This energy has deep, genuine foundation in [domain]" | Confident, affirming |
| 通根中氣 | `moderate_root` | "This energy has decent support in [domain], but not the deepest" | Balanced |
| 通根餘氣 | `weak_root` | "This energy has shallow roots in [domain], more surface than substance" | Gentle caution |
| 虛浮無根 | `floating` | "This energy lacks real foundation in [domain], appears strong but unstable" | Honest, not alarming |

### Pillar domain mapping (same as 藏干)
- **year**: 家庭背景、祖輩、童年環境 (0-16歲)
- **month**: 事業舞台、職場、社會形象 (17-32歲)
- **day**: 自己的內在本質、核心性格 (day stem = self; day BRANCH is spouse palace but modifier is for stem, so focus on self, NOT marriage/spouse)
- **hour**: 子女緣、晚年生活 (49歲+)

### Element-specific analogies
- 木 stems (甲乙): tree/plant root analogies (大樹紮根 vs 浮萍)
- 火 stems (丙丁): flame/fuel analogies (有燃料支撐 vs 虛火)
- 土 stems (戊己): mountain/soil foundation analogies (地基穩固 vs 浮沙)
- 金 stems (庚辛): metal ore/gem mine analogies (有礦脈支撐 vs 鍍金)
- 水 stems (壬癸): water source/spring analogies (有源頭活水 vs 無源之水)

### Sample entries for 辛 (Metal Yin / 珠寶)

**strong_root + year:**
> "辛金在年柱有本氣通根，你展現出來的精緻品味和審美能力是從家庭教養中培養出來的真功底，不是表面的講究。"

**floating + month:**
> "辛金在月柱虛浮無根，你在職場上展現的細膩和精緻感缺乏內在支撐——可能給人「看起來很專業但底子不夠深」的印象，需要靠實力補強。"

## Files to Create/Modify

### 1. CREATE: `packages/bazi-engine/data/explanations/interactions/tonggen_modifiers.json`
- 160 entries as described above
- Will be written by a sub-agent
- Sub-agent must validate: JSON valid, all 160 keys exist, no entry empty/too short

### 2. MODIFY: `packages/bazi-engine/app/cross_pillar.py`

**Integration method**: Modifier text is **appended to the existing `description` string** via `\n\n`, identical to how `_detect_tougan()` integrates `tougan_modifiers`. No new fields on the interaction card dict. This means **no frontend changes** — `ElementExplanation.tsx` renders `interaction.description` as-is (verified: line ~283 renders `{interaction.description}`).

**Multiple roots scope**: The modifier uses the BEST root's `nature` value (already determined by `_detect_tonggen()` before the modifier lookup). The "best root" is from the sorted `found_roots[0]` — this is the strongest root across ALL branches, not just same-pillar. This is correct because the interaction card already describes all roots found.

Add `_TONGGEN_FALLBACK` constant and `logger.warning()` when modifier is missing (mirrors tougan pattern for runtime visibility during development).

Code change in `_detect_tonggen()`:

```python
# After building base description string...
modifiers = _INTERACTION_TEMPLATES.get('tonggen_modifiers', {})
modifier = modifiers.get(value, {}).get(nature, {}).get(pillar, '')
if not modifier:
    modifier = _TONGGEN_FALLBACK
    logger.warning(f'Missing tonggen modifier: {value}/{nature}/{pillar}')
description = f'{base}\n\n{modifier}'
```

Same pattern for 虛浮無根 block (using `floating` as the state key).

### 3. MODIFY: `packages/bazi-engine/tests/test_cross_pillar.py`
- Add `TestTonggenModifiers` class (mirrors existing `TestTouganModifiers`)
- **Completeness test**: Assert all 160 combinations (10 stems × 4 states × 4 pillars) exist and are non-empty strings ≥20 chars
- **Domain tests**: year entries contain family keywords, month contain career keywords, day NOT contain marriage keywords, hour contain children/late-life keywords
- **Integration test**: tonggen interaction card `description` contains modifier text from `tonggen_modifiers.json` (not just generic base text)
- **Floating integration test**: 虛浮無根 interaction card contains `floating` modifier text

### 4. NO frontend changes needed
- Verified: `ElementExplanation.tsx` line ~283 renders `{interaction.description}` as plain text
- The modifier is concatenated into the existing description field
- No new card fields, no structural changes

## Implementation Steps

1. Write `tonggen_modifiers.json` via sub-agent (160 entries)
2. Remove `_meta` key if sub-agent adds one
3. Update `_detect_tonggen()` in `cross_pillar.py` to use modifiers
4. Add `_TONGGEN_FALLBACK` constant + `logger.warning()`
5. Write `TestTonggenModifiers` tests in `test_cross_pillar.py`
6. Run full test suite (existing ~123 + new ~12 = ~135 tests)
7. Verify via API curl test with Roger's chart

## Edge Cases
- Day pillar modifier: focus on self/inner nature, NOT marriage/spouse
- Multiple roots: modifier uses the STRONGEST root's nature (本氣 > 中氣 > 餘氣), which is `found_roots[0]` after sorting by tierIndex
- Fallback: if modifier template missing, use `_TONGGEN_FALLBACK` text + emit `logger.warning()`
- No `{placeholder}` substitution needed — entries are plain strings with stem name baked in
