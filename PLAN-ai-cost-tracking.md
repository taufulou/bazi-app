# Implementation Plan: AI Cost Tracking Per Reading Type

## Problem
The `AIUsageLog` table tracks every AI call with tokens, cost, provider, and latency — but **does NOT store `readingType`**. This makes it impossible to break down costs by feature (Lifetime vs Daily vs Q&A). The admin AI costs page only shows aggregate totals and provider breakdown, not per-feature analytics.

## Gap Analysis

| What exists | What's missing |
|---|---|
| `AIUsageLog` with provider, tokens, cost | **No `readingType` column** — can't filter by feature |
| `logUsage()` called after every AI call | **`readingType` not passed** to logUsage |
| `GET /api/admin/ai-costs` endpoint | **No per-reading-type breakdown** in response |
| Admin AI costs page with provider table | **No reading type table, no tier grouping** |
| 30-day hardcoded window | **No date range filter** |

## Implementation Steps

### Step 1: Database — Add `readingType` to `AIUsageLog`
**File:** `apps/api/prisma/schema.prisma`

- Add `readingType ReadingType? @map("reading_type")` to `AIUsageLog` model
- Add index `@@index([readingType])` and `@@index([readingType, createdAt])`
- Nullable so existing rows are unaffected
- Run `npx prisma migrate dev --name add-reading-type-to-ai-usage-log`

### Step 2: AI Service — Pass `readingType` through logging
**File:** `apps/api/src/ai/ai.service.ts`

- Update `logUsage()` signature: add `readingType: ReadingType` parameter
- Store `readingType` in the `aIUsageLog.create()` call
- Update `generateInterpretation()` at line ~226 to pass `readingType` to `logUsage()`
- 3 lines changed, 1 parameter added

### Step 3: Admin Service — New analytics query `getAICostsByReadingType()`
**File:** `apps/api/src/admin/admin.service.ts`

Add a new method that returns:
```typescript
{
  // Aggregate summary (same as before, but with date range)
  summary: { totalCost, avgCost, totalTokens, inputTokens, outputTokens, requests, cacheHitRate },

  // Breakdown by provider (existing)
  costByProvider: [{ provider, totalCost, count, avgCost, inputTokens, outputTokens }],

  // NEW: Breakdown by reading type
  costByReadingType: [{
    readingType: string,
    totalCost: number,
    count: number,
    avgCost: number,
    avgInputTokens: number,
    avgOutputTokens: number,
    totalInputTokens: number,
    totalOutputTokens: number,
    avgLatencyMs: number,
    cacheHitRate: number,
  }],

  // NEW: Breakdown by tier (grouped reading types)
  costByTier: [{
    tier: 'comprehensive' | 'periodic' | 'daily' | 'qa',
    readingTypes: string[],
    totalCost: number,
    count: number,
    avgCost: number,
  }],

  // Daily trend (existing)
  dailyCosts: [{ date, totalCost, count }],
}
```

Tier grouping logic:
- **comprehensive**: LIFETIME, CAREER, LOVE, HEALTH, COMPATIBILITY, ZWDS_LIFETIME, ZWDS_CAREER, ZWDS_LOVE, ZWDS_HEALTH, ZWDS_COMPATIBILITY, ZWDS_MAJOR_PERIOD
- **periodic**: ANNUAL, ZWDS_ANNUAL, ZWDS_MONTHLY
- **daily**: ZWDS_DAILY
- **qa**: ZWDS_QA

Accept optional `days` query parameter (default 30, max 365) instead of hardcoded 30.

### Step 4: Admin Controller — Add query param support
**File:** `apps/api/src/admin/admin.controller.ts`

- Update `GET /api/admin/ai-costs` to accept `?days=30` query param
- Pass `days` to the updated `getAICosts(days)` service method
- No new endpoints needed — enhance existing one

### Step 5: Frontend API Client — Update types and function
**File:** `apps/web/app/lib/admin-api.ts`

- Update `AICosts` interface to include `costByReadingType` and `costByTier` arrays
- Update `getAICosts()` to accept optional `{ days?: number }` param
- Add type definitions for new response shape

### Step 6: Frontend Admin Page — Enhanced AI Costs dashboard
**File:** `apps/web/app/admin/ai-costs/page.tsx`

Add three new sections below existing content:

1. **Date range selector** — Dropdown: 7d / 30d / 90d / 365d
2. **Cost by Tier** — 4 summary cards (Comprehensive, Periodic, Daily, Q&A) showing total cost, count, avg cost per call
3. **Cost by Reading Type** — Full table with columns:
   - Reading Type, Requests, Total Cost, Avg Cost, Avg Input Tokens, Avg Output Tokens, Avg Latency, Cache Hit Rate
   - Sorted by totalCost descending
   - Color-coded rows by tier

**File:** `apps/web/app/admin/ai-costs/page.module.css`
- Add styles for tier cards, reading type table, date selector

## Files Changed (7 files)

| File | Change |
|---|---|
| `apps/api/prisma/schema.prisma` | Add `readingType` column + indexes to `AIUsageLog` |
| `apps/api/src/ai/ai.service.ts` | Pass `readingType` to `logUsage()` |
| `apps/api/src/admin/admin.service.ts` | Add `costByReadingType` + `costByTier` to `getAICosts()` |
| `apps/api/src/admin/admin.controller.ts` | Add `days` query param to `getAICosts` |
| `apps/web/app/lib/admin-api.ts` | Update types + function for new response shape |
| `apps/web/app/admin/ai-costs/page.tsx` | Add reading type table, tier cards, date picker |
| `apps/web/app/admin/ai-costs/page.module.css` | New styles for added sections |

## Non-Goals
- No changes to the Bazi engine or reading creation flow
- No changes to other admin pages
- No new migration for backfilling old data (old rows will have `readingType = null`)
- No chart library — uses the same CSS bar chart pattern already in use
