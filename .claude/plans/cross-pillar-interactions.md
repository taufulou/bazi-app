# Cross-Pillar Interaction Detection — Bazi Element Encyclopedia Bonus Phase

## Context
The Bazi Element Encyclopedia (Phase 1 + 2A + 2B) is complete with all 9 element types clickable and ~1040 pre-written templates. This bonus phase adds **cross-pillar interaction detection** — when a user clicks any element, the engine checks if it participates in interactions with other pillars and shows contextual notes. This is what separates a basic lookup from a real Bazi master consultation.

## Architecture Overview

### API Change: Extend `/explain-element` payload
Add optional `four_pillars` field to the existing request. The engine uses it for interaction detection when present, gracefully skips when absent (backward compatible).

**New request fields:**
```python
VALID_STEMS = {'甲','乙','丙','丁','戊','己','庚','辛','壬','癸'}
VALID_BRANCHES = {'子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'}

class PillarInput(BaseModel):
    stem: str          # 甲-癸 (validated)
    branch: str        # 子-亥 (validated)
    tenGod: str = ""   # 比肩/劫財/etc (empty for day pillar)
    hiddenStemGods: List[str] = []  # Frontend projects HiddenStemGod[].tenGod → string[]

    @field_validator('stem')
    @classmethod
    def validate_stem(cls, v: str) -> str:
        if v not in VALID_STEMS:
            raise ValueError(f'Invalid stem: {v}')
        return v

    @field_validator('branch')
    @classmethod
    def validate_branch(cls, v: str) -> str:
        if v not in VALID_BRANCHES:
            raise ValueError(f'Invalid branch: {v}')
        return v

class ExplainElementInput(BaseModel):
    element_type: str
    value: str
    pillar: str
    god_roles: GodRolesInput
    gender: str
    # NEW — optional, for cross-pillar detection (~500 bytes with hiddenStemGods)
    four_pillars: Optional[Dict[str, PillarInput]] = None

    @field_validator('four_pillars')
    @classmethod
    def validate_four_pillars(cls, v):
        if v is not None:
            required = {'year', 'month', 'day', 'hour'}
            if set(v.keys()) != required:
                raise ValueError(f'four_pillars must have keys: {required}')
        return v
```

**Payload size**: ~500 bytes with hiddenStemGods (up from ~200 bytes). Acceptable for a single POST request.

**New response field:**
```python
{
  "generic": { ... },
  "personalized": { ... },
  "interactions": [         # NEW — optional list, max 4 items
    {
      "type": "ten_god_cross",     # ten_god_cross | branch_interaction | hidden_stem_check
      "name": "食神制殺",
      "icon": "⚡",
      "description": "你的月柱食神與時柱七殺形成「食神制殺」...",
      "pillarsInvolved": ["month", "hour"],
      "nature": "auspicious"       # auspicious | inauspicious | neutral
    }
  ]
}
```

### Interaction Display Rules
- **Sort order**: By impact descending (沖/刑 > 合 > 透干; 凶 before 吉 for safety)
- **Max display**: 4 interaction cards. If more detected, show top 4 + "還有 N 項互動" expandable
- **Conflict resolution**: When 合 and 沖 coexist for the same branch pair, show BOTH but annotate: "此六合與六沖同時存在，實際效果視整體命局而定。" Do NOT suppress either — let the user see the complexity
- **Priority weights**: 六沖(90) > 三合/三會(90/100) > 三刑(85) > 六合(80) > 半合(70) > 害(70) > 破(60)

### Engine: New module `packages/bazi-engine/app/cross_pillar.py`
Loads its own interaction templates independently (NOT via `_load_templates()` in explanations.py — avoids subdirectory loading issues). Central detection function delegates to 3 sub-detectors:
```python
# Loads templates from data/explanations/interactions/*.json at import time
_INTERACTION_TEMPLATES = _load_interaction_templates()

def detect_cross_pillar_interactions(
    element_type: str,
    value: str,
    pillar: str,
    four_pillars: Dict[str, dict],
    god_roles: Dict[str, str],
) -> List[Dict]:
    """Returns max 4 interaction dicts, sorted by priority weight descending."""
```

### Cache Note
Frontend `cacheRef` is scoped to one component mount (via `useRef` in BaziChart). BaziChart unmounts on navigation between readings, clearing the cache. Since `four_pillars` is constant within a single chart viewing, the existing cache key (without four_pillars hash) is sufficient. **Unmount guarantee**: BaziChart is conditionally rendered inside `[type]/page.tsx` and compatibility page — both unmount on route change.

### Frontend: New section in ElementExplanation bottom sheet
Renders between Layer B (宮位解讀) and Layer C (喜忌分析), styled as a distinct "命盤互動" section with interaction cards.

---

## Implementation Phases

### Phase B1: 藏干 透干/通根 Detection (simplest, highest impact)

**Trigger rules (all phases):**
- `element_type == "hidden_stem"` → 透干 check (Phase B1)
- `element_type == "stem"` → 通根 check (Phase B1)
- `element_type == "branch"` → 六合/六沖/三合/三會/三刑/害/破 checks (Phase B2/B4/B5)
- `element_type == "ten_god"` → ten god cross-interaction checks (Phase B3/B4/B5)
- Other element_types (life_stage, nayin, shensha, etc.) → no cross-pillar checks (interactions not applicable)

**DM stem**: Extracted from `four_pillars["day"].stem` for classical verse exceptions (e.g., 傷官見官 五行例外 distinguishes 庚/辛 vs 甲/乙).

**hiddenStemGods fallback**: When frontend `PillarData.hiddenStemGods` is undefined (old chart data), frontend passes `hiddenStemGods: []` in payload. Engine can derive ten gods internally from hidden stems + DM stem if needed, but for simplicity the initial implementation requires the frontend to provide them. All modern chart calculations include `hiddenStemGods`.

**Frontend projection**: In `BaziChart.tsx`, when building `four_pillars` payload:
```tsx
hiddenStemGods: (p.data.hiddenStemGods || []).map(hsg => hsg.tenGod).filter(Boolean)
```

**What to detect when user clicks a hidden stem:**
1. **透干 check**: Does this exact hidden stem appear as a 天干 in any other pillar?
   - If yes → "此藏干{stem}已透出{pillar_label}天干，力量大增——藏在地下的力量與地上的天干連成一體，影響力從潛在變為實際。"
   - Note which pillar it manifests in
2. **通根 check** (reverse — when clicking a 天干/stem): Does this manifest stem have root support from any hidden stem?
   - 本氣通根 → "此天干{stem}在{pillar_label}地支中有本氣通根，根基深厚，力量穩固。"
   - 中氣通根 → "...有中氣通根，根基尚可。"
   - 餘氣通根 → "...有餘氣通根，根基較淺。"
   - 無根 → "此天干{stem}在四柱地支中無任何藏干支持，屬於虛浮無根——就像沒有根的樹，力量不夠穩固。"

**Templates**: ~15 entries (透干/通根/無根 × pillar variants + strength tiers)
**Files to create/modify:**
- NEW: `packages/bazi-engine/app/cross_pillar.py` (detection logic)
- NEW: `packages/bazi-engine/data/explanations/interactions/hidden_stem_interactions.json` (templates)
- MODIFY: `packages/bazi-engine/app/explanations.py` (integrate interactions into response)
- MODIFY: `packages/bazi-engine/app/main.py` (add `four_pillars` to request model)
- MODIFY: `apps/web/app/lib/element-explanation-api.ts` (pass four_pillars, update response type)
- MODIFY: `apps/web/app/components/ElementExplanation.tsx` (render interactions section)
- MODIFY: `apps/web/app/components/BaziChart.tsx` (pass four_pillars data to API)

**Tests**: ~20 (透干 found/not found, 通根 本氣/中氣/餘氣/無根, multi-root, cross-pillar distance)

---

### Phase B2: 地支 Interactions (六合/六沖/三合/三會) — Tier 1

**What to detect when user clicks a branch (地支):**

**Tier 1 (this phase):**
1. **六合**: Does clicked branch form a 六合 pair with any other pillar's branch?
   - Template defaults to 合而不化 (combined but not transformed): "你的{pillar_a}支{branch_a}與{pillar_b}支{branch_b}形成「{pair}合」——兩支相合，互相牽絆。此六合是否合化成{element}，需視月令及整體命局而定。"
   - 合化 conditions are complex (需月令/化神透干/兩支衰弱); initial implementation does NOT claim 合化, only notes the 合 relationship and potential 化 element
   - 6 pairs × ~2 variants (adjacent strong vs separated weak) = ~12 templates
2. **六沖**: Does clicked branch form a 六沖 pair?
   - Template: "你的{pillar_a}支{branch_a}與{pillar_b}支{branch_b}形成「{pair}沖」——{meaning}"
   - 6 pairs × ~2 variants = ~12 templates
3. **三合**: Does clicked branch participate in a 三合局 (full or 半合)?
   - Full 三合: "你的{branches}三柱形成「{group}合{element}局」——{meaning}"
   - 半合 (only 2 present): "你的{pillar_a}和{pillar_b}形成「半合{element}局」——{meaning}"
   - 4 groups × (full + 2 half variants) = ~12 templates
4. **三會**: Does clicked branch participate in a 三會局?
   - 4 groups × 1 template = ~4 templates

**Total Tier 1 templates**: ~40
**Engine**: Use existing `branch_relationships.py` constants (SIX_HARMONIES, SIX_CLASHES, TRIPLE_HARMONIES, THREE_MEETINGS). Add `detect_branch_interactions()` function in `cross_pillar.py`.
**Tests**: ~25 (each interaction type × found/not found × adjacency)

---

### Phase B3: 十神 Cross-Interactions — Tier 1 (top 10 patterns)

**What to detect when user clicks a ten god (十神):**

**Top 10 patterns to detect:**

**Detection scope**: Builds two collections from four_pillars:
- `stem_ten_gods`: Set of tenGod values from heavenly stems only (4 values, day excluded)
- `all_ten_gods`: Set of all ten gods from stems + hiddenStemGods (for presence checks)
- `ten_god_counts`: Counter of each ten god across all positions (for quantity checks like #8, #10)

**Adjacency definition**: Pillar order is `year→month→day→hour`. Adjacent pairs: (year,month), (month,day), (day,hour). Used in rules #4, #5, #7 where "adjacent to" means: the PILLARS containing the respective ten gods are adjacent. E.g., "財 adjacent to 印" means "the pillar with 正財/偏財 is adjacent to the pillar with 正印/偏印". In rules #4/#5, `'財' not adjacent to '印'` means no 正財 or 偏財 in a pillar next to 正印 or 偏印. A ten god "exists" in the chart if it appears in any position (stem or hidden stem). However, heavenly stem presence is weighted higher than hidden stem for severity assessment.

| # | Pattern | Nature | Exact Detection Rule |
|---|---------|--------|---------------------|
| 1 | 食神制殺 | 吉/凶 | `'食神' AND '七殺' in all_ten_gods` → 吉 if DM strong/neutral; if DM weak AND '印' present → 中性; if DM weak AND no '印' → 凶 (DM too weak to support 食神制殺) |
| 2 | 傷官見官 | 凶* | `'傷官' AND '正官' in all_ten_gods` → check 五行例外 (see below). Default: 凶 |
| 3 | 梟印奪食 | 凶 | `'偏印' AND '食神' in all_ten_gods AND '偏財' not present AND (DM strong OR 食神 is 用神/喜神)` → 凶. If 偏財 present → 中性 (偏財 rescues 食神) |
| 3b | **食神制殺逢梟** | **大凶** | `#1 AND #3 both true` (食神+七殺+偏印, no 偏財) → **compound card replaces both #1 and #3**: "食神制殺逢梟神，不貧則夭——偏印奪走食神，七殺失去制約，日主完全暴露在殺氣之下。" |
| 4 | 官印相生 | 吉 | `'正官' AND '正印' in all_ten_gods AND '財' not in stem_ten_gods` (hidden 財 is less damaging than transparent) → 吉 |
| 5 | 殺印相生 | 吉 | `'七殺' AND ('偏印' OR '正印') in all_ten_gods AND '財' not in stem_ten_gods` → DM weak: 大吉, DM neutral: 吉, DM strong: 中性 |
| 6 | 食傷生財 | 吉/凶 | `('食神' OR '傷官') AND ('正財' OR '偏財') in all_ten_gods` → 吉 if DM strong, 凶 if DM weak (exhaustion) |
| 7 | 貪財壞印 | 凶/吉 | `('正財' OR '偏財') AND ('正印' OR '偏印') in all_ten_gods` → 凶 if 印 is 用神/喜神, 吉 if 印 is 忌神 |
| 8 | 比劫奪財 | 凶/吉 | `count('比肩','劫財') >= 2 AND ('正財' OR '偏財') present` → 凶 if 財 is 用神/喜神, 中性 if 忌神 |
| 9 | 官殺混雜 | 凶 | 3 tiers: (a) both in stem_ten_gods → 凶 "明官殺混雜"; (b) one stem + one hidden → 凶(lighter) "明暗官殺混雜，影響中等"; (c) both hidden only → "暗中官殺混雜，影響較輕" |
| 10 | 傷官佩印 | 吉 | `'傷官' in all_ten_gods AND '正印' in all_ten_gods AND DM weak AND '財' not in stem_ten_gods` → 吉. Stronger if 傷官 in 月柱 (得令). |

**傷官見官 五行例外 (三命通會):**
- **火土傷官宜傷盡** (DM=丙/丁): 傷官(土) should completely eliminate 官(水). If 正官 still strong → 大凶 (worse than generic). If 正官 weak/controlled → 中性.
- **金水傷官喜見官** (DM=**庚/辛 only**): Water 傷官 needs Fire 官 for warmth(調候) → nature flips to 吉
- **木火傷官官要旺** (DM=甲/乙): Needs strong 官(金), conditionally → 中性
- **土金官去反成官** (DM=戊/己): 傷官(金) removing 官(木) is beneficial → **中性 to 吉** (not 凶)
- **水木傷官財官兩見反為歡** (DM=壬/癸): Needs BOTH 財 and 官 present → 吉. 官 alone without 財 → 中性

**Template per pattern**: 1 base + conditional modifiers (DM strength + god role + compound). Example:
- 食神制殺 (身強): "...以智慧化解壓力，是非常有力的組合。"
- 食神制殺 (身弱, no 印): "...但因為你的日主偏弱，又缺少印星來扶助，食神制殺的效果大打折扣。"
- 食神制殺逢梟 (compound): "...偏印奪走了食神，七殺失去唯一的制約，形成極為不利的格局。"
- 貪財壞印 (印=忌神): "...但因為印星是你的忌神，財星壓制它反而對你有利。"

**Total templates**: ~30 (10 patterns + 1 compound × ~2.7 variants average)
**Tests**: ~30 (each pattern × present/absent × DM strong/weak conditions)

---

### Phase B4: 地支 Tier 2 (三刑, 半合) + 十神 Tier 2 (chains, quantity transforms)

**地支 Tier 2:**
1. **三刑**: 寅巳申(無恩之刑), 丑戌未(持勢之刑), 子卯(無禮之刑), 自刑(辰辰/午午/酉酉/亥亥)
   - 4 types × ~2 templates = ~8 templates
2. **半合** (already partially in B2 — this adds remaining pairs)
   - Distinguish 生地半合 (stronger) vs 墓地半合 (weaker)
   - ~8 additional templates

**十神 Tier 2:**
1. **Chain flows**: 官印→身, 食傷→財→官, 比劫→食傷→財
   - Detect 3+ ten gods forming a generative chain across pillars
   - ~6 templates
2. **Quantity transforms**: 印多為梟, 食多為傷, 官多為殺
   - Count occurrences of same ten god type across pillars
   - Template wording uses "效果類似" (effects resemble), NOT "轉化為" (transforms into) — these are folk heuristics, not classical transformation rules
   - ~3 templates
3. **財星通關**: 財 mediating between 傷官 and 正官
   - ~2 templates

**Total templates**: ~27
**Tests**: ~15

---

### Phase B5: 地支 Tier 3 (害/穿, 破) + 十神 Tier 3 (advanced)

**地支 Tier 3:**
1. **害/穿**: 6 pairs (子未, 丑午, 寅巳, 卯辰, 申亥, 酉戌) — lower priority, show as supplementary note
   - ~6 templates
2. **破**: 6 pairs (子酉, 午卯, 辰丑, 未戌, 寅亥, 申巳) — lowest priority
   - Note: 寅亥 and 申巳 overlap with 六合. When both 合 and 破 coexist, show both with annotation.
   - ~6 templates
3. **自刑**: Follows mainstream 4-branch system (辰辰/午午/酉酉/亥亥). Some schools include 寅寅/卯卯 — documented but not implemented.

**十神 Tier 3:**
1. **身殺兩停, 身財兩停**: Balance detection
2. **合殺留官 / 合官留殺**: Resolution technique detection
3. **財滋弱殺**: Conditional 財+殺 interaction

**Total templates**: ~20
**Tests**: ~10

---

## Key Files Summary

| File | Action | Phase |
|------|--------|-------|
| `packages/bazi-engine/app/cross_pillar.py` | CREATE | B1 |
| `packages/bazi-engine/data/explanations/interactions/` | CREATE dir | B1 |
| `packages/bazi-engine/data/explanations/interactions/hidden_stem_interactions.json` | CREATE | B1 |
| `packages/bazi-engine/data/explanations/interactions/branch_interactions.json` | CREATE | B2 |
| `packages/bazi-engine/data/explanations/interactions/ten_god_interactions.json` | CREATE | B3 |
| `packages/bazi-engine/app/explanations.py` | MODIFY (integrate interactions) | B1 |
| `packages/bazi-engine/app/main.py` | MODIFY (add four_pillars to request) | B1 |
| `apps/web/app/lib/element-explanation-api.ts` | MODIFY (pass four_pillars, update types) | B1 |
| `apps/web/app/components/ElementExplanation.tsx` | MODIFY (render interactions section) | B1 |
| `apps/web/app/components/ElementExplanation.module.css` | MODIFY (interaction card styles) | B1 |
| `apps/web/app/components/BaziChart.tsx` | MODIFY (extract & pass four_pillars) | B1 |
| `apps/web/app/api/explain-element/route.ts` | NO CHANGE (proxy passes through) | — |
| `packages/bazi-engine/tests/test_cross_pillar.py` | CREATE | B1 |

## Frontend Display Design

New section in bottom sheet between Layer B and Layer C:

```
◇ 命盤互動                                    ← Section header
┌──────────────────────────────────────────────┐
│ ⚡ 食神制殺                              吉  │ ← Interaction card
│ 你的月柱食神與時柱七殺形成「食神制殺」格局  │
│ ——以智慧化解壓力，是非常有力的組合。        │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│ 🔗 巳申合水                              合  │
│ 你的月支巳與日支申形成六合，合化為水...      │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│ ✓ 透干                                  強  │
│ 此藏干甲木已透出年干，力量大增...            │
└──────────────────────────────────────────────┘
```

Interaction cards use color-coded borders:
- 吉 (auspicious): green border `var(--color-wood, #2E7D32)`
- 凶 (inauspicious): red border `var(--color-fire, #D32F2F)`
- 中性 (neutral): gold border `var(--color-gold, #D4A017)`

## Verification Plan
1. **Unit tests**: `python -m pytest tests/test_cross_pillar.py -v`
2. **API test**: curl each interaction type with known charts that have the interaction
3. **Browser test**: Click elements on existing readings, verify interaction cards appear
4. **Negative test**: Click elements where NO interaction exists — verify section doesn't render
5. **Backward compatibility**: Old API calls without `four_pillars` still work (no interactions returned)

## Template Count Summary

| Phase | Type | Templates | Tests |
|-------|------|-----------|-------|
| B1 | 藏干 透干/通根 | ~15 | ~20 |
| B2 | 地支 Tier 1 (六合/六沖/三合/三會) | ~40 | ~25 |
| B3 | 十神 Tier 1 (top 10 patterns) | ~20 | ~30 |
| B4 | 地支 Tier 2 + 十神 Tier 2 | ~27 | ~15 |
| B5 | 地支 Tier 3 + 十神 Tier 3 | ~20 | ~10 |
| **Total** | | **~122** | **~100** |
