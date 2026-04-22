# AI Retry + Credit Refund — Implementation Plan

**Revision history**:
- v1: Initial plan (3-attempt retry + provider fallback + naïve refund).
- v4 (current): R3 cleanups — fixed constant name typo (`AI_AI_MAX_RETRIES_PER_PROVIDER_PER_PROVIDER` → canonical `AI_MAX_RETRIES_PER_PROVIDER`), removed stale "back-compat" text from sequencing step 7, added `git stash pop` cleanup step 8 to migration runbook, added inline note about `ReadingType` import path (`@prisma/client` not `@repo/shared`), suggested `getDegradeConfig()` helper for per-type lookup when replicating, dropped unused `EXPECTED_SECTIONS_BY_TYPE` map, marked CreditLedger backfill as deferrable.
- v3: Addressed 7 R2 issues — Prisma `JsonNull` bug fix, `done`/`final` event contradiction resolved (final-only, coordinated frontend release), `emittedKeys` scope clarified (OUTSIDE provider loop = cross-provider dedup), migration copy-back + drift recovery, per-reading-type `DEGRADE_THRESHOLDS` config, magic numbers extracted to named constants, failed-reading DB state explicitly nulled with `Prisma.JsonNull`.
- v2: Addressed 18 issues from staff-engineer round 1. Major changes:
  1. **Laopo19 root cause confirmed**: failure was **pre-first-chunk** (4s after stream setup, error frame arrived as the first SSE message). Logs verified at `2026-04-22 16:56:42 → 16:56:46`. So the "no retry after yield" approach IS sufficient for this incident — but the plan now also handles mid-stream cases via caller-side buffer reset (Issue 17).
  2. **CreditLedger table added** to scope (Issue 18). No existing per-credit-movement ledger exists in `prisma/schema.prisma` — only `Transaction` (Stripe money), `MonthlyCreditsLog`, `AdRewardLog`. Cannot ship refunds without an audit trail.
  3. **Bound decisions** for the 5 open questions previously deferred to user — see §0 below.
  4. **CreditService API** fully specified (Issue 14).
  5. **Refund-then-emit transaction ordering** locked in (Issue 15).
  6. **Streaming retry** moved from helper-internal to caller-side (Issue 8, 17) so the buffer reset is explicit.
  7. **Provider-fallback policy** chosen: **degrade gracefully** — ship what we have AT END of total-time cap, mark reading degraded, let user regenerate FREE (Issue 10).
  8. **Anthropic SDK internal retry disabled** when wrapping with our retry to avoid 9-attempt explosion (Issue 12).
  9. **Unified `final` SSE event** replaces `done` + `partial`/`failed` separation (Issue 11).
  10. **`emittedKeys` Set** tracks delivered sections to avoid duplicate emissions (Issue 13).
  11. **Frontend grep targets** enumerated (Issue 7).
  12. **Magic numbers replaced** with config constants + rationale (Issue 1, 2, 3).

---

## §0 — Bound decisions (from R1 open questions)

These were "open questions" in v1; locked here so implementing agent doesn't re-ask:

| # | Question | Decision |
|---|---|---|
| 1 | Partial-result policy | **Degrade-gracefully**: ship what we have if at least 50% of expected sections delivered AND Call 2 succeeded; otherwise full refund. The "degraded" reading is marked `isDegraded=true`, user sees a banner + "Regenerate (free)" button. |
| 2 | Regenerate behavior | Free regenerate ONLY for `isDegraded=true` readings. Re-uses original credit slot (does not double-charge). Limit: 3 regenerations per reading lifetime. |
| 3 | Cap on regenerations | 3 per reading. After that, reading is marked `regenerationExhausted=true`, "Regenerate" button disabled; user can manually delete + create fresh (which costs credits). |
| 4 | User-visible retry indicator | Yes — emit `retry_attempt` SSE events with `{provider, attempt, max, reason}` so frontend can show "Anthropic busy, retrying (2/3)..." Friendly UX. |
| 5 | MAX_TOTAL_AI_TIME_MS default | **300000 (5 min)** — covers worst case (3 providers × 3 retries × 30s each = 270s + backoff overhead). |

---

## Problem statement

When Anthropic API returned `overloaded_error` for Laopo19 Career V2 reading:
- Call 1 (header sections) failed silently → user got 17/25 sections
- Credit was already deducted BEFORE the AI ran (streaming flow)
- No retry attempted on the same provider
- Provider fallback chain (Claude → GPT → Gemini) is **broken** for the streaming path: even when Call 1 fails completely, if Call 2 has any sections the loop sets `v2Succeeded = true` and breaks, never trying GPT/Gemini

**Confirmed via logs** (`/tmp/nest-api.log` lines 1-5 of `cbfd78f4-9547-4723-a0b3-5bf7f22f2f0d` block):
```
16:56:42  [Stream] Setup starting for reading=cbfd78f4-...
16:56:42  [Stream] Reading found, hasAI=false, hasCalc=true
16:56:46  WARN Career V2 Call 1 stream error: {"type":"error","error":{"type":"overloaded_error",...}}
16:58:45  Stream Career V2 completed via CLAUDE in 122356ms, 17 sections delivered
```

Failure happened 4s after setup → the error frame arrived as the first message in the stream (before any text deltas). This is **pre-first-content-chunk** — `yieldedAny` is `false` at this point, so a retry IS safe without buffer reset.

User's requirement (locked in this round):
1. **Retry the same Anthropic API 3 times** before falling back to another provider
2. **If Anthropic fails 3x → fall through to GPT-4o → then Gemini**
3. **If ALL providers fail OR partial-result threshold not met → show user "reading failed" + REFUND credit**

---

## Current state analysis

### Credit deduction timing (3 bugs today)

| Flow | Where credit is deducted | What happens if AI fails after |
|---|---|---|
| **Non-streaming Bazi reading** | `bazi.service.ts:240-243` (inside `createReading` transaction) | AI runs BEFORE the transaction. If AI throws, exception bubbles. If AI catches the error itself (line 220-225), the reading is created with `aiInterpretation: null` AND **credits are still deducted**. ⚠️ Bug today. |
| **Streaming Bazi reading** (Career/Lifetime/Annual V2) | `bazi.service.ts:240-243` (inside `createReading` transaction, BEFORE SSE starts) | AI runs LATER inside `streamCareerV2()`. If AI partially or fully fails, the reading is updated with whatever it has. **Credits already gone.** ⚠️ Bug today. |
| **Compatibility (non-streaming)** | `bazi.service.ts:738-750` (after AI, conditional on cache miss) | If AI fails (caught at line 728-730), the reading is still saved with `aiInterpretation: undefined` and credit is still deducted. ⚠️ Bug today. |

### Retry / fallback today

**Non-streaming `generateInterpretation()`** (line 217-274):
- Outer loop tries each provider in order
- On any error, falls to next provider
- ❌ NO retry on transient errors

**Streaming `_executeStreamCareerV2()`** (line 1034-1216):
- Outer loop iterates providers
- Inside: Call 1 streams + Call 2 non-streams in parallel
- Call 1 stream errors caught at line 1105-1109 → ONLY logged, no retry, no provider fallback for Call 1 alone
- ⚠️ Line 1211: `if (totalSections > 0) { v2Succeeded = true; break; }` — guarantees we never try GPT/Gemini if Anthropic Call 2 succeeded (the Laopo19 bug)

### Anthropic SDK built-in retry

The Anthropic SDK has a built-in `maxRetries` option (default = 2) for non-streaming requests, BUT:
- It only retries on 5xx and 429 errors
- It does NOT retry the streaming `messages.stream()` method
- `overloaded_error` is HTTP 529 — should trigger retry, but only on non-stream calls

**Layering decision (Issue 12)**: When wrapping non-streaming calls with `callProviderWithRetry`, **disable the SDK's internal retry** by setting `maxRetries: 0` on the Anthropic client constructor (or per-call override). Otherwise we get 3 outer × 3 SDK = 9 attempts per provider per call. With backoff that's several minutes per provider.

### Existing credit ledger? NO.

Verified `apps/api/prisma/schema.prisma`: only models exist for `Transaction` (Stripe money flow), `MonthlyCreditsLog` (subscription grants), and `AdRewardLog` (ad-watch grants). **There is NO per-credit-movement ledger** for reading deductions, refunds, etc. Today, when a reading is created and `user.credits` is decremented, the ONLY trace is the `BaziReading.creditsUsed` field.

If we add refunds without a ledger, finance can't reconcile (user balance mysteriously goes up). **A `CreditLedger` table is in scope for this PR** (see §Implementation §3).

---

## Design

### §Part 1 — Retry semantics

**Per-provider retry policy**:
- `overloaded_error` (529): retry up to **3 times** with exponential backoff (2s, 4s, 8s + jitter)
- `rate_limit_error` (429): retry up to **3 times** with backoff (also honoring `retry-after` header if present)
- 5xx server errors: retry up to **3 times** with backoff
- 4xx client errors (400, 401, 403, 404): **DO NOT retry** — bubble immediately
- `AbortError` (timeout): **DO NOT retry** within same provider — fall through to next

**Provider fallback chain**:
- After 3 retries on Anthropic exhaust → fall to GPT-4o
- After 3 retries on GPT-4o exhaust → fall to Gemini
- After 3 retries on Gemini exhaust → all-fail path triggers (full refund)

**Cap on total time**: keep the existing per-call timeout (60s default). With retries + fallback, total worst case is bounded by `MAX_TOTAL_AI_TIME_MS` (default 300000 = 5 min, see §0). Each retry checks `Date.now() - totalStartMs > MAX_TOTAL_AI_TIME_MS` before sleeping. If exceeded, abort everything and trigger degrade-gracefully or refund based on partial-result policy.

**Backoff formula** (Issue 1 — replace symmetric jitter with full positive jitter, AWS pattern):
```typescript
private computeBackoff(attempt: number, err: Error): number {
  // Honor retry-after if surfaced (Anthropic, OpenAI use Retry-After header → SDK puts it in error.headers or message)
  const retryAfterMatch = err.message.match(/retry[- ]after[:\s]+(\d+)/i);
  if (retryAfterMatch) {
    return Math.min(parseInt(retryAfterMatch[1], 10) * 1000, AI_RETRY_AFTER_CAP_MS);  // cap at 30s
  }
  // Full positive jitter: random(0, 2^attempt * 1000)
  // For attempt=1 → 0-2000ms; attempt=2 → 0-4000ms; attempt=3 → 0-8000ms
  // Avoids retry-storm convergence
  return Math.floor(Math.random() * Math.pow(2, attempt) * 1000);
}
```

**Error classification** (Issue 3 — use SDK's error.status numeric, not regex on message):
```typescript
private isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // Prefer SDK's typed status (Anthropic SDK errors have `.status` numeric field)
  const statusFromError = (err as any).status as number | undefined;
  if (typeof statusFromError === 'number') {
    if ([429, 529].includes(statusFromError)) return true;
    if (statusFromError >= 500 && statusFromError < 600) return true;
    if (statusFromError >= 400 && statusFromError < 500) return false;  // explicit non-retry on 4xx
  }

  // Fallback: pattern match on error message for SDKs that don't expose .status
  const msg = err.message.toLowerCase();
  if (msg.includes('overloaded_error') || msg.includes('rate_limit_error')) return true;
  // Anthropic-style streaming error JSON
  if (msg.includes('"type":"overloaded_error"') || msg.includes('"type":"rate_limit_error"')) return true;
  // Network blips
  if (msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('socket hang up')) return true;
  if (msg.includes('apiconnectionerror') || msg.includes('connection error')) return true;
  // AbortError is intentionally NOT retried
  return false;
}
```

### §Part 2 — Streaming retry — caller-side state reset (Issues 8, 17)

The reviewer correctly flagged that a "transparent retry" inside `streamProviderWithRetry()` produces buffer corruption when the caller has already extracted partial state. The fix: **move the retry loop OUT of the helper and INTO the caller**. The helper becomes a single-attempt `streamProvider()`; the retry logic and state-reset live in `_executeStreamCareerV2`.

**Caller-side retry pattern**:

**Scope rule for accumulators (R2 fix #3)**:
- `call1Sections`, `call2FixedSections`, `emittedKeys` are declared **OUTSIDE the provider loop** (top of `_executeStreamCareerV2`). They accumulate across BOTH retries AND provider fallbacks. This means:
  - Retry within Anthropic: state preserved (Issue 13 — no duplicate emission to client)
  - Fallback Anthropic → GPT: state preserved (GPT will skip already-emitted keys via `emittedKeys.has(key)` check; emits only new sections). Frontend never receives duplicates.
- `call1Buffer`, `call1ExtractedKeys`, `yieldedAny` are declared **INSIDE the per-attempt loop** (per stream attempt). Reset each attempt because each new stream produces a fresh JSON character buffer that can't be safely concatenated with the previous failed attempt.

```typescript
// Inside _executeStreamCareerV2, OUTSIDE the providers loop — accumulates across all attempts + fallbacks:
const call1Sections: Record<string, InterpretationSection> = {};
const call2FixedSections: Record<string, InterpretationSection> = {};
const emittedKeys = new Set<string>();  // R2 fix #3: scope OUTSIDE provider loop
let call1Summary: InterpretationSection = { preview: '', full: '' };

// ... then INSIDE the providers loop, INSIDE the per-attempt retry loop:
let call1Buffer = '';
const call1ExtractedKeys = new Set<string>();

let call1Err: Error | undefined;

for (let attempt = 1; attempt <= AI_MAX_RETRIES_PER_PROVIDER; attempt++) {
  // Per-attempt timing check against total budget
  if (Date.now() - totalStartMs > maxTotalMs) {
    this.logger.warn(`Total AI time budget exceeded; abandoning Call 1 retries`);
    break;
  }

  // Reset per-attempt state — CRITICAL for retry safety
  call1Buffer = '';
  call1ExtractedKeys.clear();
  // NOTE: do NOT clear `call1Sections` or `emittedKeys` — they accumulate across attempts
  //       so partial success from a prior attempt is preserved AND we don't re-emit to client

  let yieldedAny = false;
  try {
    const streamGen = this.streamProvider(
      providerConfig, systemPrompt, userPromptCall1, call1Controller.signal,
    );

    for await (const chunk of streamGen) {
      yieldedAny = true;
      call1Buffer += chunk;

      const newSections = this.extractCompletedSections(
        call1Buffer, call1Keys, call1ExtractedKeys,
      );

      for (const [key, rawSection] of Object.entries(newSections)) {
        // Skip sections already emitted (prior attempt or different provider)
        if (emittedKeys.has(key)) continue;

        const { section: autoFixed } = this.autoFixSection(key, rawSection, calculationData);
        const { section } = this.autoFixCareerSection(key, autoFixed, calculationData);
        call1Sections[key] = section;
        emittedKeys.add(key);
        totalSections++;
        subscriber.next({
          data: JSON.stringify({ key, preview: section.preview, full: section.full, ...(section.score != null && { score: section.score }) }),
          type: 'section_complete',
        } as MessageEvent);
      }
    }

    // Parse remaining from final buffer (same loop body as above for unflushed sections)
    const finalParsed = this.parseLifetimeV2CallResponse(call1Buffer, 'call1');
    for (const [key, rawSection] of Object.entries(finalParsed.sections)) {
      if (emittedKeys.has(key)) continue;
      const { section: autoFixed } = this.autoFixSection(key, rawSection, calculationData);
      const { section } = this.autoFixCareerSection(key, autoFixed, calculationData);
      call1Sections[key] = section;
      emittedKeys.add(key);
      totalSections++;
      subscriber.next({
        data: JSON.stringify({ key, preview: section.preview, full: section.full, ...(section.score != null && { score: section.score }) }),
        type: 'section_complete',
      } as MessageEvent);
    }
    if (finalParsed.summary && (finalParsed.summary.preview || finalParsed.summary.full)) {
      call1Summary = finalParsed.summary;
    }

    call1Err = undefined;
    break;  // Stream completed without throwing; exit retry loop

  } catch (err) {
    call1Err = err instanceof Error ? err : new Error(String(err));
    if (!this.isRetryableError(call1Err)) break;  // 4xx, abort, etc.
    if (yieldedAny) {
      // Mid-stream failure — partial sections already emitted, can't safely replay full prompt.
      // Accept what we have. This handles the rare case the reviewer flagged.
      this.logger.warn(`Call 1 mid-stream failure (yieldedAny=true), keeping ${Object.keys(call1Sections).length} sections, no retry`);
      break;
    }
    if (attempt === AI_MAX_RETRIES_PER_PROVIDER) break;
    if (call1Controller.signal.aborted) break;

    // Emit retry_attempt event (Issue 4 / §0 decision 4)
    subscriber.next({
      data: JSON.stringify({
        provider: providerConfig.provider,
        attempt: attempt + 1,
        max: AI_MAX_RETRIES_PER_PROVIDER,
        reason: this.summarizeError(call1Err),
      }),
      type: 'retry_attempt',
    } as MessageEvent);

    const backoffMs = this.computeBackoff(attempt, call1Err);
    this.logger.warn(`Call 1 attempt ${attempt}/${AI_MAX_RETRIES_PER_PROVIDER} failed (${call1Err.message}); retrying in ${backoffMs}ms`);
    await new Promise((r) => setTimeout(r, backoffMs));
  }
}

if (call1Err) {
  this.logger.warn(`Call 1 exhausted retries on ${providerConfig.provider}: ${call1Err.message}`);
}
clearTimeout(call1Timeout);
```

**Helper: `summarizeError()`** — produces a short, user-safe message for `retry_attempt` events:
```typescript
private summarizeError(err: Error): string {
  const msg = err.message.toLowerCase();
  if (msg.includes('overloaded')) return 'AI service is busy';
  if (msg.includes('rate_limit') || msg.includes('429')) return 'AI rate limit reached';
  if (msg.includes('timeout') || msg.includes('etimedout')) return 'AI service slow to respond';
  return 'transient AI error';
}
```

**Non-streaming retry helper** (no buffer concerns — symmetric retry inside helper is fine):
```typescript
private async callProviderWithRetry(
  config: ProviderConfig,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
  totalStartMs: number,
  maxTotalMs: number,
  maxRetries: number = 3,
  onRetry?: (attempt: number, max: number, reason: string) => void,
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (Date.now() - totalStartMs > maxTotalMs) {
      throw lastErr ?? new Error('AI total time budget exceeded');
    }
    try {
      return await this.callProviderWithTimeout(config, systemPrompt, userPrompt, timeoutMs);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (!this.isRetryableError(lastErr) || attempt === maxRetries) throw lastErr;
      const backoff = this.computeBackoff(attempt, lastErr);
      onRetry?.(attempt + 1, maxRetries, this.summarizeError(lastErr));
      this.logger.warn(`Provider ${config.provider} attempt ${attempt}/${maxRetries} failed (${lastErr.message}); retrying in ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr!;
}
```

### §Part 3 — Provider fallback policy (Issue 9, 10)

**Decision: degrade-gracefully — keep what we have.** Reviewer Issue 10 forced a clear choice:
- DEGRADE-GRACEFULLY (chosen): if Call 2 succeeded with Anthropic but Call 1 failed → ship Call 2's 17 sections, mark `isDegraded=true`, offer free regenerate.
- WAIT-FOR-COMPLETENESS (rejected): would force Call 1 retry on GPT/Gemini → adds 30-60s+ user wait → frequent total-time-cap timeouts.

**Cross-provider Call 1 accumulation is OUT OF SCOPE for this PR (Issue 9).** Implementing "ask GPT for only the missing sections that Anthropic Call 1 failed to deliver" requires:
- A new prompt that targets only specific sections
- Mid-stream re-merging of GPT output with Anthropic output
- Frontend handling of mixed-provider sections

**Defer to v2 follow-up.** For this PR: provider fallback only triggers when ALL of (Call 1, Call 2) fail on the current provider. Mixed success (Call 1 fails, Call 2 succeeds) is treated as `isDegraded=true` immediately — do NOT fall to next provider. Justification: most real-world failures are transient overloads on the SAME provider; trying another provider with the same prompt is unlikely to fill the gap and adds latency.

**Replacement for line 1206-1216 broken early-break**:
```typescript
} catch (err) {
  // Provider iteration error (something threw OUTSIDE Call 1/Call 2 try blocks)
  this.logger.warn(`Career Stream V2 provider ${providerConfig.provider} threw unexpectedly: ${err}. Trying next...`);
  clearTimeout(call1Timeout);
  // Fall through to next provider iteration only if BOTH calls produced 0 sections
  // (otherwise we have something usable; ship it)
  const call1Got = Object.keys(call1Sections).length;
  const call2Got = Object.keys(call2FixedSections).length;
  if (call1Got + call2Got > 0) {
    v2Succeeded = true;  // we have at least some sections; will be handled in finally with degrade logic
    break;
  }
  // else continue to next providerConfig
}
```

The `v2Succeeded = true` here only signals "exit the providers loop"; the actual success/degrade/refund decision lives in the `finally` block (§Part 4).

### §Part 4 — Final decision + refund (Issues 2, 11, 15)

Replace the existing terminal `done` event with a single `final` event that encodes status + refund info. Issue 11: the existing `done` event fires BEFORE the `finally` block, causing race with `failed`/`partial`. Move ALL terminal logic into the `finally` block.

**Threshold for "degrade vs refund" — per-reading-type policy (Issues 2 + R2 fix #5)**:

Different reading types have different "critical content" structures. Career V2's Call 2 = forecasts (the user-visible main content). Other types may differ. Define per-type config:

```typescript
// In ai.service.ts near other constants:
interface DegradeThresholdConfig {
  call2CompletionMin: number;  // Call 2 ratio required for 'degraded' (else 'failed')
  totalCompletionMin: number;  // Total ratio required for 'degraded' (else 'failed')
  call2Critical: boolean;      // If true, Call 2 = 0 → 'failed' regardless of Call 1
}

// IMPORTANT (R3 N4): import `ReadingType` from `@prisma/client`, NOT `@repo/shared`.
// CLAUDE.md known issue: NestJS files must NOT import `@repo/shared` at runtime.
// import { ReadingType } from '@prisma/client';
const DEGRADE_THRESHOLDS: Record<ReadingType, DegradeThresholdConfig> = {
  CAREER:  { call2CompletionMin: 0.8, totalCompletionMin: 0.5, call2Critical: true },  // Call 2 = annual+monthly forecasts
  LIFETIME: { call2CompletionMin: 0.7, totalCompletionMin: 0.6, call2Critical: true }, // Call 2 = timing+fortune
  ANNUAL:   { call2CompletionMin: 0.7, totalCompletionMin: 0.6, call2Critical: true }, // Call 2 = monthly aspects
  COMPATIBILITY: { call2CompletionMin: 0.5, totalCompletionMin: 0.5, call2Critical: false }, // Romance V2 — both calls roughly equal weight
  // Add others as we discover their Call 1/Call 2 split
};
```

The implementing agent should verify these per-type splits against actual `*_V2_PROMPTS.call1Sections.length` vs `call2Sections.length` ratios + UX importance. Defaults above are conservative starting points — tune after first prod incidents.

```typescript
// In _executeStreamCareerV2, replace the existing finally-block + done event:
} finally {
  clearInterval(heartbeatInterval);
  clearTimeout(call1Timeout!);

  const expectedCall1 = CAREER_V2_PROMPTS.call1Sections.length;
  const expectedCall2 = CAREER_V2_PROMPTS.call2Sections.length;
  const expectedTotal = expectedCall1 + expectedCall2;
  const call1Got = Object.keys(call1Sections).length;
  const call2Got = Object.keys(call2FixedSections).length;
  const totalGot = call1Got + call2Got;
  const latencyMs = Date.now() - totalStartMs;

  // Per-reading-type degrade thresholds (R2 fix #5)
  // R3 N5: when replicating to Lifetime/Annual/Romance _executeStream* methods, swap CAREER for the matching ReadingType.
  // Optional: extract `private getDegradeConfig(rt: ReadingType): DegradeThresholdConfig { return DEGRADE_THRESHOLDS[rt]; }`
  // helper to centralize lookup if implementor prefers.
  const cfg = DEGRADE_THRESHOLDS[ReadingType.CAREER];
  let status: 'success' | 'degraded' | 'failed';
  let refunded = false;

  if (totalGot === 0) {
    status = 'failed';
  } else if (cfg.call2Critical && call2Got === 0) {
    // Call 2 (critical content) entirely missing — unusable
    status = 'failed';
  } else if (totalGot >= expectedTotal) {
    status = 'success';
  } else if (
    call2Got >= Math.floor(expectedCall2 * cfg.call2CompletionMin) &&
    totalGot >= Math.floor(expectedTotal * cfg.totalCompletionMin)
  ) {
    status = 'degraded';
  } else {
    // Got something but not enough
    status = 'failed';
  }

  // Refund FIRST, then emit final event (Issue 15: never tell user "refunded" before commit)
  if (status === 'failed') {
    try {
      const refundResult = await this.creditService.refundReadingCredit(
        readingId,
        `ai-failed-call1=${call1Got}/${expectedCall1}-call2=${call2Got}/${expectedCall2}`,
      );
      refunded = refundResult.refunded;  // false if already refunded (idempotent)
    } catch (refundErr) {
      this.logger.error(`Refund failed for reading ${readingId}: ${refundErr}`);
      // Don't lie to user — emit final event without `refunded: true`. Operator must reconcile manually.
      refunded = false;
    }
  }

  // Mark degraded readings in DB so frontend "Regenerate (free)" button knows
  if (status === 'degraded') {
    await this.prisma.baziReading.update({
      where: { id: readingId },
      data: { isDegraded: true, failedReason: `partial: ${totalGot}/${expectedTotal} sections` },
    }).catch((err) => this.logger.error(`Failed to mark reading degraded: ${err}`));
  }

  // Update reading with sections — gated by status:
  //   - 'success': write full aiInterpretation
  //   - 'degraded': write partial aiInterpretation + isDegraded flag (set above)
  //   - 'failed': explicitly NULL the aiInterpretation (use Prisma.JsonNull)
  //              Even if totalGot > 0 (some sections delivered but below threshold),
  //              we treat the reading as unusable since the user's credit was refunded.
  //              Don't surface partial content under a refunded reading — UX would be confused.
  if (status === 'success' || status === 'degraded') {
    const aiInterpretation = {
      schemaVersion: 'v2',
      sections: { ...call1Sections, ...call2FixedSections },
      summary: call1Summary,
      deterministic,
    };
    await this.prisma.baziReading.update({
      where: { id: readingId },
      data: {
        aiInterpretation: aiInterpretation as unknown as Prisma.InputJsonValue,
        aiProvider: activeProviderConfig.provider as any,
        aiModel: activeProviderConfig.model,
      },
    }).catch((err) => this.logger.error(`Failed to update reading ${readingId}: ${err}`));
  } else {
    // status === 'failed': explicitly null out aiInterpretation in case prior partial write
    await this.prisma.baziReading.update({
      where: { id: readingId },
      data: { aiInterpretation: Prisma.JsonNull },
    }).catch((err) => this.logger.error(`Failed to null out failed reading ${readingId}: ${err}`));
  }

  // Cache hygiene (Part 5): only cache if status === 'success'
  if (status === 'success') {
    this.cacheInterpretation(/* ... */).catch(...);
  } else {
    this.logger.warn(`Career reading ${readingId} status=${status}, skipping cache`);
  }

  // Emit unified final event (Issue 11: replaces separate done/partial/failed)
  subscriber.next({
    data: JSON.stringify({
      status,
      totalSections: totalGot,
      expectedSections: expectedTotal,
      latencyMs,
      ...(status === 'failed' && { refunded }),
      ...(status === 'failed' && { message: 'AI generation failed. Your credit has been refunded.' }),
      ...(status === 'degraded' && { message: 'Partial reading delivered. Click Regenerate to retry the missing sections (free).' }),
    }),
    type: 'final',
  } as MessageEvent);

  this.logger.log(`Stream Career V2 status=${status} via ${activeProviderConfig.provider} in ${latencyMs}ms, ${totalGot}/${expectedTotal} sections, refunded=${refunded}`);

  subscriber.complete();
}
```

### §Part 5 — Cache hygiene

Today: line 1196-1201 caches the result regardless of completeness. Fixed in §Part 4 above (only cache when `status === 'success'`). Each `_executeStream*` function reads its own `*_V2_PROMPTS.callN.length` for expected counts (e.g., Career uses `CAREER_V2_PROMPTS.call1Sections.length + CAREER_V2_PROMPTS.call2Sections.length`). No separate aggregating map needed — the per-stream code already has access to the right prompt config.


---

## Implementation

### Files to modify

#### 1. `apps/api/src/credits/credits.service.ts` (NEW MODULE — Issue 14)

**API specification**:
```typescript
@Injectable()
export class CreditsService {
  constructor(
    private prisma: PrismaService,
    private logger: LoggerService,
  ) {}

  /**
   * Atomic credit deduction. Throws BadRequestException if insufficient balance.
   * Writes a CreditLedger row (-amount).
   * Caller passes their own transaction context for atomicity with other writes.
   */
  async deductCredits(
    userId: string,
    amount: number,
    reason: string,
    options?: { readingId?: string; comparisonId?: string; tx?: PrismaTransactionClient },
  ): Promise<void> {
    const client = options?.tx ?? this.prisma;
    const updated = await client.user.updateMany({
      where: { id: userId, credits: { gte: amount } },
      data: { credits: { decrement: amount } },
    });
    if (updated.count === 0) {
      throw new BadRequestException(`Insufficient credits (need ${amount})`);
    }
    await client.creditLedger.create({
      data: {
        userId,
        amount: -amount,
        reason,
        readingId: options?.readingId ?? null,
        comparisonId: options?.comparisonId ?? null,
      },
    });
  }

  /**
   * Refund credit for a failed reading. IDEMPOTENT — calling twice is safe.
   * Returns { refunded: boolean } indicating whether THIS call performed the refund.
   * Internal: uses atomic updateMany guard against double-refund races (Issue 5).
   */
  async refundReadingCredit(
    readingId: string,
    reason: string,
  ): Promise<{ refunded: boolean; amount: number }> {
    return this.prisma.$transaction(async (tx) => {
      // Atomic guard: only proceed if creditsUsed > 0 AND not already refunded
      const reading = await tx.baziReading.findUnique({ where: { id: readingId } });
      if (!reading || reading.creditsUsed === 0 || reading.refundedAt !== null) {
        return { refunded: false, amount: 0 };
      }
      const amount = reading.creditsUsed;

      // Atomic guard against double-refund race
      const guard = await tx.baziReading.updateMany({
        where: { id: readingId, refundedAt: null, creditsUsed: { gt: 0 } },
        data: { refundedAt: new Date(), failedReason: reason },
      });
      if (guard.count === 0) {
        return { refunded: false, amount: 0 };  // race lost — another caller already refunded
      }

      // Refund credit + ledger entry
      await tx.user.update({
        where: { id: reading.userId },
        data: { credits: { increment: amount } },
      });
      await tx.creditLedger.create({
        data: {
          userId: reading.userId,
          amount: +amount,
          reason: `refund: ${reason}`,
          readingId,
        },
      });
      return { refunded: true, amount };
    });
  }

  // Comparison flow has its own table (BaziComparison); mirror the above:
  async refundComparisonCredit(comparisonId: string, reason: string): Promise<{ refunded: boolean; amount: number }> { /* same pattern */ }

  async getBalance(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { credits: true } });
    return user?.credits ?? 0;
  }
}
```

**Module setup**: new `apps/api/src/credits/credits.module.ts` providing `CreditsService`. Imported into `BaziModule` and `AiModule`. Avoids circular dep (`BaziService` imports `AiService` imports `CreditsService` — no cycle since `CreditsService` doesn't import either).

**Migration of existing call sites**: replace these direct credit decrements with `creditsService.deductCredits()`:
- `bazi.service.ts:240-243` (lifetime/career/annual reading deduction)
- `bazi.service.ts:742-745` (compatibility deduction)
- `bazi.service.ts:964-966` (recalculate deduction)
- `payments/section-unlock.service.ts` (existing section-unlock deduction)

Each gets a `reason` string like `"reading-create:CAREER"`, `"comparison-create"`, `"recalculate"`, `"section-unlock:LOVE.spouse_appearance"`. Test coverage: existing tests should pass without modification — same atomic semantics.

#### 2. `apps/api/src/ai/ai.service.ts`

**Named constants block** (R2 fix #6 — top of file, near other module constants):
```typescript
// AI retry + degrade configuration (replaces v1's inline magic numbers)
const AI_MAX_RETRIES_PER_PROVIDER = 3;
const AI_MAX_TOTAL_TIME_MS = parseInt(
  process.env.MAX_TOTAL_AI_TIME_MS ?? '300000',  // 5 min
  10,
);
const AI_RETRY_AFTER_CAP_MS = 30000;             // honor Retry-After header up to 30s
const REGENERATION_LIMIT = 3;                     // max free regenerations per degraded reading

// (DEGRADE_THRESHOLDS dict from §Part 4 also lives here)
```

All references in the plan to `AI_MAX_RETRIES_PER_PROVIDER`, `300000`, `30000`, `3`, `0.8`, `0.5` are replaced with these named constants in the implementation. The `0.8`/`0.5` thresholds live inside `DEGRADE_THRESHOLDS` (per-type, not global).

- Add `callProviderWithRetry()` (§Part 2 above) near `callProviderWithTimeout` line 672.
- Add `isRetryableError()`, `computeBackoff()`, `summarizeError()` helpers.
- Replace the inner stream try/catch in `_executeStreamCareerV2` (line 1063-1109) with the caller-side retry loop from §Part 2.
- Replace the existing finally-block + `done` event with the unified `final` event from §Part 4.
- Add `emittedKeys: Set<string>` accumulator (§Part 2).
- Inject `CreditsService` via constructor.
- Disable Anthropic SDK's internal retry: when constructing `Anthropic({ apiKey, maxRetries: 0 })` for streaming use case (Issue 12). For non-streaming, leave SDK default OR explicitly set `maxRetries: 0` and handle all retries via `callProviderWithRetry`. Document the chosen layering in code comment.
- Replicate the same pattern to `_executeStreamLifetimeV2`, `_executeStreamAnnualV2`, `_executeStreamRomanceV2`.
- Wrap non-streaming `generateInterpretation()` (line 217-274) outer provider loop with per-provider `callProviderWithRetry()`.

#### 3. `apps/api/prisma/schema.prisma` — schema additions (Issues 16, 18)

```prisma
model BaziReading {
  // ... existing fields ...
  failedReason          String?    @map("failed_reason")
  isDegraded            Boolean    @default(false) @map("is_degraded")
  refundedAt            DateTime?  @map("refunded_at")
  regenerationCount     Int        @default(0) @map("regeneration_count")
  regenerationExhausted Boolean    @default(false) @map("regeneration_exhausted")
}

model BaziComparison {
  // ... existing fields ...
  failedReason          String?    @map("failed_reason")
  isDegraded            Boolean    @default(false) @map("is_degraded")
  refundedAt            DateTime?  @map("refunded_at")
  regenerationCount     Int        @default(0) @map("regeneration_count")
  regenerationExhausted Boolean    @default(false) @map("regeneration_exhausted")
}

// NEW: per-credit-movement audit ledger (Issue 18)
model CreditLedger {
  id            String    @id @default(uuid())
  userId        String    @map("user_id")
  amount        Int       // signed: negative = deduction, positive = grant/refund
  reason        String    // e.g., "reading-create:CAREER", "refund: ai-failed-..."
  readingId     String?   @map("reading_id")
  comparisonId  String?   @map("comparison_id")
  createdAt     DateTime  @default(now()) @map("created_at")

  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  reading       BaziReading?    @relation(fields: [readingId], references: [id], onDelete: SetNull)
  comparison    BaziComparison? @relation(fields: [comparisonId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@index([readingId])
  @@map("credit_ledger")
}

// Add reverse relation on BaziReading + BaziComparison + User:
model User {
  // ...
  creditLedgerEntries CreditLedger[]
}
model BaziReading {
  // ...
  creditLedgerEntries CreditLedger[]
}
model BaziComparison {
  // ...
  creditLedgerEntries CreditLedger[]
}
```

**Migration steps (Issue 16 — worktree footgun + R2 fix #4 — copy-back + drift safety)**:

⚠️ **Drift risk**: running `prisma migrate dev` in main repo modifies main's `prisma/migrations/` directory and updates main's DB. If this PR is rejected/rewritten, main's schema is now ahead of any other branch. Mitigation steps below include drift recovery.

```bash
WT="/Users/roger/Documents/Python/Bazi_Plotting/.claude/worktrees/romantic-nobel-03e0d1"
MAIN="/Users/roger/Documents/Python/Bazi_Plotting"

# 1. Stash any in-flight changes in main to keep its working tree clean
cd "$MAIN"
git stash push -m "pre-migration-stash" -- apps/api/prisma/schema.prisma 2>/dev/null || true

# 2. Copy schema from worktree to main
cp "$WT/apps/api/prisma/schema.prisma" apps/api/prisma/schema.prisma

# 3. Run migration from main (creates apps/api/prisma/migrations/<timestamp>_add_..../migration.sql)
cd apps/api
npm run db:migrate -- --name add_reading_failure_tracking_and_credit_ledger

# 4. Verify columns + table exist
/opt/homebrew/opt/postgresql@15/bin/psql -U bazi_user -d bazi_platform -c "\d bazi_readings" | grep -E "failed_reason|is_degraded|refunded_at|regeneration_count"
/opt/homebrew/opt/postgresql@15/bin/psql -U bazi_user -d bazi_platform -c "\dt credit_ledger"
/opt/homebrew/opt/postgresql@15/bin/psql -U bazi_user -d bazi_platform -c "\d credit_ledger"

# 5. CRITICAL — copy migration files BACK to worktree so its prisma/migrations dir stays in sync
LATEST_MIGRATION=$(ls -t "$MAIN/apps/api/prisma/migrations" | head -1)
cp -r "$MAIN/apps/api/prisma/migrations/$LATEST_MIGRATION" "$WT/apps/api/prisma/migrations/"

# 6. Regenerate Prisma client in worktree
cd "$WT/apps/api"
../../node_modules/.bin/prisma generate

# 7. (Drift recovery — only if PR is rejected later) Roll back main's schema:
# cd "$MAIN" && git checkout apps/api/prisma/schema.prisma
# Then manually create a DOWN migration to drop the columns/table.
# Alternative: keep the migration since it's additive + nullable; future branches just won't reference the new fields.

# 8. Restore main's prior schema edits (R3 N3): if step 1 actually stashed something, the
#    schema overwrite + migration changed it. After verifying main is in a clean state for
#    the PR review, decide: `cd "$MAIN" && git stash list` — if there's a "pre-migration-stash"
#    entry AND you want to recover unrelated edits, `git stash pop`. Otherwise drop it with
#    `git stash drop`. Skipping this leaves orphaned stashes.
```

**Backfill (optional)**: write a one-time script to back-fill `CreditLedger` from existing `BaziReading.creditsUsed` (negative entries) and `Transaction.amount` (positive Stripe entries) for finance reconciliation of historical data. Can be deferred unless finance needs it.

#### 4. `apps/api/src/bazi/bazi.service.ts`

- Inject `CreditsService` via constructor.
- Replace inline credit deductions (lines 240-243, 742-745, 964-966) with `await this.creditsService.deductCredits(user.id, service.creditCost, "reading-create:CAREER", { readingId: reading.id, tx })`.
- Add new `regenerateReading(clerkUserId, readingId)` method:
  ```typescript
  async regenerateReading(clerkUserId: string, readingId: string): Promise<BaziReading> {
    const reading = await this.prisma.baziReading.findFirst({
      where: { id: readingId, user: { clerkUserId } },
    });
    if (!reading) throw new NotFoundException('Reading not found');
    if (!reading.isDegraded) throw new BadRequestException('Only degraded readings can be regenerated');
    if (reading.regenerationExhausted) throw new BadRequestException('Regeneration limit reached (3); please create a new reading');
    if (reading.regenerationCount >= REGENERATION_LIMIT) {
      await this.prisma.baziReading.update({ where: { id: readingId }, data: { regenerationExhausted: true } });
      throw new BadRequestException('Regeneration limit reached');
    }
    // Increment count, clear isDegraded; the next stream attempt will rewrite aiInterpretation
    // CRITICAL: use Prisma.JsonNull to actually NULL the JSON column.
    // `undefined` would be a no-op in Prisma v6 ("don't update this field").
    await this.prisma.baziReading.update({
      where: { id: readingId },
      data: {
        regenerationCount: { increment: 1 },
        isDegraded: false,
        failedReason: null,
        aiInterpretation: Prisma.JsonNull,  // FIX (R2-1): was undefined which is a no-op
      },
    });
    return reading;
  }
  ```
- Add controller endpoint `POST /api/bazi/readings/:id/regenerate` returning `{ readingId, regenerationCount }`. Frontend then re-opens the SSE stream.

#### 5. Frontend changes (Issue 7 — actual file paths)

Run greps to enumerate consumers:
```bash
grep -rn "EventSource\|streamCareerV2\|section_complete" apps/web --include="*.tsx" --include="*.ts" | head -30
grep -rn "auspiciousness\|isDegraded" apps/web --include="*.tsx" --include="*.ts" | head -20
```

Expected files (best estimate — implementing agent must verify):
- `apps/web/app/components/AIReadingDisplay.tsx` — main reading renderer
- `apps/web/app/dashboard/bazi/[id]/page.tsx` (or similar) — reading detail page that opens SSE
- `apps/web/app/lib/sse-client.ts` (or wherever SSE handler lives) — add `final`, `retry_attempt` event types
- `apps/web/app/components/RegenerateButton.tsx` — NEW component, conditionally rendered when `isDegraded && !regenerationExhausted`

**SSE event handler additions**:
```typescript
// Inside the SSE consumer:
eventSource.addEventListener('retry_attempt', (ev) => {
  const data = JSON.parse(ev.data);
  // Show toast: "AI service is busy, retrying ({data.attempt}/{data.max})..."
  setRetryStatus({ attempt: data.attempt, max: data.max, reason: data.reason });
});
eventSource.addEventListener('final', (ev) => {
  const data = JSON.parse(ev.data);
  if (data.status === 'failed') {
    showErrorToast(data.message);
    if (data.refunded) showInfoToast('Credit refunded');
  } else if (data.status === 'degraded') {
    setBanner({ kind: 'warning', message: data.message });
  }
  // 'success' handled by section_complete events; final is just a confirmation
});
```

### Tests to add

**`apps/api/src/credits/credits.service.spec.ts`** (NEW):
- `deductCredits()`: success, insufficient balance throws, ledger entry written
- `refundReadingCredit()`: idempotent (call twice → second returns `{refunded: false}`), atomic (mock concurrent calls → only one wins), correct ledger entry sign

**`apps/api/src/ai/ai.service.spec.ts`** additions:
- `isRetryableError()`: matrix of {429, 529, 500, 503, 400, 401, network errors, AbortError, plain Error}
- `computeBackoff()`: positive jitter, retry-after header parsing, max cap
- `callProviderWithRetry()`: mock provider fails N times then succeeds → verify retries; fails M+1 times → throws
- Caller-side stream retry: mock `streamProvider` to throw before yielding → verify retry; throw after yielding → verify NO retry, partial preserved
- Provider fallback: mock all 3 providers to fail → verify final status='failed' + refund called
- Mixed: Anthropic Call 1 fails 3x then OK on attempt 4 → verify NO further retry (capped at 3); ship sections
- Cache hygiene: status='degraded' → cache.set NOT called; status='success' → called

**`apps/api/src/bazi/bazi.service.spec.ts`** additions:
- `regenerateReading()`: requires isDegraded=true, increments count, blocks at 3 (sets exhausted), clears isDegraded
- Refund flow: stream completes with status='failed' → user.credits restored, BaziReading.refundedAt set, ledger row created

**End-to-end (Playwright, optional)**:
- Mock AI to return overloaded_error 3x then success → verify SSE delivers retry_attempt events, then sections, then final={status:'success'}
- Mock AI to fail all providers → verify final={status:'failed', refunded:true} AND user.credits unchanged after the flow

---

## Risk + sequencing

### Risk classification (updated for v2)

| Change | Risk | Reason |
|---|---|---|
| New `CreditsService` (refactor existing inline deductions) | 🟡 Medium | Touches every credit deduction site in 3 files. Strict regression testing required. |
| `CreditLedger` table + migration | 🟡 Medium | New table, no backfill (acceptable). Migration must apply from main repo. |
| Refund logic + ledger writes | 🟢 Low | Idempotent + atomic guard via updateMany makes race-safe. |
| Retry helpers (non-streaming) | 🟢 Low | Pure additions; old paths fall through to retry-1 (single-attempt) if unused. |
| Caller-side stream retry (§Part 2) | 🟠 Medium-High | Most behavior change in this PR. Buffer-state reset must be exact. Test with deliberate failure injection. |
| Replace `done` with `final` event | 🟠 Medium | **Decision (R2 fix)**: This is a coordinated frontend+backend release. Plan §Part 4 emits ONLY `final` (no `done`). Implementing agent must update frontend SSE handlers in the SAME PR. The frontend `done` listener is replaced by `final`. No back-compat layer — would otherwise create contradiction with §Part 4 code (which doesn't emit `done`). Frontend changes are listed in §Implementation §5. |
| `_executeStream*` parallel-replication (Lifetime, Annual, Romance) | 🟡 Medium | Code duplication risk; consider extracting common SSE-stream lifecycle helper. Defer extraction to follow-up unless time permits. |
| Schema migration in worktree | 🟡 Medium | Mitigated by step 1 of migration steps (apply from main repo). |
| Frontend changes | 🟢 Low | Additive event handlers + new banner. Old success path unchanged. |

### Recommended implementation order

1. **`CreditsService` skeleton** (`deductCredits`, `getBalance`, no refund yet). Migrate existing call sites. Verify no regression.
2. **Schema migration**: add `failedReason`, `isDegraded`, `refundedAt`, `regenerationCount`, `regenerationExhausted`, `CreditLedger` table. Apply from main repo. Regenerate Prisma client in worktree.
3. **Backfill `CreditLedger`** from existing data — `INSERT INTO credit_ledger (...) SELECT ... FROM bazi_readings WHERE creditsUsed > 0`. **Optional / deferrable** — only needed if finance team requests historical reconciliation. Skip for initial PR; add as separate ticket if needed.
4. **`CreditsService.refundReadingCredit`** + tests (idempotency, atomic).
5. **Retry helpers** (`callProviderWithRetry`, `isRetryableError`, `computeBackoff`, `summarizeError`) + unit tests.
6. **Wire retry into non-streaming `generateInterpretation`** + smoke test.
7. **Wire caller-side retry + finally-block decision into `_executeStreamCareerV2`**. Add `final` event (replaces `done` — coordinated FE/BE release in same PR). Update frontend SSE listener at the same time. End-to-end test with mocked overloaded errors.
8. **Replicate to `_executeStreamLifetimeV2`, `_executeStreamAnnualV2`, `_executeStreamRomanceV2`**.
9. **Frontend SSE handler additions** (`retry_attempt`, `final`) + degraded banner + `RegenerateButton`.
10. **`POST /readings/:id/regenerate` endpoint** + UI wiring.

**(removed step 11 from v1)** — `done` event is removed in step 7's same PR; no follow-up cleanup needed since this is a coordinated frontend+backend release.

### Cap on total AI time

`MAX_TOTAL_AI_TIME_MS=300000` enforced in §Part 2 helpers. Each retry checks before sleeping. Fast-fail prevents user from waiting 9+ minutes.

### Cost implications (re-confirmed)

- Worst-case retries: 3 outer × 3 providers = 9 attempts, but with `MAX_TOTAL_AI_TIME_MS=300000` cap, real worst case is bounded by user wait limit not retry count
- Anthropic SDK retries disabled (Issue 12) → no compound 9× explosion
- Cache hygiene means failed reads aren't cached → retried reads hit AI fresh; cost is offset by refund (zero net)

### Token usage / `aiUsageLog` accounting on refund (Issue 4 alternative)

Decision: keep `creditsUsed` field truthful at all times. After refund, `creditsUsed` stays at the original value AND `refundedAt` is set. Net spend = `creditsUsed - (refundedAt IS NULL ? 0 : creditsUsed)`. The `CreditLedger` table is the canonical source for finance — both deduction and refund show as separate rows with signed amounts.

`AIUsageLog` (provider-cost tracking) is INTENTIONALLY untouched on refund — we still incurred provider cost even though we're refunding the user. This is correct for cost-of-revenue accounting.

---

## All 18 R1 issues — disposition

| # | Severity | Issue | Resolution in v2 |
|---|---|---|---|
| 1 | trivial | Backoff jitter could be sub-1500ms | Switched to AWS full-positive-jitter pattern (§Part 1) |
| 2 | trivial | Magic 0.5 threshold | Replaced with per-call class rule (§Part 4) |
| 3 | trivial | `isRetryableError` regex false positives | Use `error.status` numeric first, regex only as fallback (§Part 1) |
| 4 | minor | Token usage accounting on refund unclear | Documented intent in §Risk: keep AIUsageLog as cost-truth, CreditLedger as user-truth |
| 5 | minor | Refund not idempotent | Atomic `updateMany` guard with `refundedAt: null` (§Implementation §1) |
| 6 | minor | Cache-hit refund column irrelevant | Implicit in atomic guard (creditsUsed:{gt:0}) |
| 7 | minor | Frontend file paths hand-waved | Grep targets enumerated (§Implementation §5) |
| 8 | moderate | Streaming retry caveat | Caller-side retry with state reset (§Part 2); confirmed Laopo19 was pre-first-chunk via logs |
| 9 | moderate | Cross-provider accumulation | Explicitly OUT OF SCOPE; degrade-gracefully chosen (§Part 3) |
| 10 | moderate | Degrade vs wait policy | Degrade-gracefully chosen; documented in §0 + §Part 3 |
| 11 | moderate | `partial`/`done` event ordering | Unified `final` event in §Part 4; `done` removed in same PR (coordinated FE/BE release) |
| 12 | moderate | SDK retry compounding | Disable SDK retries when wrapping; documented (§Anthropic SDK section) |
| 13 | moderate | Duplicate emission across retries | `emittedKeys: Set<string>` accumulator (§Part 2) |
| 14 | major | CreditService API not specified | Full API in §Implementation §1 with method signatures |
| 15 | major | Refund-then-emit ordering | Refund happens BEFORE final event in finally-block (§Part 4) |
| 16 | major | Worktree migration footgun | Migration steps explicitly say "apply from main repo" (§Implementation §3) |
| 17 | blocker | Streaming retry buffer corruption | Caller-side retry + reset of `call1Buffer` + `call1ExtractedKeys` per attempt; preserve `call1Sections` + `emittedKeys` (§Part 2) |
| 18 | blocker | No audit trail | `CreditLedger` table added (§Implementation §3); deductions + refunds both write rows |

All blockers (17, 18) and majors (14, 15, 16) addressed.
