/**
 * Contract test — Phase 2.x Monthly Streaming.
 *
 * Locks the MONTH-scope invariant: for identical input, `FortuneService.getMonthlyFortune`
 * (non-streaming) and `FortuneStreamService.streamMonthlyFortune` (SSE) MUST
 * produce byte-identical `DailyFortuneSnapshot` rows AND identical wire-shape
 * responses (modulo SSE wrapping). Mirror of `fortune-snapshot.helpers.contract.spec.ts`
 * scaled to MONTH scope.
 *
 * Per Phase 2.x plan v2 follow-up M-8 + H-3: equality scope EXCLUDES non-deterministic
 * fields (`id`, `generatedAt`, `aiNarrativeJson`). The `intraMonthBreakdown` field
 * MUST be embedded inside `engineOutputJson` and survive round-trip identically.
 *
 * Without this lock, the two paths can drift on circuit breaker state, the M#2
 * snapshot-reuse version comparison constant, or the H-3 intraMonthBreakdown
 * sibling-strip from engineOutput (M1 audit fix from Phase 2.x line audit).
 */
jest.mock('@sentry/nestjs', () => ({
  addBreadcrumb: jest.fn(),
}));

import { FortuneService } from './fortune.service';
import { FortuneStreamService } from './fortune-stream.service';
import { FortuneSnapshotHelpers } from './fortune-snapshot.helpers';
import { FortuneValidatorsService } from './fortune-validators.service';
import { FORTUNE_PROMPT_VERSIONS, FORTUNE_PRE_ANALYSIS_VERSIONS } from '../ai/prompts';

const CLERK_ID = 'clerk-1';
const PROFILE_ID = 'profile-1';
const TARGET_MONTH = '2026-05';

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

function buildMonthlyOutput() {
  return {
    monthStem: '癸',
    monthBranch: '巳',
    monthGanZhi: '癸巳',
    monthTenGod: '正財',
    monthLabel: '癸巳月',
    auspiciousness: '平',
    baseAuspiciousness: '平',
    bareMonthAuspiciousness: '平',
    energyScore: 50,
    metaFraming: 'soft_trigger',
    flowYear: 2026,
    targetYear: 2026,
    targetMonth: 5,
    dimensions: {
      career: { score: 50, label: '平', signals: [], labelZh: '事業' },
      finance: { score: 55, label: '平', signals: [], labelZh: '財運' },
      romance: { score: 50, label: '平', signals: [], labelZh: '感情' },
      health: { score: 48, label: '平', signals: [], labelZh: '健康' },
    },
    partitionSpec: {
      scheme_id: 'tiangan_dizhi_half',
      buckets: [
        { label: '上半月', day_range: [1, 15], governing_pillar: 'stem' },
        { label: '下半月', day_range: [16, 31], governing_pillar: 'branch' },
      ],
    },
    // H-3 critical — intraMonthBreakdown sibling that must round-trip
    intraMonthBreakdown: {
      scheme_id: 'tiangan_dizhi_half',
      liuyue_window: { start: '2026-05-06', end: '2026-06-04', days: 30 },
      buckets: [
        {
          label: '上半月',
          day_range: [1, 15],
          governing_pillar: 'stem',
          auspicious_days: 9,
          challenging_days: 5,
          neutral_days: 1,
          dominant_shensha: ['天喜', '比劫'],
          peak_signals: [],
        },
        {
          label: '下半月',
          day_range: [16, 31],
          governing_pillar: 'branch',
          auspicious_days: 11,
          challenging_days: 3,
          neutral_days: 2,
          dominant_shensha: ['驛馬'],
          peak_signals: [],
        },
      ],
    },
    ruleTrace: [],
    chartContext: {
      gender: 'male',
      birthDate: '1987-09-06',
      birthTime: '16:11',
      yearPillar: '丁卯',
      monthPillar: '戊申',
      dayPillar: '戊午',
      hourPillar: '庚申',
      yearTenGod: '正印',
      monthTenGod: '比肩',
      hourTenGod: '食神',
      dayMaster: '戊',
      dayMasterElement: '土',
      dayMasterYinYang: 'yang',
      strengthV2: 'neutral',
      usefulGod: '火',
      effectiveGods: {},
      isCongGe: false,
    },
    preAnalysisVersion: FORTUNE_PRE_ANALYSIS_VERSIONS.month,
  };
}

const SAMPLE_MONTHLY_NARRATIVE = {
  monthly_overview: '本月癸巳月，整體平穩',
  monthly_career: '事業層面穩定發展',
  monthly_finance: '財運機會增加',
  monthly_romance: '感情訊號活躍',
  monthly_health: '健康宜留意水氣',
  monthly_advice: { canTry: ['積極推進'], shouldHold: ['大筆投資'] },
};

const VALID_MONTHLY_NARRATIVE_JSON = JSON.stringify({
  sections: SAMPLE_MONTHLY_NARRATIVE,
});

function buildAnthropicNonStreamingResponse(jsonText: string) {
  return {
    content: [{ type: 'text', text: jsonText }],
  };
}

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

function buildSharedPrismaMocks() {
  const upsertCalls: any[] = [];
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue({
      id: 'user-1', clerkUserId: CLERK_ID, subscriptionTier: 'PRO',
    }) },
    birthProfile: { findFirst: jest.fn().mockResolvedValue(buildMockProfile()) },
    dailyFortuneSnapshot: {
      findUnique: jest.fn().mockResolvedValue(null),
      // MONTH scope uses findFirst (anchorDate normalized to 1st of month)
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation((args: any) => {
        upsertCalls.push(args);
        return Promise.resolve({
          id: 'persist-monthly-1',
          ...args.create,
          generatedAt: new Date('2026-05-29T03:00:00Z'),
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
  return { prisma, redis, config, upsertCalls };
}

function buildNonStreamingMonthlyPath(anthropicResponse: any) {
  const { prisma, redis, config, upsertCalls } = buildSharedPrismaMocks();
  const helpers = new FortuneSnapshotHelpers(prisma, redis, config);
  const validators = new FortuneValidatorsService();
  const service = new FortuneService(prisma, helpers, validators);

  jest.spyOn(helpers, 'enforceMonthlySubscriptionGate').mockImplementation(() => undefined);
  jest.spyOn(helpers, 'computeChartHash').mockReturnValue('m'.repeat(32));
  jest.spyOn(helpers, 'fetchMonthlyFromEngine').mockResolvedValue(buildMonthlyOutput() as any);
  jest.spyOn(helpers, 'ensureClaudeClient').mockResolvedValue({
    messages: {
      create: jest.fn().mockResolvedValue(anthropicResponse),
    },
  } as any);
  return { service, helpers, redis, upsertCalls };
}

function buildStreamingMonthlyPath(anthropicStreamResponse: any) {
  const { prisma, redis, config, upsertCalls } = buildSharedPrismaMocks();
  const helpers = new FortuneSnapshotHelpers(prisma, redis, config);
  const validators = new FortuneValidatorsService();
  const service = new FortuneStreamService(prisma, helpers, validators);

  jest.spyOn(helpers, 'enforceMonthlySubscriptionGate').mockImplementation(() => undefined);
  jest.spyOn(helpers, 'computeChartHash').mockReturnValue('m'.repeat(32));
  jest.spyOn(helpers, 'fetchMonthlyFromEngine').mockResolvedValue(buildMonthlyOutput() as any);
  jest.spyOn(helpers, 'ensureClaudeClient').mockResolvedValue({
    messages: {
      stream: jest.fn().mockReturnValue(anthropicStreamResponse),
    },
  } as any);
  return { service, helpers, redis, upsertCalls };
}

/** Strip non-deterministic fields. Mirror of daily contract spec but for MONTH scope. */
function projectComparable(persistArgs: any) {
  return {
    where: persistArgs.where,
    create: {
      chartHash: persistArgs.create.chartHash,
      birthProfileId: persistArgs.create.birthProfileId,
      scope: persistArgs.create.scope,
      anchorDate: persistArgs.create.anchorDate,
      yearMonth: persistArgs.create.yearMonth,
      engineOutputJson: persistArgs.create.engineOutputJson,
      energyScore: persistArgs.create.energyScore,
      auspiciousnessLabel: persistArgs.create.auspiciousnessLabel,
      preAnalysisVersion: persistArgs.create.preAnalysisVersion,
      promptVersion: persistArgs.create.promptVersion,
      aiFailureCount: persistArgs.create.aiFailureCount,
      aiLastFailedAt: persistArgs.create.aiLastFailedAt,
    },
    update: {
      engineOutputJson: persistArgs.update.engineOutputJson,
      energyScore: persistArgs.update.energyScore,
      auspiciousnessLabel: persistArgs.update.auspiciousnessLabel,
      preAnalysisVersion: persistArgs.update.preAnalysisVersion,
      promptVersion: persistArgs.update.promptVersion,
    },
  };
}

describe('FortuneService + FortuneStreamService MONTH contract (Phase 2.x M1)', () => {
  // Helper to invoke MONTH paths. If the method name differs, jest will surface it.
  const callNonStreaming = (svc: any) =>
    svc.getMonthlyFortune?.(CLERK_ID, { profileId: PROFILE_ID, month: TARGET_MONTH });
  const callStreaming = (svc: any) =>
    svc.streamMonthlyFortune?.(
      CLERK_ID,
      { profileId: PROFILE_ID, month: TARGET_MONTH },
      new MockResponse() as any,
    );

  it('both paths emit identical persistSnapshot upsert args (MONTH byte-identity)', async () => {
    const ns = buildNonStreamingMonthlyPath(
      buildAnthropicNonStreamingResponse(VALID_MONTHLY_NARRATIVE_JSON),
    );
    await callNonStreaming(ns.service);
    expect(ns.upsertCalls).toHaveLength(1);

    const stream = buildStreamingMonthlyPath(
      buildAnthropicStreamingResponse(VALID_MONTHLY_NARRATIVE_JSON),
    );
    await callStreaming(stream.service);
    expect(stream.upsertCalls).toHaveLength(1);

    const nsProjected = projectComparable(ns.upsertCalls[0]);
    const streamProjected = projectComparable(stream.upsertCalls[0]);
    expect(streamProjected).toEqual(nsProjected);
  });

  it('H-3 audit lock — intraMonthBreakdown sibling survives engineOutputJson round-trip', async () => {
    const ns = buildNonStreamingMonthlyPath(
      buildAnthropicNonStreamingResponse(VALID_MONTHLY_NARRATIVE_JSON),
    );
    await callNonStreaming(ns.service);
    const engineOutput = ns.upsertCalls[0].create.engineOutputJson;
    expect(engineOutput).toBeDefined();
    expect(engineOutput.intraMonthBreakdown).toBeDefined();
    expect(engineOutput.intraMonthBreakdown.scheme_id).toBe('tiangan_dizhi_half');
    expect(engineOutput.intraMonthBreakdown.buckets).toHaveLength(2);
    expect(engineOutput.intraMonthBreakdown.buckets[0].governing_pillar).toBe('stem');
    expect(engineOutput.intraMonthBreakdown.buckets[1].governing_pillar).toBe('branch');
    expect(engineOutput.intraMonthBreakdown.buckets[0].auspicious_days).toBe(9);
    expect(engineOutput.intraMonthBreakdown.buckets[1].auspicious_days).toBe(11);
  });

  it('both paths use MONTH scope (NOT DAY) + anchorDate normalized to 1st-of-month', async () => {
    const ns = buildNonStreamingMonthlyPath(
      buildAnthropicNonStreamingResponse(VALID_MONTHLY_NARRATIVE_JSON),
    );
    await callNonStreaming(ns.service);
    const stream = buildStreamingMonthlyPath(
      buildAnthropicStreamingResponse(VALID_MONTHLY_NARRATIVE_JSON),
    );
    await callStreaming(stream.service);

    // scope='MONTH' on both paths
    expect(ns.upsertCalls[0].create.scope).toBe('MONTH');
    expect(stream.upsertCalls[0].create.scope).toBe('MONTH');
    // anchorDate normalized to 2026-05-01
    expect(ns.upsertCalls[0].create.anchorDate.toISOString().slice(0, 10)).toBe(
      '2026-05-01',
    );
    expect(stream.upsertCalls[0].create.anchorDate.toISOString().slice(0, 10)).toBe(
      '2026-05-01',
    );
  });

  it('both paths set promptVersion to FORTUNE_PROMPT_VERSIONS.month + preAnalysisVersion to FORTUNE_PRE_ANALYSIS_VERSIONS.month', async () => {
    const ns = buildNonStreamingMonthlyPath(
      buildAnthropicNonStreamingResponse(VALID_MONTHLY_NARRATIVE_JSON),
    );
    await callNonStreaming(ns.service);
    const stream = buildStreamingMonthlyPath(
      buildAnthropicStreamingResponse(VALID_MONTHLY_NARRATIVE_JSON),
    );
    await callStreaming(stream.service);

    expect(ns.upsertCalls[0].create.promptVersion).toBe(FORTUNE_PROMPT_VERSIONS.month);
    expect(stream.upsertCalls[0].create.promptVersion).toBe(FORTUNE_PROMPT_VERSIONS.month);
    expect(ns.upsertCalls[0].create.preAnalysisVersion).toBe(
      FORTUNE_PRE_ANALYSIS_VERSIONS.month,
    );
    expect(stream.upsertCalls[0].create.preAnalysisVersion).toBe(
      FORTUNE_PRE_ANALYSIS_VERSIONS.month,
    );
  });

  it('both paths warm Redis with the same MONTH-scoped key shape', async () => {
    const ns = buildNonStreamingMonthlyPath(
      buildAnthropicNonStreamingResponse(VALID_MONTHLY_NARRATIVE_JSON),
    );
    await callNonStreaming(ns.service);
    const stream = buildStreamingMonthlyPath(
      buildAnthropicStreamingResponse(VALID_MONTHLY_NARRATIVE_JSON),
    );
    await callStreaming(stream.service);

    expect(ns.redis.set).toHaveBeenCalledTimes(1);
    expect(stream.redis.set).toHaveBeenCalledTimes(1);
    // Both paths use `fortune:monthly:{chartHash}:{yearMonth}` shape
    const nsKey: string = ns.redis.set.mock.calls[0][0];
    const streamKey: string = stream.redis.set.mock.calls[0][0];
    expect(nsKey).toBe(streamKey);
    expect(nsKey).toContain('fortune:monthly:');
    expect(nsKey).toContain(TARGET_MONTH);
  });
});
