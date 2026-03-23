# V9: 配對基礎分析 Section — Dimension Breakdown (Rev 2)

## Goal
Add a new AI-narrated section "配對基礎分析" that explains the 8-dimension compatibility score (配對契合 36分). Include a visual bar chart of all 8 dimensions, followed by AI narration in the same 💕⚠️💡 format as other sections.

**Rev 2 changes**: Addressed 8 staff engineer issues — prop wiring, interpolation scope, section ordering, token budget, field path verification, badge data access.

## Data Already Available

`compatibilityPreAnalysis.dimensionSummary` already has all 8 dimensions with scores, weights, and assessments. `compatibilityPreAnalysis.adjustedScore` has the raw 36-point base score (verified field name via DB query).

## Design

### Part 1: Visual Bar Chart (Deterministic)

8 horizontal bars with labels, scores, and assessment pills. Color-coded by score tier. Header shows "配對契合度 36分".

### Part 2: AI Narration

Standard 💕⚠️💡 format. AI explains high/low dimensions in plain language.

### Part 3: Sub-header Badge

AnnualVerdictBanner: "配對契合：36分（需要經營）| 最高：神煞互動 80分 | 最低：五行互補 0分"

---

## Implementation

### Step 1: Add section key to shared constants

**File**: `packages/shared/src/constants.ts`

Add `COMPATIBILITY_BASIS: 'compatibility_basis'` as the FIRST entry in `COMPAT_ROMANCE_V2_SECTION_KEYS`:
```typescript
export const COMPAT_ROMANCE_V2_SECTION_KEYS = {
  COMPATIBILITY_BASIS: 'compatibility_basis',  // NEW — must be first
  CHART_PROFILE_A: 'chart_profile_a',
  ...
```

This automatically updates `COMPAT_ROMANCE_V2_ALL_SECTION_KEYS` (derived via `Object.values()`), which updates the streaming section count.

### Step 2: Add section title + section order

**File**: `apps/web/app/lib/readings-api.ts`

2a. Add to `SECTION_TITLE_MAP`:
```typescript
compatibility_basis: '配對基礎分析',
```

2b. Add to `COMPAT_ROMANCE_V2_SECTION_ORDER` array — as the FIRST entry:
```typescript
const COMPAT_ROMANCE_V2_SECTION_ORDER = [
  'compatibility_basis',  // NEW — first section after 老師寄語
  'chart_profile_a',
  'chart_profile_b',
  ...
```

**Note**: If `COMPAT_ROMANCE_V2_SECTION_ORDER` doesn't exist (derived from `Object.values()`), the `Object.values()` order from Step 1 controls rendering order — which is why the new key must be the FIRST entry in the constants object.

### Step 3: Update CALL1 sections in prompts

**File**: `apps/api/src/ai/prompts.ts`

3a. Add `'compatibility_basis'` to `COMPAT_V2_SECTIONS.CALL1` array:
```typescript
CALL1: ['compatibility_basis', 'chart_profile_a', ...],
```

**CRITICAL**: Both the shared constants (Step 1) AND this local CALL1 array must be updated together. They are separate data sources.

3b. Add to the Call 1 output format string (`COMPAT_V2_OUTPUT_FORMAT_CALL1`):
```
"compatibility_basis": {
  "preview": "50-70字，一句話概括配對基礎分析的重點（最大亮點和最大挑戰）",
  "full": "200-300字，💕⚠️💡 三段結構：
    - 💕 優勢亮點：列出分數≥60的維度，用白話解釋每個維度代表什麼意思
    - ⚠️ 注意事項：列出分數<40的維度，解釋這些挑戰的實際影響
    - 💡 實戰建議：總結配對基礎的整體意義，強調分數不等於命運"
}
```

**Token budget**: Verified current Call 1 output = ~5,576 chars (8 sections). Adding 200-300 chars → ~5,876 chars → ~2,400 tokens. Well within 8192 output token limit. Safe to add.

### Step 4: Add dimension interpolation to CALL 1 block

**File**: `apps/api/src/ai/ai.service.ts`

**IMPORTANT**: The `{{dimensionBreakdown}}` placeholder must be interpolated in the **Call 1 template building block** of `buildCompatRomanceV2Prompts()` (around line 4554-4594), NOT inside `interpolateCompatPreAnalysisForV2()` (which is a Call 2 helper).

Add after the existing Call 1 replacements:
```typescript
// Build dimension breakdown for Call 1
const dimSummary = (calcData?.compatibilityPreAnalysis?.dimensionSummary || [])
  .map((d: any) => `${d.dimension}：${d.score}分（${d.assessment}）— 權重${d.weight}%`)
  .join('\n');
const adjustedScore = calcData?.compatibilityPreAnalysis?.adjustedScore ?? calcData?.adjustedScore ?? '?';
call1Template = call1Template
  .replace(/\{\{dimensionBreakdown\}\}/g, dimSummary || '（資料未提供）')
  .replace(/\{\{adjustedScore\}\}/g, String(adjustedScore));
```

### Step 5: Frontend — Dimension Bar Chart + Data Wiring

**File**: `apps/web/app/reading/compatibility/page.tsx`

5a. Add `compatibilityPreAnalysis` to the `chartData` prop passed to `AIReadingDisplay` (around line 760):
```typescript
chartData={{
  romancePreAnalysis: romancePA,
  compatibilityPreAnalysis: calcData?.compatibilityPreAnalysis,  // NEW
  chartA: ...,
  chartB: ...,
  currentYear: ...,
}}
```

**File**: `apps/web/app/components/AIReadingDisplay.tsx`

5b. Create `CompatDimensionChart` inline component:

```tsx
function CompatDimensionChart({ dimensions, totalScore }: { dimensions: any[]; totalScore: number }) {
  return (
    <div className={styles.dimChartContainer}>
      <div className={styles.dimChartHeader}>
        配對契合度 <strong>{totalScore}分</strong>
      </div>
      {dimensions.map((d: any, i: number) => (
        <div key={i} className={styles.dimChartRow}>
          <span className={styles.dimChartLabel}>{d.dimension}</span>
          <div className={styles.dimChartBarTrack}>
            <div
              className={styles.dimChartBarFill}
              style={{
                width: `${d.score}%`,
                background: d.score >= 70 ? 'var(--color-success)' : d.score >= 50 ? 'var(--color-warning)' : 'var(--color-error)',
              }}
            />
          </div>
          <span className={styles.dimChartScore}>{d.score}</span>
          <span className={`${styles.dimChartAssessment} ${styles[`dimAssess${d.score >= 70 ? 'Good' : d.score >= 50 ? 'Fair' : 'Poor'}`]}`}>
            {d.assessment}
          </span>
        </div>
      ))}
    </div>
  );
}
```

5c. In the section render, insert the chart ABOVE AI content when key is `compatibility_basis`:
```tsx
{section.key === 'compatibility_basis' && chartData?.compatibilityPreAnalysis?.dimensionSummary && (
  <CompatDimensionChart
    dimensions={chartData.compatibilityPreAnalysis.dimensionSummary}
    totalScore={chartData.compatibilityPreAnalysis.adjustedScore ?? 0}
  />
)}
```

### Step 6: Sub-header Badge

**File**: `apps/web/app/components/AIReadingDisplay.tsx`

Add helper function:
```typescript
function getScoreLabel(score: number): string {
  if (score >= 80) return '極佳';
  if (score >= 65) return '良好';
  if (score >= 50) return '普通';
  if (score >= 40) return '需注意';
  return '需要經營';
}
```

In `CompatSectionBadge`, read from `chartData.compatibilityPreAnalysis` (NOT `romancePreAnalysis`):
```typescript
case 'compatibility_basis': {
  const compatPA = chartData?.compatibilityPreAnalysis as any;
  if (!compatPA?.dimensionSummary) return null;
  const dims = compatPA.dimensionSummary;
  const highest = dims.reduce((a: any, b: any) => a.score > b.score ? a : b, dims[0]);
  const lowest = dims.reduce((a: any, b: any) => a.score < b.score ? a : b, dims[0]);
  const totalScore = compatPA.adjustedScore ?? 0;
  return <AnnualVerdictBanner
    label={`配對契合：${totalScore}分（${getScoreLabel(totalScore)}）| 最高：${highest.dimension} ${highest.score}分 | 最低：${lowest.dimension} ${lowest.score}分`}
    tone={totalScore >= 60 ? 'positive' : totalScore >= 40 ? 'neutral' : 'negative'}
  />;
}
```

### Step 7: Anti-hallucination rule

**File**: `apps/api/src/ai/prompts.ts`

Add to COMPAT_ROMANCE_V2_ANTI_HALLUCINATION:
```
Rule 25: compatibility_basis 的維度分數和評估等級必須完全使用提供的數據，禁止自行計算或修改任何維度分數。禁止使用「配對基礎」以外的維度名稱。
```

### Step 8: CSS Styles

**File**: `apps/web/app/components/AIReadingDisplay.module.css`

```css
/* Compatibility Dimension Chart */
.dimChartContainer {
  margin: 0 0 1rem 0;
  padding: 1rem;
  background: var(--bg-secondary, #FFFBF5);
  border: 1px solid var(--border-light, rgba(212, 160, 23, 0.15));
  border-radius: 12px;
}

.dimChartHeader {
  font-size: 0.9rem;
  color: var(--text-secondary, #6B5940);
  margin-bottom: 0.8rem;
  text-align: center;
}

.dimChartHeader strong {
  font-family: 'Noto Serif TC', serif;
  font-size: 1.1rem;
  color: var(--text-accent, #C41E3A);
}

.dimChartRow {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}

.dimChartRow:last-child { margin-bottom: 0; }

.dimChartLabel {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-secondary, #6B5940);
  min-width: 58px;
  text-align: right;
  flex-shrink: 0;
}

.dimChartBarTrack {
  flex: 1;
  height: 10px;
  background: rgba(212, 160, 23, 0.1);
  border-radius: 5px;
  overflow: hidden;
}

.dimChartBarFill {
  height: 100%;
  border-radius: 5px;
  transition: width 0.8s ease-out;
}

.dimChartScore {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-primary, #3C2415);
  min-width: 22px;
  text-align: right;
  flex-shrink: 0;
}

.dimChartAssessment {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0.15rem 0.4rem;
  border-radius: 6px;
  min-width: 40px;
  text-align: center;
  flex-shrink: 0;
}

.dimAssessGood {
  background: rgba(46, 125, 50, 0.1);
  color: var(--color-success);
}

.dimAssessFair {
  background: rgba(255, 193, 7, 0.1);
  color: var(--color-warning);
}

.dimAssessPoor {
  background: rgba(244, 67, 54, 0.1);
  color: var(--color-error);
}

@media (max-width: 600px) {
  .dimChartLabel { min-width: 50px; font-size: 0.72rem; }
  .dimChartAssessment { font-size: 0.62rem; min-width: 34px; }
}
```

---

## Files Changed

| File | Change | Staff Eng Issue Addressed |
|------|--------|--------------------------|
| `packages/shared/src/constants.ts` | Add `COMPATIBILITY_BASIS` key as first entry | #3 (count sync) |
| `apps/web/app/lib/readings-api.ts` | Add to `SECTION_TITLE_MAP` + section order | #4 (ordering) |
| `apps/api/src/ai/prompts.ts` | Add to CALL1 sections + output format + anti-hallucination | #8 (token budget verified) |
| `apps/api/src/ai/ai.service.ts` | Add dimension interpolation in Call 1 block (NOT interpolateCompatPreAnalysisForV2) | #6 (interpolation scope) |
| `apps/web/app/components/AIReadingDisplay.tsx` | Add `CompatDimensionChart` + badge + `getScoreLabel()` | #1, #5 (badge data) |
| `apps/web/app/components/AIReadingDisplay.module.css` | Bar chart styles | — |
| `apps/web/app/reading/compatibility/page.tsx` | Pass `compatibilityPreAnalysis` in chartData | #2 (prop wiring) |

## Token Budget Verification
Current Call 1: 8 sections, ~5,576 chars total (~2,230 tokens). Adding 1 section at 200-300 chars → ~5,876 chars (~2,350 tokens). Output token limit is 8,192. **Budget: 29% used. Safe margin of 71%.**

## Estimated Size
~200 lines total (component ~60, CSS ~70, prompt ~30, interpolation ~15, badge ~15, wiring ~10)
