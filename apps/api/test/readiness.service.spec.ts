/**
 * M7 — readiness.
 *
 * Emphasis is on the properties that are easy to get wrong and invisible when
 * wrong: which dependency is fatal, that the cache and the concurrent-dedupe
 * actually stop database round-trips, and that a HUNG dependency is bounded.
 */
import { ConfigService } from '@nestjs/config';
import {
  READINESS_CACHE_MS,
  READINESS_CHECK_TIMEOUT_MS,
  ReadinessService,
  redactReadinessReport,
} from '../src/health/readiness.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { engineFetch } from '../src/common/engine-client';
import { ShutdownService } from '../src/common/shutdown.service';

jest.mock('../src/common/engine-client', () => ({ engineFetch: jest.fn() }));
const engineFetchMock = engineFetch as jest.MockedFunction<typeof engineFetch>;

function build(overrides?: {
  db?: () => Promise<unknown>;
  ping?: () => Promise<unknown>;
  engine?: () => Promise<unknown>;
}) {
  const db = jest.fn(overrides?.db ?? (async () => [{ ok: 1 }]));
  const ping = jest.fn(overrides?.ping ?? (async () => 'PONG'));
  engineFetchMock.mockReset();
  engineFetchMock.mockImplementation(
    (overrides?.engine ?? (async () => ({ ok: true, status: 200 }))) as never,
  );

  const prisma = { $queryRaw: db } as unknown as PrismaService;
  const redis = { getClient: () => ({ ping }) } as unknown as RedisService;
  const config = { get: () => 'http://engine.test' } as unknown as ConfigService;

  return { service: new ReadinessService(prisma, redis, config, new ShutdownService()), db, ping };
}

describe('ReadinessService — the verdict', () => {
  it('is ready when everything answers', async () => {
    const { service } = build();
    const r = await service.check();
    expect(r.ready).toBe(true);
    expect(r.status).toBe('ready');
    expect(r.checks.database!.status).toBe('healthy');
    expect(r.checks.redis!.status).toBe('healthy');
    expect(r.checks.baziEngine!.status).toBe('healthy');
  });

  it('is NOT ready when Postgres is down', async () => {
    const { service } = build({
      db: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const r = await service.check();
    expect(r.ready).toBe(false);
    expect(r.status).toBe('not_ready');
    expect(r.checks.database!.error).toContain('ECONNREFUSED');
  });

  it('is NOT ready when Redis is down — the throttler fails OPEN without it', async () => {
    const { service } = build({
      ping: async () => {
        throw new Error('Connection is closed');
      },
    });
    const r = await service.check();
    expect(r.ready).toBe(false);
    expect(r.checks.redis!.required).toBe(true);
  });

  it('stays READY when only the engine is down, and says degraded', async () => {
    const { service } = build({
      engine: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const r = await service.check();
    // The engine backs a handful of routes; the rest of the API is fine
    // without it, so this must not take the instance out of rotation.
    expect(r.ready).toBe(true);
    expect(r.status).toBe('degraded');
    expect(r.checks.baziEngine!.required).toBe(false);
  });

  it('treats a non-2xx engine response as unhealthy, not healthy', async () => {
    const { service } = build({ engine: async () => ({ ok: false, status: 503 }) });
    const r = await service.check();
    expect(r.checks.baziEngine!.status).toBe('unhealthy');
    expect(r.checks.baziEngine!.error).toContain('503');
  });

  it('reports every dependency even when one fails', async () => {
    const { service } = build({
      db: async () => {
        throw new Error('down');
      },
    });
    const r = await service.check();
    expect(Object.keys(r.checks).sort()).toEqual(['baziEngine', 'database', 'redis']);
  });
});

describe('ReadinessService — the engine hop is keyed (plan R4 #11)', () => {
  it('goes through engineFetch with caller "health.probe"', async () => {
    const { service } = build();
    await service.check();
    // An UNKEYED probe on a continuously-polled endpoint would keep B3-a's
    // unkeyed counter climbing forever, so the pre-flight gate could never
    // say GO. `engineFetch` keys it; the CI guard keeps it that way.
    expect(engineFetchMock).toHaveBeenCalledWith(
      'http://engine.test/health',
      expect.objectContaining({ caller: 'health.probe' }),
    );
  });
});

describe('ReadinessService — cost control', () => {
  it('memoises, so a sequential flood is one database round-trip', async () => {
    const { service, db } = build();
    await service.check();
    await service.check();
    await service.check();
    expect(db).toHaveBeenCalledTimes(1);
  });

  it('collapses CONCURRENT probes onto one check', async () => {
    // The cache alone does not cover this: N simultaneous requests all miss it
    // and all hit the database. This is the in-flight dedupe.
    const { service, db } = build();
    await Promise.all([service.check(), service.check(), service.check()]);
    expect(db).toHaveBeenCalledTimes(1);
  });

  it('re-probes once the memo expires', async () => {
    jest.useFakeTimers();
    try {
      const { service, db } = build();
      await service.check();
      jest.advanceTimersByTime(READINESS_CACHE_MS + 1);
      await service.check();
      expect(db).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not serve a stale READY after the dependency dies', async () => {
    jest.useFakeTimers();
    try {
      let alive = true;
      const { service } = build({
        db: async () => {
          if (!alive) throw new Error('gone');
          return [1];
        },
      });
      expect((await service.check()).ready).toBe(true);
      alive = false;
      jest.advanceTimersByTime(READINESS_CACHE_MS + 1);
      expect((await service.check()).ready).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('ReadinessService — a hung dependency is bounded', () => {
  it('times a dependency out instead of waiting forever', async () => {
    jest.useFakeTimers();
    try {
      const { service } = build({ db: () => new Promise(() => {}) });
      const pending = service.check();
      await jest.advanceTimersByTimeAsync(READINESS_CHECK_TIMEOUT_MS + 10);
      const r = await pending;
      expect(r.ready).toBe(false);
      expect(r.checks.database!.error).toMatch(/timed out/);
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves no pending timer behind on the happy path', async () => {
    jest.useFakeTimers();
    try {
      const { service } = build();
      await service.check();
      // An un-cleared setTimeout per probe, on an endpoint polled forever,
      // keeps the event loop busy and delays graceful shutdown.
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('redactReadinessReport', () => {
  it('removes dependency error text but keeps which one is unhealthy', () => {
    const full = {
      ready: false,
      status: 'not_ready' as const,
      timestamp: 't',
      service: 'bazi-api',
      version: '0.1.0',
      checks: {
        database: {
          status: 'unhealthy' as const,
          latencyMs: 5,
          required: true,
          // Prisma initialisation errors can embed the datasource URL, i.e.
          // the database password, and this route is unauthenticated.
          error: 'the URL postgresql://u:p@host:5432/db is invalid',
        },
        redis: { status: 'healthy' as const, latencyMs: 1, required: true },
      },
    };
    const safe = redactReadinessReport(full);
    expect(safe.checks.database!.error).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain('postgresql://');
    // The useful part survives.
    expect(safe.checks.database!.status).toBe('unhealthy');
    expect(safe.checks.database!.required).toBe(true);
    expect(safe.ready).toBe(false);
  });

  it('does not mutate the caller\'s report — the logs still need the text', () => {
    const full = {
      ready: false,
      status: 'not_ready' as const,
      timestamp: 't',
      service: 'bazi-api',
      version: '0.1.0',
      checks: { database: { status: 'unhealthy' as const, latencyMs: 5, required: true, error: 'secret' } },
    };
    redactReadinessReport(full);
    expect(full.checks.database.error).toBe('secret');
  });
});
