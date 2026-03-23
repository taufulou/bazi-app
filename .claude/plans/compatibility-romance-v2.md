# 感情合盤 V2 — Comprehensive Implementation Plan (Rev 3)

## Overview

Replace the current 合盤比較 romance path with a Seer-level 感情合盤 feature, using the same architectural patterns as 八字愛情姻緣 (Love V2):
- **Python deterministic pre-analysis** → **AI narration** → **Paywall + streaming display**
- Keep the existing 8-dimension scoring engine as the backbone (with romance-specific calibration)
- Add 7 NEW pre-analysis functions for sections Seer covers but we don't
- Redesign the frontend to match Love V2's warm theme, section structure, and paywall flow

### What Stays (Our Strengths)
- 8-dimension enhanced scoring engine (with romance-specific sigmoid + knockout calibration)
- Radar chart (shown as free summary at top)
- Cross ten god analysis & landmines
- Yongshen complementarity matrix
- Three-layer architecture (engine → pre-analysis → AI narration)
- Anti-hallucination strategy (AI narrates, never computes)
- Granular DM strength (numeric score + 5-level: 極弱/偏弱/中和/偏旺/極旺)

### What Changes
- New pre-analysis functions for: 旺夫旺妻, 婚前婚後財富, 婚後甜蜜度/穩定度, 婚變預測, 流年感情運
- New AI prompt with 18 section keys (matching Seer's structure + our extras)
- Three-call AI architecture (per-person, cross-chart, crisis+annual) — see Token Budget
- Frontend redesigned: side-by-side form → radar summary (free) → paywall → detailed sections (paid)
- Business/friendship comparison types remain COMPLETELY UNCHANGED
- 納音 display added to chart profiles
- Educational framing section (正確看待克夫克妻)
- Three-scenario annual forecast (單身/熱戀/已婚)

### Key Calibration Changes — ROMANCE ONLY
All calibration changes are **comparison-type-specific** to avoid affecting business/friendship scores.

1. **Sigmoid steepness**: Pass `steepness=0.07` for romance (default 0.10 for others)
2. **Knockout cap**: Apply `KNOCKOUT_PENALTY_CAP = -12` for romance only (separate bonus/penalty tracking)
3. **納音 bonus**: +4 for identical year-pillar 納音 (romance only)
4. **Cross-position weight**: `CROSS_PILLAR_BRANCH_DEFAULT_WEIGHT_ROMANCE = 0.2` (others keep 0.3)
5. **Score floor**: If `spouse_palace_score > 65`, floor = 30. Knockout hard floors take precedence.

**Order of operations**: sigmoid(0.07) → separate bonus/penalty sums → cap penalties at -12 → add bonus+penalty → knockout hard floors (overrides all) → spouse palace floor (only if no hard floor) → clamp [5,99]

### Decision: 空亡 — Day-Pillar Only (子平法)
>90% of modern practitioners use day-pillar 空亡. 《神白經》: "空亡只用生日旬中空亡極緊". We implement day-pillar 空亡 only.

### Decision: 合婚危機 Cross-Pillar Scope
Classical 合婚 uses **same-position matching** (年對年, 月對月, 日對日, 時對時). Full 16-pair cross-pillar analysis has ~79% false-positive rate for random couples.

- **Crisis detection**: Same-position pairs only (4 pairs), day-day highest
- **Scoring (Dimension 6)**: All 16 pairs for depth, but cross-position weight = 0.2 (romance)
- **Tier system**: Tier 1 (Crisis): 日支六沖/天剋地沖. Tier 2 (Warning): 年月支六沖/日支六害/合化忌神. Tier 3 (Note): Cross-position hitting day branch. Tier 4 (Background): scoring only.

---

## Section Mapping

| # | Section | Key | AI Call | Notes |
|---|---------|-----|---------|-------|
| 0 | 配對指數 + 雷達圖 | _(engine-only, no AI key)_ | N/A | **FREE** — rendered from 8-dim engine |
| 1 | 男方命局特點 | `chart_profile_a` | Call 1 | Per-person |
| 2 | 女方命局特點 | `chart_profile_b` | Call 1 | Per-person |
| 3 | 男方戀愛性格 | `love_personality_a` | Call 1 | Per-person |
| 4 | 女方戀愛性格 | `love_personality_b` | Call 1 | Per-person |
| 5 | 旺妻/旺夫 (男) | `spouse_enrichment_a` | Call 1 | Per-person |
| 6 | 旺夫/旺妻 (女) | `spouse_enrichment_b` | Call 1 | Per-person |
| 7 | 男方婚前婚後財富 | `marriage_wealth_a` | Call 1 | Per-person |
| 8 | 女方婚前婚後財富 | `marriage_wealth_b` | Call 1 | Per-person |
| 9 | 正確看待克夫克妻 | `ke_fu_ke_qi_education` | _(static)_ | **Frontend-rendered**, not AI |
| 10 | 婚後感情甜蜜度 | `post_marriage_sweetness` | Call 2 | Cross-chart |
| 11 | 婚後生活穩定度 | `post_marriage_stability` | Call 2 | Cross-chart |
| 12 | 男方婚變預測 | `marriage_crisis_a` | Call 2 | Per-person crisis |
| 13 | 女方婚變預測 | `marriage_crisis_b` | Call 2 | Per-person crisis |
| 14 | 兩人合婚危機分析 | `combined_crisis_analysis` | Call 2 | Same-position tiered |
| 15 | 經營婚姻建議 | `marriage_advice` | Call 2 | Cross-chart advice |
| 16 | 男方流年感情運 | `annual_love_a` | Call 3 | 三情境 format |
| 17 | 女方流年感情運 | `annual_love_b` | Call 3 | 三情境 format |
| 18 | 感情綜合總結 | `compatibility_summary` | Call 3 | Closing summary |

**Section 0** is NOT an AI section — rendered from engine data. Not in `COMPAT_ROMANCE_V2_SECTION_KEYS`.
**Section 9** is static educational content rendered by the frontend. Not in AI calls.
**Total AI sections**: 16 (across 3 calls)

### Token Budget & Three-Call Architecture

Each section's `full` averages ~400-600 chars (~200-300 tokens). With 16 AI sections:
- **Call 1 (8 per-person sections)**: ~2400 tokens output. Well within limits.
- **Call 2 (6 cross-chart + crisis sections)**: ~1800 tokens output. Safe.
- **Call 3 (2 annual + summary)**: ~1200 tokens output (annual sections are longer with 三情境). Safe.

This is safer than a 2-call approach and matches Love V2's proven streaming pattern.

---

## Phase 1: Python Pre-Analysis Functions

### File: `packages/bazi-engine/app/compatibility_romance_preanalysis.py` (NEW)

All functions in this file are specific to romance V2. Existing `compatibility_preanalysis.py` is NOT modified.

### Function 1: `compute_individual_love_personality(chart, gender)`

**Purpose**: Pillar-position-specific personality traits (Seer's approach)

**Pillar-position trait mapping**: Scan each pillar position for its ten god (relative to DM) and generate specific trait descriptions. This is MORE GRANULAR than aggregate archetype.

```python
PILLAR_POSITION_TRAITS = {
    'year_stem': {
        '食神': '外在表現溫和有禮，給人良好第一印象',
        '傷官': '外在表現才華洋溢但銳利',
        '正財': '給人務實穩重的第一印象',
        # ... all 10 ten gods
    },
    'month_stem': { ... },  # inner character
    'hour_stem': { ... },   # late life / expression
}
```

**Additional checks**:
- 正印 strength → if weak + 五行缺水: "做事刻板缺乏靈活"
- 日支 content for intimate personality (夫妻宮 ten gods)
- DM strength impact: 極弱 → "順從型，容易在感情中委曲求全"
- **Unknown birth time guard**: If hour pillar is None/placeholder, skip `hour_stem` traits and add `hourUnknown: True` flag.

**Output**:
```python
{
  "archetype": "衝勁行動型",
  "pillarTraits": [
    {"position": "year_stem", "tenGod": "正印", "trait": "外在給人溫暖包容的第一印象"},
    {"position": "month_stem", "tenGod": "比肩", "trait": "內心堅持自我，不輕易妥協"},
    {"position": "hour_stem", "tenGod": "食神", "trait": "感情表達豐富，與子女關係融洽"},
  ],
  "strengths": ["感情豐富", "積極主動"],
  "weaknesses": ["衝動行事", "缺乏計謀"],
  "dmStrengthImpact": "偏弱（39分），核心能量不足",
  "elementPersonality": "火性格：熱情直率但容易急躁",
  "hourUnknown": False,
}
```

### Function 2: `compute_spouse_enrichment(chart, gender, effective_gods)`

**Purpose**: 旺夫/旺妻 scoring (0-100)

**Weights** (夫妻宮重於夫妻星):

For FEMALE (旺夫):
1. **Day branch (夫妻宮) quality** (0-35 pts) — HIGHEST
   - = 用神: +35, = 喜神: +25, contains 正官 or 財生官: +20
   - 空亡 (day-pillar): -15, internally clashed: -10, 傷官 in palace: -15
2. **Officer star status** (0-25 pts)
   - 正官 pure + rooted: +20, = 用/喜: +25, 傷官見官: -15, 官殺混雜: -10
3. **DM strength** (0-20 pts)
   - 偏旺/身旺: +20, 中和: +15, 偏弱: +10, 極弱: +5
4. **Productive cycle** (0-20 pts)
   - 食神制殺: +15, 食神生財→財生官: +20, 傷官帶財: +12, 傷官合殺: +12

For MALE (旺妻): Mirror logic with 正財/偏財/比劫.

**Score mapping**: 80-100 非常旺 / 60-79 較好 / 40-59 一般 / 20-39 較弱 / 0-19 明顯克

### Function 3: `compute_marriage_wealth(chart, gender, effective_gods, luck_periods)`

**天干伏吟 — BROADER DEFINITION**:
```python
def detect_broad_tiangan_fuyin(natal_stems, lp_stem, dm):
    """Detect if LP stem's ten-god-type matches any natal stem's ten-god-type."""
    lp_tg = derive_ten_god(dm, lp_stem)
    for ns in natal_stems:
        if ns == dm: continue
        if derive_ten_god(dm, ns) == lp_tg:
            return True, lp_tg
    return False, None
```

**Spouse palace support (填實/坐虛)**:
- 填實: day branch NOT in day-pillar 空亡 + hidden stems include 用/喜 element
- 坐虛: day branch in 空亡 OR hidden stems are all 忌/仇

**"婚後N年"**: Remaining years in the post-marriage 大運 period (not fixed).

**Unknown birth time**: If hour is unknown, 天干伏吟 check skips hour stem. Flag `hourUnknown`.

### Function 4: `compute_post_marriage_quality(chart_a, chart_b, cross_data)`

**Sweetness** (0-100): Day stem 五合 +30, 食神透幹 +15/person, Day branch 六合 +25 / 半合 +15, Cross ten gods nurturing +15. Penalties: 傷官 -15, Day branch clash -25, 比劫 -10.

**Stability** (0-100): No 牆外桃花 +20, Year pillars compatible +15, Pure spouse stars +20, No internal day branch clash +20, Communication gods +15. Penalties: 桃花 in hour -15, 官殺混雜 -15, 偏正財混雜 -15.

**Identical charts guard**: If `chart_a == chart_b` (same four pillars), return early with `{"sweetness": {"score": 0, "note": "identical_charts"}, "stability": {"score": 0, "note": "identical_charts"}}`.

### Function 5: `compute_marriage_crisis_risk(chart, gender, effective_gods)`

Per-person crisis. Male checks: 傷官透出, 羊刃無制, 比劫奪財, 日支被沖, 偏正財混雜. Female checks: 官殺混雜, 傷官見官, 財星透出, 日支被沖, 日支空亡. Unknown hour: skip hour-related checks, flag.

### Function 6: `compute_combined_crisis_assessment(chart_a, chart_b, enhanced_data)`

**Same-position crisis detection with tiered flagging**:

```python
def compute_combined_crisis_assessment(chart_a, chart_b, enhanced_data):
    """
    Check same-position branch pairs for crisis/warning.

    Variable extraction:
    - branches: chart['four_pillars'][pos]['branch'] for pos in [year,month,day,hour]
    - dm: chart['day_master']
    - minggong_branch: chart['extra_pillars']['ming_gong']['branch']
    - effective_gods: chart['effective_gods']
    - cross_stem_combos: enhanced_data.get('stemCombinations', [])
    """
    branches_a = [chart_a['four_pillars'][p]['branch'] for p in ['year','month','day','hour']]
    branches_b = [chart_b['four_pillars'][p]['branch'] for p in ['year','month','day','hour']]

    crisis_flags, warning_flags, note_flags = [], [], []

    # Same-position branch check
    for i, pos in enumerate(['year', 'month', 'day', 'hour']):
        br_a, br_b = branches_a[i], branches_b[i]
        if is_liuchong(br_a, br_b):
            (crisis_flags if pos == 'day' else warning_flags).append(...)
        if is_liuhai(br_a, br_b):
            (warning_flags if pos == 'day' else note_flags).append(...)

    # 天剋地沖 (day pillar)
    dm_a, dm_b = chart_a['day_master'], chart_b['day_master']
    if is_stem_clash(dm_a, dm_b) and is_liuchong(branches_a[2], branches_b[2]):
        crisis_flags.append("天剋地沖")

    # 合化忌神 (cross-chart stem combinations from enhanced_data)
    for combo in enhanced_data.get('stemCombinations', []):
        gods_a = chart_a['effective_gods']
        gods_b = chart_b['effective_gods']
        if combo['resultElement'] in [gods_a.get('忌神'), gods_b.get('忌神')]:
            warning_flags.append(f"合化忌神({combo['stems']}→{combo['resultElement']})")

    # 命宮相衝
    mg_a = chart_a['extra_pillars']['ming_gong']['branch']
    mg_b = chart_b['extra_pillars']['ming_gong']['branch']
    if is_liuchong(mg_a, mg_b):
        warning_flags.append("命宮相衝")

    return {
        "destructiveLevel": classify_severity(crisis_flags, warning_flags),
        "crisisFlags": crisis_flags,
        "warningFlags": warning_flags,
        "noteFlags": note_flags,
    }
```

### Function 7: `compute_compatibility_annual_forecast(chart, gender, effective_gods, current_year)`

**Three-scenario format**: Each signal returns `singleImplication`, `datingImplication`, `marriedImplication`.

**New detection helpers**:
```python
def check_annual_lu_hits_spouse_palace(day_branch, annual_branch):
    """Check if any hidden stem in the annual branch has its 祿神 on the natal day branch."""
    for hs in HIDDEN_STEMS.get(annual_branch, []):
        if LUSHEN.get(hs) == day_branch:
            return True
    return False

def check_peach_blossom_locked(natal_branches, taohua_branch):
    """Check if natal 桃花 branch is combined by any other natal branch (六合)."""
    for br in natal_branches:
        if br != taohua_branch and BRANCH_LIUHE.get(br) == taohua_branch:
            return True
    return False
```

### Master Orchestrator

```python
def compute_compatibility_romance_preanalysis(chart_a, chart_b, gender_a, gender_b, enhanced_data, current_year):
    """
    Master orchestrator. Calls existing generate_compatibility_pre_analysis()
    (note: underscore in existing function name) + all 7 new functions.
    """
    # Identical charts guard
    if charts_are_identical(chart_a, chart_b):
        return {"identical": True, "message": "同一命盤無法進行合盤分析"}

    # Existing pre-analysis (unchanged)
    base = generate_compatibility_pre_analysis(chart_a, chart_b, 'romance')

    # 7 new functions
    lp_a = compute_individual_love_personality(chart_a, gender_a)
    lp_b = compute_individual_love_personality(chart_b, gender_b)
    se_a = compute_spouse_enrichment(chart_a, gender_a, chart_a['effective_gods'])
    se_b = compute_spouse_enrichment(chart_b, gender_b, chart_b['effective_gods'])
    mw_a = compute_marriage_wealth(chart_a, gender_a, chart_a['effective_gods'], chart_a['luck_periods'])
    mw_b = compute_marriage_wealth(chart_b, gender_b, chart_b['effective_gods'], chart_b['luck_periods'])
    pmq = compute_post_marriage_quality(chart_a, chart_b, base)
    cr_a = compute_marriage_crisis_risk(chart_a, gender_a, chart_a['effective_gods'])
    cr_b = compute_marriage_crisis_risk(chart_b, gender_b, chart_b['effective_gods'])
    cc = compute_combined_crisis_assessment(chart_a, chart_b, enhanced_data)
    af_a = compute_compatibility_annual_forecast(chart_a, gender_a, chart_a['effective_gods'], current_year)
    af_b = compute_compatibility_annual_forecast(chart_b, gender_b, chart_b['effective_gods'], current_year)

    return {
        **base,
        "lovePersonalityA": lp_a, "lovePersonalityB": lp_b,
        "spouseEnrichmentA": se_a, "spouseEnrichmentB": se_b,
        "marriageWealthA": mw_a, "marriageWealthB": mw_b,
        "postMarriageQuality": pmq,
        "crisisRiskA": cr_a, "crisisRiskB": cr_b,
        "combinedCrisis": cc,
        "annualForecastA": af_a, "annualForecastB": af_b,
    }
```

---

## Phase 2: Engine Calibration (Romance-Specific)

### File: `packages/bazi-engine/app/compatibility_constants.py`

Add NEW romance-specific constants (do NOT modify existing constants):
```python
# Romance-specific calibration (does not affect business/friendship)
SIGMOID_STEEPNESS_ROMANCE = 0.07          # default SIGMOID_STEEPNESS = 0.10 unchanged
KNOCKOUT_PENALTY_CAP_ROMANCE = -12        # no cap for other types
NAYIN_IDENTICAL_BONUS_ROMANCE = 4         # only applied for romance
CROSS_PILLAR_BRANCH_DEFAULT_WEIGHT_ROMANCE = 0.2  # default 0.3 unchanged
SPOUSE_PALACE_SCORE_FLOOR_ROMANCE = 30    # only applied for romance
SPOUSE_PALACE_SCORE_FLOOR_THRESHOLD = 65  # spouse_palace_score must exceed this
```

### File: `packages/bazi-engine/app/compatibility_enhanced.py`

Modify `calculate_enhanced_compatibility()` to accept optional `calibration` dict:
```python
def calculate_enhanced_compatibility(chart_a, chart_b, comparison_type, calibration=None):
    cal = calibration or {}
    steepness = cal.get('sigmoid_steepness', SIGMOID_STEEPNESS)
    cross_weight = cal.get('cross_pillar_weight', CROSS_PILLAR_BRANCH_DEFAULT_WEIGHT)
    knockout_cap = cal.get('knockout_penalty_cap', None)  # None = no cap
    nayin_bonus = cal.get('nayin_bonus', 0)
    score_floor = cal.get('score_floor', None)
    score_floor_threshold = cal.get('score_floor_threshold', 0)
    # ... use these in scoring logic
```

Caller in `main.py` passes romance calibration:
```python
if comparison_type == 'romance':
    calibration = {
        'sigmoid_steepness': SIGMOID_STEEPNESS_ROMANCE,
        'cross_pillar_weight': CROSS_PILLAR_BRANCH_DEFAULT_WEIGHT_ROMANCE,
        'knockout_penalty_cap': KNOCKOUT_PENALTY_CAP_ROMANCE,
        'nayin_bonus': NAYIN_IDENTICAL_BONUS_ROMANCE,
        'score_floor': SPOUSE_PALACE_SCORE_FLOOR_ROMANCE,
        'score_floor_threshold': SPOUSE_PALACE_SCORE_FLOOR_THRESHOLD,
    }
else:
    calibration = None  # use all defaults
```

**Knockout cap implementation** (separate bonus/penalty):
```python
total_bonus = sum(k['scoreImpact'] for k in knockouts if k['scoreImpact'] > 0)
total_penalty = sum(k['scoreImpact'] for k in knockouts if k['scoreImpact'] < 0)
if knockout_cap is not None:
    total_penalty = max(total_penalty, knockout_cap)  # e.g., max(-20, -12) = -12
knockout_adjustment = total_bonus + total_penalty
```

**Score floor precedence**: Knockout hard floors > spouse palace floor > normal clamp.

---

## Phase 3: Python Endpoint Integration

### File: `packages/bazi-engine/app/main.py`

**Trigger mechanism**: Always compute romance pre-analysis when `comparison_type == 'romance'`. Add `romancePreAnalysis` as a new top-level key alongside existing `compatibilityPreAnalysis`.

```python
@app.post("/compatibility")
def compatibility_endpoint(data: CompatibilityRequest):
    chart_a = calculate_bazi(data.birth_date_a, data.birth_hour_a, data.gender_a)
    chart_b = calculate_bazi(data.birth_date_b, data.birth_hour_b, data.gender_b)

    enhanced = calculate_enhanced_compatibility(chart_a, chart_b, data.comparison_type, calibration=...)
    base_preanalysis = generate_compatibility_pre_analysis(chart_a, chart_b, data.comparison_type)

    result = {
        "chartA": chart_a,
        "chartB": chart_b,
        "compatibilityEnhanced": enhanced,
        "compatibilityPreAnalysis": base_preanalysis,  # existing key, unchanged
    }

    # Romance V2: add new pre-analysis alongside existing data
    if data.comparison_type == 'romance':
        from .compatibility_romance_preanalysis import compute_compatibility_romance_preanalysis
        romance_pa = compute_compatibility_romance_preanalysis(
            chart_a, chart_b, data.gender_a, data.gender_b, enhanced, data.current_year or 2026
        )
        result["romancePreAnalysis"] = romance_pa

    return result
```

**Key**: `romancePreAnalysis` is a NEW top-level key. `compatibilityPreAnalysis` remains unchanged. Business/friendship never get `romancePreAnalysis`.

---

## Phase 4: AI Prompt Engineering (NestJS)

### File: `apps/api/src/ai/prompts.ts`

#### Section Keys — Local NestJS Definition

Per CLAUDE.md: "NestJS files must NOT import from `@repo/shared` at runtime." Define section keys locally in `prompts.ts`:

```typescript
// Local to NestJS — mirrors packages/shared for type safety but no runtime import
const COMPAT_V2_KEYS = {
  CHART_PROFILE_A: 'chart_profile_a',
  CHART_PROFILE_B: 'chart_profile_b',
  LOVE_PERSONALITY_A: 'love_personality_a',
  LOVE_PERSONALITY_B: 'love_personality_b',
  SPOUSE_ENRICHMENT_A: 'spouse_enrichment_a',
  SPOUSE_ENRICHMENT_B: 'spouse_enrichment_b',
  MARRIAGE_WEALTH_A: 'marriage_wealth_a',
  MARRIAGE_WEALTH_B: 'marriage_wealth_b',
  POST_MARRIAGE_SWEETNESS: 'post_marriage_sweetness',
  POST_MARRIAGE_STABILITY: 'post_marriage_stability',
  MARRIAGE_CRISIS_A: 'marriage_crisis_a',
  MARRIAGE_CRISIS_B: 'marriage_crisis_b',
  COMBINED_CRISIS: 'combined_crisis_analysis',
  MARRIAGE_ADVICE: 'marriage_advice',
  ANNUAL_LOVE_A: 'annual_love_a',
  ANNUAL_LOVE_B: 'annual_love_b',
  COMPATIBILITY_SUMMARY: 'compatibility_summary',
} as const;
```

#### V2 Prompt Template — Placeholder Specification

**Call 1 placeholders** (per-person: profiles + personality + enrichment + wealth):
```
{{genderA}}, {{genderB}}                    — 男/女
{{fourPillarsA}}, {{fourPillarsB}}           — 年柱/月柱/日柱/時柱 formatted
{{dayMasterA}}, {{dayMasterB}}               — 戊/甲 etc
{{strengthLabelA}}, {{strengthLabelB}}       — 極弱/偏弱/中和/偏旺/極旺 + numeric
{{patternA}}, {{patternB}}                   — 食神格/正官格 etc
{{nayinA}}, {{nayinB}}                       — 爐中火 etc
{{fiveElementCountA}}, {{fiveElementCountB}} — "3金1木0水2火2土"
{{currentLPA}}, {{currentLPB}}               — 乙巳/丁酉 etc
{{favorableGodsA}}, {{favorableGodsB}}       — 喜=火 用=土 etc
{{pillarTraitsA}}, {{pillarTraitsB}}         — JSON array of position-specific traits
{{spouseEnrichmentA}}, {{spouseEnrichmentB}} — JSON with score, level, indicators
{{marriageWealthA}}, {{marriageWealthB}}     — JSON with pre/post/palace support
{{anchors_chart_profile_a}}, etc             — narrative anchors per section
```

**Call 2 placeholders** (cross-chart + crisis):
```
{{contextBridge}}                            — summary of Call 1 findings (1-2 sentences per section)
{{postMarriageQuality}}                      — JSON with sweetness + stability scores/factors
{{crisisRiskA}}, {{crisisRiskB}}             — JSON with risk factors per person
{{combinedCrisis}}                           — JSON with tiered flags
{{crossTenGods}}                             — existing cross ten god meanings
{{yongshenAnalysis}}                         — existing yongshen data
{{landmines}}                                — existing landmine triggers
```

**Call 3 placeholders** (annual + summary):
```
{{contextBridge2}}                           — summary of Calls 1+2
{{annualForecastA}}, {{annualForecastB}}     — JSON with peach blossom, palace, three-scenario
{{currentYear}}                              — 2026
```

#### Interpolation Mapping (in `ai.service.ts`)

```typescript
private buildCompatibilityRomanceV2Prompts(calcData: any) {
  const romancePA = calcData.romancePreAnalysis;
  const enhanced = calcData.compatibilityEnhanced;
  const chartA = calcData.chartA;
  const chartB = calcData.chartB;

  // Call 1: per-person sections
  const call1User = COMPAT_V2_CALL1_TEMPLATE
    .replace('{{genderA}}', chartA.gender === 'male' ? '男' : '女')
    .replace('{{fourPillarsA}}', formatPillars(chartA))
    .replace('{{nayinA}}', chartA.nayin || '')
    .replace('{{pillarTraitsA}}', JSON.stringify(romancePA.lovePersonalityA.pillarTraits))
    .replace('{{spouseEnrichmentA}}', JSON.stringify(romancePA.spouseEnrichmentA))
    .replace('{{marriageWealthA}}', JSON.stringify(romancePA.marriageWealthA))
    // ... same for B
    ;

  // Call 2: cross-chart
  const call2User = COMPAT_V2_CALL2_TEMPLATE
    .replace('{{postMarriageQuality}}', JSON.stringify(romancePA.postMarriageQuality))
    .replace('{{crisisRiskA}}', JSON.stringify(romancePA.crisisRiskA))
    .replace('{{combinedCrisis}}', JSON.stringify(romancePA.combinedCrisis))
    // ...
    ;

  // Call 3: annual + summary
  const call3User = COMPAT_V2_CALL3_TEMPLATE
    .replace('{{annualForecastA}}', JSON.stringify(romancePA.annualForecastA))
    .replace('{{annualForecastB}}', JSON.stringify(romancePA.annualForecastB))
    // ...
    ;

  return { systemPrompt, call1User, call2User, call3User };
}
```

### Anti-Hallucination Rules (14 rules)

1-12: Per-section data anchoring (same as before)
13. 合婚危機 must reference `crisisFlags`/`warningFlags` by tier only
14. 流年感情運 must provide ALL 3 scenarios per signal; must NOT invent signals

---

## Phase 5: NestJS Service Changes

### File: `apps/api/src/bazi/bazi.service.ts`

1. **New method**: `generateCompatibilityRomanceV2(comparisonData)`
   - Three-call streaming (reuse existing multi-call pattern from Love V2)
   - Reads `romancePreAnalysis` from calculation data
   - Falls back to existing V1 prompt if `romancePreAnalysis` is missing

2. **Routing**: In `createComparison()`:
   ```typescript
   if (dto.comparisonType === 'ROMANCE' && calcData.romancePreAnalysis) {
     aiResult = await this.generateCompatibilityRomanceV2(calcData);
   } else {
     aiResult = await this.generateCompatibilityAI(calcData); // existing V1
   }
   ```

3. **Versioning**: Save `aiVersion: 2` in comparison record when V2 is used.

### Backward Compatibility for Existing Records

- Old romance records have `aiVersion: 1` (or undefined) + old section keys
- Frontend checks `aiVersion`:
  - V2 → render with new section metadata
  - V1/undefined → render with existing compatibility UI (no change)
- Recalculate endpoint: always uses V2 for romance going forward

---

## Phase 6: Frontend Implementation

### 6A: Redesigned Form Page

Side-by-side dual birth data entry. Same warm theme as Love reading.

### 6B: Section Titles — Add to `SECTION_TITLES_ZH`

```typescript
// In AIReadingDisplay.tsx — add all 17 new keys (section 9 is static, not here)
chart_profile_a: "男方命局特點",
chart_profile_b: "女方命局特點",
love_personality_a: "男方戀愛性格",
love_personality_b: "女方戀愛性格",
spouse_enrichment_a: "男方旺妻程度",  // dynamic: swap 旺妻/旺夫 based on gender
spouse_enrichment_b: "女方旺夫程度",
marriage_wealth_a: "男方婚前婚後財富",
marriage_wealth_b: "女方婚前婚後財富",
post_marriage_sweetness: "婚後感情甜蜜度",
post_marriage_stability: "婚後生活穩定度",
marriage_crisis_a: "男方婚變情況預測",
marriage_crisis_b: "女方婚變情況預測",
combined_crisis_analysis: "兩人合婚危機分析",
marriage_advice: "經營婚姻建議",
annual_love_a: "男方{{year}}感情運",
annual_love_b: "女方{{year}}感情運",
compatibility_summary: "感情綜合總結",
```

### 6C: Static Educational Section

`ke_fu_ke_qi_education` is rendered as a static `<div>` between sections 8 and 10 — no AI call, no streaming, just hardcoded JSX with appropriate styling (📖 icon, educational theme).

### 6D: Version-Aware Rendering

```typescript
const isV2 = comparison.aiVersion === 2;
if (isV2) {
  // Render new V2 sections with COMPAT_ROMANCE_V2 metadata
} else {
  // Render old compatibility UI (unchanged)
}
```

### 6E: Page Layout

Same as Rev 2 plan — score+radar (free) → paywall → per-person → educational → combined → annual → summary.

### 6F: Unknown Birth Time UI

If either person has unknown birth time, show a banner: "⚠️ 部分時辰相關分析受限" and affected sections show a note.

---

## Phase 7: Shared Constants & Types

### `packages/shared/src/constants.ts`

```typescript
export const COMPAT_ROMANCE_V2_SECTION_KEYS = {
  CHART_PROFILE_A: 'chart_profile_a',
  // ... all 17 AI section keys (excluding ke_fu_ke_qi_education which is static)
  COMPATIBILITY_SUMMARY: 'compatibility_summary',
} as const;
```

These are consumed by the **frontend only** (via `import` at compile time). NestJS uses its own local copy (see Phase 4).

---

## Phase 8: Testing

### Python: `tests/test_compatibility_romance_preanalysis.py`
- All 7 new functions with Roger+Laopo primary case
- Identical-charts early-return guard
- Unknown birth time (hour=None) graceful degradation
- 旺夫/旺妻 boundary checks (score 0 vs 100)
- Three-scenario annual signals

### Python: `tests/test_compatibility_calibration.py`
- Romance sigmoid(0.07) vs default sigmoid(0.10) — verify different curves
- Romance knockout cap -12 vs uncapped — verify bonus/penalty separation
- 納音 bonus — verify only for romance
- Cross-position weight 0.2 vs 0.3 — verify romance-specific
- Roger+Laopo recalibrated score target: ~45-55
- **Business/friendship scores unchanged**: Run existing test cases with and without romance calibration, verify identical results for non-romance types

### NestJS: `apps/api/src/bazi/bazi.service.spec.ts`
- V2 prompt building with all placeholders
- Three-call streaming flow
- Romance vs business/friendship routing
- V1→V2 fallback when `romancePreAnalysis` missing
- `aiVersion: 2` saved in record

### Frontend: E2E with Playwright
- Form submission with dual birth data
- Score reveal + radar chart
- Paywall interaction
- V2 section streaming
- V1 backward compatibility (load old comparison, verify old UI)
- Unknown birth time banner

---

## Implementation Order

| Step | Description | Files | Priority |
|------|-------------|-------|----------|
| 1 | Engine calibration (romance-specific constants + parameterized sigmoid/knockout) | compatibility_constants.py, compatibility_enhanced.py | HIGH |
| 2 | Calibration tests (verify non-romance unaffected) | test_compatibility_calibration.py | HIGH |
| 3 | 7 new pre-analysis functions + orchestrator | compatibility_romance_preanalysis.py (NEW) | HIGH |
| 4 | Pre-analysis tests | test_compatibility_romance_preanalysis.py (NEW) | HIGH |
| 5 | Update `/compatibility` endpoint (add romancePreAnalysis key) | main.py | HIGH |
| 6 | Shared constants (frontend-only) | packages/shared/src/constants.ts | HIGH |
| 7 | NestJS: V2 prompt templates (3 calls, all placeholders) | prompts.ts | HIGH |
| 8 | NestJS: `buildCompatibilityRomanceV2Prompts()` + interpolation | ai.service.ts | HIGH |
| 9 | NestJS: Route romance to V2, add aiVersion field | bazi.service.ts | HIGH |
| 10 | Frontend: Redesign form page | page.tsx | MEDIUM |
| 11 | Frontend: Section titles + metadata + static educational section | AIReadingDisplay.tsx | MEDIUM |
| 12 | Frontend: Version-aware rendering + paywall CTA | page.tsx, new component | MEDIUM |
| 13 | Frontend: Streaming + loading integration | readings-api.ts | MEDIUM |
| 14 | NestJS + E2E tests | spec files | MEDIUM |

---

## Accuracy Validation

1. Roger+Laopo: recalibrated score ~45-55 (current 35 too harsh, Seer's 87 too generous)
2. 旺夫/旺妻: Roger's 旺妻 ~45-55, Laopo's 旺夫 ~35-45
3. Crisis: Same-position shows NO crisis (午戌半合 = positive), tier-2 warning for 丁壬合化忌神
4. Five element counts match Seer exactly
5. 3 additional test charts for cross-validation

---

## Migration Notes

- Existing `/api/bazi/comparisons` endpoints: fully backward-compatible
- Business/friendship: ZERO changes (calibration is romance-specific, romancePreAnalysis not computed)
- Old romance records: `aiVersion` undefined → render with V1 UI
- New romance records: `aiVersion: 2` → render with V2 UI
- Redis cache: `compatibility_ai_v2:{id}` for V2, old keys untouched
