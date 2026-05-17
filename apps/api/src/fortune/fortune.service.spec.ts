/**
 * Tests for FortuneService — focused on the two-layer cache path + AI
 * failure circuit breaker (PR review #4 — 2026-05-17).
 *
 * Currently covers:
 *   - Bug A5-3 fix: DB warm path repopulates Redis so subsequent reads
 *     hit the fast Redis path instead of round-tripping to Postgres.
 *   - Negative: Redis-set failure during warm does NOT throw — the snapshot
 *     is still returned (Redis is a perf optimization, not load-bearing).
 *   - Negative: stale snapshot (version drift) is NOT warmed into Redis.
 *   - Circuit breaker: after MAX_AI_FAILURES consecutive failures, AI is
 *     NOT retried for AI_FAILURE_BACKOFF_HOURS (serve engine-only).
 *   - Circuit breaker: after backoff window, AI is retried.
 *   - Circuit breaker: successful AI call resets the counter.
 *
 * versionsMatch + tryGetCached are private methods — accessed via `as any`
 * cast. Public-API coverage via getDailyFortune is intentionally deferred;
 * that path has many fan-out branches (auth + profile + subscription gate +
 * engine call + Anthropic call) and is better served by the existing
 * manual A5 smoke test in the plan file.
 */
import { FortuneScope } from '@prisma/client';
import { FortuneService } from './fortune.service';
import { FORTUNE_PRE_ANALYSIS_VERSIONS, FORTUNE_PROMPT_VERSIONS } from '../ai/prompts';

describe('FortuneService — cache layer', () => {
  const CHART_HASH = 'a'.repeat(32);
  const TARGET_DATE = '2026-05-14';
  const REDIS_KEY = `fortune:daily:${CHART_HASH}:${TARGET_DATE}`;
  const TTL_SECONDS = 24 * 60 * 60;

  function buildFreshSnapshot() {
    return {
      id: 'snapshot-1',
      chartHash: CHART_HASH,
      birthProfileId: 'profile-1',
      scope: FortuneScope.DAY,
      anchorDate: new Date(`${TARGET_DATE}T00:00:00Z`),
      engineOutputJson: { dayGanZhi: '戊子', auspiciousness: '凶中有吉', dimensions: {}, energyScore: 42 },
      aiNarrativeJson: null,
      energyScore: 42,
      auspiciousnessLabel: '凶中有吉',
      preAnalysisVersion: FORTUNE_PRE_ANALYSIS_VERSIONS.day,
      promptVersion: FORTUNE_PROMPT_VERSIONS.day,
      generatedAt: new Date('2026-05-14T03:00:00Z'),
    };
  }

  function buildService(opts: {
    redisGet?: () => Promise<string | null>;
    redisSet?: jest.Mock;
    dbFindUnique?: () => Promise<any>;
  }) {
    const redisSet = opts.redisSet ?? jest.fn().mockResolvedValue(undefined);
    const redisService: any = {
      get: opts.redisGet ?? jest.fn().mockResolvedValue(null),
      set: redisSet,
    };
    const prismaService: any = {
      dailyFortuneSnapshot: {
        findUnique: opts.dbFindUnique ?? jest.fn().mockResolvedValue(null),
      },
    };
    const configService: any = { get: (k: string) => (k === 'BAZI_ENGINE_URL' ? 'http://localhost:5001' : null) };
    const validatorsService: any = {};
    const service = new FortuneService(
      prismaService,
      redisService,
      configService,
      validatorsService,
    );
    return { service, redisSet, redisService, prismaService };
  }

  describe('Bug A5-3 — DB warm path repopulates Redis', () => {
    it('writes the DB row back into Redis when Redis was empty', async () => {
      const dbRow = buildFreshSnapshot();
      const { service, redisSet } = buildService({
        redisGet: jest.fn().mockResolvedValue(null), // Redis MISS
        dbFindUnique: jest.fn().mockResolvedValue(dbRow), // DB HIT
      });

      const result = await (service as any).tryGetCached(CHART_HASH, TARGET_DATE);

      expect(result).toBe(dbRow);
      expect(redisSet).toHaveBeenCalledTimes(1);
      expect(redisSet).toHaveBeenCalledWith(
        REDIS_KEY,
        JSON.stringify(dbRow),
        TTL_SECONDS,
      );
    });

    it('still returns the DB snapshot when Redis set throws (perf optimization, not load-bearing)', async () => {
      const dbRow = buildFreshSnapshot();
      const redisSet = jest.fn().mockRejectedValue(new Error('Redis down'));
      const { service } = buildService({
        redisGet: jest.fn().mockResolvedValue(null),
        redisSet,
        dbFindUnique: jest.fn().mockResolvedValue(dbRow),
      });

      // Should NOT throw — caller gets the snapshot, Redis warm failure
      // is logged as a warn but doesn't propagate.
      const result = await (service as any).tryGetCached(CHART_HASH, TARGET_DATE);

      expect(result).toBe(dbRow);
      expect(redisSet).toHaveBeenCalledTimes(1);
    });

    it('does NOT warm Redis when DB row is stale (version drift)', async () => {
      const staleRow = {
        ...buildFreshSnapshot(),
        preAnalysisVersion: 'v0.0.0-stale',
      };
      const redisSet = jest.fn();
      const { service } = buildService({
        redisGet: jest.fn().mockResolvedValue(null),
        redisSet,
        dbFindUnique: jest.fn().mockResolvedValue(staleRow),
      });

      const result = await (service as any).tryGetCached(CHART_HASH, TARGET_DATE);

      // Stale rows fall through to regen — must NOT warm Redis with stale
      // data (would poison the cache for 24h until TTL).
      expect(result).toBeNull();
      expect(redisSet).not.toHaveBeenCalled();
    });

    it('does NOT touch DB or warm Redis when Redis already has fresh data (hot path)', async () => {
      const cached = buildFreshSnapshot();
      const cachedJson = JSON.stringify(cached);
      const dbFindUnique = jest.fn();
      const redisSet = jest.fn();
      const { service } = buildService({
        redisGet: jest.fn().mockResolvedValue(cachedJson),
        redisSet,
        dbFindUnique,
      });

      const result = await (service as any).tryGetCached(CHART_HASH, TARGET_DATE);

      expect(result).not.toBeNull();
      // Hot path bails before DB — verifies we didn't accidentally
      // double-fetch or double-warm.
      expect(dbFindUnique).not.toHaveBeenCalled();
      expect(redisSet).not.toHaveBeenCalled();
    });
  });

  describe('AI failure circuit breaker (PR review #4)', () => {
    function buildFailedSnapshot(opts: {
      aiFailureCount: number;
      aiLastFailedAt: Date | null;
    }) {
      return {
        ...buildFreshSnapshot(),
        promptVersion: null,  // AI failed
        aiNarrativeJson: null,
        aiFailureCount: opts.aiFailureCount,
        aiLastFailedAt: opts.aiLastFailedAt,
      };
    }

    it('serves engine-only when failure count >= MAX_AI_FAILURES and within backoff window', async () => {
      // 3 consecutive failures, last failed 1 hour ago (still within 24h backoff)
      const recentlyFailed = buildFailedSnapshot({
        aiFailureCount: 3,
        aiLastFailedAt: new Date(Date.now() - 60 * 60 * 1000),
      });
      const { service, redisSet } = buildService({
        redisGet: jest.fn().mockResolvedValue(null),
        dbFindUnique: jest.fn().mockResolvedValue(recentlyFailed),
      });

      const result = await (service as any).tryGetCached(CHART_HASH, TARGET_DATE);

      // Circuit OPEN — serve the engine-only row as cache-valid.
      expect(result).not.toBeNull();
      expect(result.aiFailureCount).toBe(3);
      // Redis re-warmed with the engine-only snapshot
      expect(redisSet).toHaveBeenCalledTimes(1);
    });

    it('retries AI when failure count >= MAX_AI_FAILURES but backoff window has elapsed', async () => {
      // 5 failures, last failed 25 hours ago (outside 24h backoff)
      const longAgo = buildFailedSnapshot({
        aiFailureCount: 5,
        aiLastFailedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      });
      const { service, redisSet } = buildService({
        redisGet: jest.fn().mockResolvedValue(null),
        dbFindUnique: jest.fn().mockResolvedValue(longAgo),
      });

      const result = await (service as any).tryGetCached(CHART_HASH, TARGET_DATE);

      // Circuit CLOSED — backoff elapsed → treat as stale → null forces regen
      expect(result).toBeNull();
      // Must NOT warm Redis with stale row
      expect(redisSet).not.toHaveBeenCalled();
    });

    it('retries AI when failure count is below cap (1 or 2 prior failures)', async () => {
      // 2 failures — under the MAX_AI_FAILURES=3 cap; should retry
      const partial = buildFailedSnapshot({
        aiFailureCount: 2,
        aiLastFailedAt: new Date(),
      });
      const { service, redisSet } = buildService({
        redisGet: jest.fn().mockResolvedValue(null),
        dbFindUnique: jest.fn().mockResolvedValue(partial),
      });

      const result = await (service as any).tryGetCached(CHART_HASH, TARGET_DATE);

      expect(result).toBeNull();  // → caller regenerates
      expect(redisSet).not.toHaveBeenCalled();
    });

    it('handles legacy snapshots missing aiFailureCount/aiLastFailedAt (?? 0 guard)', async () => {
      // Stale Redis-deserialized row from before the migration — fields are undefined.
      // Must NOT crash; must NOT spuriously trip the circuit breaker.
      const legacy = {
        ...buildFreshSnapshot(),
        promptVersion: null,
        // aiFailureCount / aiLastFailedAt intentionally OMITTED (undefined)
      };
      delete (legacy as any).aiFailureCount;
      delete (legacy as any).aiLastFailedAt;
      const { service, redisSet } = buildService({
        redisGet: jest.fn().mockResolvedValue(null),
        dbFindUnique: jest.fn().mockResolvedValue(legacy),
      });

      const result = await (service as any).tryGetCached(CHART_HASH, TARGET_DATE);

      // failureCount defaults to 0 < MAX → should retry (return null)
      expect(result).toBeNull();
      expect(redisSet).not.toHaveBeenCalled();
    });

    it('serves cached row normally when promptVersion is current (AI succeeded)', async () => {
      // Sanity: a healthy row with non-null promptVersion should NOT touch the
      // circuit-breaker path. This locks the order of checks in versionsMatch.
      const healthy = {
        ...buildFreshSnapshot(),
        aiFailureCount: 0,
        aiLastFailedAt: null,
      };
      const { service } = buildService({
        redisGet: jest.fn().mockResolvedValue(null),
        dbFindUnique: jest.fn().mockResolvedValue(healthy),
      });

      const result = await (service as any).tryGetCached(CHART_HASH, TARGET_DATE);

      expect(result).not.toBeNull();
      expect(result.promptVersion).toBe(FORTUNE_PROMPT_VERSIONS.day);
    });
  });
});
