/**
 * Tests for FortuneService — focused on the two-layer cache path + AI
 * failure circuit breaker (PR review #4 — 2026-05-17).
 *
 * Phase Fortune Streaming Layer 3 (2026-05-28): the cache + persistence
 * helpers moved to `FortuneSnapshotHelpers` (extracted so the new
 * `FortuneStreamService` shares the same invariants). This spec now
 * constructs a real `FortuneSnapshotHelpers` against the same mocked
 * Prisma / Redis / Config, injects it into `FortuneService`, and exercises
 * the helpers via that path. `helpers.tryGetCached` / `helpers.persistSnapshot`
 * are public methods (no `as any` cast needed); `getDailyFortune` covers
 * the full-stack orchestration.
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
 *   - engineOnly path: skips AI + persist + warm.
 */
import { FortuneScope } from '@prisma/client';
import { FortuneService } from './fortune.service';
import { FortuneSnapshotHelpers } from './fortune-snapshot.helpers';
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
    dbUpsert?: jest.Mock;
  }) {
    const redisSet = opts.redisSet ?? jest.fn().mockResolvedValue(undefined);
    const dbUpsert = opts.dbUpsert ?? jest.fn().mockImplementation((args: any) => Promise.resolve({
      id: 'persist-1',
      ...args.create,
      generatedAt: new Date(),
    }));
    const redisService: any = {
      get: opts.redisGet ?? jest.fn().mockResolvedValue(null),
      set: redisSet,
    };
    const prismaService: any = {
      dailyFortuneSnapshot: {
        findUnique: opts.dbFindUnique ?? jest.fn().mockResolvedValue(null),
        upsert: dbUpsert,
      },
    };
    const configService: any = { get: (k: string) => (k === 'BAZI_ENGINE_URL' ? 'http://localhost:5001' : null) };
    const validatorsService: any = {};
    const helpers = new FortuneSnapshotHelpers(prismaService, redisService, configService);
    const service = new FortuneService(prismaService, helpers, validatorsService);
    return { service, helpers, redisSet, dbUpsert, redisService, prismaService };
  }

  /** Minimal valid engine output for `persistSnapshot` calls. */
  function buildDailyOutput() {
    return {
      dayGanZhi: '戊子',
      auspiciousness: '凶中有吉',
      dimensions: {},
      energyScore: 42,
    } as any;
  }

  describe('Bug A5-3 — DB warm path repopulates Redis', () => {
    it('writes the DB row back into Redis when Redis was empty', async () => {
      const dbRow = buildFreshSnapshot();
      const { helpers, redisSet } = buildService({
        redisGet: jest.fn().mockResolvedValue(null), // Redis MISS
        dbFindUnique: jest.fn().mockResolvedValue(dbRow), // DB HIT
      });

      const result = await helpers.tryGetCached(CHART_HASH, TARGET_DATE);

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
      const { helpers } = buildService({
        redisGet: jest.fn().mockResolvedValue(null),
        redisSet,
        dbFindUnique: jest.fn().mockResolvedValue(dbRow),
      });

      // Should NOT throw — caller gets the snapshot, Redis warm failure
      // is logged as a warn but doesn't propagate.
      const result = await helpers.tryGetCached(CHART_HASH, TARGET_DATE);

      expect(result).toBe(dbRow);
      expect(redisSet).toHaveBeenCalledTimes(1);
    });

    it('does NOT warm Redis when DB row is stale (version drift)', async () => {
      const staleRow = {
        ...buildFreshSnapshot(),
        preAnalysisVersion: 'v0.0.0-stale',
      };
      const redisSet = jest.fn();
      const { helpers } = buildService({
        redisGet: jest.fn().mockResolvedValue(null),
        redisSet,
        dbFindUnique: jest.fn().mockResolvedValue(staleRow),
      });

      const result = await helpers.tryGetCached(CHART_HASH, TARGET_DATE);

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
      const { helpers } = buildService({
        redisGet: jest.fn().mockResolvedValue(cachedJson),
        redisSet,
        dbFindUnique,
      });

      const result = await helpers.tryGetCached(CHART_HASH, TARGET_DATE);

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
        promptVersion: null, // AI failed
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
      const { helpers, redisSet } = buildService({
        redisGet: jest.fn().mockResolvedValue(null),
        dbFindUnique: jest.fn().mockResolvedValue(recentlyFailed),
      });

      const result = await helpers.tryGetCached(CHART_HASH, TARGET_DATE);

      // Circuit OPEN — serve the engine-only row as cache-valid.
      expect(result).not.toBeNull();
      expect(result!.aiFailureCount).toBe(3);
      // Redis re-warmed with the engine-only snapshot
      expect(redisSet).toHaveBeenCalledTimes(1);
    });

    it('retries AI when failure count >= MAX_AI_FAILURES but backoff window has elapsed', async () => {
      // 5 failures, last failed 25 hours ago (outside 24h backoff)
      const longAgo = buildFailedSnapshot({
        aiFailureCount: 5,
        aiLastFailedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      });
      const { helpers, redisSet } = buildService({
        redisGet: jest.fn().mockResolvedValue(null),
        dbFindUnique: jest.fn().mockResolvedValue(longAgo),
      });

      const result = await helpers.tryGetCached(CHART_HASH, TARGET_DATE);

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
      const { helpers, redisSet } = buildService({
        redisGet: jest.fn().mockResolvedValue(null),
        dbFindUnique: jest.fn().mockResolvedValue(partial),
      });

      const result = await helpers.tryGetCached(CHART_HASH, TARGET_DATE);

      expect(result).toBeNull(); // → caller regenerates
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
      const { helpers, redisSet } = buildService({
        redisGet: jest.fn().mockResolvedValue(null),
        dbFindUnique: jest.fn().mockResolvedValue(legacy),
      });

      const result = await helpers.tryGetCached(CHART_HASH, TARGET_DATE);

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
      const { helpers } = buildService({
        redisGet: jest.fn().mockResolvedValue(null),
        dbFindUnique: jest.fn().mockResolvedValue(healthy),
      });

      const result = await helpers.tryGetCached(CHART_HASH, TARGET_DATE);

      expect(result).not.toBeNull();
      expect(result!.promptVersion).toBe(FORTUNE_PROMPT_VERSIONS.day);
    });
  });

  /**
   * persistSnapshot — verifies the WRITE side of the circuit breaker.
   *
   * `tryGetCached` tests above cover the READ side (when to bypass AI).
   * These tests cover the inverse: how the failure counter mutates as
   * snapshots are persisted. Together they form a closed loop:
   *   persist failure → versionsMatch sees counter → bypass AI → ...
   *   persist success → versionsMatch sees counter=0 → AI runs normally
   *
   * The reset behavior was implicitly trusted in the original commit
   * (line 14 of this spec's docstring claimed coverage). Per PR #46
   * line audit follow-up, locking it with an explicit test.
   */
  describe('persistSnapshot — circuit-breaker counter mutations', () => {
    const PERSIST_ARGS = {
      chartHash: CHART_HASH,
      birthProfileId: 'profile-1',
      anchorDate: new Date(`${TARGET_DATE}T00:00:00Z`),
      dailyOutput: buildDailyOutput(),
      narrative: null as any,
    };

    it('AI success → CREATE block initializes counter to 0 and lastFailedAt to null', async () => {
      const dbUpsert = jest.fn().mockImplementation((args: any) => Promise.resolve({
        id: 'persist-1', ...args.create, generatedAt: new Date(),
      }));
      const { helpers } = buildService({ dbUpsert });
      await helpers.persistSnapshot({
        ...PERSIST_ARGS,
        promptVersion: FORTUNE_PROMPT_VERSIONS.day, // AI succeeded
      });
      expect(dbUpsert).toHaveBeenCalledTimes(1);
      const call = dbUpsert.mock.calls[0][0];
      expect(call.create.aiFailureCount).toBe(0);
      expect(call.create.aiLastFailedAt).toBeNull();
    });

    it('AI success → UPDATE block resets counter to 0 and lastFailedAt to null', async () => {
      const dbUpsert = jest.fn().mockResolvedValue({ id: 'persist-1' });
      const { helpers } = buildService({ dbUpsert });
      await helpers.persistSnapshot({
        ...PERSIST_ARGS,
        promptVersion: FORTUNE_PROMPT_VERSIONS.day,
      });
      const call = dbUpsert.mock.calls[0][0];
      // Reset path — NOT the increment path
      expect(call.update.aiFailureCount).toBe(0);
      expect(call.update.aiLastFailedAt).toBeNull();
      // Sanity: success path must be a primitive `0`, NOT a Prisma
      // `{ increment: 1 }` object — guards against accidentally inverting
      // the ternary in `persistSnapshot`.
      expect(typeof call.update.aiFailureCount).toBe('number');
    });

    it('AI failure → CREATE block sets counter=1 and lastFailedAt=now', async () => {
      const dbUpsert = jest.fn().mockImplementation((args: any) => Promise.resolve({
        id: 'persist-1', ...args.create, generatedAt: new Date(),
      }));
      const { helpers } = buildService({ dbUpsert });
      const before = Date.now();
      await helpers.persistSnapshot({
        ...PERSIST_ARGS,
        promptVersion: null, // AI failed
      });
      const call = dbUpsert.mock.calls[0][0];
      expect(call.create.aiFailureCount).toBe(1);
      expect(call.create.aiLastFailedAt).toBeInstanceOf(Date);
      const lastFailedMs = (call.create.aiLastFailedAt as Date).getTime();
      expect(lastFailedMs).toBeGreaterThanOrEqual(before);
      expect(lastFailedMs).toBeLessThanOrEqual(Date.now());
    });

    it('AI failure → UPDATE block uses Prisma atomic { increment: 1 } (NOT JS-level math)', async () => {
      const dbUpsert = jest.fn().mockResolvedValue({ id: 'persist-1' });
      const { helpers } = buildService({ dbUpsert });
      await helpers.persistSnapshot({
        ...PERSIST_ARGS,
        promptVersion: null,
      });
      const call = dbUpsert.mock.calls[0][0];
      // Critical: must be Prisma `{ increment: 1 }` object (race-safe SQL
      // `SET ai_failure_count = ai_failure_count + 1`), NOT a JS number
      // like `2` which would require a prior SELECT and lose concurrent
      // failures (see PR #46 staff-review #4).
      expect(call.update.aiFailureCount).toEqual({ increment: 1 });
      expect(call.update.aiLastFailedAt).toBeInstanceOf(Date);
    });
  });

  // ============================================================
  // Phase Fortune+ progressive loading — engineOnly path
  // ============================================================
  //
  // Verifies the new short-circuit: when getDailyFortune is called with
  // engineOnly=true, the service:
  //   1. Skips runDailyAINarration (no Anthropic call)
  //   2. Does NOT call persistSnapshot (no DB write — avoids polluting
  //      cache with narrative=null + tripping aiFailureCount circuit-breaker)
  //   3. Does NOT warm Redis (same reason)
  //   4. Still returns engine output via buildResponse (narrative=null on wire)
  //
  // Cache HIT path is independent of engineOnly — already covered by the
  // existing «Bug A5-3» suite above. When cached, full payload returns
  // regardless of engineOnly hint.

  describe('Phase Fortune+ — engineOnly path', () => {
    /** Mock Prisma user + birth profile lookups for getDailyFortune entry. */
    function buildFullStackService(opts: {
      cacheHit?: boolean;
      engineFetchOutput?: any;
    } = {}) {
      // Default upsert returns a valid snapshot so buildResponse doesn't
      // blow up on snapshot.engineOutputJson access (audit I5 throw path).
      const dbUpsert = jest.fn().mockResolvedValue(buildFreshSnapshot());
      const redisSet = jest.fn().mockResolvedValue(undefined);
      const redisGet = opts.cacheHit
        ? jest.fn().mockResolvedValue(JSON.stringify(buildFreshSnapshot()))
        : jest.fn().mockResolvedValue(null);

      const prismaService: any = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-1',
            clerkUserId: 'clerk-1',
            subscriptionTier: 'PRO',
          }),
        },
        birthProfile: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'profile-1',
            userId: 'user-1',
            birthDate: new Date('1987-09-06'),
            birthTime: '16:11',
            birthCity: '吉打',
            birthTimezone: 'Asia/Kuala_Lumpur',
            gender: 'male',
            isPrimary: true,
          }),
        },
        dailyFortuneSnapshot: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: dbUpsert,
        },
      };
      const redisService: any = { get: redisGet, set: redisSet };
      const configService: any = {
        get: (k: string) => (k === 'BAZI_ENGINE_URL' ? 'http://localhost:5001' : null),
      };
      const validatorsService: any = {
        validate: jest.fn().mockImplementation((n: any) => ({
          sanitized: n, didStrip: false, findings: [],
        })),
      };
      const helpers = new FortuneSnapshotHelpers(prismaService, redisService, configService);
      const service = new FortuneService(prismaService, helpers, validatorsService);

      // Bypass subscription gate — these tests cover the engineOnly path,
      // not subscription windowing. Test date `2026-05-14` may be outside
      // the «±1 past, +30 forward» window depending on when the test runs.
      jest
        .spyOn(helpers, 'enforceSubscriptionGate')
        .mockImplementation(() => undefined);

      // Bypass chart-hash compute — uses sha256 against profile fields; we
      // stub to a known value so cache-key lookups match buildFreshSnapshot().
      jest.spyOn(helpers, 'computeChartHash').mockReturnValue(CHART_HASH);

      // Stub engine + AI methods so we can spy without making HTTP calls.
      const engineFetch = jest
        .spyOn(helpers, 'fetchDailyFromEngine')
        .mockResolvedValue(opts.engineFetchOutput ?? {
          ...buildDailyOutput(),
          chartContext: { dayMaster: { stem: '戊' } },
        });
      const aiNarration = jest
        .spyOn(service as any, 'runDailyAINarration')
        .mockResolvedValue({
          narrative: { daily_overview: 'mock narrative' } as any,
          validation: { sanitized: { daily_overview: 'mock narrative' } } as any,
          promptVersion: FORTUNE_PROMPT_VERSIONS.day,
        });

      return { service, helpers, dbUpsert, redisSet, engineFetch, aiNarration };
    }

    it('engineOnly=true: skips AI narration entirely (no Anthropic call)', async () => {
      const { service, aiNarration } = buildFullStackService();
      await service.getDailyFortune('clerk-1', {
        date: TARGET_DATE,
        engineOnly: true,
      });
      expect(aiNarration).not.toHaveBeenCalled();
    });

    it('engineOnly=true: does NOT persist to DB (no aiFailureCount pollution)', async () => {
      const { service, dbUpsert } = buildFullStackService();
      await service.getDailyFortune('clerk-1', {
        date: TARGET_DATE,
        engineOnly: true,
      });
      expect(dbUpsert).not.toHaveBeenCalled();
    });

    it('engineOnly=true: does NOT warm Redis (avoid narrative=null pollution)', async () => {
      const { service, redisSet } = buildFullStackService();
      await service.getDailyFortune('clerk-1', {
        date: TARGET_DATE,
        engineOnly: true,
      });
      expect(redisSet).not.toHaveBeenCalled();
    });

    it('engineOnly=true: still calls engine + returns engine output with narrative=null', async () => {
      const { service, engineFetch } = buildFullStackService();
      const result = await service.getDailyFortune('clerk-1', {
        date: TARGET_DATE,
        engineOnly: true,
      });
      expect(engineFetch).toHaveBeenCalledTimes(1);
      expect(result.narrative).toBeNull();
      expect(result.engineOutput.dayGanZhi).toBe('戊子');
      expect(result.cacheHit).toBe(false);
    });

    it('engineOnly=true + cache HIT: returns FULL cached payload (narrative bonus)', async () => {
      // When cache hits, the cached row may have narrative — return as-is.
      // This is the desirable «free upgrade» case for the progressive UX:
      // engine-only fetcher gets full payload instantly + frontend's parallel
      // full-fetch becomes a no-op (Redis hit returns same payload).
      const { service, aiNarration, engineFetch } = buildFullStackService({
        cacheHit: true,
      });
      const result = await service.getDailyFortune('clerk-1', {
        date: TARGET_DATE,
        engineOnly: true,
      });
      expect(engineFetch).not.toHaveBeenCalled(); // cache short-circuit
      expect(aiNarration).not.toHaveBeenCalled();
      expect(result.cacheHit).toBe(true);
    });

    it('engineOnly=false (default): runs AI + persists + warms Redis (regression)', async () => {
      const { service, dbUpsert, redisSet, aiNarration } = buildFullStackService();
      await service.getDailyFortune('clerk-1', {
        date: TARGET_DATE,
        // engineOnly omitted — full path
      });
      expect(aiNarration).toHaveBeenCalledTimes(1);
      expect(dbUpsert).toHaveBeenCalledTimes(1);
      expect(redisSet).toHaveBeenCalledTimes(1);
    });
  });
});
