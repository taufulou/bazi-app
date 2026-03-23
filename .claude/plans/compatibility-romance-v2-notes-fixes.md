# 感情合盤 V2 — Notes 7, 8, 9, 11, 12 Fix Plan

Fixes for 5 NOTEs from the final audit. Does NOT override any existing plan.

## Pre-Fix Verification Results

- **Note 7/12 (nayin path)**: CONFIRMED BUG. `ai.service.ts` line 4517 reads `chart['nayin']` but chart has no top-level `nayin` key. Correct path: `chart.fourPillars?.year?.naYin`.
- **Note 8 (yongshenAnalysis)**: **FALSE POSITIVE**. `compatibilityPreAnalysis['yongshenAnalysis']` DOES exist with full data (aUsefulElement, bUsefulElement, explanation, score, etc.). The V2 `interpolateCompatPreAnalysisForV2()` at line 4678 reads it correctly. No fix needed.
- **Note 9 (streaming endpoint)**: CONFIRMED GAP. Frontend calls `/api/bazi/comparisons/:id/stream` but controller has no such endpoint. The ai.service.ts has `streamCompatibilityRomanceV2()` ready but nothing calls it.
- **Note 11 (badge positioning)**: CONFIRMED. Badge renders at line 844 AFTER `AIReadingDisplay`, should render BEFORE it.

---

## Fix 1: Note 7/12 — Nayin path (1 line)

**File**: `apps/api/src/ai/ai.service.ts` line 4517

**Current**:
```typescript
(chart['nayin'] as string) || ''
```

**Fix**:
```typescript
((chart as any).fourPillars?.year?.naYin as string) || ''
```

**Verification**: Roger's chart has `fourPillars.year.naYin = '爐中火'`. After fix, `{{nayinA}}` will interpolate to `爐中火` instead of empty string.

---

## Fix 2: Note 8 — yongshenAnalysis

**No fix needed.** The data exists and the code reads it correctly. The audit's claim was a false positive based on an incorrect assertion from an earlier research round.

---

## Fix 3: Note 9 — Streaming SSE endpoint for comparisons

### 3A: Add SSE endpoint to controller

**File**: `apps/api/src/bazi/bazi.controller.ts`

Add a new SSE endpoint after the existing `generate-ai` endpoint:

```typescript
@Sse('comparisons/:id/stream')
@ApiBearerAuth()
@ApiOperation({ summary: 'Stream AI interpretation for a romance comparison via SSE' })
streamComparisonAI(
  @CurrentUser() auth: AuthPayload,
  @Param('id') id: string,
): Observable<MessageEvent> {
  return this.baziService.streamComparisonAI(auth.userId, id);
}
```

### 3B: Add streaming method to bazi.service.ts

**File**: `apps/api/src/bazi/bazi.service.ts`

Add a `streamComparisonAI()` method that follows the EXISTING `streamReading` pattern, including:
- Redis concurrent stream limit
- Cache check before streaming
- DB persistence after stream completes

```typescript
streamComparisonAI(userId: string, comparisonId: string): Observable<MessageEvent> {
  // 1. Load the comparison record
  const comparison = await this.prisma.baziComparison.findFirst({
    where: { id: comparisonId, userId },
  });
  if (!comparison) throw new NotFoundException('Comparison not found');

  // 2. Check if it's a romance V2 comparison
  const calculationData = comparison.calculationData as Record<string, unknown>;
  const isRomanceV2 = comparison.comparisonType === 'ROMANCE'
    && !!calculationData['romancePreAnalysis'];
  if (!isRomanceV2) {
    throw new BadRequestException('Streaming only supported for Romance V2 comparisons');
  }

  // 3. Check cache — if AI already generated, return cached result as instant stream
  if (comparison.aiInterpretation) {
    return this.emitCachedResultAsStream(comparison.aiInterpretation);
  }

  // 4. Redis concurrent stream limit (max 2 per user, same as streamReading)
  // Use Redis key: `stream:active:compat:${userId}` with TTL
  // If limit exceeded, throw TooManyRequestsException

  // 5. Call ai.service streaming method
  // The _executeStreamCompatRomanceV2() in ai.service.ts already handles
  // DB update (saves aiInterpretation to the comparison record) on completion
  return this.aiService.streamCompatibilityRomanceV2(calculationData, comparisonId);
}
```

### 3C: Credit deduction + stream failure strategy

The frontend flow uses two separate API calls:
1. `createBaziCompatibility({ skipAI: true })` → creates record, deducts credits, returns calc data
2. SSE stream → generates AI and persists to DB

**Credit safety**: Credits are deducted in step 1 (same as current non-streaming flow). If the stream fails:
- The comparison record EXISTS with `calculationData` but `aiInterpretation: null`
- User can retry via the `generate-ai` endpoint (already exists) which doesn't charge again
- The frontend's error handler should show a "重試" button that calls `generateCompatibilityAI()`
- The `_executeStreamCompatRomanceV2()` already saves to DB on completion (check existing implementation)

**No `stream` DTO field needed**: The frontend already uses `skipAI: true` for step 1. The `stream: true` flag was redundant — the frontend just calls the SSE endpoint directly after getting the comparison ID. Remove the proposed `stream` DTO field.

**Revised frontend unlock flow** (simpler, uses existing `skipAI`):
1. `createBaziCompatibility(token, { ...params, skipAI: false })` → creates record WITH credits deduction, AI generated synchronously, returns full result
2. **OR** for streaming: `createBaziCompatibility(token, { ...params, skipAI: true })` → creates record, deducts credits, NO AI
3. Frontend calls SSE endpoint → `streamComparisonAI()` → stream sections
4. On failure: frontend retry button calls `generateCompatibilityAI()` (non-streaming fallback)

### 3D: Verify _executeStreamCompatRomanceV2 saves to DB

**File**: `apps/api/src/ai/ai.service.ts` — check `_executeStreamCompatRomanceV2()`

Verify it:
- Calls `prisma.baziComparison.update()` to save `aiInterpretation` after streaming completes
- Sets `schemaVersion: 'v2'` in the saved data
- Handles errors gracefully (emits error event to SSE, doesn't leave DB in broken state)

If the existing implementation already handles DB persistence (check the code), no additional work needed. If NOT, add the persistence step.

### 3E: Verify Observable import + add Redis concurrent limit

Check that `bazi.controller.ts` imports `Observable` and `MessageEvent` from the right packages (same as the existing `streamReading` endpoint uses).

Add Redis concurrent stream check in `streamComparisonAI()`, following the same pattern as `streamReading()` (search for `stream:active` in bazi.service.ts).

---

## Fix 4: Note 11 — Badge positioning

**Problem**: Badge renders AFTER section content. Should render BETWEEN title and content, matching the existing pattern used by Career V2, Annual V2, and Love V2 badges.

**Approach**: Follow the EXISTING inline badge pattern used by other reading types (CareerSummaryBadge, LoveSectionBadge, AnnualSectionBadge at AIReadingDisplay.tsx lines ~1688-1707). These are rendered inside `AIReadingDisplay` based on `readingType` detection, NOT via a generic prop.

### 4A: Add `isCompatV2` detection in AIReadingDisplay.tsx

In the section rendering area where other badge types are detected (search for `isCareerV2` or `isLoveV2`), add:

```tsx
// Detect compat V2 reading type
const isCompatV2 = readingType === 'compatibility_v2' || sections.some(s => s.key === 'chart_profile_a');
```

### 4B: Add `CompatSectionBadge` inline rendering

After the section title, inside the existing badge rendering area:

```tsx
{isCompatV2 && (
  <CompatSectionBadge sectionKey={section.key} chartData={chartData} />
)}
```

The `CompatSectionBadge` component can be defined in `AIReadingDisplay.tsx` (small inline component) or imported. It reads badge data from `chartData` which already contains `romancePreAnalysis`, `chartA`, `chartB`.

### 4C: Move badge logic from page.tsx to AIReadingDisplay.tsx

Move the `getCompatV2SectionBadge()` function from `page.tsx` to `AIReadingDisplay.tsx` (or a shared util). Remove the inline badge render from `page.tsx` (the `{badge && <div>...` at line 844).

### 4D: Pass romancePreAnalysis via chartData prop

The compatibility page already passes `chartData` to `AIReadingDisplay`. Ensure `romancePreAnalysis` is included:

```tsx
<AIReadingDisplay
  chartData={{ ...existingChartData, romancePreAnalysis: rpa, chartA, chartB }}
  ...
/>
```

### 4E: CSS

Add `.compatSectionBadge` style in `AIReadingDisplay.module.css` matching existing badge styles (same as `.loveSectionBadge` or `.careerSummaryBadge`).

**Files changed**:
- `AIReadingDisplay.tsx` — add isCompatV2 detection + CompatSectionBadge component + move badge function (~40 lines)
- `page.tsx` — remove inline badge render, pass rpa via chartData (~-10 lines)
- `AIReadingDisplay.module.css` — add badge style (~5 lines)

---

## Implementation Order

| Step | Fix | Description | Est. Lines |
|------|-----|-------------|-----------|
| 1 | Note 7/12 | Nayin path fix in ai.service.ts | 1 |
| 2 | Note 8 | Confirmed false positive — no code change | 0 |
| 3 | Note 11 | Badge positioning — follow existing inline pattern in AIReadingDisplay | ~45 |
| 4 | Note 9 | SSE streaming: controller endpoint + service method with cache/redis/DB | ~60 |

**Total**: ~106 lines of changes.

Steps 1 and 3 can be done in parallel. Step 4 (streaming) is the most complex.

## Test Impact

- **Note 7/12**: No test changes. Only affects AI prompt content (nayin now populated).
- **Note 11**: No test changes. CSS/rendering only. Verify existing badge tests for other reading types still pass.
- **Note 9**: TypeScript must compile. Verify with `tsc --noEmit`. Check the existing `_executeStreamCompatRomanceV2()` handles DB persistence. If NestJS unit tests mock the comparison controller, may need a new test case for the SSE endpoint. The critical runtime check: after streaming completes, verify `baziComparison.aiInterpretation` is populated in DB.
