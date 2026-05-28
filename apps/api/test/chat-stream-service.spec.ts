/**
 * Unit tests for ChatStreamService — covers SSE streaming, watchdog, refund-on-error,
 * concurrent-stream lock, refusal short-circuit, post-validation.
 *
 * Anthropic SDK and Redis are mocked. Real Express Response captured via
 * MockResponse helper that records every `write()` call as a parsed SSE event.
 */
import { ChatStreamService } from '../src/chat/chat-stream.service';

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
  let service: ChatStreamService;
  let mockAnthropicStream: jest.Mock;

  beforeEach(() => {
    mockPrisma = {
      user: { findUnique: jest.fn() },
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
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
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
      getChatContextForReading: jest.fn().mockResolvedValue({
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
      }),
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

    service = new ChatStreamService(
      mockPrisma,
      mockConfig,
      mockRedis,
      mockPaymentService,
      mockContextService,
      mockValidators,
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

  function makeAsyncIterableStream(events: any[]) {
    const iterable = {
      [Symbol.asyncIterator]: async function* () {
        for (const e of events) yield e;
      },
      finalMessage: jest.fn().mockResolvedValue({
        usage: {
          input_tokens: 8000,
          output_tokens: 250,
          cache_read_input_tokens: 7500,
          cache_creation_input_tokens: 0,
        },
      }),
    };
    return iterable;
  }

  // ============================================================
  // Lock + ownership + version drift
  // ============================================================

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
  });

  // ============================================================
  // Anthropic error → refund + error event
  // ============================================================

  // ============================================================
  // Phase 1.6 audit fixes
  // ============================================================

  describe('Phase 1.6 audit fixes', () => {
    it('Bug B fix — STREAM_LOCK_TTL_SECONDS > Anthropic timeout (no race)', async () => {
      // Verifies the lock TTL > Anthropic timeout invariant by inspecting
      // the acquireLock call. Lock must be 150s; Anthropic timeout 90s.
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(makeFreshSession());
      mockRedis.acquireLock.mockResolvedValue(false); // bail early — we just want to check the call args

      const res = new MockResponse() as any;
      await service.streamMessage('c1', 's1', 'hello', undefined, res);

      // Verify lock TTL is at LEAST 91 (longer than Anthropic timeout 90s)
      expect(mockRedis.acquireLock).toHaveBeenCalledWith(
        'chat-session-stream:s1',
        expect.any(Number),
      );
      const ttlArg = mockRedis.acquireLock.mock.calls[0][1];
      expect(ttlArg).toBeGreaterThan(90);
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
          // eslint-disable-next-line no-unreachable
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

  describe('refund on Anthropic error', () => {
    it('refunds the user message and emits AI_CALL_FAILED error event', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', clerkUserId: 'c1' });
      mockPrisma.chatSession.findUnique.mockResolvedValue(makeFreshSession());
      mockPrisma.chatMessage.create.mockResolvedValueOnce({ id: 'msg-user' });
      mockAnthropicStream.mockReturnValue(
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
