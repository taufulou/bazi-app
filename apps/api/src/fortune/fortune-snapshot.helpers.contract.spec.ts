/**
 * Contract test — Phase Fortune Streaming Layer 3.
 *
 * Locks the invariant: for identical input, `FortuneService.getDailyFortune`
 * (non-streaming) and `FortuneStreamService.streamDailyFortune` (SSE) MUST
 * produce byte-identical `DailyFortuneSnapshot` rows AND identical wire-shape
 * responses (modulo SSE wrapping). Without this lock, the two services
 * inevitably drift on cache invariants (`aiFailureCount` circuit breaker,
 * I5 malformed-JSON guard, I1 NULL-promptVersion staleness, etc.) — that's
 * the whole reason `FortuneSnapshotHelpers` was extracted.
 *
 * Per plan v2 implementation-PR follow-up #1: equality scope is the
 * (chartHash, scope, anchorDate, energyScore, auspiciousnessLabel,
 * preAnalysisVersion, promptVersion, engineOutputJson) tuple. We EXCLUDE
 * non-deterministic fields:
 *   - `id`: Prisma-generated cuid (different per insert)
 *   - `generatedAt`: `new Date()` at upsert time (microsecond-different)
 *   - `aiNarrativeJson`: Anthropic varies per call (even at temperature 0)
 *
 * What the test verifies: both paths call `persistSnapshot` with the same
 * args, so the upsert receives the same payload — DB row contents match.
 */
// Mock Sentry at module level (same reason as fortune-stream.service.spec.ts —
// the real export is a non-configurable getter, can't be spied directly).
jest.mock('@sentry/nestjs', () => ({
  addBreadcrumb: jest.fn(),
}));

import { FortuneService } from './fortune.service';
import { FortuneStreamService } from './fortune-stream.service';
import { FortuneSnapshotHelpers } from './fortune-snapshot.helpers';
import { FortuneValidatorsService } from './fortune-validators.service';
import { FORTUNE_PROMPT_VERSIONS } from '../ai/prompts';
import { ShutdownService } from '../common/shutdown.service';

// ============================================================
// Test fixtures
// ============================================================

const CLERK_ID = 'clerk-1';
const PROFILE_ID = 'profile-1';
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

const SAMPLE_NARRATIVE = {
  daily_overview: '今日整體偏向平穩',
  daily_romance: '今日感情層面平穩',
  daily_career: '今日事業需謹慎',
  daily_finance: '今日財運穩定',
  daily_travel: '今日宜短程',
  daily_health: '今日宜留意筋骨',
  daily_advice: { canTry: ['整理桌面'], shouldHold: ['重大決定延後'] },
};

const VALID_NARRATIVE_JSON = JSON.stringify({ sections: SAMPLE_NARRATIVE });

// Anthropic non-streaming response shape (FortuneService.runDailyAINarration uses
// client.messages.create — returns `{ content: [{ type: 'text', text }] }`).
//
// `usage` is OPTIONAL and absent by default, so the contract tests below see
// exactly the response they always did; only the #6 metering test passes one.
function buildAnthropicNonStreamingResponse(jsonText: string, usage?: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text: jsonText }],
    ...(usage && { usage }),
  };
}

// Anthropic streaming response — async iterable of content_block_delta events.
function buildAnthropicStreamingResponse(jsonText: string) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: jsonText },
      };
    },
    finalMessage: jest.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [],
      usage: { input_tokens: 100, output_tokens: 500 },
    }),
  };
}

// ============================================================
// MockResponse for SSE (copied minimal version from fortune-stream.service.spec.ts)
// ============================================================
class MockResponse {
  public events: Array<Record<string, unknown>> = [];
  public ended = false;
  public headers: Record<string, string> = {};
  public writableEnded = false;
  public headersSent = false;
  public flushHeadersCalled = false;
  setHeader(k: string, v: string) { this.headers[k] = v; return this; }
  flushHeaders() { this.flushHeadersCalled = true; this.headersSent = true; }
  write(chunk: string) {
    if (this.writableEnded) return false;
    const m = chunk.match(/^data: (.+)\n\n$/);
    if (m) { try { this.events.push(JSON.parse(m[1])); } catch { /* ignore */ } }
    return true;
  }
  end() { this.ended = true; this.writableEnded = true; }
  on() { return this; }
  off() { return this; }
}

// ============================================================
// Builders that hand out FRESHLY-MOCKED service instances for each path
// ============================================================

/** Builds a (FortuneService, deps) pair that runs the NON-STREAMING path. */
function buildNonStreamingPath(anthropicResponse: any) {
  const upsertCalls: any[] = [];
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue({
      id: 'user-1', clerkUserId: CLERK_ID, subscriptionTier: 'PRO',
    }) },
    birthProfile: { findFirst: jest.fn().mockResolvedValue(buildMockProfile()) },
    dailyFortuneSnapshot: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation((args: any) => {
        upsertCalls.push(args);
        // Returns a valid Date object for generatedAt so buildResponse doesn't blow up
        return Promise.resolve({
          id: 'persist-1',
          ...args.create,
          generatedAt: new Date('2026-05-14T03:00:00Z'),
        });
      }),
    },
  };
  const redis: any = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const config: any = { get: jest.fn().mockImplementation((k: string) => {
    if (k === 'BAZI_ENGINE_URL') return 'http://localhost:5001';
    if (k === 'ANTHROPIC_API_KEY') return 'sk-test';
    if (k === 'CLAUDE_MODEL') return 'claude-sonnet-4-5';
    return null;
  }) };
  const helpers = new FortuneSnapshotHelpers(prisma, redis, config);
  const validators = new FortuneValidatorsService();
  const service = new FortuneService(prisma, helpers, validators, { record: jest.fn(), recordFailure: jest.fn(), assertUnderCap: jest.fn(), estimateCostUsd: jest.fn(() => 0.01) } as never, { run: (_p: unknown, _c: unknown, fn: () => unknown) => fn(), acquire: async () => () => undefined, runGenerator: (_p: unknown, _c: unknown, g: () => unknown) => g(), snapshot: () => ({}) } as never, { consume: jest.fn(), peek: jest.fn(), limitFor: () => 100 } as never);

  // Stub deterministic helpers
  jest.spyOn(helpers, 'enforceSubscriptionGate').mockImplementation(() => undefined);
  jest.spyOn(helpers, 'computeChartHash').mockReturnValue('a'.repeat(32));
  jest.spyOn(helpers, 'fetchDailyFromEngine').mockResolvedValue(buildDailyOutput());
  jest.spyOn(helpers, 'ensureClaudeClient').mockResolvedValue({
    messages: {
      create: jest.fn().mockResolvedValue(anthropicResponse),
    },
  });
  return { service, helpers, redis, upsertCalls };
}

/** Builds a (FortuneStreamService, deps) pair that runs the SSE path. */
function buildStreamingPath(anthropicStreamResponse: any) {
  const upsertCalls: any[] = [];
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue({
      id: 'user-1', clerkUserId: CLERK_ID, subscriptionTier: 'PRO',
    }) },
    birthProfile: { findFirst: jest.fn().mockResolvedValue(buildMockProfile()) },
    dailyFortuneSnapshot: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation((args: any) => {
        upsertCalls.push(args);
        return Promise.resolve({
          id: 'persist-stream-1',
          ...args.create,
          generatedAt: new Date('2026-05-14T03:00:00Z'),
        });
      }),
    },
  };
  const redis: any = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const config: any = { get: jest.fn().mockImplementation((k: string) => {
    if (k === 'BAZI_ENGINE_URL') return 'http://localhost:5001';
    if (k === 'ANTHROPIC_API_KEY') return 'sk-test';
    if (k === 'CLAUDE_MODEL') return 'claude-sonnet-4-5';
    return null;
  }) };
  const helpers = new FortuneSnapshotHelpers(prisma, redis, config);
  const validators = new FortuneValidatorsService();
  const service = new FortuneStreamService(prisma, helpers, validators, { record: jest.fn(), recordFailure: jest.fn(), assertUnderCap: jest.fn(), estimateCostUsd: jest.fn(() => 0.01) } as never, { run: (_p: unknown, _c: unknown, fn: () => unknown) => fn(), acquire: async () => () => undefined, runGenerator: (_p: unknown, _c: unknown, g: () => unknown) => g(), snapshot: () => ({}) } as never, { consume: jest.fn(), peek: jest.fn(), limitFor: () => 100 } as never, new ShutdownService());

  jest.spyOn(helpers, 'enforceSubscriptionGate').mockImplementation(() => undefined);
  jest.spyOn(helpers, 'computeChartHash').mockReturnValue('a'.repeat(32));
  jest.spyOn(helpers, 'fetchDailyFromEngine').mockResolvedValue(buildDailyOutput());
  jest.spyOn(helpers, 'ensureClaudeClient').mockResolvedValue({
    messages: {
      stream: jest.fn().mockReturnValue(anthropicStreamResponse),
    },
  });
  return { service, helpers, redis, upsertCalls };
}

/** Strip non-deterministic fields per plan v2 follow-up #1 equality scope. */
function projectComparable(persistArgs: any) {
  return {
    where: persistArgs.where,
    create: {
      chartHash: persistArgs.create.chartHash,
      birthProfileId: persistArgs.create.birthProfileId,
      scope: persistArgs.create.scope,
      anchorDate: persistArgs.create.anchorDate,
      engineOutputJson: persistArgs.create.engineOutputJson,
      // aiNarrativeJson EXCLUDED — Anthropic varies per call
      // generatedAt EXCLUDED — `new Date()` at upsert time
      energyScore: persistArgs.create.energyScore,
      auspiciousnessLabel: persistArgs.create.auspiciousnessLabel,
      preAnalysisVersion: persistArgs.create.preAnalysisVersion,
      promptVersion: persistArgs.create.promptVersion,
      aiFailureCount: persistArgs.create.aiFailureCount,
      aiLastFailedAt: persistArgs.create.aiLastFailedAt,
    },
    update: {
      // Same exclusions for update path
      engineOutputJson: persistArgs.update.engineOutputJson,
      energyScore: persistArgs.update.energyScore,
      auspiciousnessLabel: persistArgs.update.auspiciousnessLabel,
      preAnalysisVersion: persistArgs.update.preAnalysisVersion,
      promptVersion: persistArgs.update.promptVersion,
    },
  };
}

// ============================================================
// Contract assertions
// ============================================================

describe('FortuneService + FortuneStreamService contract', () => {
  it('produces byte-identical snapshot upsert args (excluding non-deterministic fields)', async () => {
    const ns = buildNonStreamingPath(
      buildAnthropicNonStreamingResponse(VALID_NARRATIVE_JSON),
    );
    await ns.service.getDailyFortune(CLERK_ID, {
      profileId: PROFILE_ID,
      date: TARGET_DATE,
    });
    expect(ns.upsertCalls).toHaveLength(1);

    const stream = buildStreamingPath(
      buildAnthropicStreamingResponse(VALID_NARRATIVE_JSON),
    );
    await stream.service.streamDailyFortune(
      CLERK_ID,
      { profileId: PROFILE_ID, date: TARGET_DATE },
      new MockResponse() as any,
    );
    expect(stream.upsertCalls).toHaveLength(1);

    const nsProjected = projectComparable(ns.upsertCalls[0]);
    const streamProjected = projectComparable(stream.upsertCalls[0]);

    // All cache-invariant fields must match exactly
    expect(streamProjected).toEqual(nsProjected);
  });

  it('both paths warm Redis with the same key', async () => {
    const ns = buildNonStreamingPath(
      buildAnthropicNonStreamingResponse(VALID_NARRATIVE_JSON),
    );
    await ns.service.getDailyFortune(CLERK_ID, {
      profileId: PROFILE_ID,
      date: TARGET_DATE,
    });

    const stream = buildStreamingPath(
      buildAnthropicStreamingResponse(VALID_NARRATIVE_JSON),
    );
    await stream.service.streamDailyFortune(
      CLERK_ID,
      { profileId: PROFILE_ID, date: TARGET_DATE },
      new MockResponse() as any,
    );

    expect(ns.redis.set).toHaveBeenCalledTimes(1);
    expect(stream.redis.set).toHaveBeenCalledTimes(1);
    expect(ns.redis.set.mock.calls[0][0]).toBe(stream.redis.set.mock.calls[0][0]);
    // Same Redis key shape: `fortune:daily:{chartHash}:{date}`
    expect(ns.redis.set.mock.calls[0][0]).toBe(
      `fortune:daily:${'a'.repeat(32)}:${TARGET_DATE}`,
    );
  });

  it('both paths set promptVersion to FORTUNE_PROMPT_VERSIONS.day on success', async () => {
    const ns = buildNonStreamingPath(
      buildAnthropicNonStreamingResponse(VALID_NARRATIVE_JSON),
    );
    await ns.service.getDailyFortune(CLERK_ID, {
      profileId: PROFILE_ID,
      date: TARGET_DATE,
    });

    const stream = buildStreamingPath(
      buildAnthropicStreamingResponse(VALID_NARRATIVE_JSON),
    );
    await stream.service.streamDailyFortune(
      CLERK_ID,
      { profileId: PROFILE_ID, date: TARGET_DATE },
      new MockResponse() as any,
    );

    expect(ns.upsertCalls[0].create.promptVersion).toBe(FORTUNE_PROMPT_VERSIONS.day);
    expect(stream.upsertCalls[0].create.promptVersion).toBe(FORTUNE_PROMPT_VERSIONS.day);
  });

  it('both paths use the same preAnalysisVersion', async () => {
    const ns = buildNonStreamingPath(
      buildAnthropicNonStreamingResponse(VALID_NARRATIVE_JSON),
    );
    await ns.service.getDailyFortune(CLERK_ID, {
      profileId: PROFILE_ID,
      date: TARGET_DATE,
    });

    const stream = buildStreamingPath(
      buildAnthropicStreamingResponse(VALID_NARRATIVE_JSON),
    );
    await stream.service.streamDailyFortune(
      CLERK_ID,
      { profileId: PROFILE_ID, date: TARGET_DATE },
      new MockResponse() as any,
    );

    expect(ns.upsertCalls[0].create.preAnalysisVersion).toEqual(
      stream.upsertCalls[0].create.preAnalysisVersion,
    );
  });

  it('both paths emit the same circuit-breaker state on success (counter=0, lastFailed=null)', async () => {
    const ns = buildNonStreamingPath(
      buildAnthropicNonStreamingResponse(VALID_NARRATIVE_JSON),
    );
    await ns.service.getDailyFortune(CLERK_ID, {
      profileId: PROFILE_ID,
      date: TARGET_DATE,
    });

    const stream = buildStreamingPath(
      buildAnthropicStreamingResponse(VALID_NARRATIVE_JSON),
    );
    await stream.service.streamDailyFortune(
      CLERK_ID,
      { profileId: PROFILE_ID, date: TARGET_DATE },
      new MockResponse() as any,
    );

    expect(ns.upsertCalls[0].create.aiFailureCount).toBe(0);
    expect(ns.upsertCalls[0].create.aiLastFailedAt).toBeNull();
    expect(stream.upsertCalls[0].create.aiFailureCount).toBe(0);
    expect(stream.upsertCalls[0].create.aiLastFailedAt).toBeNull();
  });
});

describe('#6 — non-streaming fortune meters the cache counters through the shared reader', () => {
  it('passes the response\'s cache counters AND the 5-minute part of the split to the spend record', async () => {
    // Pairwise-distinct values and a MIXED split (200 of 300 at 5m), so this
    // one case tells "reads the split" from "defaults it to 0" and from
    // "copies the total" — and a neighbour-filled field cannot pass.
    const ns = buildNonStreamingPath(
      buildAnthropicNonStreamingResponse(VALID_NARRATIVE_JSON, {
        input_tokens: 1200,
        output_tokens: 400,
        cache_read_input_tokens: 700,
        cache_creation_input_tokens: 300,
        cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 100 },
      }),
    );
    await ns.service.getDailyFortune(CLERK_ID, { profileId: PROFILE_ID, date: TARGET_DATE });

    // `record` fires before the narrative is parsed, so no parse outcome can mask this.
    const record = (ns.service as unknown as { aiSpend: { record: jest.Mock } }).aiSpend.record;
    const spend = record.mock.calls
      .map((c) => c[0] as { context: string; usage: unknown })
      .filter((a) => a.context === 'fortune:daily');
    expect(spend).toHaveLength(1);
    expect(spend[0].usage).toEqual({
      inputTokens: 1200,
      outputTokens: 400,
      cacheReadTokens: 700,
      cacheWriteTokens: 300,
      cacheWrite5mTokens: 200,
    });
  });
});
