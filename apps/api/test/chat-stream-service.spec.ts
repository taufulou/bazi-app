/**
 * Unit tests for ChatStreamService — covers SSE streaming, watchdog, refund-on-error,
 * concurrent-stream lock, refusal short-circuit, post-validation.
 *
 * Anthropic SDK and Redis are mocked. Real Express Response captured via
 * MockResponse helper that records every `write()` call as a parsed SSE event.
 */
// #26 — the deadline reports through Sentry. `addBreadcrumb` MUST be in the
// mock too: the refund-cap path calls it, and a mock without it throws there.
jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), addBreadcrumb: jest.fn() }));

import * as Sentry from '@sentry/nestjs';
import { ChatStreamService, STREAM_LOCK_TTL_SECONDS } from '../src/chat/chat-stream.service';
import { ShutdownService } from '../src/common/shutdown.service';

/** The default chat-context the stream builds its prompt from. Hoisted so the
 *  #26 tests can hand it back from a SCHEDULED fake timer (a slow context build). */
const DEFAULT_CHAT_CONTEXT = {
  chart: { dayMaster: { stem: '甲' }, gender: 'female' },
  strength: { classification: 'very_weak' },
  favorability: { yongShen: '水', xiShen: '木', jiShen: '金' },
  fiveElements: {},
  patternNarrative: null,
  narrativeAnchors: null,
  call2NarrativeAnchors: null,
  touganAnalysis: [],
  tenGodPositionAnalysis: [],
  luckPeriods: [],
  annualForecast15: [],
  monthlyForecast12: [],
  romance: {},
  career: {},
  relationships: {},
  shensha: {},
  doctrineFlags: {},
  doctrineInjectors: {},
};

// ============================================================
// Mock Express Response — captures SSE events for assertion
// ============================================================

class MockResponse {
  public events: Array<Record<string, unknown>> = [];
  public ended = false;
  public headers: Record<string, string> = {};
  public writableEnded = false;
  public headersSent = false;
  public flushHeadersCalled = false;
  private listeners: Record<string, Array<() => void>> = {};

  setHeader(k: string, v: string) {
    this.headers[k] = v;
    return this;
  }

  flushHeaders() {
    this.flushHeadersCalled = true;
    this.headersSent = true;
  }

  write(chunk: string) {
    if (this.writableEnded) return false;
    // Parse SSE format: "data: <json>\n\n"
    const match = chunk.match(/^data: (.+)\n\n$/);
    if (match) {
      try {
        this.events.push(JSON.parse(match[1]));
      } catch {
        this.events.push({ rawChunk: chunk });
      }
    }
    return true;
  }

  end() {
    this.ended = true;
    this.writableEnded = true;
  }

  on(event: string, listener: () => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(listener);
    return this;
  }

  off(event: string, listener: () => void) {
    if (!this.listeners[event]) return this;
    this.listeners[event] = this.listeners[event].filter((l) => l !== listener);
    return this;
  }

  /** Test helper: simulate the client disconnecting mid-stream. */
  simulateClientDisconnect() {
    (this.listeners.close || []).forEach((l) => l());
  }
}

// ============================================================
// Tests
// ============================================================

describe('ChatStreamService', () => {
  let mockPrisma: any;
  let mockConfig: any;
  let mockRedis: any;
  let mockPaymentService: any;
  let mockContextService: any;
  let mockValidators: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAiSpend: any;
  let service: ChatStreamService;
  let mockAnthropicStream: jest.Mock;
  // #26 — kept as handles so the deadline tests can assert "no slot was taken"
  // and "no registration leaked".
  let mockGovernorAcquire: jest.Mock;
  let shutdown: ShutdownService;

  beforeEach(() => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    mockPrisma = {
      user: { findUnique: jest.fn() },
      // F6 — the stream re-checks reading entitlement before building context.
      // Default to a non-refunded row so existing tests exercise their own
      // subject; the F6 describe below overrides it.
      baziReading: { findUnique: jest.fn().mockResolvedValue({ refundedAt: null }) },
      chatSession: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      chatMessage: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
    };
    mockConfig = {
      get: jest.fn((k: string) => {
        if (k === 'ANTHROPIC_API_KEY') return 'sk-test-fake';
        if (k === 'CLAUDE_MODEL') return 'claude-sonnet-4-5-20250929';
        return undefined;
      }),
    };
    mockRedis = {
      // #23 — an ownership TOKEN, so the release assertion proves the same
      // token comes back.
      acquireLock: jest.fn().mockResolvedValue('tok-stream'),
      releaseLock: jest.fn().mockResolvedValue(true),
    };
    mockPaymentService = {
      deductForMessage: jest.fn().mockResolvedValue({ method: 'FREE_QUOTA' }),
      getMonthlyUsage: jest.fn().mockResolvedValue({
        chatsUsed: 1,
        monthlyQuota: 15,
        resetsAt: new Date(),
        subscriptionTier: 'BASIC',
      }),
      refundLastMessage: jest.fn().mockResolvedValue({
        refunded: true,
        method: 'FREE_QUOTA',
      }),
    };
    mockContextService = {
      getCurrentSnapshotVersions: jest.fn().mockReturnValue({
        contextVersion: 'v1.0.0',
        preAnalysisVersion: 'life=v2.9.0|love=v1.11.0|car=v2.5.0|ann=v2.4.0',
      }),
      getChatContextForReading: jest.fn().mockResolvedValue(DEFAULT_CHAT_CONTEXT),
    };
    mockValidators = {
      refuseListPreFlight: jest.fn().mockReturnValue({ refused: false }),
      postValidate: jest.fn((text: string) => ({
        text,
        bannedPhraseStripped: false,
        citationAutoPrepended: false,
        strippedPhrases: [],
      })),
      shouldJudge: jest.fn().mockReturnValue(false),
    };

    // Ob1 #14 — hoisted so tests can assert the zero-usage failure line is
    // actually emitted. `recordFailure` is what makes a stream that died before
    // its first token visible at all; before it, that path logged nothing.
    mockAiSpend = { record: jest.fn(), recordFailure: jest.fn(), assertUnderCap: jest.fn(), estimateCostUsd: jest.fn(() => 0.01) };

    mockGovernorAcquire = jest.fn(async () => () => undefined);
    shutdown = new ShutdownService();
    service = new ChatStreamService(
      mockPrisma,
      mockConfig,
      mockRedis,
      mockPaymentService,
      mockContextService,
      mockValidators,
      mockAiSpend as never,
      { run: (_p: unknown, _c: unknown, fn: () => unknown) => fn(), acquire: mockGovernorAcquire, runGenerator: (_p: unknown, _c: unknown, g: () => unknown) => g(), snapshot: () => ({}) } as never,
      { consume: jest.fn(), peek: jest.fn(), limitFor: () => 100 } as never,
      shutdown,
    );

    // Patch Anthropic stream
    mockAnthropicStream = jest.fn();
    (service as any).anthropic = { messages: { stream: mockAnthropicStream } };
  });

  function makeFreshSession(overrides: Partial<any> = {}) {
    return {
      id: 's1',
      userId: 'u1',
      readingId: 'reading-1',
      startedAt: new Date(),
      endedAt: null,
      contextVersion: 'v1.0.0',
      preAnalysisVersion: 'life=v2.9.0|love=v1.11.0|car=v2.5.0|ann=v2.4.0',
      messageCount: 0,
      firstMessageAt: null,
      creditExtensions: 0,
      paidMessagesUsed: 0,
      ...overrides,
    };
  }

  const DEFAULT_FINAL_USAGE = {
    input_tokens: 8000,
    output_tokens: 250,
    cache_read_input_tokens: 7500,
    cache_creation_input_tokens: 0,
  };

  function makeAsyncIterableStream(events: any[], finalUsage: Record<string, unknown> = DEFAULT_FINAL_USAGE) {
    const iterable = {
      [Symbol.asyncIterator]: async function* () {
        for (const e of events) yield e;
      },
      finalMessage: jest.fn().mockResolvedValue({ usage: finalUsage }),
    };
    return iterable;
  }

  // ============================================================
  // Lock + ownership + version drift
  // ============================================================

  // ============================================================
  // F6 — refunded-reading gate on the STREAM door
  // ============================================================

  describe('F6 — refuses a refunded reading', () => {
    // ⚠️ This describe exists because a mutation found the gap: deleting the
    // stream's entitlement gate passed all 16 tests here. The stream is the
    // surface the web client actually uses, so it was the most important door
    // and the untested one. Mutation testing only covers code you thought to
    // mutate — the question that found this was "which callers have NO test
    // pointing at them?"
    it('emits READING_REFUNDED and never calls Anthropic', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(makeFreshSession());
      mockPrisma.chatMessage.create.mockResolvedValue({ id: 'm1' });
      mockPrisma.baziReading.findUnique.mockResolvedValue({ refundedAt: new Date() });

      // `events` is already typed on MockResponse — no `any` needed, and the
      // eslint suppression budget for this file is a ratchet (adding one `any`
      // un-suppresses every pre-existing violation in the file).
      const res = new MockResponse();
      await service.streamMessage('c1', 's1', 'hello', undefined, res as never);

      const err = res.events.find((e) => e.type === 'error');
      expect(err).toBeDefined();
      // Reported as itself, not as an AI failure (the F5 F-2 branch).
      expect(err?.code).toBe('READING_REFUNDED');
      expect(mockAnthropicStream).not.toHaveBeenCalled();
      // The upfront deduction comes back — no Anthropic call was made.
      expect(mockPaymentService.refundLastMessage).toHaveBeenCalled();
    });

    // Negative control is structural rather than duplicated here: the
    // pre-existing tests in this file run THROUGH this gate with
    // `refundedAt: null` (the `beforeEach` default), so an always-fire gate
    // breaks them. Measured: inverting the gate fails **8 of 16** — the other
    // 8 short-circuit earlier (NOT_FOUND, FORBIDDEN, SESSION_EXPIRED,
    // SESSION_ENDED, version drift, CONCURRENT_STREAM, payment failure,
    // refuse-list pre-flight).
    //
    // ⚠️ An earlier version of this comment claimed all 16 and said "verified
    // by mutation" — the mutation was run, the COUNT was not, and the audit
    // caught the overstatement. The control is half the size it advertised.
    //
    // ⚠️ It can also rot silently: it rests entirely on the `beforeEach`
    // default. A future test that overrides `baziReading.findUnique` with a row
    // shaped for another purpose (`{id, userId}`, say) yields
    // `refundedAt === undefined`, which the deliberate truthiness check reads
    // as not-refunded — that test then stops exercising the gate with no
    // signal. The explicit refusal test above is what actually holds the line.
  });

  describe('pre-flight checks', () => {
    it('emits CONCURRENT_STREAM when Redis lock cannot be acquired', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(makeFreshSession());
      mockRedis.acquireLock.mockResolvedValue(false);

      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', 'hello', undefined, res);

      expect(res.events).toHaveLength(1);
      expect(res.events[0]).toMatchObject({ type: 'error', code: 'CONCURRENT_STREAM' });
      expect(res.ended).toBe(true);
      expect(mockAnthropicStream).not.toHaveBeenCalled();
    });

    it('releases the lock even when the stream errors', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(makeFreshSession());
      mockPrisma.chatMessage.create.mockResolvedValue({ id: 'm1' });
      mockAnthropicStream.mockImplementation(() => {
        throw new Error('Anthropic 503');
      });

      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', 'hello', undefined, res);

      expect(mockRedis.releaseLock).toHaveBeenCalledWith(
        'chat-session-stream:s1',
        'tok-stream',
      );
    });

    it('emits FORBIDDEN when session not owned by this user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(
        makeFreshSession({ userId: 'other-user' }),
      );

      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', 'hello', undefined, res);

      expect(res.events[0]).toMatchObject({ type: 'error', code: 'FORBIDDEN' });
      expect(mockRedis.acquireLock).not.toHaveBeenCalled();
    });

    it('emits SESSION_EXPIRED when session is older than 24h', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(
        makeFreshSession({
          startedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        }),
      );

      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', 'hello', undefined, res);

      expect(res.events[0]).toMatchObject({ type: 'error', code: 'SESSION_EXPIRED' });
    });

    it('emits CONTEXT_VERSION_DRIFTED when versions diverge mid-session', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(
        makeFreshSession({ contextVersion: 'v0.9.0' }),
      );

      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', 'hello', undefined, res);

      expect(res.events[0]).toMatchObject({
        type: 'error',
        code: 'CONTEXT_VERSION_DRIFTED',
      });
    });
  });

  // ============================================================
  // Refusal short-circuit
  // ============================================================

  describe('refuse-list short-circuit', () => {
    it('emits synthetic refusal as single delta+done, no Anthropic call', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(makeFreshSession());
      mockValidators.refuseListPreFlight.mockReturnValue({
        refused: true,
        syntheticReply: '此類問題超出八字命理範疇',
        matchedPattern: 'lottery',
      });
      mockPrisma.chatMessage.create.mockResolvedValue({ id: 'refusal-msg' });
      mockPrisma.chatSession.update.mockResolvedValue({ messageCount: 1 });
      mockPrisma.chatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        messageCount: 1,
        creditExtensions: 0,
        paidMessagesUsed: 0,
      });

      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', '下期樂透號碼', undefined, res);

      // Wire: session_start, delta (synthetic refusal), done. No 'error'.
      const types = res.events.map((e: any) => e.type);
      expect(types).toEqual(['session_start', 'delta', 'done']);
      const deltaEvent = res.events.find((e: any) => e.type === 'delta') as any;
      expect(deltaEvent.text).toContain('八字命理範疇');
      expect(mockAnthropicStream).not.toHaveBeenCalled();
      // BUT deduction still happens (per plan: refuse counts as 1 quota use)
      expect(mockPaymentService.deductForMessage).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Successful streaming flow
  // ============================================================

  describe('streaming happy path', () => {
    it('streams text_delta events to client and emits done at the end', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(makeFreshSession());
      mockPrisma.chatMessage.create
        .mockResolvedValueOnce({ id: 'msg-user' })
        .mockResolvedValueOnce({ id: 'msg-asst' });
      mockPrisma.chatSession.update.mockResolvedValue({ messageCount: 1 });
      mockPrisma.chatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        messageCount: 1,
        creditExtensions: 0,
        paidMessagesUsed: 0,
      });

      mockAnthropicStream.mockReturnValue(
        makeAsyncIterableStream([
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '根據您的' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '命局' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '...' } },
        ]),
      );

      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', '我的命格如何', undefined, res);

      // Expected event sequence: session_start, 3× delta, done
      const types = res.events.map((e: any) => e.type);
      expect(types).toEqual(['session_start', 'delta', 'delta', 'delta', 'done']);

      // Concatenated delta text reconstructs the full response
      const fullText = res.events
        .filter((e: any) => e.type === 'delta')
        .map((e: any) => e.text)
        .join('');
      expect(fullText).toBe('根據您的命局...');

      // Done event has token usage
      const doneEvent = res.events[res.events.length - 1] as any;
      expect(doneEvent.messageId).toBe('msg-asst');
      expect(doneEvent.usage).toMatchObject({
        inputTokens: 8000,
        outputTokens: 250,
        cacheReadTokens: 7500,
      });

      // Anthropic was called with cache_control
      expect(mockAnthropicStream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 800,
          system: expect.arrayContaining([
            expect.objectContaining({
              cache_control: { type: 'ephemeral', ttl: '1h' },
            }),
          ]),
        }),
        expect.objectContaining({ timeout: 90_000 }),
      );
    });

    it('#6 — persists the final message\'s cache counters, read through the shared reader', async () => {
      // Pairwise-distinct values: the default fixture has cache writes = 0 and
      // input = 8000, so it could not catch a swapped or neighbour-filled field.
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(makeFreshSession());
      mockPrisma.chatMessage.create
        .mockResolvedValueOnce({ id: 'msg-user' })
        .mockResolvedValueOnce({ id: 'msg-asst' });
      mockPrisma.chatSession.update.mockResolvedValue({ messageCount: 1 });
      mockPrisma.chatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        messageCount: 1,
        creditExtensions: 0,
        paidMessagesUsed: 0,
      });
      mockAnthropicStream.mockReturnValue(
        makeAsyncIterableStream(
          [{ type: 'content_block_delta', delta: { type: 'text_delta', text: '根據您的命局' } }],
          {
            input_tokens: 1234,
            output_tokens: 250,
            cache_read_input_tokens: 8000,
            cache_creation_input_tokens: 3000,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 3000 },
          },
        ),
      );

      await service.streamMessage('c1', 's1', '我的命格如何', undefined, new MockResponse() as never);

      const rows = (mockPrisma.chatMessage.create as jest.Mock).mock.calls
        .map((c) => (c[0] as { data: Record<string, unknown> }).data)
        .filter((d) => d.role === 'ASSISTANT');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ tokensInput: 1234, cacheReadTokens: 8000, cacheCreationTokens: 3000 });
    });
  });

  // ============================================================
  // Anthropic error → refund + error event
  // ============================================================

  // ============================================================
  // Phase 1.6 audit fixes
  // ============================================================

  describe('Phase 1.6 audit fixes', () => {
    it('#26 (T1) — the lock TTL is DERIVED from the total deadline: 205s + 112s margin = 317s', async () => {
      // ⚠️ History: this test used to be named "no race", certifying that a
      // literal 150s lock could not expire mid-stream because the 90s Anthropic
      // timeout capped the stream. It did not (that timeout bounds time-to-
      // HEADERS per attempt, the SDK retries, and the lock also spans the cold
      // chat-context build) — todo #26 replaced the literal with a derivation.
      //
      // The NUMBER is hardcoded here on purpose (the way redis-lock.spec.ts
      // hardcodes the script text): a change to the formula must be re-pinned
      // deliberately, not absorbed by importing the same constants.
      //   deadline 205 = 60 (slowest cold context build: compat engine call)
      //                + 65 (watchdog 60s + one 5s poll — when it FIRES)
      //                + 80 (800 output tokens at a degraded 10 tok/s)
      //   margin   112 = ceil(max(79 normal tail, 92 abort tail) / 1000) + 20 cushion
      //                  normal tail: 5s poll (P6 can start up to one poll after
      //                               the deadline) + 2 tx × 7s + 3 reads × 20s pool wait
      //                  abort tail:  5s poll + 60s SDK retry sleep (ignores the
      //                               signal) + 20s update wait + 7s refund tx
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(makeFreshSession());
      mockRedis.acquireLock.mockResolvedValue(null); // bail early — we just want to check the call args

      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', 'hello', undefined, res);

      expect(mockRedis.acquireLock).toHaveBeenCalledWith('chat-session-stream:s1', 317);
      // The exported constant agrees (that it is DERIVED from the engine
      // timeouts, not a literal, is pinned by the guard spec's probe).
      expect(STREAM_LOCK_TTL_SECONDS).toBe(317);
    });

    it('Bug D fix — flushHeaders called before any event', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(makeFreshSession());
      mockRedis.acquireLock.mockResolvedValue(false);

      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', 'hello', undefined, res);

      // flushHeaders called early so client sees connection establish
      expect(res.flushHeadersCalled).toBe(true);
    });

    it('Bug C fix — client disconnect aborts stream and refunds without writing to dead response', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(makeFreshSession());
      mockPrisma.chatMessage.create.mockResolvedValueOnce({ id: 'msg-user' });

      const res = new MockResponse() as any;

      // Mock generator fires `close` event from WITHIN its first iteration.
      // By this point in service code, `response.on('close', ...)` has been
      // attached (line: setupResponseHooks() runs before anthropic.messages.stream).
      // So firing disconnect here triggers the close handler synchronously,
      // which sets clientDisconnected=true and aborts the controller.
      mockAnthropicStream.mockImplementation(() => {
        const iter = (async function* () {
          // Trigger client disconnect now — close handler runs, sets the flag
          res.simulateClientDisconnect();
          // SDK responds to abort signal by throwing
          throw new Error('aborted by AbortController.signal');
          yield {};
        })();
        return iter;
      });

      await service.streamMessage('c1', 's1', 'hello', undefined, res);

      // Refund called with client-disconnected reason (NOT generic ai-stream-failed)
      expect(mockPaymentService.refundLastMessage).toHaveBeenCalledWith(
        'msg-user',
        's1',
        'u1',
        expect.stringContaining('client'),
      );
      // Message marked CLIENT_DISCONNECTED (preserves diagnostic for debugging)
      expect(mockPrisma.chatMessage.update).toHaveBeenCalledWith({
        where: { id: 'msg-user' },
        data: { errorCode: 'CLIENT_DISCONNECTED' },
      });
    });
  });

  // ============================================================
  // #26 — total deadline (fake timers)
  //
  // Instant mocks + a fake clock put the lock request, `lastDeltaAt` and the
  // watchdog interval all at fake t = 0, so interval polls land at 5, 10, …,
  // 205 s. Every test advances the clock to a 600 s HORIZON before awaiting
  // the stream — beyond the natural end of every mutant (the longest generator
  // ends at 400 s; a deadline wrongly clocked from stream start lands at
  // 355 s) — so a broken guard fails FAST on an assertion, never on jest's
  // 5 s timeout.
  // ============================================================

  describe('#26 — total deadline', () => {
    const HORIZON_MS = 600_000;
    const DEADLINE_MS = 205_000;

    type Signal = AbortSignal;
    /** The default mock wait: observes the abort immediately, like the SDK
     *  does once headers have arrived. Rejects at once on an already-aborted
     *  signal, and removes its listener when the wait completes. */
    const waitAbortAware = (ms: number, signal: Signal) =>
      new Promise<void>((resolve, reject) => {
        const abortErr = () => new Error('aborted by AbortController.signal');
        if (signal.aborted) return reject(abortErr());
        const onAbort = () => {
          clearTimeout(t);
          reject(abortErr());
        };
        const t = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    /** Silence ends BEFORE the 600 s horizon (counted from stream start), so a
     *  mutant that never aborts fails on `done`, not on jest's 5 s timeout. */
    const SILENCE_UNTIL_MS = 500_000;
    /** Mirrors the SDK's retry sleep (`internal/utils/sleep.js`, a bare
     *  setTimeout): the abort is observed only when the sleep ENDS. */
    const waitAbortBlind = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const textDelta = (text: string) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text } });

    /**
     * An Anthropic stream mock: text deltas at the given offsets (ms from
     * stream start), then `after`: end normally / abort-aware silence /
     * abort-BLIND sleep of `blindMs` then throw if aborted.
     */
    function streamMock(opts: {
      deltaAt: number[];
      after: 'end' | 'silence' | 'blind-silence';
      blindMs?: number;
    }) {
      const seen = { abort: false };
      const impl = (_params: unknown, { signal }: { signal: Signal }) => {
        signal.addEventListener('abort', () => { seen.abort = true; }, { once: true });
        const iter = (async function* () {
          let t = 0;
          for (const at of opts.deltaAt) {
            await waitAbortAware(at - t, signal);
            t = at;
            yield textDelta('字');
          }
          if (opts.after === 'end') return;
          if (opts.after === 'silence') {
            await waitAbortAware(Math.max(0, SILENCE_UNTIL_MS - t), signal);
            return;
          }
          await waitAbortBlind(opts.blindMs ?? 210_000);
          if (signal.aborted) throw new Error('aborted by AbortController.signal');
        })();
        return Object.assign(iter, { finalMessage: jest.fn().mockResolvedValue({ usage: DEFAULT_FINAL_USAGE }) });
      };
      return { impl, seen };
    }

    /** Deltas every 10 s, `n` of them, from stream start. */
    const every10s = (n: number) => Array.from({ length: n }, (_, i) => (i + 1) * 10_000);

    let warnSpy: jest.SpyInstance;
    const watchdogWarns = () =>
      warnSpy.mock.calls.filter((c) => /Stream watchdog timeout/.test(String(c[0]))).length;
    const refundReason = () => String(mockPaymentService.refundLastMessage.mock.calls[0]?.[3] ?? '');
    const errorEvent = (res: MockResponse) => res.events.find((e) => e.type === 'error') as Record<string, unknown> | undefined;

    beforeEach(() => {
      jest.useFakeTimers();
      warnSpy = jest.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
      jest.spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error').mockImplementation(() => undefined);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(makeFreshSession());
      mockPrisma.chatMessage.create
        .mockResolvedValueOnce({ id: 'msg-user' })
        .mockResolvedValueOnce({ id: 'msg-asst' });
      mockPrisma.chatSession.update.mockResolvedValue({ messageCount: 1 });
      mockPrisma.chatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1', messageCount: 1, creditExtensions: 0, paidMessagesUsed: 0,
      });
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    /**
     * Start the stream, advance the fake clock to the horizon, then await it.
     * The rejection handler is attached BEFORE the advance (a late handler
     * reports an escaped throw twice — once as unhandled, once here). After
     * every run, nothing may be left behind: no pending timer (a leaked
     * watchdog interval) and no shutdown registration. These two assertions
     * are the ONLY thing that catches a pre-check moved to after the
     * AbortController / registerStream / setInterval block (mutation M12).
     */
    async function drive(): Promise<MockResponse> {
      const res = new MockResponse();
      const settled = service
        .streamMessage('c1', 's1', '我的命格如何', undefined, res as never)
        .then(() => undefined, (e: unknown) => e);
      await jest.advanceTimersByTimeAsync(HORIZON_MS);
      expect(await settled).toBeUndefined(); // nothing escaped streamMessage
      expect(jest.getTimerCount()).toBe(0);
      expect(shutdown.activeStreamCount).toBe(0);
      return res;
    }

    it('T2 — a stream still running at 205 s is aborted, refunded and labelled as the DEADLINE (not the watchdog)', async () => {
      // 40 deltas at 10 s intervals → the generator would end naturally at 400 s
      // (so a deleted deadline branch fails on `done`, not on a hang).
      const { impl, seen } = streamMock({ deltaAt: every10s(40), after: 'end' });
      mockAnthropicStream.mockImplementation(impl);

      const res = await drive();

      expect(errorEvent(res)).toMatchObject({ code: 'AI_CALL_FAILED', refunded: true });
      expect(refundReason()).toMatch(/^stream-deadline-exceeded:20\ds$/);
      expect(seen.abort).toBe(true);
      expect(mockPrisma.chatMessage.update).toHaveBeenCalledWith({ where: { id: 'msg-user' }, data: { errorCode: 'AI_FAILED' } });
      // Exact timings — the runbook triages `mid_stream` by comparing these two.
      // Context was instant, so the AI call started at t=0: both are 205 s.
      expect(Sentry.captureMessage).toHaveBeenCalledWith('chat.stream.deadline_exceeded', {
        level: 'warning',
        tags: { phase: 'mid_stream' },
        extra: { elapsedMs: DEADLINE_MS, aiElapsedMs: DEADLINE_MS, deadlineMs: DEADLINE_MS },
        fingerprint: ['chat.stream.deadline_exceeded', 'mid_stream'],
      });
      // The watchdog never fired — deltas were flowing.
      expect(watchdogWarns()).toBe(0);
    });

    it('T3 — the 60 s no-delta WATCHDOG still fires, once, at 65 s (abort observed immediately)', async () => {
      const { impl } = streamMock({ deltaAt: [0], after: 'silence' });
      mockAnthropicStream.mockImplementation(impl);

      const res = await drive();

      expect(errorEvent(res)).toMatchObject({ code: 'AI_CALL_FAILED', refunded: true });
      expect(refundReason()).toBe('watchdog-timeout-no-delta-60s');
      expect(watchdogWarns()).toBe(1);
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('T3b — an abort OBSERVED LATE (the SDK retry sleep) is not relabelled by the ticks that keep running', async () => {
      // The watchdog fires at 65 s. The generator is parked on an abort-BLIND
      // 210 s sleep — exactly the SDK's retry sleep — so the interval keeps
      // ticking through 70 … 205 s. The 205 s tick is past the deadline; the
      // `signal.aborted` guard is what stops it from relabelling the watchdog's
      // abort as a deadline (and from aborting + warning 27 more times).
      const { impl } = streamMock({ deltaAt: [0], after: 'blind-silence', blindMs: 210_000 });
      mockAnthropicStream.mockImplementation(impl);

      const res = await drive();

      expect(errorEvent(res)).toMatchObject({ code: 'AI_CALL_FAILED', refunded: true });
      expect(refundReason()).toBe('watchdog-timeout-no-delta-60s');
      expect(watchdogWarns()).toBe(1);
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('T4 — the PRE-CHECK refuses before the Anthropic call when < 30 s of budget remain, refunds, and spends nothing', async () => {
      // A cold context build that takes 180 s (a SCHEDULED fake timer, fired by
      // the outer advance) leaves 25 s < 30 s of budget.
      mockContextService.getChatContextForReading.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(DEFAULT_CHAT_CONTEXT), 180_000)),
      );
      mockAnthropicStream.mockImplementation(streamMock({ deltaAt: every10s(3), after: 'end' }).impl);

      const res = await drive();

      expect(mockAnthropicStream).not.toHaveBeenCalled();
      expect(mockGovernorAcquire).not.toHaveBeenCalled(); // no S1 slot taken
      expect(errorEvent(res)).toMatchObject({ code: 'STREAM_TIMEOUT', refunded: true, refundMethod: 'FREE_QUOTA' });
      expect(String(errorEvent(res)!.message)).toContain('已退還');
      expect(refundReason()).toBe('stream-deadline-before-ai:180s');
      expect(mockPrisma.chatMessage.update).toHaveBeenCalledWith({ where: { id: 'msg-user' }, data: { errorCode: 'STREAM_TIMEOUT' } });
      expect(Sentry.captureMessage).toHaveBeenCalledWith('chat.stream.deadline_exceeded', {
        level: 'warning',
        tags: { phase: 'pre_ai' },
        extra: { elapsedMs: 180_000, aiElapsedMs: null, deadlineMs: DEADLINE_MS },
        fingerprint: ['chat.stream.deadline_exceeded', 'pre_ai'],
      });
      // No AI call was made, so no AI-CALL line of either kind.
      expect(mockAiSpend.record).not.toHaveBeenCalled();
      expect(mockAiSpend.recordFailure).not.toHaveBeenCalled();
      // (`drive()` already asserted: no pending timer, no shutdown registration —
      // the leak a misplaced pre-check would leave behind.)
      expect(res.ended).toBe(true);
    });

    it('T4b — the pre-check boundary is strict: exactly 30 s left is enough to start the stream', async () => {
      // 175 s context build → exactly MIN_STREAM_BUDGET_MS (30 s) remains. The
      // check is `<`, not `<=`, so the stream is STARTED — and its body is kept
      // inside the remaining budget (3 deltas at 5 s spacing, ending at 190 s,
      // before the 205 s deadline tick) so it completes with `done`.
      mockContextService.getChatContextForReading.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(DEFAULT_CHAT_CONTEXT), 175_000)),
      );
      mockAnthropicStream.mockImplementation(streamMock({ deltaAt: [5_000, 10_000, 15_000], after: 'end' }).impl);

      const res = await drive();

      expect(mockAnthropicStream).toHaveBeenCalledTimes(1);
      expect(res.events.map((e) => e.type)).toEqual(['session_start', 'delta', 'delta', 'delta', 'done']);
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('T5 — negative control: a normal 30 s turn is untouched', async () => {
      const { impl, seen } = streamMock({ deltaAt: every10s(3), after: 'end' });
      mockAnthropicStream.mockImplementation(impl);

      const res = await drive();

      expect(res.events.map((e) => e.type)).toEqual(['session_start', 'delta', 'delta', 'delta', 'done']);
      expect(seen.abort).toBe(false);
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
      expect(mockPaymentService.refundLastMessage).not.toHaveBeenCalled();
    });

    it('T6 — the deadline is clocked from the LOCK REQUEST, not from the stream start', async () => {
      // 150 s cold context build, then deltas every 10 s: the deadline lands at
      // 205 s total ≈ 55 s into the stream. Clocked from the stream start it
      // would land at 355 s — and the reason string says which.
      mockContextService.getChatContextForReading.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(DEFAULT_CHAT_CONTEXT), 150_000)),
      );
      mockAnthropicStream.mockImplementation(streamMock({ deltaAt: every10s(40), after: 'end' }).impl);

      const res = await drive();

      expect(errorEvent(res)).toMatchObject({ code: 'AI_CALL_FAILED' });
      expect(refundReason()).toMatch(/^stream-deadline-exceeded:20\ds$/);
      expect(refundReason()).not.toMatch(/:35\ds$/);
      // The ONE test where the two timings differ: 205 s since the lock request,
      // 55 s since the AI call started — the pair the runbook triages by.
      expect(Sentry.captureMessage).toHaveBeenCalledWith('chat.stream.deadline_exceeded', {
        level: 'warning',
        tags: { phase: 'mid_stream' },
        extra: { elapsedMs: DEADLINE_MS, aiElapsedMs: 55_000, deadlineMs: DEADLINE_MS },
        fingerprint: ['chat.stream.deadline_exceeded', 'mid_stream'],
      });
    });

    it('T6b — the clock starts BEFORE the lock acquire, not after it returns', async () => {
      // A 10 s acquire round trip (Redis has no commandTimeout). Clocked from
      // before the acquire the deadline is at 205 s: deltas every 10 s from the
      // 10 s stream start land at 20 … 200 → 19 of them, and the AI call has
      // run 195 s. Clocked from AFTER the acquire the deadline slides to 215 s:
      // 20 deltas, 205 s. (The reason string is `:205s` either way, since it is
      // measured from the same origin — so it cannot discriminate; these can.)
      mockRedis.acquireLock.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('tok-stream'), 10_000)),
      );
      mockAnthropicStream.mockImplementation(streamMock({ deltaAt: every10s(40), after: 'end' }).impl);

      const res = await drive();

      expect(errorEvent(res)).toMatchObject({ code: 'AI_CALL_FAILED' });
      expect(res.events.filter((e) => e.type === 'delta')).toHaveLength(19);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'chat.stream.deadline_exceeded',
        expect.objectContaining({ extra: { elapsedMs: DEADLINE_MS, aiElapsedMs: 195_000, deadlineMs: DEADLINE_MS } }),
      );
    });

    it('T7 — when the watchdog AND the deadline are both true on the same tick, the DEADLINE wins (check order)', async () => {
      // Deltas at 10 … 140 s and one at 142 s, then silence.
      //   200 s poll: 200 − 142 = 58 → watchdog false (under `>` or `>=`); 200 < 205 → deadline false
      //   205 s poll: 205 − 142 = 63 > 60 → watchdog TRUE; 205 ≥ 205 → deadline TRUE — the ONLY such tick
      // With the if / else-if chain only the first true branch runs, so a swap
      // flips the label AND logs the watchdog warn.
      const { impl } = streamMock({ deltaAt: [...every10s(14), 142_000], after: 'silence' });
      mockAnthropicStream.mockImplementation(impl);

      const res = await drive();

      expect(errorEvent(res)).toMatchObject({ code: 'AI_CALL_FAILED' });
      expect(refundReason()).toMatch(/^stream-deadline-exceeded:205s$/);
      expect(watchdogWarns()).toBe(0);
      expect(Sentry.captureMessage).toHaveBeenCalledWith('chat.stream.deadline_exceeded', expect.objectContaining({ tags: { phase: 'mid_stream' } }));
    });

    it('T10 — the pre-check\'s OWN refund failure is never relabelled as an AI failure, and never claims a refund', async () => {
      mockContextService.getChatContextForReading.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(DEFAULT_CHAT_CONTEXT), 180_000)),
      );
      mockPaymentService.refundLastMessage.mockRejectedValue(
        Object.assign(new Error('Transaction API error: Unable to start a transaction in the given time.'), { code: 'P2028' }),
      );
      mockAnthropicStream.mockImplementation(streamMock({ deltaAt: every10s(3), after: 'end' }).impl);

      const res = await drive(); // resolves — nothing escapes

      expect(mockAnthropicStream).not.toHaveBeenCalled();
      expect(mockGovernorAcquire).not.toHaveBeenCalled();
      const ev = errorEvent(res)!;
      expect(ev).toMatchObject({ code: 'STREAM_TIMEOUT', refunded: false });
      expect(String(ev.message)).not.toContain('已退還');
      expect(mockAiSpend.recordFailure).not.toHaveBeenCalled();
      expect(mockAiSpend.record).not.toHaveBeenCalled();
      // The STREAM_TIMEOUT stamp was never overwritten with AI_FAILED.
      const stamps = (mockPrisma.chatMessage.update as jest.Mock).mock.calls.map((c) => c[0].data.errorCode);
      expect(stamps).toEqual(['STREAM_TIMEOUT']);
      expect(res.events.some((e) => e.code === 'AI_CALL_FAILED')).toBe(false);
    });
  });

  describe('refund on Anthropic error', () => {
    it('refunds the user message and emits AI_CALL_FAILED error event', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(makeFreshSession());
      mockPrisma.chatMessage.create.mockResolvedValueOnce({ id: 'msg-user' });
      mockAnthropicStream.mockReturnValue(
        // Throwing BEFORE the first yield is exactly the failure simulated here.
        // eslint-disable-next-line require-yield
        (async function* () {
          throw new Error('Anthropic 503 Service Unavailable');
        })(),
      );

      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', '我的命格如何', undefined, res);

      // session_start emitted, then error
      const types = res.events.map((e: any) => e.type);
      expect(types).toContain('session_start');
      expect(types).toContain('error');

      const errorEvent = res.events.find((e: any) => e.type === 'error') as any;
      expect(errorEvent.code).toBe('AI_CALL_FAILED');
      expect(errorEvent.refunded).toBe(true);

      // Ob1 #14 — the whole point. This stream threw BEFORE its first yield, so
      // there is no usage to price and `record()` is skipped; without
      // `recordFailure` the call left no AI-CALL line at all and the only trace
      // in the log was the refund. Assert the wiring, not just the helper.
      expect(mockAiSpend.record).not.toHaveBeenCalled();
      expect(mockAiSpend.recordFailure).toHaveBeenCalledTimes(1);
      expect(mockAiSpend.recordFailure.mock.calls[0][0]).toMatchObject({
        provider: 'CLAUDE',
        context: 'chat:stream',
        error: expect.any(Error),
      });
      expect(errorEvent.refundMethod).toBe('FREE_QUOTA');

      // Original errorCode set BEFORE refund (preserves audit trail)
      expect(mockPrisma.chatMessage.update).toHaveBeenCalledWith({
        where: { id: 'msg-user' },
        data: { errorCode: 'AI_FAILED' },
      });
      expect(mockPaymentService.refundLastMessage).toHaveBeenCalledWith(
        'msg-user',
        's1',
        'u1',
        expect.stringContaining('Anthropic 503'),
      );
    });
  });

  // ============================================================
  // Phase Fortune+ — topic-boundary refuse refund cap (cost defense)
  // ============================================================
  //
  // Policy: first N consecutive topic-boundary refuses get refunded
  // (forgive occasional off-topic mistakes); (N+1)th and beyond are NOT
  // refunded (user pays for repeated off-topic spam; covers our Anthropic
  // API spend on refuse generations). N = CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT
  // (currently 2). Counter `consecutiveRefuses` resets to 0 on any in-topic
  // message (existing atomic `{ set: 0 }` semantics).
  //
  // These tests mock the transaction's `chatSession.update` so it returns
  // a controlled `consecutiveRefuses` value, then verify whether
  // `refundLastMessage` was called for an AI-refuse response.

  describe('Phase Fortune+ — refuse refund cap', () => {
    function makeRefuseStream() {
      // F-1 style refuse opener (matches CHAT_V1_TOPIC_REFUSE_OPENING_REGEX)
      return makeAsyncIterableStream([
        {
          type: 'content_block_delta',
          delta: {
            type: 'text_delta',
            text: '謝謝您的提問。關於命格定性與終身格局的詳細分析，超出本《八字日運》解讀的範圍——',
          },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: '《八字終身運》提供完整解讀。' },
        },
      ]);
    }

    function setupCommonMocks(consecutiveRefusesAfterUpdate: number) {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        clerkUserId: 'c1',
      });
      // Use default LIFETIME session (refuse-cap logic is reading-type
      // agnostic — it gates purely on `consecutiveRefuses` value). FORTUNE
      // sessions would also work but require additional fortuneScope /
      // fortuneAnchorDate / profileId fields for context resolution.
      mockPrisma.chatSession.findUnique.mockResolvedValue(makeFreshSession());
      mockPrisma.chatMessage.create
        .mockResolvedValueOnce({ id: 'msg-user' })
        .mockResolvedValueOnce({ id: 'msg-asst' });
      // The transaction's session.update returns the post-update value of
      // consecutiveRefuses. This is what the refund-cap check reads.
      mockPrisma.chatSession.update.mockResolvedValue({
        messageCount: 1,
        consecutiveRefuses: consecutiveRefusesAfterUpdate,
      });
      mockPrisma.chatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        messageCount: 1,
        creditExtensions: 0,
        paidMessagesUsed: 0,
        consecutiveRefuses: consecutiveRefusesAfterUpdate,
      });
      mockAnthropicStream.mockReturnValue(makeRefuseStream());
    }

    it('1st consecutive refuse (counter→1) → REFUND fires', async () => {
      setupCommonMocks(1);
      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', '我命格如何？', undefined, res);

      expect(mockPaymentService.refundLastMessage).toHaveBeenCalledWith(
        'msg-user',
        's1',
        'u1',
        'topic-boundary-refuse',
      );
    });

    it('2nd consecutive refuse (counter→2 = LIMIT) → REFUND fires', async () => {
      setupCommonMocks(2);
      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', '今年事業如何？', undefined, res);

      expect(mockPaymentService.refundLastMessage).toHaveBeenCalledWith(
        'msg-user',
        's1',
        'u1',
        'topic-boundary-refuse',
      );
    });

    it('3rd consecutive refuse (counter→3 > LIMIT) → REFUND SUPPRESSED', async () => {
      setupCommonMocks(3);
      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', '我的婚姻幸福嗎？', undefined, res);

      // The crux of the cost-defense policy: 3rd consecutive refuse onward
      // does NOT refund the user. They still get the refuse-with-pivot AI
      // response, but their credit is deducted (covers Anthropic API cost).
      expect(mockPaymentService.refundLastMessage).not.toHaveBeenCalled();
    });

    it('5th consecutive refuse (counter→5) → REFUND still SUPPRESSED', async () => {
      // Spam scenario — refund stays suppressed for all subsequent refuses
      // until counter resets (user asks an in-topic question).
      setupCommonMocks(5);
      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', '明年我會升職嗎？', undefined, res);

      expect(mockPaymentService.refundLastMessage).not.toHaveBeenCalled();
    });

    it('done event surfaces consecutiveRefuses so frontend can fire warning dialog', async () => {
      setupCommonMocks(3);
      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', '我命格如何？', undefined, res);

      const doneEvent = res.events[res.events.length - 1] as any;
      expect(doneEvent.type).toBe('done');
      expect(doneEvent.consecutiveRefuses).toBe(3);
    });
  });
});
