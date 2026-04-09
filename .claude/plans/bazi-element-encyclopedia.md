# Bazi Element Encyclopedia — Interactive Chart Explanations

## Overview

Add click-to-explain functionality to the 八字命格 table in BaziChart. When users click any element (十神, 天干, 地支, 藏干, 十二運, 納音, 神煞, 旺相休囚死), a bottom sheet slides up showing:

- **Free tier**: Generic explanation (Layer A) — always visible
- **Paid tier** (subscriber-only): Personalized 4-layer explanation assembled from pre-computed templates, tailored to the user's specific chart (pillar position, 喜忌 role, DM strength, gender)

**Priority**: 十神 first (test end-to-end), then expand to remaining 7 types.

---

## Architecture

### Data Flow

```
JSON template files (packages/bazi-engine/data/)
  ↓ loaded into memory at server startup
Python Engine endpoint (POST /explain-element)
  ↓ assembles ALL layers (no subscription gating server-side)
Frontend bottom sheet component (via React Portal at document.body)
  ↓ displays free content always + paid content only if isSubscriber
Subscription gate (isSubscriber prop from reading page — frontend-only)
```

### Template Storage

- **Location**: `packages/bazi-engine/data/explanations/`
- **Format**: JSON files, one per element type
- **Loading**: Read once at server startup into Python dict (zero latency per click). Per-file error handling ensures one malformed file doesn't block others.
- **Pillar key convention**: Always use English keys (`year`, `month`, `day`, `hour`) in both JSON templates and frontend code. Never use Chinese keys (`年`, `月`, `日`, `時`).
- **Future**: Admin page can read/write these JSON files

### Template Assembly (Python Engine)

No AI involved. The engine:
1. Receives: element type, value, pillar, and minimal chart context (god role elements only)
2. **Always returns ALL layers** (A + B + C + D) — no subscription check server-side
3. Computes god role via `_determine_element_god_role()` using the DM's god role elements
4. Returns assembled JSON

**Security model**: The engine always returns all layers. The frontend gates display using the trusted `isSubscriber` prop. Templates are educational reference content (like a textbook), not secret AI-generated premium output. This eliminates the spoofable `is_subscriber` flag from the API and keeps the endpoint simple.

### Subscription Check

- Uses existing `isSubscriber` prop already passed to components from reading pages
- No new auth/payment logic needed — piggybacks on existing subscription system
- All-access: subscribers see personalized explanations for ALL elements, no per-click cost
- **Frontend-only gating**: The bottom sheet component decides what to show based on `isSubscriber`

---

## Phase 1: 十神 (Ten Gods) — End-to-End

### Step 1: Write Ten God Template Data

**File**: `packages/bazi-engine/data/explanations/ten_gods.json`

**Structure**:
```json
{
  "正官": {
    "layerA": {
      "name": "正官",
      "category": "十神",
      "meaning": "正官代表規範、責任與正當的權力...",
      "keywords": ["紀律", "地位", "責任", "管理", "穩重"],
      "liuQin": {
        "male": "女兒",
        "female": "丈夫"
      }
    },
    "layerB": {
      "year": "正官出現在你的年柱，代表你的家庭背景...",
      "month": "正官出現在你的月柱，這是正官最有力量的位置...",
      "day": "正官出現在你的日支藏干（夫妻宮），代表配偶正派穩重...",
      "hour": "正官出現在你的時柱，代表你的晚年運勢..."
    },
    "layerC": {
      "喜神": "正官是你命局中的喜神，這是非常好的配置...",
      "用神": "正官是你命局中的用神，這代表「紀律與責任」...",
      "閒神": "正官是你命局中的閒神，屬於中性的存在...",
      "忌神": "正官是你命局中的忌神，這代表過多的規範...",
      "仇神": "正官是你命局中的仇神，它會間接削弱..."
    },
    "layerD": {
      "male": "從六親角度看，正官在男命中代表女兒...",
      "female": "從六親角度看，正官在女命中代表丈夫..."
    }
  },
  "劫財": { ... },
  "食神": { ... },
  "傷官": { ... },
  "偏財": { ... },
  "正財": { ... },
  "偏官": { ... },
  "比肩": { ... },
  "偏印": { ... },
  "正印": { ... }
}
```

**Content**: 10 ten gods × (1 Layer A + 4 Layer B + 5 Layer C + 2 Layer D) = **~120 entries**

Writing tone: 專業溫暖型 — like an experienced teacher explaining one-on-one. 中學 reading level. Confident ("代表" not "可能代表"), with one relatable analogy per explanation. Occasional classical reference for credibility.

**Layer B note**: 4 pillar versions (年/月/日/時). While the day **stem** is always 日元, ten gods DO appear in day pillar's **hidden stems** (日支藏干). The day pillar is the 夫妻宮 (spouse palace) — ten gods hidden there carry critical marriage/relationship meaning. Layer B "day" focuses on this 藏干 context.

**Layer A content guidelines**: Each ten god's Layer A should include:
- Core象意 (symbolism) with one relatable analogy
- 正/偏 distinction where applicable (e.g., 正官 vs 偏官/七殺)
- Brief mention of 合 interactions (e.g., 正官合日主 = 官來合我, meaning authority seeks you out)
- Key cross-interaction partner in ONE sentence (e.g., 食神: "食神最著名的組合是「食神制殺」——用智慧和才華來化解七殺帶來的壓力。" 傷官: "傷官最需注意的是「傷官見官」——才華與權威的衝撞，容易引發是非。")
- Six relations (六親) with complete chain — not just primary relative

**Key十神 cross-interaction pairs** (each ten god's Layer A should mention its most important interaction):
| 十神 | Key Interaction | One-sentence explanation for Layer A |
|------|----------------|--------------------------------------|
| 比肩 | 比肩奪財 | 比肩多見容易與人爭利，有競爭傾向 |
| 劫財 | 劫財爭合 | 劫財容易與日主爭奪正財(妻/財)，帶有競爭意味 |
| 食神 | 食神制殺 | 食神最著名的組合是「食神制殺」——以智慧化解壓力 |
| 傷官 | 傷官見官 | 傷官最需注意「傷官見官」——才華衝撞權威，易惹是非 |
| 偏財 | 財生官 | 偏財可以生官殺，財富帶來社會地位或壓力 |
| 正財 | 財生官 | 正財生正官，正當財富帶來正當地位 |
| 偏官(七殺) | 食神制殺 | 七殺被食神制約時，化壓力為動力，反成大器 |
| 正官 | 傷官見官 | 正官最怕傷官來剋，權威被挑戰 |
| 偏印 | 梟印奪食 | 偏印最忌「梟印奪食」——剋制食神，壓抑才華和口福 |
| 正印 | 印生身 | 正印生日主，長輩庇護，但印太多則過度依賴 |

**Layer C content guidelines**: Each god role variant should:
- Use the **effective** god role from the engine (post-從格 override). For 從格 charts, the engine's `determine_favorable_gods()` already inverts roles correctly, so the template selected will automatically be correct.
- **Include DM strength reasoning**: Each template must explain WHY this element is the user's 喜神/忌神/etc. by connecting it to DM strength. E.g., "因為你的日主偏強，需要洩秀平衡，食神能幫你釋放過多的能量，所以是你的喜神。" This requires the `strengthClassification` field in `GodRolesInput`.
- Include a brief note: "本分析基於旺衰取用法。不同命理流派對喜用神的判定可能有所差異。" This acknowledges convention differences (e.g., strong DM 用神/喜神 swap between schools).
- Add a note that stems involved in 天干合化 may have altered effective impact: "若此十神的天干與其他天干相合，其實際效果可能因合化而改變。"

**Layer C DM-strength-aware template strategy**: Since Layer C has 5 god role variants × 10 ten gods = 50 templates, and DM strength has 3 classifications (strong/neutral/weak), writing 150 variants is impractical. Instead:
- Each Layer C template includes **placeholders** that the engine substitutes at assembly time via `_substitute_strength_context()`.

**Strength classification collapsing** (5 values → 3 buckets):
- `very_strong` + `strong` → `"偏強"` label
- `very_weak` + `weak` → `"偏弱"` label
- `neutral` → `"中和"` label

**Available placeholders in Layer C templates**:
| Placeholder | Source | Example Value |
|-------------|--------|---------------|
| `{strengthLabel}` | Collapsed strength bucket | "偏強", "偏弱", "中和" |
| `{dmElement}` | `god_roles.dayMasterElement` | "木", "火", etc. |

**Example template with placeholders**:
"正官是你命局中的忌神。因為你的日主{strengthLabel}，過多的規範和約束反而會讓你感到壓力沉重。"

**Engine substitution** (added to `get_element_explanation()`):
```python
STRENGTH_LABEL_MAP = {
    'very_strong': '偏強', 'strong': '偏強',
    'very_weak': '偏弱', 'weak': '偏弱',
    'neutral': '中和',
}

def _substitute_placeholders(text: str, god_roles: dict) -> str:
    """Replace {strengthLabel} and {dmElement} in template text."""
    strength = god_roles.get('strengthClassification', 'neutral')
    label = STRENGTH_LABEL_MAP.get(strength, '中和')
    return text.replace('{strengthLabel}', label).replace('{dmElement}', god_roles.get('dayMasterElement', ''))
```

Applied after Layer C lookup:
```python
if god_role and god_role in entry.get("layerC", {}):
    raw = entry["layerC"][god_role]
    personalized["godRoleMeaning"] = _substitute_placeholders(raw, god_roles)
    personalized["godRole"] = god_role
```

Templates WITHOUT placeholders pass through unmodified (`.replace()` on a string without the target is a no-op).

**Test coverage**: Add tests for `_substitute_placeholders()` — verify strong/very_strong both map to 偏強, templates without placeholders are returned unchanged, missing strengthClassification defaults to 中和.

**Layer D 六親 reference table** (must be verified against standard 十神六親表):

| 十神 | 男命 (primary / extended) | 女命 (primary / extended) |
|------|--------------------------|--------------------------|
| 比肩 | 兄弟 / 朋友 | 姐妹 / 朋友 |
| 劫財 | 姐妹 / 情敵 | 兄弟 / 情敵 |
| 食神 | 孫子、女婿 / 晚輩 | 女兒 / 才華表現 |
| 傷官 | 祖母 / 外祖母 | 兒子 / 情人(部分流派) |
| 偏財 | 父親 / 情人、偏妻 | 婆婆(夫之母) / 偏財運 |
| 正財 | 妻子 / 正當財運 | 正當財運 / 繼父(部分流派) |
| 偏官(七殺) | 兒子 / 小人、壓力 | 情人、偏夫 / 非正式伴侶 |
| 正官 | 女兒 / 上司 | 丈夫 / 正式伴侶 |
| 偏印 | 繼母、偏母 / 宗教導師 | 繼母、偏母 / 非傳統mentor |
| 正印 | 母親 / 長輩庇護 | 母親 / 長輩庇護 |

### Step 2: Python Engine — Template Loader + Endpoint

**File**: `packages/bazi-engine/app/explanations.py` (new)

```python
import json
import os
import logging
from typing import Dict, Any, Optional

from app.constants import STEM_ELEMENT

logger = logging.getLogger(__name__)

# Load templates once at module import
_TEMPLATES: Dict[str, Any] = {}

def _load_templates():
    """Load all explanation JSON files into memory.
    Gracefully handles missing directory and per-file errors.
    One malformed file does NOT block loading of other files.
    """
    data_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'explanations')
    try:
        filenames = sorted(os.listdir(data_dir))
    except FileNotFoundError:
        logger.warning(f"Explanations directory not found: {data_dir}. "
                       "Element explanations will be unavailable.")
        return

    for filename in filenames:
        if not filename.endswith('.json'):
            continue
        filepath = os.path.join(data_dir, filename)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                key = filename.replace('.json', '')
                _TEMPLATES[key] = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            logger.error(f"Failed to load explanation template {filename}: {e}")
            # Continue loading other files

    logger.info(f"Loaded {len(_TEMPLATES)} explanation template files")

_load_templates()


# ── Ten God → Element mapping ──
# Each ten god's element depends on the Day Master stem.
# This maps: (relationship_type) → how to derive the element from DM.
#
# Mapping chain for _determine_element_god_role():
#   1. Ten god name (e.g., "正官") → relationship type (e.g., "overcomes_me_diff")
#   2. DM element (e.g., "木") → ten god's element via relationship (e.g., 剋木且異性 = "金")
#   3. Compare ten god's element against chartData god roles:
#      - chartData.dayMaster.favorableGod = "火" → if ten god element == "火" → "喜神"
#      - chartData.dayMaster.usefulGod = "水" → if ten god element == "水" → "用神"
#      - etc.
#
# For ten gods, the element IS deterministic from the DM stem:
TEN_GOD_TO_RELATIONSHIP = {
    '比肩': 'same',          # Same element, same polarity
    '劫財': 'same',          # Same element, diff polarity
    '食神': 'i_produce',     # Element I produce
    '傷官': 'i_produce',     # Element I produce (diff polarity)
    '偏財': 'i_overcome',    # Element I overcome
    '正財': 'i_overcome',    # Element I overcome (diff polarity)
    '偏官': 'overcomes_me',  # Element that overcomes me
    '正官': 'overcomes_me',  # Element that overcomes me (diff polarity)
    '偏印': 'produces_me',   # Element that produces me
    '正印': 'produces_me',   # Element that produces me (diff polarity)
}

# Import from app.constants — never redefine locally to avoid maintenance divergence
from app.constants import ELEMENT_PRODUCES, ELEMENT_OVERCOMES, ELEMENT_PRODUCED_BY, ELEMENT_OVERCOME_BY


def _determine_element_god_role(
    value: str,
    element_type: str,
    god_roles: Dict[str, str]
) -> Optional[str]:
    """Determine which god role (喜神/用神/閒神/忌神/仇神) an element falls into.

    Args:
        value: The element value (e.g., "正官", "甲", "子")
        element_type: "ten_god", "stem", "branch", etc.
        god_roles: Dict with keys favorableGod/usefulGod/idleGod/tabooGod/enemyGod,
                   values are element names (e.g., {"favorableGod": "火", ...})

    Returns:
        One of "喜神", "用神", "閒神", "忌神", "仇神", or None if unmappable.
    """
    # Step 1: Determine the five element for this value
    target_element = None

    if element_type == 'ten_god':
        # Ten god → relationship → DM element → target element
        relationship = TEN_GOD_TO_RELATIONSHIP.get(value)
        dm_element = god_roles.get('dayMasterElement')
        if not relationship or not dm_element:
            return None
        if relationship == 'same':
            target_element = dm_element
        elif relationship == 'i_produce':
            target_element = ELEMENT_PRODUCES.get(dm_element)
        elif relationship == 'i_overcome':
            target_element = ELEMENT_OVERCOMES.get(dm_element)
        elif relationship == 'overcomes_me':
            target_element = ELEMENT_OVERCOME_BY.get(dm_element)
        elif relationship == 'produces_me':
            target_element = ELEMENT_PRODUCED_BY.get(dm_element)

    elif element_type == 'stem':
        target_element = STEM_ELEMENT.get(value)

    elif element_type in ('branch', 'kong_wang'):
        # kong_wang value is a branch character — same element lookup
        from app.constants import BRANCH_ELEMENT
        target_element = BRANCH_ELEMENT.get(value)

    # Add more element_type mappings in Phase 2 as needed

    if not target_element:
        return None

    # Step 2: Match against god roles
    role_map = {
        god_roles.get('favorableGod'): '喜神',
        god_roles.get('usefulGod'): '用神',
        god_roles.get('idleGod'): '閒神',
        god_roles.get('tabooGod'): '忌神',
        god_roles.get('enemyGod'): '仇神',
    }
    return role_map.get(target_element)


def get_element_explanation(
    element_type: str,
    value: str,
    pillar: str,
    god_roles: Dict[str, str],
    gender: str
) -> dict:
    """Assemble explanation from template layers.

    Always returns ALL layers (no subscription gating).
    Frontend decides what to display based on isSubscriber.

    Args:
        element_type: "ten_god" | "stem" | "branch" | etc.
        value: "正官" | "甲" | "子" | etc.
        pillar: "year" | "month" | "day" | "hour"
        god_roles: Minimal dict with favorableGod/usefulGod/idleGod/tabooGod/enemyGod
                   + dayMasterElement. Extracted on frontend before sending.
        gender: "male" | "female"
    """
    template_map = {
        'ten_god': 'ten_gods',
        'stem': 'stems',
        'branch': 'branches',
        'hidden_stem': 'hidden_stems',
        'life_stage': 'life_stages',
        'nayin': 'nayins',
        'shensha': 'shenshas',
        'seasonal_state': 'seasonal_states',
        'kong_wang': 'kong_wang',
    }

    template_file = template_map.get(element_type)
    if not template_file or template_file not in _TEMPLATES:
        return {"error": f"Unknown element type: {element_type}"}

    templates = _TEMPLATES[template_file]
    entry = templates.get(value)
    if not entry:
        return {"error": f"No template for: {value}"}

    # Layer A — generic (free tier content)
    result = {
        "generic": entry["layerA"],
    }

    # Layer B — pillar-specific
    personalized = {}
    if pillar in entry.get("layerB", {}):
        personalized["pillarMeaning"] = entry["layerB"][pillar]

    # Layer C — god role
    god_role = _determine_element_god_role(value, element_type, god_roles)

    # Kong wang uses collapsed 3-key system (5 god roles → 3 template keys)
    if element_type == 'kong_wang' and god_role:
        KONG_WANG_ROLE_MAP = {
            '喜神': 'favorable', '用神': 'favorable',
            '忌神': 'unfavorable', '仇神': 'unfavorable',
            '閒神': 'neutral',
        }
        god_role = KONG_WANG_ROLE_MAP.get(god_role, 'neutral')

    if god_role and god_role in entry.get("layerC", {}):
        raw = entry["layerC"][god_role]
        personalized["godRoleMeaning"] = _substitute_placeholders(raw, god_roles)
        personalized["godRole"] = god_role

    # Layer D — gender/六親
    if gender in entry.get("layerD", {}):
        personalized["genderMeaning"] = entry["layerD"][gender]

    result["personalized"] = personalized
    return result
```

### Step 3: FastAPI Endpoint

**File**: `packages/bazi-engine/app/main.py` (add new endpoint)

```python
class GodRolesInput(BaseModel):
    """Structured god roles — ensures dayMasterElement is always present.
    These are the EFFECTIVE god roles (post-從格 override if applicable).
    The frontend extracts these from chartData.dayMaster which already
    reflects the engine's 從格 detection and god role inversion."""
    dayMasterElement: str = Field(..., description="DM element: 木/火/土/金/水")
    strengthClassification: str = Field(..., description="DM strength: very_weak/weak/neutral/strong/very_strong")
    favorableGod: str = Field("", description="喜神 element (effective, post-從格)")
    usefulGod: str = Field("", description="用神 element (effective, post-從格)")
    idleGod: str = Field("", description="閒神 element (effective, post-從格)")
    tabooGod: str = Field("", description="忌神 element (effective, post-從格)")
    enemyGod: str = Field("", description="仇神 element (effective, post-從格)")

class ExplainElementInput(BaseModel):
    element_type: str = Field(..., description="ten_god|stem|branch|hidden_stem|life_stage|nayin|shensha|seasonal_state|kong_wang")
    value: str = Field(..., description="The element value, e.g. '正官', '甲', '子'")
    pillar: str = Field(..., description="year|month|day|hour")
    god_roles: GodRolesInput = Field(..., description="Minimal chart context with structured validation")
    gender: str = Field("male", description="male|female")

@app.post("/explain-element")
async def explain_element(input_data: ExplainElementInput):
    result = get_element_explanation(
        element_type=input_data.element_type,
        value=input_data.value,
        pillar=input_data.pillar,
        god_roles=input_data.god_roles,
        gender=input_data.gender,
    )
    return {"status": "success", "data": result}
```

**Design decisions**:
- **Minimal payload**: Frontend extracts only 6 fields from chartData (5 god role elements + dayMasterElement) instead of sending the full 50-200KB chart object. Total payload: ~200 bytes.
- **No `is_subscriber` in API**: Engine always returns all layers. Frontend gates display. Eliminates spoofability concern.
- **No `chart_data` in API**: Only the god role elements needed for Layer C mapping.

### Step 4: Frontend — Bottom Sheet Component

**File**: `apps/web/app/components/ElementExplanation.tsx` (new)
**File**: `apps/web/app/components/ElementExplanation.module.css` (new)

**Component interface**:
```typescript
interface ElementExplanationProps {
  isOpen: boolean;
  onClose: () => void;
  elementType: 'ten_god' | 'stem' | 'branch' | 'hidden_stem' | 'life_stage' | 'nayin' | 'shensha' | 'seasonal_state' | 'kong_wang';
  value: string;          // "正官", "甲", "子", etc.
  pillar: 'year' | 'month' | 'day' | 'hour';
  pillarLabel: string;    // "年柱", "月柱", "日柱", "時柱"
  chartData: BaziChartData;
  isSubscriber: boolean;
  gender: string;
}
```

**UI structure**:
```
┌──────────────────────────────────┐
│ ═══ (drag handle)                │
│                                  │
│  正官 · 時柱              [✕]    │  ← Header with element name + pillar
│ ─────────────────────────────── │
│  十神                            │  ← Category badge
│                                  │
│  正官代表規範、責任與正當的      │  ← Layer A (free, always shown)
│  權力。在十神體系中...           │
│                                  │
│  關鍵詞：紀律 地位 責任 管理     │  ← Keywords as pills
│                                  │
│  六親：男命→女兒 / 女命→丈夫    │  ← Six relations
│ ─────────────────────────────── │
│  🔒 個人化解讀                   │  ← Section divider (paid)
│                                  │
│  [IF SUBSCRIBER]:                │
│  ▸ 宮位解讀                      │  ← Layer B content
│    正官出現在你的時柱，代表...   │
│                                  │
│  ▸ 喜忌分析                      │  ← Layer C content
│    正官是你命局中的忌神...       │
│                                  │
│  ▸ 六親關係                      │  ← Layer D content
│    從六親角度看，正官在男命...   │
│                                  │
│  [IF NOT SUBSCRIBER]:            │
│  正官出現在你的時柱，代表你的... │  ← Teaser (blurred)
│  ████████████████████████████   │
│  [🔓 解鎖個人化解讀]            │  ← CTA button → subscription page
│  本命盤共有 N 個個人化解讀       │  ← Value indicator
└──────────────────────────────────┘
```

**Rendering via React Portal**: The bottom sheet is rendered using `createPortal(jsx, document.body)` to avoid z-index/overflow clipping issues from BaziChart's ancestor containers. This ensures the backdrop covers the full viewport and the sheet is never clipped by `overflow: hidden` parents.

**Bottom sheet behavior**:
- Slides up from bottom with CSS transform animation (300ms ease-out)
- Backdrop overlay (semi-transparent) — click to close
- Swipe down to close (touch events)
- Max height: 70vh (scrollable content inside)
- Mobile-first, works on desktop too
- No external library — pure CSS + minimal JS + React Portal

**CSS patterns**: Follow existing BaziChart.module.css warm theme:
- Background: `var(--bg-card)` (#FFFFFF)
- Header accent: `var(--text-accent)` (#C41E3A)
- Keywords: pill style matching existing `.shenShaItem`
- Blur effect for teaser: `filter: blur(4px)` on paid content
- CTA button: red-orange gradient matching existing paywall CTAs

**Teaser strategy (deliberate design)**: For non-subscribers, the frontend shows a blurred ~60 char preview of Layer B's `pillarMeaning` as marketing bait — "你看到的只是開頭，訂閱看完整個人化解讀". The full B/C/D content IS in the API response (inspectable via DevTools), and this is intentional: templates are educational reference content (like a textbook), not secret. The paywall gates convenience/UX, not data secrecy. This is the same model as news sites that return full article HTML but blur it with CSS.

### Step 5: Make BaziChart Table Cells Clickable

**File**: `apps/web/app/components/BaziChart.tsx` (modify)

**Changes**:

1. **Add new props** to BaziChartProps:
```typescript
interface BaziChartProps {
  data: BaziChartData;
  name?: string;
  birthDate?: string;
  birthTime?: string;
  visibleSections?: number;
  hideSections?: number[];
  // NEW:
  isSubscriber?: boolean;     // From reading page
  gender?: string;            // From chartData or form
  onElementClick?: (info: ElementClickInfo) => void;  // Optional callback
}

interface ElementClickInfo {
  elementType: 'ten_god' | 'stem' | 'branch' | 'hidden_stem' | 'life_stage' | 'nayin' | 'shensha' | 'seasonal_state' | 'kong_wang';
  value: string;
  pillar: 'year' | 'month' | 'day' | 'hour';
  pillarLabel: string;
}
```

2. **Add state** for bottom sheet:
```typescript
const [selectedElement, setSelectedElement] = useState<ElementClickInfo | null>(null);
```

3. **Wrap clickable cells** with click handler:

For ten god cells (line ~220):
```tsx
// Before:
<td className={styles.tenGodCell}>
  {p.key === "day" ? "日元" : (p.data.tenGod || "—")}
</td>

// After:
<td
  className={`${styles.tenGodCell} ${p.data.tenGod ? styles.clickableCell : ''}`}
  onClick={() => p.data.tenGod && handleElementClick('ten_god', p.data.tenGod, p.key)}
>
  {p.key === "day" ? "日元" : (p.data.tenGod || "—")}
</td>
```

**Phase 1: Make ALL cell types clickable** (not just ten gods). For types without templates yet, the `ElementExplanation` component shows a "coming soon" fallback:
```tsx
// In ElementExplanation.tsx — when API returns {"error": "No template for: ..."}
if (data?.error) {
  return <div className={styles.comingSoon}>此項目的詳細解讀即將推出，敬請期待。</div>;
}
```
This means BaziChart.tsx is fully wired in Phase 1 and never needs revisiting in Phase 2A/2B.

Similar wrapping for: stems, branches, hidden stems, life stages, nayin, shensha items, seasonal states, kong wang.

4. **Add clickable cell CSS** to BaziChart.module.css:
```css
.clickableCell {
  cursor: pointer;
  position: relative;
  transition: background-color 0.15s ease;
}

.clickableCell:hover {
  background-color: rgba(212, 160, 23, 0.06);
}

.clickableCell:active {
  background-color: rgba(212, 160, 23, 0.12);
}
```

**No `::after` pseudo-element** — the cursor + hover highlight is sufficient affordance. A one-time hint text "點擊任意欄位查看解讀" is shown above the table on first visit (tracked via localStorage).

5. **Render bottom sheet** via Portal from BaziChart:
```tsx
{selectedElement && createPortal(
  <ElementExplanation
    isOpen={!!selectedElement}
    onClose={() => setSelectedElement(null)}
    elementType={selectedElement.elementType}
    value={selectedElement.value}
    pillar={selectedElement.pillar}
    pillarLabel={selectedElement.pillarLabel}
    chartData={data}
    isSubscriber={isSubscriber ?? false}
    gender={gender ?? 'male'}
  />,
  document.body
)}
```

### Step 6: Frontend API Call

**File**: `apps/web/app/lib/element-explanation-api.ts` (new)

```typescript
const BAZI_ENGINE_URL = 'http://localhost:5001';

interface GodRoles {
  dayMasterElement: string;
  strengthClassification: string;
  favorableGod: string;
  usefulGod: string;
  idleGod: string;
  tabooGod: string;
  enemyGod: string;
}

export function extractGodRoles(chartData: BaziChartData): GodRoles {
  return {
    dayMasterElement: chartData.dayMaster.element,
    strengthClassification: chartData.dayMaster.strength,  // "very_weak"|"weak"|"neutral"|"strong"|"very_strong"
    favorableGod: chartData.dayMaster.favorableGod,
    usefulGod: chartData.dayMaster.usefulGod,
    idleGod: chartData.dayMaster.idleGod,
    tabooGod: chartData.dayMaster.tabooGod,
    enemyGod: chartData.dayMaster.enemyGod,
  };
}

// Cache scoped to component lifecycle via useRef in the calling component.
// This hook-based approach resets cache on unmount (page navigation).
// Usage: const cacheRef = useRef(new Map<string, ElementExplanationData>());
//        pass cacheRef.current to fetchElementExplanation as optional param.

export async function fetchElementExplanation(
  params: {
    elementType: string;
    value: string;
    pillar: string;
    godRoles: GodRoles;
    gender: string;
  },
  cache?: Map<string, ElementExplanationData>
): Promise<ElementExplanationData> {
  const cacheKey = `${params.elementType}:${params.value}:${params.pillar}:${params.gender}`;
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  const response = await fetch(`${BAZI_ENGINE_URL}/explain-element`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      element_type: params.elementType,
      value: params.value,
      pillar: params.pillar,
      god_roles: params.godRoles,
      gender: params.gender,
    }),
  });
  const data = await response.json();
  cache?.set(cacheKey, data.data);
  return data.data;
}
```

**Payload optimization**: `extractGodRoles()` pulls only the 6 needed fields (~200 bytes) from chartData, replacing the previous design of sending the full 50-200KB chart object.

**Cache key includes `gender`**: Prevents stale data if the same session somehow serves both genders (e.g., compatibility readings showing two charts).

### Step 7: Wire Into Reading Pages

**Files to modify** (only 2 files — the codebase uses a dynamic route):
- `apps/web/app/reading/[type]/page.tsx` (handles 八字終身運, 事業詳批, 愛情姻緣, 流年運勢, health, all ZWDS types)
- `apps/web/app/reading/compatibility/page.tsx` (合盤 — if it renders BaziChart)

**Changes per page**: Pass `isSubscriber` and `gender` props to `<BaziChart>`:

```tsx
<BaziChart
  data={chartData}
  name={formValues?.name}
  birthDate={formValues?.birthDate}
  birthTime={formValues?.birthTime}
  isSubscriber={isSubscriber || isPaidReading}  // existing state
  gender={chartData?.gender || formValues?.gender || 'male'}
/>
```

No other changes needed — BaziChart handles everything internally.

### Step 8: Tests

**Python tests**: `packages/bazi-engine/tests/test_explanations.py`
- Test template loading (all files parse correctly)
- Test template loading with missing directory (graceful fallback)
- Test `get_element_explanation()` returns all layers (generic + personalized)
- Test god role mapping chain: ten god → element → match against god roles
  - e.g., DM=甲木, 正官(overcomes_me)→金, if tabooGod=金 → godRole=忌神
  - e.g., DM=甲木, 食神(i_produce)→火, if favorableGod=火 → godRole=喜神
- Test edge cases: unknown element type, missing value, pillar with no Layer B entry
- Test all 10 ten gods have valid template entries

**Frontend tests** (if test infrastructure exists):
- Test bottom sheet open/close via Portal
- Test free vs subscriber rendering (free shows blur + CTA, subscriber shows all)
- Test API call with correct minimal payload
- Test cache hit/miss behavior

---

## Phase 2A: Simple Types (after Phase 1 confirmed — ~400 entries)

These types follow the standard pattern with no or minimal engine logic changes. All cells are already clickable from Phase 1 — just add JSON template files and extend `_determine_element_god_role()` where needed.

### 天干 (Heavenly Stems)
- **Layer A**: 10 entries (甲-癸), each with element象意, 陰陽特質
- **Layer B**: 4 pillar versions × 10 = 40 entries. 年/月/時 explain pillar context; 日柱天干 = Day Master itself → show dedicated DM explanation (e.g., "甲木是你的日主，代表你的本質...")
- **Layer C**: 5 god roles × 10 = 50 entries (based on the stem's element vs DM's god system)
- **Layer D**: Gender-specific only where the resulting ten god has gender-variant 六親
- **Total**: ~110 entries

### 地支 (Earthly Branches)
- **Layer A**: 12 entries (子-亥), each with element, 生肖, 季節, 基本象意. **Must include static reference info for each branch**:
  - 六合 partner (e.g., 子丑合土, 寅亥合木, 卯戌合火, 辰酉合金, 巳申合水, 午未合火/土)
  - 六沖 opponent (e.g., 子午沖, 丑未沖, 寅申沖, 卯酉沖, 辰戌沖, 巳亥沖)
  - 三合局 group (e.g., 子 → 申子辰水局, 丑 → 巳酉丑金局)
  - 三會局 group (e.g., 子 → 亥子丑會水局)
  - This is static text (no live computation needed) — serves as educational reference so users can check their own chart for interactions.
- **Layer B**: 4 pillar versions × 12 = 48. Focus on 宮位 meaning: 年支=母親/童年, 月支=事業/社交, 日支=配偶宮, 時支=子女/晚年
- **Layer C**: 5 god roles × 12 = 60 (based on branch's main element vs DM's god system)
- **Layer D**: Gender variant for 日支 (配偶宮 interpretation differs)
- **Total**: ~130 entries

---

## Phase 2B: Complex Types (after Phase 2A confirmed — ~635 entries)

These types require additional engine logic, special click handling, or significantly more content. No frontend changes needed — all cells already clickable from Phase 1.

### 藏干 (Hidden Stems)
- **Layer A**: 12 entries (by branch: 子藏癸, 丑藏己癸辛, etc.), explaining 本氣/中氣/餘氣 concept. **Must include 透干/通根 concept**: explain that when a hidden stem also appears as a manifest stem (天干) elsewhere in the chart, it is called "透干" — its power is dramatically amplified ("打開了倉庫之門"). Conversely, a hidden stem that stays buried (藏而不透) only represents latent/hidden potential, not active influence. Also explain "虛浮/無根" — when a manifest stem has no corresponding hidden stem support in any branch, it lacks root and is weak. This is a CORE concept every real Bazi master uses when assessing hidden stems.
- **Layer B**: 4 pillar versions × 12 = 48. Focus: what it means for this hidden ten god to be buried in this pillar (including 日柱 = 配偶宮的隱藏能量). Each pillar version should include: "若此藏干透出天干（即其他柱的天干中也出現同一五行），則其力量大增，影響更為明顯。"
- **Layer C**: 5 god roles × 12 = ~60 (based on the specific hidden stem's ten god)
- **Layer D**: Gender variant where hidden ten god has 六親 significance
- **Total**: ~130 entries
- **Implementation note**: When user clicks a specific hidden stem (e.g., the 丙 in 寅), the `value` passed should be the hidden stem character + its ten god, not just the branch. The frontend needs to track which hidden stem was clicked.

### 十二運 (Twelve Life Stages)
- **Layer A**: 12 entries (長生-養), each with lifecycle metaphor
- **Layer B**: 4 pillar versions × 12 = 48. Focus on life-phase mapping (年=童年, 月=事業, 日=婚姻/自我, 時=晚年)
- **Layer C**: 5 god roles × 12 = 60 (how the stage interacts with DM strength)
- **Layer D**: Not needed (life stages are gender-neutral in interpretation)
- **Total**: ~120 entries

### 納音 (Nayin)
- **Layer A**: 30 unique nayin names (海中金, 爐中火, etc.), grouped from 60 Jiazi pairs. Each Layer A entry should also note:
  - The nayin's 正五行 vs 納音五行 contrast (e.g., 甲子 = Wood stem but 海中金 nayin — surface Wood nature with hidden Gold essence)
  - Brief mention that 納音 analysis also involves cross-pillar interactions (年柱納音 vs 其他柱 的生剋關係), even though the encyclopedia entry focuses on single-pillar meaning
- **Layer B**: 4 pillar versions × 30 = 120. Focus: 年柱納音 = 本命, other pillars = supplementary
- **Layer C**: Simplified — 2 versions per nayin (favorable vs unfavorable based on whether nayin element matches 用神/忌神). 30 × 2 = 60
- **Layer D**: Not needed
- **Total**: ~210 entries
- **Note**: 納音 is lower priority in modern 子平 school. Templates can be shorter.

### 神煞 (Shensha / Special Stars)
- **Layer A**: Entries for ALL stars calculated by `shen_sha.py` (cross-reference at implementation time to ensure 1:1 coverage — no calculated star should lack an encyclopedia entry). Each with basic meaning + auspicious/malefic classification.
- **Layer B**: 4 pillar versions per star = ~140. This is where the gold is: 桃花 in 年月 vs 日時 has completely different meaning (墻外 vs 墻內). Key stars to give extra attention: 天德/月德(separate entries), 金輿, 紅鸞/天喜, 孤辰/寡宿, 亡神/劫煞.
- **Layer C**: 3 versions per shensha (as 喜神/neutral/忌神 — simplified from 5 because shensha interaction with god system is more binary). ~105 entries
- **Layer D**: Gender variant for select shensha (桃花, 紅鸞, 天喜, 孤辰寡宿, 勾絞煞 differ by gender). ~15 entries
- **Total**: ~295+ entries
- **Note**: Largest template set. Write in batches: (1) major auspicious, (2) malefic, (3) minor/specialized.

### 旺相休囚死 (Seasonal States)
- **Layer A**: 5 entries (旺/相/休/囚/死), each explaining the state concept
- **Layer B**: Not pillar-specific (seasonal states apply to elements, not pillars). Instead, Layer B explains which season produces this state for the clicked element and its seasonal context.
- **Layer C**: Element-role conditional matrix — 5 states × 5 god roles = **25 entries**. The correct interpretation chain: first determine the element's seasonal state, then cross-reference with its god role. Example entries:
  - 旺 + 用神: "你的用神在當季處於最旺盛的狀態，這是極為有利的配置。用神得令，代表你命中最需要的力量在這個季節獲得天然的加持。"
  - 旺 + 忌神: "你的忌神在當季處於最旺盛的狀態，這會放大其不利的影響。忌神得令意味著對你不利的力量在這個季節特別強勢，需要更加注意。"
  - 死 + 用神: "你的用神在當季處於最衰弱的狀態。用神失令代表你最需要的助力在這個季節先天不足，需要透過大運、流年或後天努力來補強。"
- **Layer D**: Not needed
- **Total**: ~35 entries

### 空亡 (Kong Wang / Void)
- **Layer A**: 1 entry explaining the concept of 空亡: two branches per 旬 that are "void" — 有其氣無形, 有名無實. Explain 真空 vs 假空 distinction: if the void branch is 沖/合/刑 by other branches in the chart, it's "假空" (not truly void). Only uncontacted void branches are "真空".
- **Layer B**: 4 pillar versions:
  - 年柱空亡: 與祖業緣薄，童年動盪，難得祖輩實質幫助，需白手起家
  - 月柱空亡: 兄弟姐妹緣薄，事業多變，性格偏獨立
  - 日支空亡: 配偶緣薄，婚姻需特別注意，中年家庭/事業多阻
  - 時柱空亡: 子女緣薄，晚年較孤寂，與子女關係疏遠
- **Layer C**: 3 versions using collapsed god role mapping:
  - **favorable** (喜神 or 用神 空亡): "你最需要的助力處於空亡狀態，代表這份幫助可能來得晚或不穩定，需要靠自身努力補強。"
  - **unfavorable** (忌神 or 仇神 空亡): "對你不利的力量處於空亡狀態，反而是好事——不利因素被削弱，減少了阻礙。"
  - **neutral** (閒神 空亡): "此空亡所涉及的五行對你影響中性，空亡的效果不明顯。"
  - **God role collapsing**: The engine maps 5 god roles → 3 keys: `_determine_element_god_role()` returns 喜神/用神 → template key "favorable", 忌神/仇神 → "unfavorable", 閒神 → "neutral". This collapsing is specific to `kong_wang` type.
- **Layer D**: Not needed
- **Total**: ~8 entries
- **Implementation note**: When user clicks a 空亡 branch in the chart:
  - `elementType` = `kong_wang`
  - `value` = the void branch character (e.g., "戌")
  - `pillar` = which pillar position the void branch falls in. E.g., if 空亡 is 戌亥 and 年支 is 戌, then `pillar` = "year". The BaziChart currently shows 空亡 branches globally — the frontend needs to determine which pillar(s) contain a void branch and pass the correct `pillar` for context. Layer B explains what it means for THAT pillar to have a void branch.

### Phase 2A + 2B Total: ~1040 template entries (across all 9 types)

---

## Bonus Phase: Cross-Pillar Interaction Checks (after Phase 2 complete)

To be considered ONLY after all Phase 1 + Phase 2 element types are implemented and tested. These are advanced features that require additional engine computation.

### 十神 Cross-Interactions (食神制殺, 傷官見官, etc.)
When user clicks a ten god, the engine checks if its key interaction partner exists in other pillars and adds a contextual note. E.g., clicking 食神 in 月柱 → engine detects 七殺 in 時柱 → adds: "你的命盤中食神與七殺同時出現，形成「食神制殺」的格局——以智慧化解壓力，是非常有力的組合。"

**Implementation**: New engine function `detect_ten_god_interactions(chart_data)` returns list of active interactions. The explanation endpoint includes these as an optional `interactions` field in the response.

### 地支 Cross-Pillar Interactions (六合/六沖/三合/三刑)
When user clicks a branch, the engine checks if it forms 六合/六沖/三合/三刑 with branches in other pillars and adds contextual notes. E.g., clicking 子 in 日支 → engine detects 午 in 月支 → adds: "你的日支子與月支午形成「子午沖」——配偶宮與事業宮之間存在衝突張力，婚姻與事業可能需要更多平衡。"

**Implementation**: New engine function `detect_branch_interactions(chart_data, target_pillar)` returns list of active interactions for the clicked branch.

### 藏干 透干 Detection
When user clicks a hidden stem, the engine checks if the same stem appears as a manifest stem in any other pillar. E.g., clicking hidden 甲 in 日支寅 → engine detects 甲 in 年干 → adds: "此藏干甲木已透出年干，力量大增——這不只是隱藏的潛力，而是已經展現出來的實際影響力。"

**Implementation**: Simple check — compare hidden stem character against all 4 manifest stems.

---

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `packages/bazi-engine/data/explanations/ten_gods.json` | Ten god templates (Phase 1) |
| `packages/bazi-engine/data/explanations/stems.json` | Heavenly stem templates (Phase 2) |
| `packages/bazi-engine/data/explanations/branches.json` | Earthly branch templates (Phase 2) |
| `packages/bazi-engine/data/explanations/hidden_stems.json` | Hidden stem templates (Phase 2) |
| `packages/bazi-engine/data/explanations/life_stages.json` | Twelve life stage templates (Phase 2) |
| `packages/bazi-engine/data/explanations/nayins.json` | Nayin templates (Phase 2) |
| `packages/bazi-engine/data/explanations/shenshas.json` | Shensha templates (Phase 2) |
| `packages/bazi-engine/data/explanations/seasonal_states.json` | Seasonal state templates (Phase 2) |
| `packages/bazi-engine/data/explanations/kong_wang.json` | Kong Wang (空亡) templates (Phase 2) |
| `packages/bazi-engine/app/explanations.py` | Template loader + assembly logic |
| `packages/bazi-engine/tests/test_explanations.py` | Tests for explanation engine |
| `apps/web/app/components/ElementExplanation.tsx` | Bottom sheet UI component (rendered via Portal) |
| `apps/web/app/components/ElementExplanation.module.css` | Bottom sheet styles |
| `apps/web/app/lib/element-explanation-api.ts` | Frontend API client with session cache |

### Modified Files
| File | Changes |
|------|---------|
| `packages/bazi-engine/app/main.py` | Add `POST /explain-element` endpoint |
| `apps/web/app/components/BaziChart.tsx` | Add click handlers, new props, Portal-render bottom sheet |
| `apps/web/app/components/BaziChart.module.css` | Add `.clickableCell` styles (cursor + hover only, no ::after icon) |
| `apps/web/app/reading/[type]/page.tsx` | Pass `isSubscriber`, `gender` to BaziChart |
| `apps/web/app/reading/compatibility/page.tsx` | Pass `isSubscriber`, `gender` to BaziChart (if it renders BaziChart) |

---

## Implementation Order

### Phase 1: Infrastructure + 十神 (end-to-end)
1. **Create directory structure** + `ten_gods.json` with all 10 ten god templates (Layer A + B + C + D)
2. **Write `explanations.py`** — template loader (with graceful fallback) + `get_element_explanation()` + `_determine_element_god_role()` + `_substitute_placeholders()`
3. **Add FastAPI endpoint** — `POST /explain-element` in `main.py` (minimal payload: god_roles only)
4. **Write Python tests** — template loading, graceful fallback, layer assembly, god role mapping, placeholder substitution
5. **Build `ElementExplanation` component** — bottom sheet via React Portal with free/paid sections + "coming soon" fallback for types without templates
6. **Build `element-explanation-api.ts`** — frontend API client with `extractGodRoles()` helper + session cache (keyed by elementType:value:pillar:gender)
7. **Make ALL BaziChart cells clickable** — add click handlers for ALL 9 types + `.clickableCell` CSS + one-time hint text. Types without templates show "coming soon" fallback.
8. **Wire into reading pages** — pass `isSubscriber` + `gender` props in `[type]/page.tsx` + `compatibility/page.tsx`
9. **End-to-end testing** — click ten gods (free + subscriber views), click other types (verify "coming soon" fallback)

### Phase 2A: Simple Types (~400 entries, content-focused)
1. **Write JSON templates**: `stems.json`, `branches.json`, `life_stages.json`, `kong_wang.json`, `seasonal_states.json`
2. **Extend `_determine_element_god_role()`**: Add `life_stage`, `nayin`, `shensha`, `seasonal_state` element mapping (minor code changes)
3. **Add Kong Wang collapsing logic** in `get_element_explanation()` (already designed in plan)
4. **Add seasonal states 5×5 matrix** template structure
5. **Write tests** for new element types
6. **Review + test** — verify all 5 types display correctly, "coming soon" fallback disappears for implemented types

### Phase 2B: Complex Types (~635 entries, content + engineering)
1. **藏干 click tracking**: Update frontend to pass specific hidden stem character + ten god as `value` (not just branch name). Requires modifying the hidden stem cell click handler in BaziChart.tsx.
2. **Write `hidden_stems.json`** — including 透干/通根 concept in Layer A
3. **納音 element extraction**: Add nayin name → element mapping table (海中金→金, 爐中火→火, etc.). Write `nayins.json`.
4. **神煞 engine logic**: Add shensha → element mapping (some shensha don't have a clear five-element). Write `shenshas.json` in batches (major auspicious → malefic → minor).
5. **Write tests** for all 3 complex types
6. **Review + test** — verify all types, no "coming soon" remaining

### Bonus Phase: Cross-Pillar Interactions (after all phases complete)
- 十神 cross-interaction detection
- 地支 六合/六沖/三合/三刑 detection
- 藏干 透干 live detection

---

## Design Decisions & Trade-offs

| Decision | Chosen | Alternative | Why |
|----------|--------|-------------|-----|
| Template storage | JSON files | Python dicts / DB | Editable without code changes, future admin page ready |
| Explanation assembly | Python engine | Frontend-only | Engine has chart context (god roles), keeps logic server-side |
| API payload | Minimal god_roles (~200 bytes) | Full chart_data (50-200KB) | Every cell click triggers this — must be lightweight |
| Subscription gating | Frontend-only (engine returns all layers) | Server-side is_subscriber check | Templates are educational content, not secret. Eliminates spoofability concern without security theater |
| Bottom sheet rendering | React Portal at document.body | Child of BaziChart | Avoids z-index/overflow clipping from ancestor containers |
| Clickable affordance | Cursor + hover highlight only | ::after ⓘ icon per cell | Icons clutter tight table cells; hint text + hover is sufficient |
| Bottom sheet vs modal | Bottom sheet | Modal / Tooltip / Side panel | Mobile-first, less intrusive, natural for reference content |
| No AI narration | Pre-computed templates | AI-generated | Zero latency, zero API cost, consistent quality, deterministic |
| All-access subscription | Subscribers see all | Per-click credits | Encourages exploration, matches user request |
| Phase 1 scope | Ten gods only | All 8 types | Validate UX + architecture before scaling content |
| Reading page files | `[type]/page.tsx` (1 dynamic route) | 4 separate page files | Matches actual codebase structure |

---

## Review History

### Round 1 — 9 issues found, all addressed:
1. ✅ (Low) Removed ::after ⓘ icon — use cursor + hover + hint text instead
2. ✅ (Low) Fixed Phase 2 Layer B counts to include day pillar where applicable
3. ✅ (Low) Added gender to session cache key
4. ✅ (Medium) Updated to use actual file paths: `[type]/page.tsx` + `compatibility/page.tsx`
5. ✅ (Medium) Removed `is_subscriber` from API — engine always returns all layers, frontend gates display
6. ✅ (Medium) Added try/except with warning log to `_load_templates()`
7. ✅ (Medium) Spelled out full `_determine_element_god_role()` mapping chain with code
8. ✅ (Medium) Bottom sheet rendered via React Portal at `document.body`
9. ✅ (High) Replaced full `chart_data` payload with minimal `god_roles` (~200 bytes)

### Round 2 (Staff Engineer) — 5 issues found, all addressed:
1. ✅ (Low) Specified pillar key convention: always English (`year/month/day/hour`) in templates + frontend
2. ✅ (Low) Per-file error handling in `_load_templates()` — one bad JSON file doesn't block others
3. ✅ (Low) Cache scoped to component lifecycle via `useRef` instead of module-level Map
4. ✅ (Medium) `god_roles` uses structured `GodRolesInput` Pydantic model with `dayMasterElement` required
5. ✅ (Medium) Documented teaser as deliberate marketing design — Layer B preview is intentional, not a leak

### Round 3 (Bazi Master Domain Review R1) — 10 issues found, all addressed:
1. ✅ (High) Strong DM 用神/喜神 convention disagreement — added disclaimer note to Layer C templates
2. ✅ (Medium) Missing Layer B for day pillar ten gods (夫妻宮) — added day pillar variant
3. ✅ (High) 從格 inverted god roles — use effective god roles from engine (post-從格 override)
4. ✅ (Medium) 合化 transforms ten god element — added note in Layer C about 天干合化 impact
5. ✅ (Medium) 六親 mapping incomplete — added complete 十神六親表 with primary + extended relations
6. ✅ (Low) 35 神煞 coverage — cross-reference against `shen_sha.py` to ensure 1:1 coverage
7. ✅ (Medium) 十二運 needs pillar-specific variants — confirmed in Phase 2 with 4 pillar versions
8. ✅ (Medium) 旺相休囚死 Layer C cross-reference backwards — restructured as 5×5 element-role matrix
9. ✅ (Low) 納音 missing cross-pillar dimension — added 正五行 vs 納音五行 contrast note in Layer A
10. ✅ (Low) 正官 Layer A missing 合官 concept — added to Layer A content guidelines

### Round 4 (Bazi Master Domain Review R2) — 2 issues found, all addressed:
1. ✅ (Low) Duplicate constant definitions in `explanations.py` — changed to import from `app.constants`
2. ✅ (Medium) 六親 table error: 正財 female = 父親 is wrong — corrected to 正當財運/繼父(部分流派). 父親 = 偏財 for both genders.

### Round 5 (Accuracy Gap Analysis) — 7 gaps found, 6 addressed (1 skipped):
1. ✅ (High) 藏干 missing 透干/通根 core concept — added to Layer A content + Layer B contextual note
2. ✅ (Medium) 空亡 missing as clickable type — added as 9th element type with pillar-specific Layer B
3. ✅ (High) Layer C missing DM strength reasoning — added `strengthClassification` to GodRolesInput + conditional sentence strategy
4. ⏭️ (Low) 十二運 陰干逆行 school dispute — SKIPPED per user decision
5. ✅ (Medium) 十神 cross-interactions (食神制殺, 傷官見官) — added key interaction pairs to Layer A content guidelines + deferred live detection to Bonus Phase
6. ✅ (Medium) 地支 六合/六沖/三合 reference info — added static reference to Layer A content + deferred live detection to Bonus Phase
7. ✅ (High) GodRolesInput missing `strengthClassification` — added field, updated frontend extractGodRoles()

### Round 6 (Sub-Review of accuracy fixes) — 4 issues found, all addressed:
1. ✅ (Low) 空亡 Layer C: 5 god roles → 3 template keys collapsing logic specified (favorable/unfavorable/neutral)
2. ✅ (Low) 空亡 `pillar` semantics clarified: pillar = which pillar position the void branch falls in
3. ✅ (Medium) `{strengthLabel}` placeholder substitution: added `_substitute_placeholders()` helper with defined placeholders + STRENGTH_LABEL_MAP
4. ✅ (Medium) 5 strength values → 3 buckets: explicit collapsing (very_strong+strong→偏強, very_weak+weak→偏弱, neutral→中和)

### Round 7 (Sub-Review R2) — 2 issues found, all addressed:
1. ✅ (Medium) Kong wang 5→3 collapsing not in main function code — added KONG_WANG_ROLE_MAP inline in `get_element_explanation()`
2. ✅ (Medium) `_substitute_placeholders()` not wired into main function — updated Layer C lookup to call `_substitute_placeholders(raw, god_roles)`
3. ✅ (Medium) `_determine_element_god_role()` missing `kong_wang` case — merged with `branch` case: `elif element_type in ('branch', 'kong_wang')`
