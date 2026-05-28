/**
 * Tests for FortuneStreamService — Phase Fortune Streaming Layer 2.
 *
 * Covers (per plan v2):
 *   - Cache HIT: emits engine_ready + done with FULL narrative, NO
 *     section_complete events (M6 — no artificial inter-section delays).
 *   - Cache MISS happy path: engine_ready first, then section_complete per
 *     section (clarinet-driven), then done with sanitized narrative.
 *   - Per-section banned-phrase strip (H1) — provisional value emitted in
 *     section_complete is already sanitized; «必然» → «易於».
 *   - Sanitize-diff Sentry breadcrumb fires when strip occurred (H1 follow-up).
 *   - Stop-reason explicit branch (follow-up #2): max_tokens → TRUNCATED
 *     error; refusal → AI_REFUSED error. Both persist with promptVersion=null.
 *   - AI failure mid-stream (M4) → persists with promptVersion=null so circuit
 *     breaker increments correctly.
 *   - Engine fetch failure → ENGINE_FAILED, NO persist (engine failure isn't
 *     an AI failure).
 *   - Subscription gate (SUBSCRIBER_ONLY for free user out-of-window).
 *   - Client disconnect with parseable buffer → persists as success (M5).
 *
 * Anthropic SDK is mocked via patched `helpers.ensureClaudeClient`. Express
 * Response captured via MockResponse that records each SSE event.
 */
// Mock @sentry/nestjs at module level so addBreadcrumb is spyable.
// (Real exports from @sentry/nestjs may be defined as non-configurable
// getter properties — direct jest.spyOn would throw.)
jest.mock('@sentry/nestjs', () => ({
  addBreadcrumb: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';
import { FortuneStreamService } from './fortune-stream.service';
import { FortuneSnapshotHelpers } from './fortune-snapshot.helpers';
import { FortuneValidatorsService } from './fortune-validators.service';
import { FORTUNE_PROMPT_VERSIONS } from '../ai/prompts';

// ============================================================
// MockResponse — captures SSE events
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
  simulateClientDisconnect() {
    (this.listeners.close || []).forEach((l) => l());
  }
}

// ============================================================
// Test fixtures
// ============================================================

const CLERK_ID = 'clerk-1';
const PROFILE_ID = 'profile-1';
const CHART_HASH = 'a'.repeat(32);
const TARGET_DATE = '2026-05-14';

function buildMockProfile() {
  return {
    id: PROFILE_ID,
    userId: 'user-1',
    birthDate: new Date('1987-09-06T00:00:00Z'),
    birthTime: '16:11',
    birthCity: '吉打',
    birthTimezone: 'Asia/Kuala_Lumpur',
    gender: 'male',
    birthLongitude: 100.5,
    birthLatitude: 6.2,
    isPrimary: true,
  };
}

function buildDailyOutput() {
  return {
    dayStem: '戊',
    dayBranch: '子',
    dayGanZhi: '戊子',
    dayTenGod: '比肩',
    dateIso: TARGET_DATE,
    auspiciousness: '凶中有吉',
    baseAuspiciousness: '凶中有吉',
    energyScore: 42,
    metaFraming: 'soft_trigger',
    dimensions: {
      romance: { score: 46, signals: [] },
      career: { score: 42, signals: [] },
      finance: { score: 54, signals: [] },
      travel: { score: 32, signals: [] },
      health: { score: 41, signals: [] },
    },
    folkContent: {
      wealthDirection: { element: '火', direction: '南方', note: '' },
    },
    chartContext: {
      gender: 'male',
      birthDate: '1987-09-06',
      birthTime: '16:11',
      lunarDate: null,
      yearPillar: '丁卯',
      monthPillar: '戊申',
      dayPillar: '戊午',
      hourPillar: '庚申',
      yearTenGod: '正印',
      monthTenGod: '比肩',
      hourTenGod: '食神',
      dayMaster: '戊',
      dayMasterElement: '土',
      dayMasterYinYang: '陽',
      strengthV2: 'neutral',
      usefulGod: '火',
      favorableGod: '木',
      tabooGod: '水',
      enemyGod: '金',
    },
  };
}

function buildFreshSnapshot() {
  return {
    id: 'snapshot-1',
    chartHash: CHART_HASH,
    birthProfileId: PROFILE_ID,
    scope: 'DAY' as any,
    anchorDate: new Date(`${TARGET_DATE}T00:00:00Z`),
    yearMonth: null,
    year: null,
    engineOutputJson: {
      dayStem: '戊',
      dayBranch: '子',
      dayGanZhi: '戊子',
      dayTenGod: '比肩',
      auspiciousness: '凶中有吉',
      energyScore: 42,
      metaFraming: 'soft_trigger',
      dimensions: {},
      folkContent: {},
    },
    aiNarrativeJson: {
      daily_overview: '今日整體偏向平穩',
      daily_romance: '今日感情層面平穩',
      daily_career: '今日事業需謹慎',
      daily_finance: '今日財運穩定',
      daily_travel: '今日宜短程',
      daily_health: '今日宜留意筋骨',
      daily_advice: { canTry: ['x'], shouldHold: ['y'] },
    },
    energyScore: 42,
    auspiciousnessLabel: '凶中有吉',
    preAnalysisVersion: 'v1.2.0',
    promptVersion: FORTUNE_PROMPT_VERSIONS.day,
    generatedAt: new Date('2026-05-14T03:00:00Z'),
    aiFailureCount: 0,
    aiLastFailedAt: null,
  };
}

/** Build an async-iterable that mimics Anthropic's
 *  `messages.stream()` response. `events` is the sequence of yield values;
 *  `finalMessage` resolves to a stop-reason object. */
function makeAsyncStream(events: any[], stopReason: string = 'end_turn') {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e;
    },
    finalMessage: jest.fn().mockResolvedValue({
      stop_reason: stopReason,
      content: [],
      usage: { input_tokens: 100, output_tokens: 500 },
    }),
  };
}

function buildService(opts: {
  cached?: any;
  engineOutput?: any;
  engineFetchThrows?: Error;
  streamEvents?: any[];
  streamStopReason?: string;
  streamThrows?: Error;
  validatorSanitized?: any;
} = {}) {
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', clerkUserId: CLERK_ID, subscriptionTier: 'PRO' }) },
    birthProfile: { findFirst: jest.fn().mockResolvedValue(buildMockProfile()) },
  };
  const config: any = { get: jest.fn().mockImplementation((k: string) => {
    if (k === 'BAZI_ENGINE_URL') return 'http://localhost:5001';
    if (k === 'ANTHROPIC_API_KEY') return 'sk-test';
    if (k === 'CLAUDE_MODEL') return 'claude-sonnet-4-5';
    return null;
  }) };
  const redis: any = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const helpers = new FortuneSnapshotHelpers(prisma, redis, config);
  const validators = new FortuneValidatorsService();
  const service = new FortuneStreamService(prisma, helpers, validators);

  // Stub helper methods to make the test path deterministic
  jest.spyOn(helpers, 'enforceSubscriptionGate').mockImplementation(() => undefined);
  jest.spyOn(helpers, 'computeChartHash').mockReturnValue(CHART_HASH);
  jest.spyOn(helpers, 'tryGetCached').mockResolvedValue(opts.cached ?? null);
  if (opts.engineFetchThrows) {
    jest.spyOn(helpers, 'fetchDailyFromEngine').mockRejectedValue(opts.engineFetchThrows);
  } else {
    jest.spyOn(helpers, 'fetchDailyFromEngine').mockResolvedValue(opts.engineOutput ?? buildDailyOutput());
  }
  const persistSpy = jest.spyOn(helpers, 'persistSnapshot').mockResolvedValue(buildFreshSnapshot());

  // Mock Anthropic client
  const streamFn = opts.streamThrows
    ? jest.fn().mockImplementation(() => { throw opts.streamThrows; })
    : jest.fn().mockReturnValue(
        makeAsyncStream(opts.streamEvents ?? [], opts.streamStopReason ?? 'end_turn'),
      );
  jest.spyOn(helpers, 'ensureClaudeClient').mockResolvedValue({
    messages: { stream: streamFn },
  });

  // Optionally override validator output
  if (opts.validatorSanitized !== undefined) {
    jest.spyOn(validators, 'validate').mockReturnValue({
      sanitized: opts.validatorSanitized,
      didStrip: false,
      findings: [],
    } as any);
  }

  return { service, helpers, validators, prisma, config, redis, persistSpy, streamFn };
}

/** Build a sequence of content_block_delta events from a single chunk array. */
function textDeltaEvents(chunks: string[]) {
  return chunks.map((text) => ({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text },
  }));
}

// Sample valid narrative — minimal so validator doesn't error on missing required sections
const VALID_NARRATIVE_JSON = JSON.stringify({
  sections: {
    daily_overview: '今日整體偏向平穩，宜以平常心面對',
    daily_romance: '今日感情層面平穩',
    daily_career: '今日事業需謹慎',
    daily_finance: '今日財運穩定',
    daily_travel: '今日宜短程',
    daily_health: '今日宜留意筋骨',
    daily_advice: { canTry: ['整理桌面'], shouldHold: ['重大決定延後'] },
  },
});

// ============================================================
// Tests
// ============================================================

describe('FortuneStreamService', () => {
  // ============================================================
  // Cache HIT path
  // ============================================================
  describe('cache HIT', () => {
    it('emits engine_ready + done with full narrative, NO section_complete events', async () => {
      const cached = buildFreshSnapshot();
      const { service } = buildService({ cached });
      const res = new MockResponse() as any;

      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);

      const types = res.events.map((e: any) => e.type);
      // Plan v2 M6: cache hit emits engine_ready + done in one batch
      expect(types).toEqual(['engine_ready', 'done']);
      const done = res.events.find((e: any) => e.type === 'done') as any;
      expect(done.cacheHit).toBe(true);
      expect(done.narrative).not.toBeNull();
      expect(done.narrative.daily_overview).toBe('今日整體偏向平穩');
      expect(res.ended).toBe(true);
    });

    it('does NOT open Anthropic stream on cache hit', async () => {
      const { service, streamFn } = buildService({ cached: buildFreshSnapshot() });
      const res = new MockResponse() as any;
      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);
      expect(streamFn).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Cache MISS happy path
  // ============================================================
  describe('cache MISS — happy path', () => {
    it('emits engine_ready first, then section_complete per section, then done', async () => {
      const { service } = buildService({
        streamEvents: textDeltaEvents([VALID_NARRATIVE_JSON]),
      });
      const res = new MockResponse() as any;

      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);

      const types = res.events.map((e: any) => e.type);
      // engine_ready first, then 7 section_complete events (overview + 5 dims + advice), then done
      expect(types[0]).toBe('engine_ready');
      expect(types[types.length - 1]).toBe('done');
      const sectionKeys = res.events
        .filter((e: any) => e.type === 'section_complete')
        .map((e: any) => e.key);
      // All 7 canonical sections must have been emitted
      expect(sectionKeys).toEqual(expect.arrayContaining([
        'daily_overview',
        'daily_romance',
        'daily_career',
        'daily_finance',
        'daily_travel',
        'daily_health',
        'daily_advice',
      ]));
    });

    it('done event carries the sanitized narrative + cacheHit=false', async () => {
      const { service, persistSpy } = buildService({
        streamEvents: textDeltaEvents([VALID_NARRATIVE_JSON]),
      });
      const res = new MockResponse() as any;
      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);
      const done = res.events.find((e: any) => e.type === 'done') as any;
      expect(done.cacheHit).toBe(false);
      expect(done.narrative).not.toBeNull();
      // persistSnapshot called with full prompt version (success path)
      expect(persistSpy).toHaveBeenCalledTimes(1);
      expect(persistSpy.mock.calls[0][0].promptVersion).toBe(FORTUNE_PROMPT_VERSIONS.day);
    });

    it('warms Redis after successful persist', async () => {
      const { service, redis } = buildService({
        streamEvents: textDeltaEvents([VALID_NARRATIVE_JSON]),
      });
      const res = new MockResponse() as any;
      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);
      expect(redis.set).toHaveBeenCalledTimes(1);
      expect(redis.set.mock.calls[0][0]).toBe(`fortune:daily:${CHART_HASH}:${TARGET_DATE}`);
    });
  });

  // ============================================================
  // Per-section banned-phrase strip (plan v2 H1)
  // ============================================================
  describe('per-section banned-phrase strip', () => {
    it('strips 「必然」 from section value BEFORE emit', async () => {
      const tainted = JSON.stringify({
        sections: {
          daily_overview: '今日必然會發生好事，宜以平常心面對',
          daily_romance: '今日感情層面平穩',
          daily_career: '今日事業需謹慎',
          daily_finance: '今日財運穩定',
          daily_travel: '今日宜短程',
          daily_health: '今日宜留意筋骨',
          daily_advice: { canTry: ['x'], shouldHold: ['y'] },
        },
      });
      const { service } = buildService({
        streamEvents: textDeltaEvents([tainted]),
      });
      const res = new MockResponse() as any;
      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);

      const overview = res.events.find(
        (e: any) => e.type === 'section_complete' && e.key === 'daily_overview',
      ) as any;
      expect(overview).toBeDefined();
      // 必然 → 易於 per FORTUNE_BANNED_ABSOLUTE_PHRASES substitution
      expect(overview.value).not.toContain('必然');
      expect(overview.value).toContain('易於');
    });

    it('fires Sentry sanitize_diff breadcrumb when strip occurred', async () => {
      (Sentry.addBreadcrumb as jest.Mock).mockClear();
      const tainted = JSON.stringify({
        sections: {
          daily_overview: '今日必然如此',
          daily_romance: '今日感情平穩',
          daily_career: '今日宜謹慎',
          daily_finance: '今日宜守',
          daily_travel: '今日宜短',
          daily_health: '今日宜緩',
          daily_advice: { canTry: ['x'], shouldHold: ['y'] },
        },
      });
      const { service } = buildService({
        streamEvents: textDeltaEvents([tainted]),
      });
      const res = new MockResponse() as any;
      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);

      // At least one fortune.stream.sanitize_diff breadcrumb fired
      const sanitizeBreadcrumbs = (Sentry.addBreadcrumb as jest.Mock).mock.calls.filter(
        (c) => c[0].category === 'fortune.stream.sanitize_diff',
      );
      expect(sanitizeBreadcrumbs.length).toBeGreaterThanOrEqual(1);
      expect(sanitizeBreadcrumbs[0][0].data).toEqual(
        expect.objectContaining({
          sectionKeys: expect.arrayContaining(['daily_overview']),
          totalDiffPhraseCount: expect.any(Number),
        }),
      );
    });

    it('does NOT fire sanitize_diff breadcrumb when no strip occurred (clean narrative)', async () => {
      (Sentry.addBreadcrumb as jest.Mock).mockClear();
      const { service } = buildService({
        streamEvents: textDeltaEvents([VALID_NARRATIVE_JSON]),
      });
      const res = new MockResponse() as any;
      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);

      const sanitizeBreadcrumbs = (Sentry.addBreadcrumb as jest.Mock).mock.calls.filter(
        (c) => c[0].category === 'fortune.stream.sanitize_diff',
      );
      expect(sanitizeBreadcrumbs).toHaveLength(0);
    });
  });

  // ============================================================
  // Stop-reason explicit branch (plan v2 follow-up #2)
  // ============================================================
  describe('stop_reason branches', () => {
    it('max_tokens truncation → TRUNCATED error + persists with promptVersion=null', async () => {
      const { service, persistSpy } = buildService({
        streamEvents: textDeltaEvents([VALID_NARRATIVE_JSON]),
        streamStopReason: 'max_tokens',
      });
      const res = new MockResponse() as any;
      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);

      const errEvent = res.events.find((e: any) => e.type === 'error') as any;
      expect(errEvent).toBeDefined();
      expect(errEvent.code).toBe('TRUNCATED');
      expect(persistSpy).toHaveBeenCalledTimes(1);
      // Plan v2 M4: failure path persists with promptVersion=null so circuit
      // breaker counts the failure
      expect(persistSpy.mock.calls[0][0].promptVersion).toBeNull();
    });

    it('refusal stop_reason → AI_REFUSED error + persists with promptVersion=null', async () => {
      const { service, persistSpy } = buildService({
        streamEvents: textDeltaEvents([VALID_NARRATIVE_JSON]),
        streamStopReason: 'refusal',
      });
      const res = new MockResponse() as any;
      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);

      const errEvent = res.events.find((e: any) => e.type === 'error') as any;
      expect(errEvent).toBeDefined();
      expect(errEvent.code).toBe('AI_REFUSED');
      expect(persistSpy.mock.calls[0][0].promptVersion).toBeNull();
    });
  });

  // ============================================================
  // Failure paths
  // ============================================================
  describe('failure paths', () => {
    it('Anthropic stream throws → AI_FAILED error + persists null (circuit-breaker)', async () => {
      const { service, persistSpy } = buildService({
        streamThrows: new Error('Anthropic 503'),
      });
      const res = new MockResponse() as any;
      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);

      const errEvent = res.events.find((e: any) => e.type === 'error') as any;
      expect(errEvent).toBeDefined();
      expect(errEvent.code).toBe('AI_FAILED');
      expect(persistSpy).toHaveBeenCalledTimes(1);
      // Circuit-breaker increment per plan v2 M4
      expect(persistSpy.mock.calls[0][0].promptVersion).toBeNull();
    });

    it('engine fetch throws → ENGINE_FAILED error, NO persist', async () => {
      const { service, persistSpy } = buildService({
        engineFetchThrows: new Error('Engine down'),
      });
      const res = new MockResponse() as any;
      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);

      const errEvent = res.events.find((e: any) => e.type === 'error') as any;
      expect(errEvent).toBeDefined();
      expect(errEvent.code).toBe('ENGINE_FAILED');
      // Engine failure ≠ AI failure → do NOT poison the circuit breaker
      expect(persistSpy).not.toHaveBeenCalled();
    });

    it('parseable JSON but malformed structure → PARSE_FAILED', async () => {
      const { service, persistSpy } = buildService({
        streamEvents: textDeltaEvents(['just some text, no JSON at all']),
      });
      const res = new MockResponse() as any;
      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);

      const errEvent = res.events.find((e: any) => e.type === 'error') as any;
      expect(errEvent).toBeDefined();
      expect(errEvent.code).toBe('PARSE_FAILED');
      expect(persistSpy.mock.calls[0][0].promptVersion).toBeNull();
    });
  });

  // ============================================================
  // Subscription gate
  // ============================================================
  describe('subscription gate', () => {
    it('SUBSCRIBER_ONLY error for free user accessing future day', async () => {
      const { service, helpers } = buildService();
      // Re-arm: enforceSubscriptionGate throws ForbiddenException
      jest.spyOn(helpers, 'enforceSubscriptionGate').mockImplementation(() => {
        const { ForbiddenException } = require('@nestjs/common');
        throw new ForbiddenException({ code: 'SUBSCRIBER_ONLY', message: 'forbidden' });
      });
      const res = new MockResponse() as any;
      await service.streamDailyFortune(CLERK_ID, { date: '2030-01-01' }, res);

      const errEvent = res.events.find((e: any) => e.type === 'error') as any;
      expect(errEvent).toBeDefined();
      expect(errEvent.code).toBe('SUBSCRIBER_ONLY');
    });
  });

  // ============================================================
  // Client disconnect (plan v2 M5)
  // ============================================================
  describe('client disconnect', () => {
    it('disconnect AFTER full buffer received → persists as success', async () => {
      // Simulate: full narrative arrives in one chunk, then stream throws
      // (mimicking abortController kick when client disconnects). Detector
      // will have completed; buffer is parseable.
      const { service, persistSpy } = buildService({
        streamEvents: textDeltaEvents([VALID_NARRATIVE_JSON]),
        streamThrows: undefined,
      });

      // Override the stream to also fire `simulateClientDisconnect` mid-flight
      const res = new MockResponse() as any;
      // Override to throw AFTER yielding the JSON — simulates disconnect
      // recovery: buffer is full + parseable
      const events = textDeltaEvents([VALID_NARRATIVE_JSON]);
      const streamFn = jest.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) yield e;
          // simulate disconnect: trigger close listeners then throw
          res.simulateClientDisconnect();
          throw new Error('aborted');
        },
        finalMessage: jest.fn().mockResolvedValue({ stop_reason: 'end_turn' }),
      });
      jest.spyOn((service as any).helpers, 'ensureClaudeClient').mockResolvedValue({
        messages: { stream: streamFn },
      });

      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);

      // Plan v2 M5: parseable buffer → persisted as success (cache the work)
      expect(persistSpy).toHaveBeenCalledTimes(1);
      const call = persistSpy.mock.calls[0][0];
      expect(call.promptVersion).toBe(FORTUNE_PROMPT_VERSIONS.day);
      expect(call.narrative).not.toBeNull();
    });

    it('disconnect BEFORE complete buffer → persists as failure (circuit breaker)', async () => {
      const res = new MockResponse() as any;
      const persistSpy = jest.fn().mockResolvedValue(buildFreshSnapshot());
      const { service } = buildService({});
      jest.spyOn((service as any).helpers, 'persistSnapshot').mockImplementation(persistSpy);

      // Stream yields incomplete JSON then disconnects
      const streamFn = jest.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: '{"sections":{"daily_overview":"incom' },
          };
          res.simulateClientDisconnect();
          throw new Error('aborted');
        },
        finalMessage: jest.fn().mockResolvedValue({ stop_reason: 'end_turn' }),
      });
      jest.spyOn((service as any).helpers, 'ensureClaudeClient').mockResolvedValue({
        messages: { stream: streamFn },
      });

      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);

      expect(persistSpy).toHaveBeenCalledTimes(1);
      // Incomplete → failure path
      expect(persistSpy.mock.calls[0][0].promptVersion).toBeNull();
    });
  });

  // ============================================================
  // SSE headers
  // ============================================================
  describe('SSE headers', () => {
    it('sets text/event-stream + flushHeaders before first event', async () => {
      const { service } = buildService({ cached: buildFreshSnapshot() });
      const res = new MockResponse() as any;
      await service.streamDailyFortune(CLERK_ID, { date: TARGET_DATE }, res);

      expect(res.headers['Content-Type']).toBe('text/event-stream');
      expect(res.headers['Cache-Control']).toBe('no-cache');
      expect(res.headers['X-Accel-Buffering']).toBe('no');
      expect(res.flushHeadersCalled).toBe(true);
    });
  });
});
