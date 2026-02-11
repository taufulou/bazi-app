# Implementation Plan: AI Cost Tracking Per Reading Type (v2)

## Problem
The `AIUsageLog` table tracks every AI call with tokens, cost, provider, and latency — but **does NOT store `readingType`**. This makes it impossible to break down costs by feature (Lifetime vs Daily vs Q&A). The admin AI costs page only shows aggregate totals and provider breakdown, not per-feature analytics.

## Why Denormalization (not JOIN)
`AIUsageLog.readingId` is a nullable FK to `BaziReading`. A JOIN approach has gaps:
- `readingId` is NULL for compatibility readings (stored in `BaziComparison`, not `BaziReading`)
- `readingId` is NULL when AI calls fail before a reading record is created
- Aggregation queries with JOINs are slower on analytics-scale data

Adding `readingType` directly to `AIUsageLog` is the correct approach: faster queries, no JOIN holes, and the column is set at call time (source of truth).

## Gap Analysis

| What exists | What's missing |
|---|---|
| `AIUsageLog` with provider, tokens, cost | **No `readingType` column** — can't filter by feature |
| `logUsage()` called after every AI call | **`readingType` not passed** to logUsage |
| `GET /api/admin/ai-costs` endpoint | **No per-reading-type breakdown** in response |
| Admin AI costs page with provider table | **No reading type table, no tier grouping** |
| 30-day hardcoded window | **No date range filter** |
| Field named `totalCost30d` | **Misleading when window is configurable** |

## Implementation Steps

### Step 1: Shared Constants — Tier mapping
**File:** `packages/shared/src/constants.ts`

Add the tier grouping as a shared constant with exhaustiveness check:

```typescript
export const READING_TYPE_TIERS: Record<string, { tier: string; label: string }> = {
  LIFETIME: { tier: 'comprehensive', label: 'Comprehensive' },
  CAREER: { tier: 'comprehensive', label: 'Comprehensive' },
  LOVE: { tier: 'comprehensive', label: 'Comprehensive' },
  HEALTH: { tier: 'comprehensive', label: 'Comprehensive' },
  COMPATIBILITY: { tier: 'comprehensive', label: 'Comprehensive' },
  ZWDS_LIFETIME: { tier: 'comprehensive', label: 'Comprehensive' },
  ZWDS_CAREER: { tier: 'comprehensive', label: 'Comprehensive' },
  ZWDS_LOVE: { tier: 'comprehensive', label: 'Comprehensive' },
  ZWDS_HEALTH: { tier: 'comprehensive', label: 'Comprehensive' },
  ZWDS_COMPATIBILITY: { tier: 'comprehensive', label: 'Comprehensive' },
  ZWDS_MAJOR_PERIOD: { tier: 'comprehensive', label: 'Comprehensive' },
  ANNUAL: { tier: 'periodic', label: 'Periodic' },
  ZWDS_ANNUAL: { tier: 'periodic', label: 'Periodic' },
  ZWDS_MONTHLY: { tier: 'periodic', label: 'Periodic' },
  ZWDS_DAILY: { tier: 'daily', label: 'Daily' },
  ZWDS_QA: { tier: 'qa', label: 'Q&A' },
};

export const TIER_ORDER = ['comprehensive', 'periodic', 'daily', 'qa', 'unclassified'] as const;
```

All 16 `ReadingType` enum values covered. If a new type is added to Prisma but not mapped here, the backend will assign it to the `unclassified` tier (explicit fallback, not silent omission).

### Step 2: Database — Add `readingType` to `AIUsageLog`
**File:** `apps/api/prisma/schema.prisma`

```prisma
model AIUsageLog {
  // ... existing fields ...
  readingType      ReadingType? @map("reading_type")  // nullable for legacy rows

  @@index([createdAt, readingType])  // date-first for range scan then grouping
  // keep existing indexes unchanged
}
```

- Column is **nullable** — existing rows get `NULL`, no data loss
- Composite index is `[createdAt, readingType]` (date-first for the `WHERE created_at >= ? GROUP BY reading_type` query pattern)
- Single-column `@@index([readingType])` omitted — the composite index covers reading-type-only queries via index skip scan, and standalone filtering by type without date is not a planned query
- Run: `npx prisma migrate dev --name add-reading-type-to-ai-usage-log`

**Backfill (post-migration):** Run once to populate historical rows where possible:
```sql
UPDATE ai_usage_log SET reading_type = br.reading_type
FROM bazi_readings br
WHERE ai_usage_log.reading_id = br.id
  AND ai_usage_log.reading_type IS NULL;
```
This is a one-time operation, not part of the migration file. Rows without a `reading_id` (compatibility, failed calls) will remain NULL.

### Step 3: AI Service — Pass `readingType` through logging
**File:** `apps/api/src/ai/ai.service.ts`

Update `logUsage()` signature:
```typescript
private async logUsage(
  userId: string | undefined,
  readingId: string | undefined,
  readingType: ReadingType | undefined,  // NEW
  config: ProviderConfig,
  result: AIGenerationResult,
) {
  // ... existing code ...
  await this.prisma.aIUsageLog.create({
    data: {
      // ... existing fields ...
      readingType: readingType ?? null,  // explicit null for type safety
    },
  });
}
```

Update `generateInterpretation()` call site (~line 226):
```typescript
this.logUsage(userId, readingId, readingType, providerConfig, generationResult)
  .catch((err) => this.logger.error(`Failed to log AI usage: ${err}`));
```

`readingType` is already a parameter of `generateInterpretation()` (line 173), so it's simply forwarded.

**Known gap (pre-existing):** `generateInterpretationStream()` (if it exists) does not call `logUsage()` at all. This is out of scope for this change but documented as a follow-up.

### Step 4: Admin Service — Enhance `getAICosts()` with per-type breakdown
**File:** `apps/api/src/admin/admin.service.ts`

Enhance the existing `getAICosts()` method (not a new method). Accept `days` param:

```typescript
async getAICosts(days = 30) {
  days = Math.min(Math.max(days, 1), 365); // clamp server-side
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // ... existing queries with `since` replacing `thirtyDaysAgo` ...
```

Add one new parallel raw SQL query for the reading type breakdown:
```sql
SELECT
  reading_type,
  SUM(cost_usd)::float as total_cost,
  COUNT(*) as count,
  AVG(cost_usd)::float as avg_cost,
  AVG(input_tokens)::float as avg_input_tokens,
  AVG(output_tokens)::float as avg_output_tokens,
  SUM(input_tokens) as total_input_tokens,
  SUM(output_tokens) as total_output_tokens,
  AVG(latency_ms)::float as avg_latency_ms,
  COUNT(*) FILTER (WHERE is_cache_hit) as cache_hits
FROM ai_usage_log
WHERE created_at >= $1
GROUP BY reading_type
ORDER BY total_cost DESC
```

**NULL handling:** Rows with `reading_type IS NULL` will appear as a group. Map in application code:
```typescript
costByReadingType: rawResults.map(r => ({
  readingType: r.reading_type ?? 'UNCLASSIFIED',
  // ... other fields ...
  cacheHitRate: r.count > 0 ? r.cache_hits / r.count : 0,
}))
```

**Tier aggregation** — computed in application code from `costByReadingType` results (not SQL):
```typescript
import { READING_TYPE_TIERS, TIER_ORDER } from '@repo/shared';

const tierMap = new Map<string, { totalCost: number; count: number; types: string[] }>();
for (const entry of costByReadingType) {
  const tier = READING_TYPE_TIERS[entry.readingType]?.tier ?? 'unclassified';
  // accumulate into tierMap
}
```

**Response shape changes:**
- Rename `totalCost30d` → `totalCost` (no longer hardcoded to 30 days)
- Add `days` field to response so frontend knows the actual window
- Add `costByReadingType` array
- Add `costByTier` array
- Existing `costByProvider` enhanced with `avgCost`, `totalInputTokens`, `totalOutputTokens`

### Step 5: Admin Controller — Add `days` query param with validation
**File:** `apps/api/src/admin/admin.controller.ts`

```typescript
@Get('ai-costs')
@ApiOperation({ summary: 'Get AI usage costs and analytics' })
@ApiQuery({ name: 'days', required: false, example: 30, description: 'Lookback window (1-365)' })
async getAICosts(
  @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
) {
  return this.adminService.getAICosts(days);
}
```

Validation uses existing NestJS pipes (`DefaultValuePipe`, `ParseIntPipe`) matching the pattern at lines 157-159. Server-side clamping in the service (Step 4) prevents values outside 1-365.

### Step 6: Frontend API Client — Update types and function
**File:** `apps/web/app/lib/admin-api.ts`

```typescript
export interface CostByReadingType {
  readingType: string;
  totalCost: number;
  count: number;
  avgCost: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgLatencyMs: number;
  cacheHitRate: number;
}

export interface CostByTier {
  tier: string;
  label: string;
  readingTypes: string[];
  totalCost: number;
  count: number;
  avgCost: number;
}

export interface AICosts {
  totalCost: number;           // renamed from totalCost30d
  days: number;                // actual lookback window
  avgCostPerReading: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  cacheHitRate: number;
  costByProvider: { provider: string; totalCost: number; count: number; avgCost: number; totalInputTokens: number; totalOutputTokens: number }[];
  costByReadingType: CostByReadingType[];
  costByTier: CostByTier[];
  dailyCosts: { date: string; totalCost: number; count: number }[];
}

export async function getAICosts(token: string, params?: { days?: number }): Promise<AICosts> {
  const query = new URLSearchParams();
  if (params?.days) query.set('days', String(params.days));
  const qs = query.toString();
  return apiFetch<AICosts>(`/api/admin/ai-costs${qs ? `?${qs}` : ''}`, { token });
}
```

### Step 7: Frontend Admin Page — Enhanced AI Costs dashboard
**File:** `apps/web/app/admin/ai-costs/page.tsx`

Changes to existing page:

1. **Date range selector** (top of page, next to title):
   - Dropdown with options: 7 days, 30 days, 90 days, 365 days
   - Default: 30 days
   - On change: re-fetch with new `days` param

2. **Update summary cards** — use `totalCost` instead of `totalCost30d`

3. **Cost by Tier section** (new, after summary cards):
   - 4-5 cards in a row: Comprehensive, Periodic, Daily, Q&A, (Unclassified if present)
   - Each card shows: tier label, total cost, request count, avg cost per call
   - Distinct background color per tier

4. **Cost by Reading Type table** (new, after tier cards):
   - Columns: Reading Type, Tier, Requests, Total Cost, Avg Cost, Avg Input Tokens, Avg Output Tokens, Avg Latency, Cache Hit %
   - Sorted by totalCost descending
   - `UNCLASSIFIED` rows shown with dimmed styling and "(Legacy)" label
   - Reading type names displayed as human-readable labels

5. **Daily bar chart** — extract `Math.max()` computation out of the `.map()` loop (O(n) instead of O(n^2))

**File:** `apps/web/app/admin/ai-costs/page.module.css`
- Styles for: `.tierCards`, `.tierCard`, `.tierCard[data-tier]` variants, `.dateSelector`, `.readingTypeTable`, `.legacyRow`

### Step 8: Tests
**Files:**

1. **`apps/api/test/ai-service.spec.ts`** — Update the mock for `aIUsageLog.create` to verify `readingType` is included. Add a test case that verifies `generateInterpretation()` passes `readingType` through to `logUsage()`.

2. **`apps/api/test/admin-service.spec.ts`** — Add happy-path tests for `getAICosts()`:
   - Verify `costByReadingType` is correctly grouped from raw SQL results
   - Verify `costByTier` aggregation maps correctly (using shared constants)
   - Verify NULL `readingType` rows appear as `UNCLASSIFIED`
   - Verify `days` parameter correctly adjusts the date filter
   - Verify clamping: `days=0` → 1, `days=999` → 365

3. **`apps/api/test/admin-controller.spec.ts`** — Update `getAICosts` test to verify `days` query param is forwarded to service.

## Files Changed (9 files + 1 migration)

| File | Change |
|---|---|
| `packages/shared/src/constants.ts` | Add `READING_TYPE_TIERS` and `TIER_ORDER` constants |
| `apps/api/prisma/schema.prisma` | Add `readingType` column + `[createdAt, readingType]` index to `AIUsageLog` |
| `apps/api/src/ai/ai.service.ts` | Pass `readingType` to `logUsage()`, store in create call |
| `apps/api/src/admin/admin.service.ts` | Enhance `getAICosts(days)` with per-type + per-tier breakdown, rename `totalCost30d` → `totalCost` |
| `apps/api/src/admin/admin.controller.ts` | Add `days` query param with `DefaultValuePipe(30)` + `ParseIntPipe` |
| `apps/web/app/lib/admin-api.ts` | Update `AICosts` interface, add `CostByReadingType` + `CostByTier` types, add `days` param |
| `apps/web/app/admin/ai-costs/page.tsx` | Add date selector, tier cards, reading type table, fix O(n^2) bar chart |
| `apps/web/app/admin/ai-costs/page.module.css` | New styles for tier cards, reading type table, date selector |
| `apps/api/test/ai-service.spec.ts` | Verify `readingType` in logUsage mock |
| `apps/api/test/admin-service.spec.ts` | Happy-path tests for costByReadingType, costByTier, NULL handling, days clamping |
| `apps/api/test/admin-controller.spec.ts` | Verify `days` param forwarding |

## Non-Goals
- No changes to the Bazi engine or reading creation flow
- No changes to other admin pages
- No chart library — uses the same CSS bar chart pattern already in use
- No logging changes to `generateInterpretationStream()` (pre-existing gap, documented for follow-up)

## Migration Notes
- The migration adds a nullable column — PostgreSQL handles this without table rewrite (instant `ALTER TABLE ADD COLUMN`)
- Index creation on existing data should be fast for small tables; for production with large tables, consider `CREATE INDEX CONCURRENTLY` by editing the migration SQL before applying
- Backfill SQL provided in Step 2 should be run manually post-migration
