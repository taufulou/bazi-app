# AI Call 2 Streaming + Timeout Bump (v3 APPROVED)

**Origin**: Laopo23 2026 Annual reading (`81895a73-a4bb-4df0-97a7-c7beb9c94415`) failed with
`ai-failed-ANNUAL-call1=9/9-call2=0/12`, refunded at exactly **180.064s** after creation —
Call 2's non-streaming response cut off at the 180s timeout before Claude finished
generating all 12 monthly sections.

**Status**: Approved to merge by staff engineer after v1 (13 issues) → v2 (2 conditions +
3 nits) → v3 (all closed). Hold for user go-ahead before implementation.

---

## Part 1 — Timeout bump (env only, no code change)

Add to `apps/api/.env`:

```
AI_STREAM_TIMEOUT_MS=300000      # 5 min per streaming call  (was 180s default)
AI_CALL_TIMEOUT_MS=300000        # 5 min per non-streaming call (was 60s / 180s)
MAX_TOTAL_AI_TIME_MS=900000      # 15 min total budget (was 5 min)
```

Also reduce `AI_MAX_RETRIES_PER_PROVIDER` from **3 → 2** (source constant,
`apps/api/src/ai/ai.service.ts:92`). With 2 concurrent streaming calls at 300s each,
retries starved the original 600s budget; 900s + 2 retries gives exactly
1 same-provider retry + 1 full fallback.

Timeout arithmetic committed in plan:

| Scenario | Wall time | Fits in 900s? |
|---|---|---|
| Happy path (Call 1 + Call 2 concurrent) | max(300, 300) = 300s | ✓ |
| 1 same-provider retry | 300s + backoff + 300s ≈ 602s | ✓ |
| Fallback to GPT after Claude exhausted | 602s + 300s = 902s | tight, fits |
| 2nd retry or 3rd provider | > 900s → fails fast | correctly declines |

Document in `CLAUDE.md` under "Server Troubleshooting" with rationale.

---

## Part 2 — Stream Call 2 in `_executeStreamV2Common`

### Goal
Replace the non-streaming Call 2 path (currently `apps/api/src/ai/ai.service.ts` lines
967–988) with a streaming loop that emits `section_complete` events as each section's
JSON closes. Same output shape; faster perceived progress; partial-success on slow
calls instead of full timeout.

### Consumers of `_executeStreamV2Common` (all affected)

- Lifetime V2 (Call 2: 12 sections)
- Career V2 (Call 2: 13–30 sections)
- Annual V2 (Call 2: 12 monthly_XX sections)

Compatibility V2 has its OWN flow and already streams Call 2 — unaffected by this PR.

### Architecture — concurrency model preserved

Current `_executeStreamV2Common` runs Call 1 and Call 2 concurrently via a Promise
pattern. Plan **preserves** this by using `Promise.all([call1Loop, call2Loop])`. The
**streaming loop body** for Call 2 mirrors Compat V2's proven Call 2 stream loop
(chunk buffer → `extractCompletedSections` → emit `section_complete`).

### New private method

```ts
private async _streamV2Call2Loop(
  providerConfig: ProviderConfig,
  systemPrompt: string,
  userPromptCall2: string,
  subscriber: Subscriber<MessageEvent>,
  readingType: ReadingType,
  call2FixedSections: Record<string, InterpretationSection>,
  emittedKeys: Set<string>,
  call2ExpectedKeys: string[],
  call2Parser: ((content: string) => { sections: Record<string, InterpretationSection>; summary?: InterpretationSection }) | undefined,
  fixSection: (key: string, raw: InterpretationSection) => InterpretationSection,
  totalStartMs: number,
  timeoutMs: number,
  includeScore: boolean,
  call2Controller: AbortController,   // for teardown
  usageAccumulator: { inputTokens: number; outputTokens: number },
): Promise<void>
```

Internals mirror Call 1's retry loop (lines 994–1089) with the three-way error contract
below.

### Error handling contract (load-bearing)

Explicit semantics for mid-stream failure:

| State | Decision | Classical mode? |
|---|---|---|
| Error **before any chunk yielded** (`yieldedAny=false`) | Retry on same provider if `isRetryableError` | Matches Call 1 |
| Mid-stream (`yieldedAny=true`), extracted **< `call2CompletionMin`** | **Fall through to next provider** (abandons current provider, fresh attempt on fallback) | NEW — improves on Call 1 default |
| Mid-stream, extracted **≥ `call2CompletionMin`** | Keep extracted, no further attempts | Threshold met |
| AbortError (timeout) | No retry; fall through to next provider | Matches Call 1 |

This fixes issue #8 (previously, mid-stream 0/12 with retryable error = keep 0 sections
= permanent failure). Now we advance providers.

### Guard before write (prevents emit-vs-cache skew on retry)

```ts
for (const [key, rawSection] of Object.entries(newSections)) {
  if (emittedKeys.has(key)) continue;  // guard BEFORE write
  const section = fixSection(key, rawSection);
  call2FixedSections[key] = section;
  emittedKeys.add(key);
  subscriber.next({ data: JSON.stringify({ key, preview: section.preview, full: section.full, ...(includeScore && section.score != null && { score: section.score }) }), type: 'section_complete' });
}
```

Final-drain parse (post-stream) applies the same guard. On retry, previously-emitted
keys are skipped — cache matches what the client saw.

### Feature flag

```ts
const streamCall2Enabled = this.configService.get<string>('AI_STREAM_CALL2') !== '0';
```

"Default on, explicit `'0'` to disable." When off, the existing non-streaming path
runs unchanged (keep existing code under `if (!streamCall2Enabled) { ... }`).

### Token accounting (parity with non-streaming path)

Verified `@anthropic-ai/sdk@0.73.0` already exports `MessageDeltaUsage` and
`RawMessageDeltaEvent`. No SDK bump needed.

`streamClaude` extended with optional `usageOut` mutable ref:

```ts
private async *streamClaude(
  config, systemPrompt, userPrompt, signal?,
  usageOut?: { inputTokens: number; outputTokens: number },
): AsyncGenerator<string> {
  // ...
  for await (const event of stream) {
    if (event.type === 'message_start' && usageOut) {
      usageOut.inputTokens = event.message.usage.input_tokens;
    } else if (event.type === 'content_block_delta' && 'delta' in event && event.delta.type === 'text_delta') {
      yield event.delta.text;
    } else if (event.type === 'message_delta' && usageOut) {
      usageOut.outputTokens = event.usage.output_tokens;  // cumulative; final wins
    }
  }
}
```

Same pattern applied to `streamGPT` (OpenAI `stream_options: {include_usage: true}` →
`usage` on final chunk) and `streamGemini` (`response.usageMetadata` on final stream
chunk).

**Known asymmetry** (documented in PR description): OpenAI + Gemini usage chunks
arrive only on NORMAL completion. Aborted/truncated streams leave `{0, 0}` — do not
double-bill or under-bill in `logUsage`.

### Observable teardown (fixes pre-existing leak)

```ts
return new Observable((subscriber) => {
  const call1Controller = new AbortController();
  const call2Controller = new AbortController();
  this._executeStreamV2Common({ ..., controllers: [call1Controller, call2Controller] })
    .catch(err => { /* existing error handling */ });

  return () => {
    // Observable unsubscribe (client disconnected or component unmounted).
    // Safe to abort even if both streams completed — SDK abort() on a settled
    // request is a documented no-op across Claude/OpenAI/Gemini.
    call1Controller.abort();
    call2Controller.abort();
  };
});
```

### Timeout bookkeeping

Refactor cleanup: `Set<ReturnType<typeof setTimeout>>` cleared in `finally` (replaces
scalar `call1Timeout`). Both call1 and call2 register into the set.

### Logging

Unified prefix `[V2Stream:${readingType}]` applied to:
- All new Call 2 log lines
- Retroactively to existing Call 1 log lines (for consistency; single grep pattern
  works across both calls)

Log format: `[V2Stream:ANNUAL] Call 2 SECTION EMITTED key=monthly_03 chars=452`

New cache-write observability (for SLO):
```ts
this.logger.log(`[V2Stream:${readingType}] CACHED readingId=${id} call1=${n}/${e1} call2=${m}/${e2} provider=${p}`);
```

No repo log-parsing infra exists (audited), so prefix change is safe.

---

## Testing

### Unit tests (new)

1. `test_call2_retry_does_not_reemit_or_overwrite` — guard-before-write invariant on
   retry.
2. `test_call2_overloaded_mid_stream_below_threshold_advances_provider` — error
   contract branch.
3. `test_call2_overloaded_mid_stream_above_threshold_keeps_partial` — error contract
   branch.
4. `test_call2_overloaded_before_any_chunk_retries_same_provider` — error contract
   branch.
5. `test_concurrent_call1_call2_emission_no_dedup_leak` — interleaving safety.
6. `test_annual_call2_truncated_mid_monthly_07_fails_with_threshold_derivation` —
   partial buffer + final-drain + status derived from `DEGRADE_THRESHOLDS.ANNUAL`
   (dual assertion: literal `'failed'` AND derivation via
   `cfg.call2Critical && (6/12) < cfg.call2CompletionMin`).
7. `test_call_complete_ordering_with_call2_finishing_first` — non-deterministic
   call_complete order.
8. `test_ai_stream_call2_flag_off_uses_non_streaming_path` — legacy path parity.
9. `test_streaming_claude_captures_usage_from_message_delta` — token capture.

### Integration (pre-merge)

- End-to-end Annual V2 against live Claude API for Laopo chart; assert
  `status='success'` with 12 monthly sections. Run once.
- Lifetime + Career V2 golden-path run; output shape unchanged.

---

## Rollout

### Gates

| Stage | Config | Success criterion | Duration | Owner |
|---|---|---|---|---|
| Dev | `AI_STREAM_CALL2=1` | Roger dogfoods 5 Annual readings | 24h | Roger |
| Staging | same | `call2Got ≥ 0.9 × expected` for **≥95%** of readings in any 1h window | 72h | Roger |
| Prod | same | `call2Got ≥ 0.9 × expected` for **≥98%** of readings | 7 days | Roger → on-call rotation |
| Flag removal | `AI_STREAM_CALL2` deleted from code | — | 14 days after prod enable | On-call |

### SLO / rollback trigger

> If `call2Got / expectedCall2Count < 0.9` for **> 5%** of ANNUAL or LIFETIME readings
> in any rolling 1-hour window, `AI_STREAM_CALL2=0` rollback must be initiated within
> **15 minutes**.

### Cache invalidation runbook (if partial-correctness regression)

```sql
-- Null out AI interpretations created during incident window
UPDATE bazi_readings
SET ai_interpretation = NULL
WHERE created_at >= '<incident_start>' AND created_at <= '<incident_end>'
  AND reading_type IN ('LIFETIME', 'CAREER', 'ANNUAL')
  AND ai_provider IS NOT NULL;

-- Clear reading cache
DELETE FROM reading_cache
WHERE created_at >= '<incident_start>';
```

Also: `redis-cli FLUSHALL` per CLAUDE.md cache-invalidation convention.

### Dashboard query (monitoring during soak)

```sql
SELECT
  date_trunc('hour', created_at) AS hour,
  reading_type,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE failed_reason IS NULL AND is_degraded = false) AS success,
  COUNT(*) FILTER (WHERE is_degraded = true) AS degraded,
  COUNT(*) FILTER (WHERE failed_reason IS NOT NULL) AS failed
FROM bazi_readings
WHERE created_at >= now() - interval '24 hours'
  AND reading_type IN ('LIFETIME','CAREER','ANNUAL')
GROUP BY 1, 2 ORDER BY 1 DESC, 2;
```

---

## Files to change

- `apps/api/.env` — 3 new timeout env vars (Part 1).
- `apps/api/src/ai/ai.service.ts` —
  - `AI_MAX_RETRIES_PER_PROVIDER = 2` (was 3).
  - New `_streamV2Call2Loop` method.
  - Swap Call 2 block in `_executeStreamV2Common` behind `AI_STREAM_CALL2` flag.
  - Token capture in `streamClaude` / `streamGPT` / `streamGemini`.
  - Observable teardown hook.
  - Retroactive `[V2Stream:${readingType}]` log prefix on Call 1.
- `apps/api/src/ai/ai.service.spec.ts` — 9 new tests.
- `CLAUDE.md` — document new env vars + cache invalidation runbook + SLO.

## Non-goals (explicit)

- No TS type changes (frontend already generic on SSE events).
- No prompt changes (same prompts work streaming or non-streaming).
- No DB schema changes.
- No frontend changes required.
- Compat V2 untouched — already streams Call 2.

## Non-blocking follow-ups (post-merge)

- If Gemini chunk size (200–500 chars) causes noticeably worse interleaving UX, add
  chunk splitter — unlikely per audit.
- If OpenAI/Gemini aborted streams frequently leave {0, 0} usage records, estimate
  from `buffer.length / 3` as heuristic fallback.

---

## Approval trail

- v1 review: 13 issues (LOW → HIGH) — "Approve with conditions".
- v2 review: 12✅ / 1~partial / 0❌ + 3 new issues — "Approve with 2 conditions + 3 nits".
- v3 review: all conditions closed — **"APPROVED to merge"**.

PR description must call out:
1. OpenAI/Gemini usage telemetry asymmetry vs Anthropic (aborted streams → missing tokens).
2. The 72h staging → 7d prod soak plan with Roger as named owner.
3. Log-parser audit result ("no infra to break").
