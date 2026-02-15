/**
 * Tests for RedisService distributed lock operations.
 * Validates acquireLock, releaseLock, and withLock helpers.
 */
import { RedisService } from '../src/redis/redis.service';
import { ConfigService } from '@nestjs/config';

// ============================================================
// Mock ioredis
// ============================================================

const mockRedisClient = {
  set: jest.fn(),
  del: jest.fn(),
  get: jest.fn(),
  setex: jest.fn(),
  exists: jest.fn(),
  ttl: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  multi: jest.fn(),
  on: jest.fn(),
  quit: jest.fn(),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedisClient);
});

// ============================================================
// Tests
// ============================================================

describe('RedisService — Distributed Lock', () => {
  let service: RedisService;

  beforeEach(() => {
    jest.clearAllMocks();
    const mockConfig = {
      get: jest.fn().mockReturnValue('redis://localhost:6379'),
    };
    service = new RedisService(mockConfig as unknown as ConfigService);
  });

  // ============================================================
  // acquireLock
  // ============================================================

  describe('acquireLock', () => {
    it('should return true when lock is successfully acquired', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await service.acquireLock('test:lock:1', 30);

      expect(result).toBe(true);
      expect(mockRedisClient.set).toHaveBeenCalledWith('test:lock:1', '1', 'EX', 30, 'NX');
    });

    it('should return false when lock is already held', async () => {
      mockRedisClient.set.mockResolvedValue(null);

      const result = await service.acquireLock('test:lock:1', 30);

      expect(result).toBe(false);
      expect(mockRedisClient.set).toHaveBeenCalledWith('test:lock:1', '1', 'EX', 30, 'NX');
    });

    it('should use default TTL of 30 seconds', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await service.acquireLock('test:lock:default');

      expect(mockRedisClient.set).toHaveBeenCalledWith('test:lock:default', '1', 'EX', 30, 'NX');
    });

    it('should respect custom TTL', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await service.acquireLock('test:lock:custom', 60);

      expect(mockRedisClient.set).toHaveBeenCalledWith('test:lock:custom', '1', 'EX', 60, 'NX');
    });
  });

  // ============================================================
  // releaseLock
  // ============================================================

  describe('releaseLock', () => {
    it('should delete the lock key', async () => {
      mockRedisClient.del.mockResolvedValue(1);

      await service.releaseLock('test:lock:1');

      expect(mockRedisClient.del).toHaveBeenCalledWith('test:lock:1');
    });

    it('should not throw even if key does not exist', async () => {
      mockRedisClient.del.mockResolvedValue(0);

      await expect(service.releaseLock('nonexistent:lock')).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // withLock
  // ============================================================

  describe('withLock', () => {
    it('should execute function and release lock on success', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.del.mockResolvedValue(1);

      const fn = jest.fn().mockResolvedValue('result');
      const result = await service.withLock('test:lock:fn', fn);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockRedisClient.set).toHaveBeenCalledWith('test:lock:fn', '1', 'EX', 30, 'NX');
      expect(mockRedisClient.del).toHaveBeenCalledWith('test:lock:fn');
    });

    it('should release lock even when function throws', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.del.mockResolvedValue(1);

      const fn = jest.fn().mockRejectedValue(new Error('Function failed'));

      await expect(service.withLock('test:lock:fail', fn)).rejects.toThrow('Function failed');
      expect(mockRedisClient.del).toHaveBeenCalledWith('test:lock:fail');
    });

    it('should throw error when lock cannot be acquired', async () => {
      mockRedisClient.set.mockResolvedValue(null);

      const fn = jest.fn().mockResolvedValue('should not run');

      await expect(service.withLock('test:lock:busy', fn)).rejects.toThrow(
        'Failed to acquire lock: test:lock:busy',
      );
      expect(fn).not.toHaveBeenCalled();
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    it('should use custom TTL', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.del.mockResolvedValue(1);

      const fn = jest.fn().mockResolvedValue('done');
      await service.withLock('test:lock:ttl', fn, 120);

      expect(mockRedisClient.set).toHaveBeenCalledWith('test:lock:ttl', '1', 'EX', 120, 'NX');
    });
  });
});
