/**
 * Tests for HealthController — simple health check and detailed dependency checks.
 *
 * @jest-environment node
 */

import { HealthController } from '../src/health/health.controller';

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
