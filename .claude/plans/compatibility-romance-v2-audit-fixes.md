# 感情合盤 V2 — Audit Fix Plan

Fixes for 22 issues found during line audit. Does NOT override the main implementation plan.

## Verified Chart Data Structure (exact runtime paths)

```
chart['mingGong']['branch']              — 命宮 branch (TOP-LEVEL, not under extraPillars)
chart['dayMaster']['tabooGod']           — 忌神 element name (e.g., '木')
chart['dayMaster']['favorableGod']       — 喜神
chart['dayMaster']['usefulGod']          — 用神
chart['dayMaster']['enemyGod']           — 仇神
chart['dayMaster']['strength']           — 'weak', 'extremely_weak', 'balanced', 'strong', 'extremely_strong'
chart['dayMaster']['strengthScoreV2']['score']  — numeric (e.g., 39.0)
chart['dayMaster']['strengthScoreV2']['classification'] — 'weak' etc
chart['dayMaster']['pattern']            — '食神格' etc
chart['dayMasterStem']                   — '戊' etc
chart['fourPillars']['year']['stem']     — '丁' etc
chart['fourPillars']['year']['naYin']    — '爐中火' etc
chart['fourPillars']['year']['branch']   — '卯' etc
chart['fourPillars']['year']['hiddenStems'] — ['乙'] etc
chart['kongWang']                        — ['子', '丑'] (day-pillar 空亡)
chart['elementCounts']['stems']          — {'木':0, '火':1, '土':2, '金':1, '水':0} (raw stem counts)
chart['elementCounts']['branches']       — {'木':1, '火':1, '土':0, '金':2, '水':0} (raw branch counts)
```

Enhanced data:
```
enhanced['specialFindings']['combinationName']  — '淫慝之合' or None
enhanced['specialFindings']['huaHuaQuality']    — element or None
enhanced['dimensionScores']['dayStemRelationship']['combinationName'] — same
enhanced['dimensionScores']['dayStemRelationship']['findings'] — list of cross-stem findings
```
Note: `stemCombinations` does NOT exist as a key. Must compute cross-chart combinations directly.

compatibilityPreAnalysis:
```
cpa['crossTenGods']      — cross ten god analysis
cpa['landmines']         — landmine triggers
cpa['timingSync']        — timing data
cpa['attractionAnalysis'] — romance attraction
```
Note: `yongshenAnalysis` key does NOT exist in cpa. Must check actual keys.

---

## Fix 1: P9 — 命宮 path (HIGH)

**File**: `compatibility_romance_preanalysis.py` → `compute_combined_crisis_assessment()`
**Change**: Replace `chart_a.get('mingGong', {}).get('branch', '')` with `chart_a.get('mingGong', {}).get('branch', '')`.

Wait — the verified path IS `chart['mingGong']['branch']` (top-level). So the code `chart.get('mingGong', {}).get('branch', '')` is actually CORRECT. The audit assumed `extraPillars.mingGong` but the real chart uses top-level `mingGong`.

**Action**: VERIFY in the actual code. If the code already uses `chart.get('mingGong', {}).get('branch', '')`, this is a **FALSE POSITIVE** — no fix needed.

---

## Fix 2: P12 — Orchestrator missing `generate_compatibility_pre_analysis()` call (HIGH)

**Verified**: `calculator.py` already calls `generate_compatibility_pre_analysis()` at line 506 and stores result in `result['compatibilityPreAnalysis']`. The NestJS `interpolateCompatPreAnalysisForV2()` reads from `calculationData.compatibilityPreAnalysis` (separate key).

**Action**: VERIFY the NestJS interpolation reads from the correct path. If confirmed, this is a **FALSE POSITIVE** — the base pre-analysis data flows through `compatibilityPreAnalysis` alongside `romancePreAnalysis`.

---

## Fix 3: N1 — aiVersion DB field (HIGH)

**Current state**: `schemaVersion: 'v2'` embedded in `aiInterpretation` JSON blob.
**Frontend**: `isV2Romance()` already checks `data.aiInterpretation?.schemaVersion === 'v2'` (via `isV2Romance` helper at page.tsx lines 43-49).

**Action**: VERIFY the frontend isV2Romance helper works with the current JSON-embedded approach. If it does, **no DB migration needed** — document the approach as intentional. If the frontend checks `comparison.aiVersion` (top-level field that doesn't exist), fix the frontend check to read from `aiInterpretation.schemaVersion` instead.

---

## Fix 4: F1 — Sub-header badges (HIGH, ~80 lines)

**File**: `apps/web/app/reading/compatibility/page.tsx`

Create a `getCompatV2SectionBadge()` function that receives `sectionKey`, `romancePreAnalysis`, `chartA`, `chartB` and returns a badge string for each section type.

**Badge definitions** (from plan section 5C):

```typescript
function getCompatV2SectionBadge(
  key: string,
  rpa: any,
  chartA: any,
  chartB: any,
  currentYear: number
): string | null {
  if (!rpa) return null;
  const dmA = chartA?.dayMaster;
  const dmB = chartB?.dayMaster;

  switch (key) {
    case 'chart_profile_a':
      return `日主${chartA?.dayMasterStem || ''}${dmA?.element || ''} · ${_strengthZh(dmA)} · ${dmA?.pattern || ''} · ${chartA?.fourPillars?.year?.naYin || ''}`;
    case 'chart_profile_b':
      return `日主${chartB?.dayMasterStem || ''}${dmB?.element || ''} · ${_strengthZh(dmB)} · ${dmB?.pattern || ''} · ${chartB?.fourPillars?.year?.naYin || ''}`;
    case 'love_personality_a':
      return rpa.lovePersonalityA?.archetype ? `${rpa.lovePersonalityA.archetype}` : null;
    case 'love_personality_b':
      return rpa.lovePersonalityB?.archetype ? `${rpa.lovePersonalityB.archetype}` : null;
    case 'spouse_enrichment_a':
      const seA = rpa.spouseEnrichmentA;
      return seA ? `${seA.title}程度：${seA.level}（${seA.totalScore}分）` : null;
    case 'spouse_enrichment_b':
      const seB = rpa.spouseEnrichmentB;
      return seB ? `${seB.title}程度：${seB.level}（${seB.totalScore}分）` : null;
    case 'marriage_wealth_a':
      const mwA = rpa.marriageWealthA;
      return mwA ? `婚前${mwA.preMarriage?.[0]?.elementAssessment || '—'} · 婚後${mwA.postMarriage?.[0]?.elementAssessment || '—'}` : null;
    case 'marriage_wealth_b':
      const mwB = rpa.marriageWealthB;
      return mwB ? `婚前${mwB.preMarriage?.[0]?.elementAssessment || '—'} · 婚後${mwB.postMarriage?.[0]?.elementAssessment || '—'}` : null;
    case 'post_marriage_sweetness':
      const sw = rpa.postMarriageQuality?.sweetness;
      return sw ? `甜蜜度：${sw.score}/100 ${sw.level}` : null;
    case 'post_marriage_stability':
      const st = rpa.postMarriageQuality?.stability;
      return st ? `穩定度：${st.score}/100 ${st.level}` : null;
    case 'marriage_crisis_a':
      return rpa.crisisRiskA ? `婚變風險：${rpa.crisisRiskA.overallRisk}` : null;
    case 'marriage_crisis_b':
      return rpa.crisisRiskB ? `婚變風險：${rpa.crisisRiskB.overallRisk}` : null;
    case 'combined_crisis_analysis':
      return rpa.combinedCrisis ? `${rpa.combinedCrisis.destructiveLevel}` : null;
    case 'annual_love_a':
      const afA = rpa.annualForecastA;
      if (!afA) return null;
      const parts = [];
      if (afA.hongluanActivated) parts.push('紅鸞星動');
      if (afA.tianxiActivated) parts.push('天喜星動');
      if (afA.taohuaActivated) parts.push('桃花星動');
      return parts.length ? parts.join(' · ') : '緣分星未飛臨';
    case 'annual_love_b':
      const afB = rpa.annualForecastB;
      if (!afB) return null;
      const partsB = [];
      if (afB.hongluanActivated) partsB.push('紅鸞星動');
      if (afB.tianxiActivated) partsB.push('天喜星動');
      if (afB.taohuaActivated) partsB.push('桃花星動');
      return partsB.length ? partsB.join(' · ') : '緣分星未飛臨';
    default:
      return null;
  }
}

function _strengthZh(dm: any): string {
  if (!dm) return '';
  const map: Record<string, string> = {
    'extremely_weak': '極弱', 'weak': '偏弱', 'balanced': '中和',
    'strong': '偏旺', 'extremely_strong': '極旺',
  };
  const label = map[dm.strength] || dm.strength;
  const score = dm.strengthScoreV2?.score ?? dm.strengthScore ?? '';
  return `${label}${score ? `（${score}分）` : ''}`;
}
```

**Integration**: In the V2 sections rendering loop, render badge below each section title:
```tsx
{aiSections.map(section => {
  const badge = getCompatV2SectionBadge(section.key, romancePreAnalysis, chartA, chartB, currentYear);
  return (
    <div key={section.key}>
      <SectionTitle ... />
      {badge && <div className={styles.sectionBadge}>{badge}</div>}
      <SectionContent ... />
    </div>
  );
})}
```

**Data flow**: `romancePreAnalysis` comes from `comparisonData.data.romancePreAnalysis`. Pass it as a local variable when rendering V2 sections. `chartA`/`chartB` come from `comparisonData.data.chartA`/`chartB`.

**CSS**: Add `.sectionBadge` class (pill-style, subtle background, small font) — ~5 lines.

---

## Fix 5: P1 — Partner cross-reference (MEDIUM)

**File**: `compatibility_romance_preanalysis.py` → `compute_individual_love_personality()`

**Change**: Add optional `partner_dm_element` param. At end of function, compute element interaction:

```python
ELEMENT_INTERACTION_LABELS = {
    'produces': '相生',   # my element produces partner's
    'produced_by': '相生', # partner's element produces mine
    'overcomes': '相剋',  # my element overcomes partner's
    'overcome_by': '相剋', # partner's element overcomes mine
    'same': '比和',       # same element
}

def compute_individual_love_personality(chart, gender, partner_dm_element=None):
    # ... existing code ...

    # Partner dynamic (if provided)
    partner_dynamic = None
    if partner_dm_element:
        my_element = STEM_ELEMENT.get(dm, '')
        if my_element == partner_dm_element:
            partner_dynamic = {'interaction': '比和', 'description': f'{my_element}遇{partner_dm_element}，同類相惜但缺乏互補'}
        elif ELEMENT_PRODUCES.get(my_element) == partner_dm_element:
            partner_dynamic = {'interaction': '我生對方', 'description': f'{my_element}生{partner_dm_element}，你天生願意為對方付出'}
        elif ELEMENT_PRODUCED_BY.get(my_element) == partner_dm_element:
            partner_dynamic = {'interaction': '對方生我', 'description': f'{partner_dm_element}生{my_element}，對方天生是你的支持者'}
        elif ELEMENT_OVERCOMES.get(my_element) == partner_dm_element:
            partner_dynamic = {'interaction': '我剋對方', 'description': f'{my_element}剋{partner_dm_element}，你在關係中較強勢'}
        else:
            partner_dynamic = {'interaction': '對方剋我', 'description': f'{partner_dm_element}剋{my_element}，對方在關係中較強勢'}

    return { ...existing_output, 'partnerDynamic': partner_dynamic }
```

**Orchestrator update**: Pass partner's DM element when calling:
```python
lp_a = compute_individual_love_personality(chart_a, gender_a, partner_dm_element=STEM_ELEMENT.get(chart_b.get('dayMasterStem', '')))
lp_b = compute_individual_love_personality(chart_b, gender_b, partner_dm_element=STEM_ELEMENT.get(chart_a.get('dayMasterStem', '')))
```

---

## Fix 6: P4 — 傷官合殺 +12 (MEDIUM)

**File**: `compatibility_romance_preanalysis.py` → `compute_spouse_enrichment()`, female productive cycle section

**Change**: Add `elif` after 傷官帶財 check:
```python
# After: elif has_shangguan and has_cai: productive_score += 12 (傷官帶財)
elif has_shangguan and has_qisha:
    productive_score += 12
    indicators.append({
        'indicator': '傷官合殺',
        'effect': 'positive',
        'description': '傷官與七殺結合，化解衝突為正面力量',
    })
```

Need to ensure `has_qisha` is defined: check if 偏官/七殺 is in stems or prominent hidden stems. Look at existing variable declarations in the function to see if `has_qisha` already exists or needs to be added.

---

## Fix 7: P7 — Pre-marriage LP element-role analysis (MEDIUM)

**File**: `compatibility_romance_preanalysis.py` → `compute_marriage_wealth()`, pre-marriage LP loop

**Change**: Add element-role check (same pattern as post-marriage loop):
```python
# Inside pre-marriage LP loop, after existing 伏吟 and clash checks:
lp_stem_element = STEM_ELEMENT.get(lp_stem, '')
if lp_stem_element:
    dm_obj = chart.get('dayMaster', {})
    if lp_stem_element == dm_obj.get('usefulGod') or lp_stem_element == dm_obj.get('favorableGod'):
        finding['elementAssessment'] = '喜用神主導，運勢較好'
    elif lp_stem_element == dm_obj.get('tabooGod') or lp_stem_element == dm_obj.get('enemyGod'):
        finding['elementAssessment'] = '忌仇神主導，運勢較差'
    else:
        finding['elementAssessment'] = '運勢平穩'
```

---

## Fix 8: P10 — 合化忌神 direct computation (MEDIUM)

**File**: `compatibility_romance_preanalysis.py` → `compute_combined_crisis_assessment()`

**IMPORTANT**: `STEM_COMBINATION_LOOKUP` is keyed by a SINGLE stem (str), NOT a tuple.
Structure: `STEM_COMBINATION_LOOKUP[stem] → (partner_stem, result_element, combination_name)`
Example: `STEM_COMBINATION_LOOKUP['丁'] → ('壬', '木', '淫慝之合')`

**Change**: Replace the `dimensionScores` read with direct stem combination computation:
```python
from .stem_combinations import STEM_COMBINATION_LOOKUP

# Compute cross-chart stem combinations directly
stems_a = [chart_a['fourPillars'][p]['stem'] for p in ['year', 'month', 'day', 'hour']]
stems_b = [chart_b['fourPillars'][p]['stem'] for p in ['year', 'month', 'day', 'hour']]
taboo_a = chart_a.get('dayMaster', {}).get('tabooGod', '')
taboo_b = chart_b.get('dayMaster', {}).get('tabooGod', '')

seen_combos = set()
for sa in stems_a:
    combo_info = STEM_COMBINATION_LOOKUP.get(sa)
    if not combo_info:
        continue
    partner, result_element, combo_name = combo_info
    if partner in stems_b:
        dedup_key = tuple(sorted([sa, partner]))
        if dedup_key in seen_combos:
            continue
        seen_combos.add(dedup_key)
        if result_element == taboo_a or result_element == taboo_b:
            who = '甲方' if result_element == taboo_a else '乙方'
            warning_flags.append({
                'type': '合化忌神',
                'description': f'{sa}{partner}合（{combo_name}）化{result_element}（{who}忌神）',
            })
```

Remove the old `dimensionScores` based approach entirely.

**Note**: This checks all 16 stem pairs via the lookup (4 stems × partner check). Dedup prevents double-counting when both 丁∈A and 壬∈B AND 壬∈A and 丁∈B.

---

## Fix 9: P13 — Function 4 argument verification (MEDIUM)

**Action**: VERIFY what `compute_post_marriage_quality` actually accesses from its `cross_data` parameter.

Read the function and list every `cross_data.get(...)` or `cross_data[...]` call. If it only uses chart_a and chart_b (which are separate params), then `cross_data` is irrelevant and this is a **FALSE POSITIVE**.

If it does access `cross_data` for something specific, determine whether `enhanced_data` provides that data or not.

---

## Fix 10: F2 — Unknown birth time UI (MEDIUM)

**File**: `apps/web/app/reading/compatibility/page.tsx`

**Change**: Add banner in the V2 sections container:
```tsx
{/* Unknown birth time warning */}
{(romancePA?.lovePersonalityA?.hourUnknown || romancePA?.lovePersonalityB?.hourUnknown) && (
  <div className={styles.hourUnknownBanner}>
    <span>⚠️</span> 部分時辰相關分析受限
    {romancePA?.lovePersonalityA?.hourUnknown && <span>（{nameA || '男方'}時辰未知）</span>}
    {romancePA?.lovePersonalityB?.hourUnknown && <span>（{nameB || '女方'}時辰未知）</span>}
  </div>
)}
```

**CSS** in `page.module.css`:
```css
.hourUnknownBanner {
  background: rgba(245, 166, 35, 0.1);
  border: 1px solid rgba(245, 166, 35, 0.3);
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 16px;
}
```

---

## Fix 11: F3 — Dynamic section titles (MEDIUM)

**File**: `apps/web/app/reading/compatibility/page.tsx` (or `AIReadingDisplay.tsx`)

**Change**: Create a title override function used when rendering V2 sections:
```typescript
function getCompatV2DynamicTitle(
  key: string,
  genderA: string,
  genderB: string,
  currentYear: number,
): string | null {
  switch (key) {
    case 'spouse_enrichment_a':
      return genderA === 'male' ? '男方旺妻程度' : '女方旺夫程度';
    case 'spouse_enrichment_b':
      return genderB === 'male' ? '男方旺妻程度' : '女方旺夫程度';
    case 'annual_love_a':
      return `男方${currentYear}感情運`;
    case 'annual_love_b':
      return `女方${currentYear}感情運`;
    default:
      return null; // fall through to SECTION_TITLES_ZH
  }
}
```

Use in rendering: `const title = getCompatV2DynamicTitle(key, genderA, genderB, year) || SECTION_TITLES_ZH[key]`.

---

## Fix 12: P2 — 食神/傷官 透幹 detection (LOW)

**File**: `compatibility_romance_preanalysis.py` → `compute_individual_love_personality()`

**Change**: Add `transparent: true/false` to each pillar trait, and a `transparentGods` summary:
```python
# In pillar trait generation, traits from stems get transparent=True:
trait_entry = {'position': pos, 'tenGod': tg, 'trait': desc, 'transparent': pos != 'day_branch'}

# At end of function:
transparent_gods = list(set(t['tenGod'] for t in pillar_traits if t.get('transparent')))
result['transparentGods'] = transparent_gods
```

---

## Fix 13: P3 — 正印 graduated strength check (LOW)

**File**: `compatibility_romance_preanalysis.py` → `compute_individual_love_personality()`

**Change**: Replace `count == 0` check with weighted strength check:
```python
# Replace:
# if zhengyin_count == 0: weaknesses.append('缺乏領悟能力')
# With:
zhengyin_in_stems = any(derive_ten_god(dm, s) == '正印' for s in natal_stems if s != dm)
zhengyin_in_hidden = any(
    derive_ten_god(dm, hs) == '正印'
    for br in branches
    for hs in HIDDEN_STEMS.get(br, [])
)
if not zhengyin_in_stems and not zhengyin_in_hidden:
    weaknesses.append('缺乏領悟能力，學習需要更多耐心')
elif not zhengyin_in_stems:
    # Present only in hidden stems — weak but not absent
    weaknesses.append('領悟能力偏弱，直覺力不足')
```

---

## Fix 14: P5 — 正官 pure+rooted +20 (LOW)

**File**: `compatibility_romance_preanalysis.py` → `compute_spouse_enrichment()`, category 2

**Change**: Add specific check before the tier fallback:
```python
# For female: after checking 用/喜 god match
# Add: pure (正官 in stems AND no 偏官 in stems) + rooted (正官 element in branch hidden stems)
spouse_in_stems = any(derive_ten_god(dm, s) == spouse_tg for s in natal_stems if s != dm)
anti_spouse_in_stems = any(derive_ten_god(dm, s) == anti_spouse_tg for s in natal_stems if s != dm)
spouse_rooted = any(
    derive_ten_god(dm, hs) == spouse_tg
    for br in branches for hs in HIDDEN_STEMS.get(br, [])
)
if spouse_in_stems and not anti_spouse_in_stems and spouse_rooted:
    star_score = max(star_score, 20)  # pure + rooted
```

Where `anti_spouse_tg` = '偏官' for female, '偏財' for male.

---

## Fix 15: P6 — 財生官 in day branch quality (LOW)

**File**: `compatibility_romance_preanalysis.py` → `compute_spouse_enrichment()`, category 1

**Change**: After checking spouse star in day branch hidden stems:
```python
# For female only: check 財生官 chain in day branch
if gender == 'female' and branch_score < 20:
    day_hidden_gods = [derive_ten_god(dm, hs) for hs in day_hidden_stems]
    has_cai = any(g in ('正財', '偏財') for g in day_hidden_gods)
    has_guan = any(g == '正官' for g in day_hidden_gods)
    if has_cai and has_guan:
        branch_score = max(branch_score, 20)
        indicators.append({'indicator': '財生官在夫妻宮', 'effect': 'positive', 'description': '日支財星生官星，婚姻宮有利循環'})
```

---

## Fix 16: P8 — 婚後N年 remaining years (LOW)

**File**: `compatibility_romance_preanalysis.py` → `compute_marriage_wealth()`, output section

**Change**: Compute remaining years from estimated marriage age to LP end:
```python
# After determining marriage_lp:
post_marriage_years_in_lp = None
if marriage_lp_index is not None and marriage_lp_index < len(luck_periods):
    lp = luck_periods[marriage_lp_index]
    lp_end_age = lp.get('endAge', lp.get('startAge', 0) + 10)
    post_marriage_years_in_lp = max(0, lp_end_age - estimated_marriage_age)

# Add to output:
result['postMarriageYearsInLP'] = post_marriage_years_in_lp
```

---

## Fix 17: P11 — 忌神 key name verification (LOW)

**Verified**: The chart uses `chart['dayMaster']['tabooGod']` = '木'. The code uses `effective_gods.get('tabooGod')`.

The `_get_effective_gods()` helper in the preanalysis file extracts from `chart.get('dayMaster', {})` and returns keys like `tabooGod`. **This is CORRECT. No fix needed.**

---

## Fix 18: N2 — fiveElementCount format (LOW)

**File**: `apps/api/src/ai/ai.service.ts` → `interpolateCompatV2ChartFields()`

**Change**: Use `elementCounts` (raw counts from stems+branches) instead of `fiveElementsBalanceZh` (percentages):
```typescript
// Replace percentage format with Seer-style raw count
const ec = chart.elementCounts;
const stemCounts = ec?.stems || {};
const branchCounts = ec?.branches || {};
const total: Record<string, number> = {};
for (const el of ['金', '木', '水', '火', '土']) {
  total[el] = (stemCounts[el] || 0) + (branchCounts[el] || 0);
}
const fiveElementCount = `${total['金']}金${total['木']}木${total['水']}水${total['火']}火${total['土']}土`;
```

This produces "3金1木0水2火2土" matching Seer exactly.

---

## Fix 19: N3 — V2-specific auto-fix (LOW)

**Action**: DEFER. The generic auto-fix is sufficient for initial launch. Add V2-specific corrections when we test with real AI output and find patterns that need fixing.

---

## Fix 20: F4 — 男方/女方 form labels (LOW)

**File**: `apps/web/app/reading/compatibility/page.tsx`

**Change**: Where `DualBirthDataForm` is rendered, the form already has two panels. Add a label above each panel inside the page component:
```tsx
<div className={styles.formLabels}>
  <span className={styles.formLabelA}>男方</span>
  <span className={styles.formLabelB}>女方</span>
</div>
<DualBirthDataForm ... />
```

Or if the form component accepts a label prop, pass `panelLabels={['男方', '女方']}`.

---

## Implementation Order

| Step | Fix # | Description | Est. Lines |
|------|-------|-------------|-----------|
| V1 | P9 | Verify 命宮 path (may be false positive) | 0-2 |
| V2 | P12 | Verify orchestrator data flow (likely false positive) | 0 |
| V3 | N1 | Verify frontend isV2Romance reads from JSON blob | 0-5 |
| V4 | P11 | Verify tabooGod key (confirmed correct) | 0 |
| V5 | P13 | Verify Function 4 cross_data usage | 0 |
| V6 | P10 | Fix 合化忌神 direct computation | ~20 |
| V7 | P4 | Add 傷官合殺 +12 | ~8 |
| V8 | P7 | Add pre-marriage element-role check | ~12 |
| V9 | P1 | Add partner cross-reference to Function 1 | ~25 |
| V10 | F1 | Build sub-header badges | ~90 |
| V11 | F3 | Dynamic section titles | ~20 |
| V12 | F2 | Unknown birth time banner | ~15 |
| V13 | N2 | Fix fiveElementCount to raw counts | ~10 |
| V14 | P2 | Add transparent flag to pillar traits | ~5 |
| V15 | P3 | Graduated 正印 strength check | ~10 |
| V16 | P5 | Add pure+rooted check | ~10 |
| V17 | P6 | Add 財生官 chain check | ~8 |
| V18 | P8 | Add postMarriageYearsInLP | ~6 |
| V19 | F4 | Add 男方/女方 form labels | ~5 |
| — | N3 | Defer V2 auto-fix | 0 |

**Total**: V1-V5 are verifications (may need 0-7 lines). V6-V19 are code changes (~244 lines total).

**Strategy**: Do V1-V5 verifications first (parallel). Then batch the Python fixes (V6-V9, V14-V18) in one agent. Then batch the frontend fixes (V10-V12, V19) in another agent. Then do NestJS fix (V13) separately.

---

## Test Impact Assessment

Python fixes that change output shapes or scores — affected test files:

| Fix | Output Change | Affected Tests |
|-----|--------------|----------------|
| V6 (P10) | `combinedCrisis.warningFlags` may now include 合化忌神 | `test_compatibility_romance_preanalysis.py` → `TestCombinedCrisisAssessment` |
| V7 (P4) | `spouseEnrichment` score may increase by up to 12 for eligible charts | `test_compatibility_romance_preanalysis.py` → `TestSpouseEnrichment` score range assertions |
| V8 (P7) | `marriageWealth.preMarriage` items gain `elementAssessment` field | `test_compatibility_romance_preanalysis.py` → `TestMarriageWealth` |
| V9 (P1) | `lovePersonality` output gains `partnerDynamic` key | `test_compatibility_romance_preanalysis.py` → `TestIndividualLovePersonality` |
| V14 (P2) | `lovePersonality.pillarTraits` items gain `transparent` flag, output gains `transparentGods` | `test_compatibility_romance_preanalysis.py` → `TestIndividualLovePersonality` |
| V15 (P3) | `lovePersonality.weaknesses` may change for borderline 正印 cases | `test_compatibility_romance_preanalysis.py` → `TestIndividualLovePersonality` |
| V16 (P5) | `spouseEnrichment.categoryScores.starStatus` may change | `test_compatibility_romance_preanalysis.py` → `TestSpouseEnrichment` |
| V17 (P6) | `spouseEnrichment.categoryScores.branchQuality` may change for female with 財生官 | `test_compatibility_romance_preanalysis.py` → `TestSpouseEnrichment` |
| V18 (P8) | `marriageWealth` output gains `postMarriageYearsInLP` key | `test_compatibility_romance_preanalysis.py` → `TestMarriageWealth` |

**Action**: After all Python fixes, re-run `test_compatibility_romance_preanalysis.py`. Update score range assertions if they now fall outside bounds (e.g., 旺夫 score increased due to 傷官合殺). Add new assertions for new output keys (`partnerDynamic`, `transparentGods`, `postMarriageYearsInLP`, `elementAssessment`).

Also re-run `test_compatibility_calibration.py` to verify calibration is unchanged.

---

## Known Gap: `yongshenAnalysis` placeholder

The NestJS `interpolateCompatPreAnalysisForV2()` reads `preAnalysis['yongshenAnalysis']` but this key does NOT exist in `compatibilityPreAnalysis`. The interpolation falls back to `'（資料未提供）'` which is safe but wastes a prompt placeholder.

**Action**: DEFER. The cross-chart yongshen analysis data is embedded in other fields (`strengthProfiles`, `dimensionSummary`). A proper fix would extract yongshen-specific narrative from the pre-analysis, but this is a content quality issue, not a crash risk. Document for future improvement.

---

## Verified Constants for Fix 5 (P1)

`ELEMENT_PRODUCES` and `ELEMENT_PRODUCED_BY` both exist in `constants.py`:
- `ELEMENT_PRODUCES`: `{'木': '火', '火': '土', '土': '金', '金': '水', '水': '木'}`
- `ELEMENT_PRODUCED_BY`: reverse of above (auto-generated)
- Both imported in the preanalysis file's existing imports.

No additional imports needed for Fix 5.
