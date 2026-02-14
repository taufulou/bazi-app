# Phase 10: Wire Frontend to NestJS API — Implementation Plan

## Overview
Connect the reading page (`apps/web/app/reading/[type]/page.tsx`) to the NestJS backend for authenticated readings with real AI interpretation, credit deduction, and reading history.

---

## Step 1: Expose `selectedProfileId` from BirthDataForm to Parent

**File:** `apps/web/app/components/BirthDataForm.tsx`

**Problem:** `selectedProfileId` is internal state in BirthDataForm. The parent `page.tsx` receives only `BirthDataFormValues` via `onSubmit` — no profile ID. NestJS endpoints require `birthProfileId` (UUID).

**Fix:** Change `onSubmit` callback signature to include the profile ID:
```typescript
// Current
onSubmit: (data: BirthDataFormValues) => void;

// New
onSubmit: (data: BirthDataFormValues, profileId: string | null) => void;
```

In `handleSubmit()`, pass `selectedProfileId`:
```typescript
onSubmit(form, selectedProfileId);
```

---

## Step 2: Create `apps/web/app/lib/readings-api.ts`

API client functions for creating/fetching readings via NestJS. Reuse `apiFetch` from `api.ts`.

**Reading type slug → backend enum mapping:**
```typescript
const READING_TYPE_MAP: Record<string, string> = {
  "lifetime": "LIFETIME", "annual": "ANNUAL", "career": "CAREER",
  "love": "LOVE", "health": "HEALTH",
  "zwds-lifetime": "ZWDS_LIFETIME", "zwds-annual": "ZWDS_ANNUAL",
  "zwds-career": "ZWDS_CAREER", "zwds-love": "ZWDS_LOVE",
  "zwds-health": "ZWDS_HEALTH",
  "zwds-monthly": "ZWDS_MONTHLY", "zwds-daily": "ZWDS_DAILY",
  "zwds-major-period": "ZWDS_MAJOR_PERIOD", "zwds-qa": "ZWDS_QA",
};
```

Note: `compatibility`, `zwds-compatibility`, `cross-system`, `deep-stars` are NOT in this map — they use different endpoints (see Step 7).

**Functions (note: slug→enum mapping happens inside these functions):**
```typescript
export async function createBaziReading(token: string, params: {
  birthProfileId: string;
  readingType: string;  // frontend slug e.g. "lifetime" → internally mapped to "LIFETIME"
  targetYear?: number;
}): Promise<NestJSReadingResponse> {
  return apiFetch('/api/bazi/readings', {
    method: 'POST', token,
    body: JSON.stringify({
      birthProfileId: params.birthProfileId,
      readingType: READING_TYPE_MAP[params.readingType],  // slug → enum
      targetYear: params.targetYear,
    }),
  });
}

export async function createZwdsReading(token: string, params: {
  birthProfileId: string;
  readingType: string;  // frontend slug e.g. "zwds-career" → internally mapped to "ZWDS_CAREER"
  targetYear?: number;
  targetMonth?: number;
  targetDay?: string;
  questionText?: string;
}): Promise<NestJSReadingResponse> {
  return apiFetch('/api/zwds/readings', {
    method: 'POST', token,
    body: JSON.stringify({
      birthProfileId: params.birthProfileId,
      readingType: READING_TYPE_MAP[params.readingType],  // slug → enum
      ...(params.targetYear && { targetYear: params.targetYear }),
      ...(params.targetMonth && { targetMonth: params.targetMonth }),
      ...(params.targetDay && { targetDay: params.targetDay }),
      ...(params.questionText && { questionText: params.questionText }),
    }),
  });
}

export async function getReading(token: string, id: string): Promise<NestJSReadingResponse> {
  // Both Bazi and ZWDS readings are in the same baziReading table
  // Use bazi endpoint — works for both
  return apiFetch(`/api/bazi/readings/${id}`, { token });
}
```

**Response type:**
```typescript
interface NestJSReadingResponse {
  id: string;
  readingType: string;
  calculationData: Record<string, unknown>;  // Direct chart data — no unwrapping needed
  aiInterpretation: {
    sections: Record<string, { preview: string; full: string }>;  // Object keyed
    summary?: { preview: string; full: string };
  } | null;
  creditsUsed: number;
  createdAt: string;
}
```

**AI response transformer** (backend object → frontend array):
```typescript
export function transformAIResponse(ai: NestJSReadingResponse['aiInterpretation']): AIReadingData | null {
  if (!ai || !ai.sections) return null;

  const sections = Object.entries(ai.sections).map(([key, { preview, full }]) => ({
    key,
    title: SECTION_TITLE_MAP[key] || key,  // zh-TW titles
    preview,
    full,
  }));

  const summary = ai.summary ? { text: ai.summary.full } : undefined;

  return { sections, summary };
}
```

`SECTION_TITLE_MAP` maps section keys like `"personality"` → `"命格性格分析"`, `"career_palace"` → `"事業宮分析"`, etc. (extract from existing mock data).

---

## Step 3: Auto-Create Profile for Manual Entry (First-Time User Flow)

**Problem:** When a signed-in user types birth data manually without selecting a saved profile, there is no `birthProfileId`. NestJS endpoints require it.

**New parent-level state in `page.tsx`:**
```typescript
const [lastProfileId, setLastProfileId] = useState<string | null>(null);
const [currentReadingId, setCurrentReadingId] = useState<string | null>(null);
const [showSubscribeCTA, setShowSubscribeCTA] = useState(false);
```

**Solution in `handleFormSubmit()`:**
```typescript
async function handleFormSubmit(data: BirthDataFormValues, profileId: string | null) {
  setFormValues(data);
  setIsLoading(true);
  setError(undefined);
  setShowSubscribeCTA(false);
  setCurrentReadingId(null);

  let birthProfileId = profileId;

  // Signed-in but no profile selected → auto-create one
  if (isSignedIn && !birthProfileId) {
    const token = await getToken();
    if (token) {
      try {
        const newProfile = await createBirthProfile(token, formValuesToPayload(data, 'SELF'));
        birthProfileId = newProfile.id;
        // Update savedProfiles for dropdown
        const updated = await fetchBirthProfiles(token);
        setSavedProfiles(updated);
      } catch {
        // Fall back to direct engine call (chart only)
      }
    }
  }

  // Store profile ID for retry
  setLastProfileId(birthProfileId);

  try {
    if (isSignedIn && birthProfileId) {
      // Route through NestJS (chart + AI + credits + DB)
      await callNestJSReading(data, birthProfileId);
    } else {
      // Not signed in OR profile creation failed → direct engine (chart only, no AI)
      await callDirectEngine(data);
    }
  } finally {
    setIsLoading(false);
  }
}
```

This ensures first-time users who type manually still get the full NestJS flow. `lastProfileId` is stored in parent state so `handleRetry` can access it.

---

## Step 4: Modify `handleFormSubmit()` — Dual Path

**Authenticated path (NestJS):**

Note: `readingType` variable holds the frontend slug (e.g. `"zwds-career"`). The `createBaziReading` and `createZwdsReading` functions in `readings-api.ts` handle the mapping to backend enum (e.g. `"ZWDS_CAREER"`) internally via `READING_TYPE_MAP`. Callers pass the slug; the API client converts it.

```typescript
async function callNestJSReading(data: BirthDataFormValues, birthProfileId: string) {
  const token = await getToken();
  if (!token) return;

  try {
    let response: NestJSReadingResponse;

    if (isZwds) {
      response = await createZwdsReading(token, {
        birthProfileId,
        readingType: readingType,  // slug → API client maps to ZWDS_CAREER etc.
        targetYear: (readingType === 'zwds-annual' || readingType === 'zwds-monthly')
          ? new Date().getFullYear() : undefined,
        targetMonth: readingType === 'zwds-monthly' ? targetMonth : undefined,
        targetDay: readingType === 'zwds-daily' ? targetDay : undefined,
        questionText: readingType === 'zwds-qa' ? questionText : undefined,
      });
      setZwdsChartData(response.calculationData as ZwdsChartData);
    } else {
      response = await createBaziReading(token, {
        birthProfileId,
        readingType: readingType,  // slug → API client maps to LIFETIME etc.
        targetYear: readingType === 'annual' ? new Date().getFullYear() : undefined,
      });
      setChartData(response.calculationData);
    }

    // Transform AI response (object→array) for AIReadingDisplay
    const aiReading = transformAIResponse(response.aiInterpretation);
    setAiData(aiReading);

    // Save reading ID for retry/history
    setCurrentReadingId(response.id);

    setStep("result");
    setTab("chart");
  } catch (err) {
    const message = err instanceof Error ? err.message : '';

    // Insufficient credits or free reading used → fall back to chart-only via direct engine
    if (message.includes('Insufficient credits') || message.includes('Free reading already used')) {
      try {
        await callDirectEngine(data);
        setShowSubscribeCTA(true);  // Show subscribe CTA on reading tab
        return;  // Don't show error — chart loaded successfully
      } catch {
        // If direct engine also fails, show generic error
      }
    }

    // Other errors → show Chinese error message
    handleNestJSError(err);
  }
}
```

**Unauthenticated path (direct engine — keep existing):**
```typescript
async function callDirectEngine(data: BirthDataFormValues) {
  // Keep existing direct fetch calls to /api/bazi-calculate and /api/zwds-calculate
  // No AI interpretation, no credits, no DB save
  // Set aiData to null
  // On result tab: if showSubscribeCTA, show subscribe prompt instead of "暫無 AI 解讀"
  // setStep("result"), setTab("chart")
}
```

---

## Step 5: Error Handling with Chinese Messages

```typescript
function handleNestJSError(err: unknown) {
  const message = err instanceof Error ? err.message : '';

  if (message.includes('Insufficient credits')) {
    setError('額度不足，請升級訂閱方案以繼續使用');
    setShowSubscribeCTA(true);
  } else if (message.includes('Free reading already used')) {
    setError('免費體驗已使用完畢，請訂閱以繼續');
    setShowSubscribeCTA(true);
  } else if (message.includes('429') || message.includes('Too many')) {
    setError('請求過於頻繁，請稍候再試');
  } else if (message === 'Failed to fetch') {
    setError('無法連線到服務，請確認網路連線');
  } else {
    setError('分析失敗，請稍後再試');
  }
}
```

---

## Step 6: Handle Insufficient Credits Gracefully — Chart Fallback

**Problem:** If a signed-in user has no credits, `POST /api/bazi/readings` returns 400. The user sees nothing.

**Solution:** On "Insufficient credits" error, fall back to direct engine call for chart-only:
```typescript
if (message.includes('Insufficient credits') || message.includes('Free reading already used')) {
  // Fall back to direct engine for chart display
  await callDirectEngine(data);
  setError(null);  // Clear the error since chart loaded
  setShowSubscribeCTA(true);  // Show CTA on the reading tab instead of AI content
}
```

This way the user always sees their chart, with a CTA to subscribe for AI interpretation.

---

## Step 7: Compatibility, Cross-System, Deep-Stars — Separate Flows

These types use different endpoints and cannot go through the standard `createReading` path:

| Type | Endpoint | Notes |
|------|----------|-------|
| `compatibility` | `POST /api/bazi/comparisons` | Requires 2 profiles + comparisonType |
| `zwds-compatibility` | `POST /api/zwds/comparisons` | Requires 2 profiles + comparisonType |
| `cross-system` | `POST /api/zwds/cross-system` | Single profile, different endpoint |
| `deep-stars` | `POST /api/zwds/deep-stars` | Single profile, Master-tier only |

**Phase 10 scope:** Wire only the 14 single-person reading types (6 Bazi + 8 ZWDS). Compatibility requires a dual-person form redesign. Cross-system and deep-stars need their slugs added to `VALID_TYPES` and routed to special endpoints.

**For now:** Keep compatibility with direct engine calls (chart-only). Cross-system and deep-stars add as separate `VALID_TYPES` entries routing to their respective NestJS endpoints.

---

## Step 8: Prevent Double-Charge on Retry

**Problem:** `handleRetry` calls `handleFormSubmit` again, which creates a new reading and deducts credits again.

**Solution:** Store the reading ID from the first successful call. On retry, if we already have a reading ID, just re-fetch it. Use `lastProfileId` (parent state) not `selectedProfileId` (BirthDataForm internal state):
```typescript
// State already declared in Step 3:
// const [currentReadingId, setCurrentReadingId] = useState<string | null>(null);
// const [lastProfileId, setLastProfileId] = useState<string | null>(null);

const handleRetry = async () => {
  if (currentReadingId) {
    // Re-fetch existing reading (no new credit deduction)
    const token = await getToken();
    if (token) {
      const reading = await getReading(token, currentReadingId);
      // Re-populate chart and AI data from saved reading
      if (isZwds) setZwdsChartData(reading.calculationData as ZwdsChartData);
      else setChartData(reading.calculationData);
      setAiData(transformAIResponse(reading.aiInterpretation));
    }
  } else if (formValues) {
    // No reading was created yet → retry full submit
    handleFormSubmit(formValues, lastProfileId);
  }
};

// handleBack must also reset new state:
const handleBack = () => {
  if (step === "result") {
    setStep("input");
    setChartData(null);
    setZwdsChartData(null);
    setAiData(null);
    setCurrentReadingId(null);
    setLastProfileId(null);
    setShowSubscribeCTA(false);
  } else {
    router.push("/dashboard");
  }
};
```

---

## Step 9: Keep Mock Functions Behind Feature Flag

**Problem:** Removing mocks before AI keys are configured leaves users with "暫無 AI 解讀資料".

**Solution:** Keep mocks as development fallback:
```typescript
// In callNestJSReading(), after getting response:
if (!response.aiInterpretation) {
  // AI provider not configured or failed — use mock as fallback in development
  if (process.env.NODE_ENV === 'development') {
    const mockAI = isZwds
      ? generateMockZwdsReading(readingType as ReadingTypeSlug)
      : generateMockReading(readingType as ReadingTypeSlug);
    setAiData(mockAI);
  } else {
    setAiData(null);  // Production: show "AI analysis unavailable" CTA
  }
}
```

Delete mocks entirely only after confirming end-to-end AI flow works in production.

---

## Step 10: Reading History Page (Basic)

**New page:** `apps/web/app/dashboard/readings/page.tsx`

**Endpoint:** `GET /api/users/me/readings` (already exists)

**Layout:**
```
← 返回控制台

歷史分析記錄
查看您過去的命理分析結果

[Card: Roger · 八字終身運 · 2026-02-12]
[Card: Laopo · 紫微事業運 · 2026-02-10]
...

(empty state: 尚無分析記錄)
```

Click a card → navigate to `/reading/[type]?id=xxx` → reading page checks for `id` query param on mount, if present calls `getReading(token, id)` and jumps directly to result step (skipping input form).

**Required change in `page.tsx`:** Add a `useSearchParams` hook to detect `?id=xxx`. In the initial `useEffect`, if `id` is present, call `getReading()` and set chart/AI data directly, set step to "result".

**Deferred to Phase 10B:** Pagination, filtering by type, date range.

---

## Files Summary

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `apps/web/app/components/BirthDataForm.tsx` | MODIFY | Add `profileId` to `onSubmit` callback |
| 2 | `apps/web/app/lib/readings-api.ts` | CREATE | API client + response transformer |
| 3 | `apps/web/app/reading/[type]/page.tsx` | MODIFY | Dual-path submit, error handling, retry logic |
| 4 | `apps/web/app/dashboard/readings/page.tsx` | CREATE | Reading history page (basic) |
| 5 | `apps/web/app/dashboard/readings/page.module.css` | CREATE | History page styles |
| 6 | `apps/web/app/dashboard/page.tsx` | MODIFY | Add link to reading history |

**No backend changes needed.** All NestJS endpoints are already built and tested.

---

## Prerequisites
- At least one AI API key configured in `apps/api/.env` (ANTHROPIC_API_KEY or OPENAI_API_KEY or GOOGLE_AI_API_KEY)
- NestJS server running (`npm run dev:api`)
- Python Bazi engine running (port 5001) — needed by NestJS for Bazi calculations

---

## Out of Scope (Phase 10B)
- Compatibility dual-person form redesign
- Reading history pagination/filtering
- Credit balance display on form
- Two-phase loading (chart first, then AI)
- AI streaming responses
- `BaziChartData` proper typing (currently `any`)
