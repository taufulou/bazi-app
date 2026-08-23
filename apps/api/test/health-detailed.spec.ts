/**
 * Tests for HealthController — simple health check and detailed dependency checks.
 *
 * @jest-environment node
 */

import { HealthController } from '../src/health/health.controller';
import type { ReadinessReport, ReadinessService } from '../src/health/readiness.service';

// ============================================================
// Mock Dependencies
// ============================================================

const mockPrisma = {
  $queryRaw: jest.fn(),
};

const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
};

const mockConfig = {
  get: jest.fn().mockReturnValue('http://localhost:5001'),
};

// M7. `/health/ready` delegates entirely; the controller's own job is the
// STATUS CODE, which is what a platform healthcheck reads. ReadinessService's
// verdict logic is covered in readiness.service.spec.ts.
const mockReadiness = {
  check: jest.fn<Promise<ReadinessReport>, []>(),
};

function report(ready: boolean, status: ReadinessReport['status']): ReadinessReport {
  return {
    ready,
    status,
    timestamp: '2026-01-01T00:00:00.000Z',
    service: 'bazi-api',
    version: '0.1.0',
    checks: {},
  };
}

// ============================================================
// Global fetch mock
// ============================================================

const originalFetch = global.fetch;

beforeAll(() => {
  global.fetch = jest.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
});

// ============================================================
// Controller instance
// ============================================================

let controller: HealthController;

beforeEach(() => {
  jest.clearAllMocks();
  controller = new HealthController(
    mockPrisma as any,
    mockRedis as any,
    mockConfig as any,
    mockReadiness as unknown as ReadinessService,
  );
});

// ============================================================
// Tests
// ============================================================

describe('HealthController', () => {
  // ----------------------------------------------------------
  // 1. Simple /health endpoint
  // ----------------------------------------------------------
  describe('check()', () => {
    it('should return status ok with service info', () => {
      const result = controller.check();

      expect(result.status).toBe('ok');
      expect(result.service).toBe('bazi-api');
      expect(result.version).toBe('0.1.0');
      expect(result.timestamp).toBeDefined();
      // Verify timestamp is a valid ISO string
      expect(() => new Date(result.timestamp)).not.toThrow();
    });
  });

  // ----------------------------------------------------------
  // Detailed /health/detailed endpoint
  // ----------------------------------------------------------
  describe('checkDetailed()', () => {
    // Helper to set up all-healthy mocks
    function setAllHealthy() {
      mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.get.mockResolvedValue('pong');
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    }

    // 2. All services healthy
    it('should return overall healthy when all dependencies are healthy', async () => {
      setAllHealthy();

      const result = await controller.checkDetailed();

      expect(result.status).toBe('healthy');
      expect(result.service).toBe('bazi-api');
      expect(result.version).toBe('0.1.0');
      expect(result.timestamp).toBeDefined();
      expect(result.checks.database.status).toBe('healthy');
      expect(result.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.checks.redis.status).toBe('healthy');
      expect(result.checks.redis.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.checks.baziEngine.status).toBe('healthy');
      expect(result.checks.baziEngine.latencyMs).toBeGreaterThanOrEqual(0);
    });

    // 3. Database down
    it('should return database unhealthy and overall unhealthy when prisma throws', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.get.mockResolvedValue('pong');
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      const result = await controller.checkDetailed();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.database.status).toBe('unhealthy');
      expect(result.checks.database.error).toBe('Connection refused');
      expect(result.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
      // Other services should still be checked
      expect(result.checks.redis.status).toBe('healthy');
      expect(result.checks.baziEngine.status).toBe('healthy');
    });

    // 4. Redis down (set throws)
    it('should return redis unhealthy and overall unhealthy when redis.set throws', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      mockRedis.set.mockRejectedValue(new Error('ECONNREFUSED'));
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      const result = await controller.checkDetailed();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.redis.status).toBe('unhealthy');
      expect(result.checks.redis.error).toBe('ECONNREFUSED');
      expect(result.checks.redis.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.checks.database.status).toBe('healthy');
      expect(result.checks.baziEngine.status).toBe('healthy');
    });

    // 5. Redis degraded (get returns wrong value)
    it('should return redis degraded and overall degraded when redis.get returns unexpected value', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.get.mockResolvedValue('wrong-value');
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      const result = await controller.checkDetailed();

      expect(result.status).toBe('degraded');
      expect(result.checks.redis.status).toBe('degraded');
      expect(result.checks.redis.error).toBeUndefined();
      expect(result.checks.database.status).toBe('healthy');
      expect(result.checks.baziEngine.status).toBe('healthy');
    });

    // 6. Bazi engine down (fetch throws)
    it('should return baziEngine unhealthy and overall unhealthy when fetch throws', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.get.mockResolvedValue('pong');
      (global.fetch as jest.Mock).mockRejectedValue(new Error('fetch failed'));

      const result = await controller.checkDetailed();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.baziEngine.status).toBe('unhealthy');
      expect(result.checks.baziEngine.error).toBe('fetch failed');
      expect(result.checks.baziEngine.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.checks.database.status).toBe('healthy');
      expect(result.checks.redis.status).toBe('healthy');
    });

    // 7. Bazi engine non-ok response
    it('should return baziEngine degraded and overall degraded when fetch returns non-ok', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.get.mockResolvedValue('pong');
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503 });

      const result = await controller.checkDetailed();

      expect(result.status).toBe('degraded');
      expect(result.checks.baziEngine.status).toBe('degraded');
      expect(result.checks.baziEngine.error).toBeUndefined();
      expect(result.checks.database.status).toBe('healthy');
      expect(result.checks.redis.status).toBe('healthy');
    });

    // 8. Mixed: DB healthy, Redis unhealthy, Bazi healthy
    it('should return overall unhealthy when any single dependency is unhealthy', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      mockRedis.set.mockRejectedValue(new Error('Redis timeout'));
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      const result = await controller.checkDetailed();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.database.status).toBe('healthy');
      expect(result.checks.redis.status).toBe('unhealthy');
      expect(result.checks.redis.error).toBe('Redis timeout');
      expect(result.checks.baziEngine.status).toBe('healthy');
    });
  });
});

// ============================================================
// M7 — GET /health/ready
//
// The wiring, not the verdict: does the route turn a report into the right
// HTTP status? Platforms read the code, not the body, so getting this backwards
// is invisible in every service-level test and catastrophic in production —
// an always-200 readiness endpoint reports a dead instance as fit for traffic.
// ============================================================

describe('HealthController — GET /health/ready', () => {
  function res() {
    return { status: jest.fn() } as unknown as import('express').Response & {
      status: jest.Mock;
    };
  }

  it('answers 200 when ready', async () => {
    mockReadiness.check.mockResolvedValue(report(true, 'ready'));
    const r = res();
    await controller.ready(r);
    expect(r.status).toHaveBeenCalledWith(200);
  });

  it('answers 200 when only an advisory dependency is down', async () => {
    mockReadiness.check.mockResolvedValue(report(true, 'degraded'));
    const r = res();
    await controller.ready(r);
    expect(r.status).toHaveBeenCalledWith(200);
  });

  it('answers 503 when a required dependency is down', async () => {
    mockReadiness.check.mockResolvedValue(report(false, 'not_ready'));
    const r = res();
    await controller.ready(r);
    expect(r.status).toHaveBeenCalledWith(503);
  });

  it('does NOT leak driver error text — this route is unauthenticated', async () => {
    const full = report(false, 'not_ready');
    full.checks = {
      database: {
        status: 'unhealthy',
        latencyMs: 1,
        required: true,
        error: 'the URL postgresql://user:pw@host:5432/db is invalid',
      },
    };
    mockReadiness.check.mockResolvedValue(full);
    const out = await controller.ready(res());
    expect(out.checks.database!.error).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('postgresql://');
    // Which dependency failed is still visible; only the text is gone.
    expect(out.checks.database!.status).toBe('unhealthy');
  });

  it('returns the per-dependency report, not a flattened error', async () => {
    // `passthrough` + res.status() rather than throwing: AllExceptionsFilter
    // reduces a thrown body to {message, error, code}, discarding the only part
    // a human debugging an outage wants.
    const full = report(false, 'not_ready');
    full.checks = {
      database: { status: 'healthy', latencyMs: 1, required: true },
      redis: { status: 'unhealthy', latencyMs: 2, required: true, error: 'down' },
    };
    mockReadiness.check.mockResolvedValue(full);
    const out = await controller.ready(res());
    expect(out.checks.redis!.status).toBe('unhealthy');
    expect(out.checks.database!.status).toBe('healthy');
  });

  it('leaves liveness dependency-free — no probe runs for GET /health', () => {
    mockReadiness.check.mockClear();
    const out = controller.check();
    expect(out.status).toBe('ok');
    expect(mockReadiness.check).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });
});
