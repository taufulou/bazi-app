# V10: Code Review Round 2 Fixes — Rev 2

## Context
PR #29 code review round 2 found 4 issues. This plan fixes all 4 without modifying existing plans.

**Rev 2 changes**: (1) Fix 1 now explicitly states "preserve the summary-extraction block at lines 4417-4421 — only replace the `parseLifetimeV2CallResponse` call, NOT the surrounding logic". (2) Fix 3 now uses `(saved.calculationData as any)?.romancePreAnalysis` cast since `CompatibilityCalculationData` interface doesn't declare `romancePreAnalysis`.

---

## Fix 1: Streaming Parser Uses Wrong Fallback Keys (Score 90) — CRITICAL

**File**: `apps/api/src/ai/ai.service.ts`

**Problem**: `_executeStreamCompatRomanceV2()` uses `parseLifetimeV2CallResponse` at 6 locations for final-parse and salvage. When fallback triggers, it searches for Lifetime keys instead of Compat V2 keys.

**Already fixed in batch path** (lines 4038-4065): Uses `parseAIResponse` + `extractCompletedSections(COMPAT_V2_SECTIONS.*)`.

**Fix**: Replace all 6 `parseLifetimeV2CallResponse` calls in the streaming path with the same pattern used in the batch path.

### 6 locations to change:

**Call 1 final parse** (~line 4221):
```typescript
// Before:
const finalParsed1 = this.parseLifetimeV2CallResponse(call1Buffer, 'call1');
// After:
const finalParsed1 = this.parseAIResponse(call1Buffer, ReadingType.COMPATIBILITY);
if (Object.keys(finalParsed1.sections).length === 0) {
  const extracted = this.extractCompletedSections(call1Buffer, COMPAT_V2_SECTIONS.CALL1, call1ExtractedKeys);
  Object.assign(finalParsed1.sections, extracted);
}
```

**Call 1 salvage** (~line 4246):
```typescript
// Before:
const salvaged = this.parseLifetimeV2CallResponse(call1Buffer, 'call1');
// After:
const salvaged = this.parseAIResponse(call1Buffer, ReadingType.COMPATIBILITY);
if (Object.keys(salvaged.sections).length === 0) {
  const extracted = this.extractCompletedSections(call1Buffer, COMPAT_V2_SECTIONS.CALL1, call1ExtractedKeys);
  Object.assign(salvaged.sections, extracted);
}
```

**Call 2 final parse** (~line 4314): Same pattern with `COMPAT_V2_SECTIONS.CALL2` and `call2ExtractedKeys`

**Call 2 salvage** (~line 4334): Same pattern with `COMPAT_V2_SECTIONS.CALL2` and `call2ExtractedKeys`

**Call 3 final parse** (~line 4403): Same pattern with `COMPAT_V2_SECTIONS.CALL3` and `call3ExtractedKeys`

**⚠️ CRITICAL for Call 3**: The summary-extraction block at lines 4417-4421 MUST be preserved. Only replace the `parseLifetimeV2CallResponse` call itself — do NOT touch the surrounding `if (finalParsed3.summary ...)` logic. `parseAIResponse` also populates `.summary`, so this block continues to work correctly.

**Call 3 salvage** (~line 4429): Same pattern with `COMPAT_V2_SECTIONS.CALL3` and `call3ExtractedKeys`

**Important**: Use the existing `callNExtractedKeys` set (already tracked during streaming) so `extractCompletedSections` doesn't re-extract sections that were already sent during live streaming.

---

## Fix 2: Missing `compatibility_basis` in SECTION_TITLES_ZH (Score 78)

**File**: `apps/web/app/components/AIReadingDisplay.tsx`

**Problem**: The `SECTION_TITLES_ZH` map (used for section icon theming and title rendering) is missing the new `compatibility_basis` key.

**Fix**: Add one line at the start of the Compatibility V2 section of `SECTION_TITLES_ZH`:

```typescript
// In the compat V2 block of SECTION_TITLES_ZH:
compatibility_basis: "配對基礎分析",
chart_profile_a: "男方命局特點",
// ...
```

Find `SECTION_TITLES_ZH` (around line 300), then find the comment `// Compatibility V2` or the first compat entry `chart_profile_a`, and add `compatibility_basis` before it.

---

## Fix 3: Page Reload Breaks Unlock Flow (Score 62)

**File**: `apps/web/app/reading/compatibility/page.tsx`

**Problem**: After `handleSubmit` creates a comparison (credits deducted), the URL stays at `/reading/compatibility` without the comparison ID. If the user reloads the page, `currentComparisonIdRef.current` is null, and `handleRomanceUnlock` throws "找不到合盤資料". The user paid but can't access their reading.

**Root cause**: The page already has a `loadSavedComparison(readingIdParam)` flow for deep links (`?id=xxx`), but `handleSubmit` never pushes the ID to the URL.

**Solution**: Use `window.history.replaceState` to silently update the URL with the comparison ID after creation. This way:
- Page reload → URL has `?id=xxx` → `loadSavedComparison` restores state
- Back button still works (replaceState doesn't add history entry)
- No Next.js router needed (avoids full page re-render)

### Changes:

**3a. After comparison creation in `handleSubmit` (romance path, ~line 353):**
```typescript
const result = await createBaziCompatibility(token, { ...params, skipAI: true });
currentComparisonIdRef.current = result.id;
savedSubmitParamsRef.current = params;
setCompatData(result);

// Silently update URL so page reload can restore state
window.history.replaceState(null, '', `?id=${result.id}`);
```

**3b. In `loadSavedComparison` (~line 283), handle the paywall state for unpaid comparisons:**

Currently, `loadSavedComparison` assumes AI is already generated. For the case where comparison exists but `aiInterpretation` is null (user paid but didn't unlock yet), we need to show the paywall:

```typescript
const loadSavedComparison = async (id: string) => {
  setIsLoading(true);
  try {
    const token = await getToken();
    if (!token) {
      setError("請先登入");
      setStep("input");
      return;
    }
    const saved = await getCompatibility(token, id);
    setCompatData(saved);
    currentComparisonIdRef.current = saved.id;  // ADD: restore ref

    // Check if this is a V2 romance comparison without AI yet (paywall state)
    // Note: CompatibilityCalculationData interface doesn't declare romancePreAnalysis, so cast needed
    const isV2Romance = (saved.calculationData as any)?.romancePreAnalysis;
    if (isV2Romance && !saved.aiInterpretation) {
      // Restore paywall state — credits already deducted, user just needs to unlock
      setStep("result");
      setShowPaywall(true);
    } else {
      // Has AI — show full results
      setAiData(transformAIResponse(saved.aiInterpretation));
      setStep("result");
    }
  } catch {
    setError("無法載入分析結果");
    setStep("input");
  } finally {
    setIsLoading(false);
  }
};
```

**3c. After unlock streaming completes, update URL again (if it doesn't have the ID):**
Not needed — the URL was already set in step 3a. After unlock, the same URL works because `loadSavedComparison` will find the AI interpretation populated.

---

## Fix 4: Hardcoded Hex Color Fallbacks (Score 35)

**Files**:
- `apps/web/app/components/CompatibilityScoreRevealV2.module.css`
- `apps/web/app/components/CompatibilityRomancePaywallCTA.module.css`
- `apps/web/app/reading/compatibility/page.module.css`

**Problem**: Some CSS rules use hardcoded hex values where CSS variables exist and should be used.

### 4a. `CompatibilityScoreRevealV2.module.css`:

| Current | Replace with |
|---------|-------------|
| `color: #C2185B` (peach badge) | `color: var(--color-peach-blossom)` |
| `color: #B8860B` (spouse badge) | `color: var(--color-gold)` |
| `color: #2E7D32` (reassurance strong) | `color: var(--color-success)` |
| `background: #FFFFFF` (container, masterNote) | `background: var(--bg-card)` |
| `background: linear-gradient(135deg, #f0faf0 ...)` (reassurance) | `background: linear-gradient(135deg, var(--color-success-bg-start) 0%, var(--color-success-bg-end) 100%)` |

### 4b. `CompatibilityRomancePaywallCTA.module.css`:

| Current | Replace with |
|---------|-------------|
| `background: linear-gradient(135deg, #999 ...)` (disabled btn) | `background: linear-gradient(135deg, var(--color-disabled-bg) 0%, var(--color-disabled-bg-end) 100%)` |

### 4c. `page.module.css`:

| Current | Replace with |
|---------|-------------|
| `background: linear-gradient(180deg, #FFF3E0 ...)` (pageContainer) | `background: linear-gradient(180deg, var(--bg-primary) 0%, var(--bg-secondary) 100%)` |
| `color: #FFFFFF` (backLink, headerTitle) | `color: var(--bg-card)` |

### 4d. Remove redundant fallback hex from `var()` calls:

Where both the variable and its fallback are identical to the defined value (e.g., `var(--color-gold, #D4A017)` when `--color-gold` IS `#D4A017`), remove the fallback to keep CSS clean:
```css
/* Before: */ color: var(--color-gold, #D4A017);
/* After:  */ color: var(--color-gold);
```

Only remove fallbacks for variables that are guaranteed to exist in `globals.css`.

---

## Implementation Order

| Step | Fix | Files | Est. Lines |
|------|-----|-------|-----------|
| 1 | Fix 2 (section title) | AIReadingDisplay.tsx | ~1 |
| 2 | Fix 1 (streaming parser) | ai.service.ts | ~30 |
| 3 | Fix 3 (page reload) | page.tsx | ~15 |
| 4 | Fix 4 (CSS variables) | 3 CSS files | ~20 |

**Total**: ~66 lines across 5 files

## Verification

1. `cd apps/api && ../../node_modules/.bin/nest build` — NestJS compiles
2. Check Next.js hot-reload — no errors
3. Manual test: submit form → check URL has `?id=xxx` → reload page → paywall shows → unlock works
4. Manual test: verify streaming works end-to-end
