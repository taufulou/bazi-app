# UX Polish: Shensha Simplification + Interaction Badges + Pillar Context

## Goal
Three UX improvements to the Element Encyclopedia:
1. Simplify 34 shensha Layer A entries (remove technical lookup formulas)
2. Change interaction card badges from 吉/凶/中 → 強/顯/隱/中/弱/浮 (neutral descriptors)
3. Add pillar context explanations (what each pillar represents) with free/paid tiers

## Key Files to Modify/Create

| File | Action | Purpose |
|------|--------|---------|
| `packages/bazi-engine/data/explanations/shenshas.json` | MODIFY | Simplify 34 Layer A entries |
| `packages/bazi-engine/app/cross_pillar.py` | MODIFY | Change `nature` field values |
| `packages/bazi-engine/data/explanations/pillar_context.json` | CREATE | 4 pillar context entries |
| `packages/bazi-engine/app/explanations.py` | MODIFY | Add pillarContext to response |
| `apps/web/app/components/ElementExplanation.tsx` | MODIFY | Render pillar context + new badges |
| `apps/web/app/components/ElementExplanation.module.css` | MODIFY | Badge color updates |
| `apps/web/app/lib/element-explanation-api.ts` | MODIFY | Add pillarContext type |
| `packages/bazi-engine/tests/test_explanations.py` | MODIFY | Add regression tests |

---

## Step 1: Simplify Shensha Layer A (34 entries)

### What to Remove
Every shensha Layer A currently dumps the lookup formula, e.g.:
> "天乙貴人以日干查對應地支而得——甲戊庚日見丑未、乙己日見子申..."

Remove ALL lookup formulas. Keep: core meaning + relatable analogy + keywords.

### Rewrite Pattern
Each entry should follow this structure:
1. **What it is** (1 sentence — identity + ranking)
2. **What it means for you** (1-2 sentences — practical life impact with analogy)
3. **Keywords** remain unchanged

### Example Rewrites

**天乙貴人 (Before):**
> "天乙貴人是八字中最重要的吉星，號稱「神煞之首」。天乙貴人以日干查對應地支而得——甲戊庚日見丑未、乙己日見子申、丙丁日見亥酉、壬癸日見卯巳、辛日見午寅。天乙貴人代表..."

**天乙貴人 (After):**
> "天乙貴人是八字中最重要的吉星，號稱「神煞之首」。有天乙貴人的人，一生中總容易遇到貴人相助——在你遇到困難的時候，常常會有人適時伸出援手，幫你化險為夷。這顆星也代表你天生有一種讓人願意幫助你的氣質。"

**華蓋 (After):**
> "華蓋代表才華、獨立思考和精神世界的豐富。有華蓋的人，內心世界特別豐富，喜歡深入思考，對哲學、宗教或藝術有天然的興趣。就像一頂華麗的傘蓋——你的精神層次比一般人高，但也因此容易感到曲高和寡、不被理解。"

**羊刃 (After):**
> "羊刃代表極端強烈的能量和行動力。就像一把鋒利的刀——用得好可以披荊斬棘，用不好容易傷到自己和別人。有羊刃的人個性果斷剛強，不怕衝突，但也容易衝動。如果命局中有正官或七殺來制衡，羊刃反而會成為你最大的武器。"

### Implementation
Use a sub-agent to rewrite all 34 Layer A `meaning` fields. Keep `name`, `category`, `keywords`, `nature` unchanged. Only modify `meaning`.

---

## Step 2: Change Interaction Badges

### Current → New Badge Mapping

| State | Old `nature` | Old Badge | New `nature` | New Badge |
|-------|-------------|-----------|-------------|-----------|
| 透干 (same pillar) | auspicious | 吉 | manifest | **顯** |
| 透干 (cross pillar) | auspicious | 吉 | manifest | **顯** |
| 藏而不透 | neutral | 中 | latent | **隱** |
| 通根 (本氣) | auspicious | 吉 | strong_root | **強** |
| 通根 (中氣) | auspicious | 吉 | moderate_root | **中** |
| 通根 (餘氣) | neutral | 中 | weak_root | **弱** |
| 虛浮無根 | inauspicious | 凶 | floating | **浮** |

### Code Changes in `cross_pillar.py`
```python
# _detect_tougan: change 'nature' for all interactions
# 透干 → nature: 'manifest'
# 藏而不透 → nature: 'latent'

# _detect_tonggen: change 'nature' per tier
# 本氣 → nature: 'strong_root'
# 中氣 → nature: 'moderate_root'
# 餘氣 → nature: 'weak_root'
# 虛浮無根 → nature: 'floating'
```

### Frontend Badge Display Map (ElementExplanation.tsx)
```typescript
const NATURE_BADGE: Record<string, { label: string; color: string }> = {
  'manifest': { label: '顯', color: '#2E7D32' },     // green — energy visible
  'latent': { label: '隱', color: '#8B7355' },        // muted brown — energy hidden
  'strong_root': { label: '強', color: '#2E7D32' },   // green — strong root
  'moderate_root': { label: '中', color: '#B8860B' },  // gold — moderate root
  'weak_root': { label: '弱', color: '#D4A017' },     // lighter gold — weak root
  'floating': { label: '浮', color: '#D32F2F' },      // red — no root, floating
};
// Fallback for unknown/old cached values:
// default → { label: '·', color: '#8B7355' }
```

### Cache Bust Strategy
Session cache key already includes `elementType:value:pillar:gender` — nature values are in the response payload, not the key. When the engine restarts with new nature values, new API calls will return updated values. Stale cached entries will be cleared on page reload (cache is `useRef`, lives only in component lifecycle). Frontend badge map includes fallback for unknown values.

### CSS Changes
Replace `[data-nature="auspicious"]` / `[data-nature="inauspicious"]` with new nature values. Use consistent warm palette:
- Strong/manifest: green border-left + subtle green bg
- Moderate: gold border-left + subtle gold bg
- Latent/weak: muted brown border-left + default bg
- Floating: red border-left + subtle red bg

---

## Step 3: Pillar Context Explanations

### Data: `pillar_context.json`

Based on verified research from multiple classical sources:

```json
{
  "year": {
    "free": "年柱代表你的根——家庭背景、祖先和童年（1-16歲）。同一個元素出現在不同的柱位，意義完全不同。解鎖個人化解讀，了解這個元素在你的年柱中如何影響你的早年經歷和家族緣分。",
    "paid": "年柱是你的「根基之柱」，代表祖先、家庭背景和1-16歲的早年運勢。年干代表祖父及父系長輩，年支代表祖母及母系長輩。出現在年柱的元素，揭示你的家庭環境、家教方式和從小培養的性格基底。年柱好比一棵樹的根——根基穩固，整棵樹才能茁壯成長。"
  },
  "month": {
    "free": "月柱是你命盤中最有力量的一柱——代表你的事業舞台和青壯年時期（17-32歲）。月令（月支）決定了你整個命局的強弱格局。解鎖個人化解讀，了解這個元素如何影響你的職業發展和社會形象。",
    "paid": "月柱是你的「事業之柱」，代表父母、兄弟姐妹和17-32歲的社會發展期。月干代表父親和年長的兄姐，月支代表母親和年幼的弟妹。月支又稱「月令」或「提綱」，是整個命盤中最重要的一個字——它決定了日主的旺衰強弱，被命理界稱為「命之宅」。出現在月柱的元素，直接影響你的職業選擇、工作風格和社會地位。"
  },
  "day": {
    "free": "日柱代表你自己的核心本質和最親密的關係（33-48歲）。日干就是「你自己」，日支則是「配偶宮」。解鎖個人化解讀，了解這個元素如何揭示你的內心世界和婚姻關係。",
    "paid": "日柱是你的「自我之柱」——日干代表你自己（日主/命主），是整個命盤的中心。日支是你的「配偶宮」，代表你最親密的伴侶關係，也反映你內心最深處的渴望和性格傾向。日支與日干緊密相連，就像你身體下方的影子，既代表另一半的特質，也映照出你潛意識中的真實自我。出現在日柱的元素，對應33-48歲的中年運勢。"
  },
  "hour": {
    "free": "時柱代表你的子女緣和人生的最終歸宿（49歲以後）。它藏著你下半生的秘密。解鎖個人化解讀，了解這個元素如何影響你的晚年福報和子女運勢。",
    "paid": "時柱是你的「歸宿之柱」，代表子女、晚年和49歲以後的人生。時干代表子女的品性和成就，時支代表孫輩和你晚年的生活環境。時柱也被稱為「福德宮」——晚年是否享福、子女是否孝順，都能從時柱看出端倪。出現在時柱的元素，揭示你人生最終的走向和歸宿。"
  }
}
```

### Engine Integration (`explanations.py`)
Add `pillarContext` to the response. **Follows existing pattern**: engine returns ALL data (both free + paid), frontend gates via `isSubscriber` prop. No server-side subscription check.

The endpoint already receives `pillar` as a required field in `ExplainElementInput`, so no API contract change needed.

```python
# Load pillar_context.json at startup (optional — log warning if missing, don't crash)
_PILLAR_CONTEXT = _load_pillar_context()  # Returns {} on failure

# In get_element_explanation():
pillar_ctx = _PILLAR_CONTEXT.get(pillar, {})
if pillar_ctx:
    result["pillarContext"] = {
        "free": pillar_ctx.get("free", ""),
        "paid": pillar_ctx.get("paid", ""),
    }
# If pillar_context.json missing → pillarContext field omitted → frontend handles None
```

### Error Handling
- If `pillar_context.json` fails to load: log warning, `_PILLAR_CONTEXT = {}`, endpoint continues normally without pillarContext
- Frontend: `data.pillarContext?.free` — already safe with optional chaining

### Frontend Rendering (`ElementExplanation.tsx`)

**Free tier**: Show `pillarContext.free` between category badge and Layer A, styled as a subtle info box with a key icon.

**Paid tier**: Show `pillarContext.paid` as the first item under "個人化解讀" header, before 宮位解讀. Styled with a left-border accent and slightly different background.

### Types Update (`element-explanation-api.ts`)
```typescript
export interface PillarContextData {
  free: string;
  paid: string;
}

export interface ElementExplanationData {
  generic: LayerAData;
  personalized: PersonalizedData;
  interactions?: InteractionData[];
  pillarContext?: PillarContextData;  // NEW
  error?: string;
}
```

---

## Implementation Sequence

1. **Shensha Layer A rewrite** (sub-agent for content, then validate JSON)
2. **Create `pillar_context.json`** (4 entries, write inline)
3. **Update `cross_pillar.py`** (change nature values)
4. **Update `explanations.py`** (add pillarContext loading + response)
5. **Update `element-explanation-api.ts`** (add types)
6. **Update `ElementExplanation.tsx`** (render pillar context + new badges)
7. **Update `ElementExplanation.module.css`** (new badge styles)
8. **Add tests** (pillar context loading, badge nature values)
9. **Run full test suite**

---

## Edge Cases

- **Day pillar stem click**: pillarContext.paid says "日干代表你自己" — this is fine, the user is clicking their own Day Master
- **Kong wang / seasonal state**: These don't have a meaningful pillar position (they're chart-level), but the API always receives a pillar param. Show pillar context anyway since the element IS in that pillar
- **Shensha that span multiple pillars**: Some shensha appear in multiple branches. The pillar context is for the specific pillar the user clicked, not where the shensha "belongs"
- **Backward compatibility**: `pillarContext` is a new field — old cached responses won't have it. Frontend should handle `undefined` gracefully

## Tests to Add
- All 34 shensha Layer A entries contain no lookup formula patterns (e.g., no "日見", no "年見", no "甲戊庚日見")
- pillar_context.json has all 4 pillars with non-empty free + paid text
- Cross-pillar nature values use new vocabulary (manifest/latent/strong_root/etc.)
- **Update `test_cross_pillar.py`**: All assertions on `nature` values must change from "auspicious"/"inauspicious"/"neutral" to new values
- Frontend handles missing pillarContext gracefully (optional chaining)
- Grep codebase for old nature values ("auspicious", "inauspicious") to find all consumers

## Key Files to Also Update (Consumer Audit)
| File | What to Change |
|------|---------------|
| `packages/bazi-engine/tests/test_cross_pillar.py` | Update all `nature` assertions |
| `apps/web/app/components/ElementExplanation.module.css` | Update `[data-nature=...]` selectors |
