/**
 * Tests for RedisService distributed lock operations — todo #23 (ownership).
 *
 * The lock used to store the constant '1' and release with a bare DEL, so a
 * holder whose lock had EXPIRED deleted its SUCCESSOR's lock on the way out.
 * The value is now a per-holder token and release is a compare-and-delete.
 *
 * This spec mocks ioredis, so it proves the WIRING (token in, same token out,
 * the exact script sent, the never-throw contract, the Sentry payload). The
 * real compare-and-delete semantics are proven against a real Redis in
 * `redis-lock.integration.spec.ts`.
 */
import * as Sentry from '@sentry/nestjs';
import {
  RedisService,
  KNOWN_LOCK_PREFIXES,
  classifyLostLock,
  lockKeyPrefix,
} from '../src/redis/redis.service';
import { ConfigService } from '@nestjs/config';

// ============================================================
// Mocks
// ============================================================

const mockRedisClient = {
  set: jest.fn(),
  del: jest.fn(),
  eval: jest.fn(),
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

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
}));

/**
 * The compare-and-delete script, written out HERE rather than imported.
 * Importing `RELEASE_LOCK_SCRIPT` would make the expectation mutate with the
 * code: a broken script (say, an unconditional DEL) would still "match".
 */
const EXPECTED_RELEASE_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

const TOKEN_SHAPE = /^[0-9a-f-]{36}\.\d+\.\d+$/;

// ============================================================
// Tests
// ============================================================

describe('RedisService — Distributed Lock (ownership tokens)', () => {
  let service: RedisService;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    const mockConfig = {
      get: jest.fn().mockReturnValue('redis://localhost:6379'),
    };
    service = new RedisService(mockConfig as unknown as ConfigService);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logger = (service as any).logger;
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ============================================================
  // acquireLock
  // ============================================================

  describe('acquireLock', () => {
    it('returns a token and stores THAT SAME token with SET … EX ttl NX', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      const token = await service.acquireLock('test:lock:1', 30);

      expect(token).toMatch(TOKEN_SHAPE);
      expect(mockRedisClient.set).toHaveBeenCalledWith('test:lock:1', token, 'EX', 30, 'NX');
    });

    it('never stores the old constant value', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      await service.acquireLock('test:lock:1', 30);
      expect(mockRedisClient.set.mock.calls[0][1]).not.toBe('1');
    });

    it('gives two acquisitions DIFFERENT tokens', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      const a = await service.acquireLock('test:lock:a', 30);
      const b = await service.acquireLock('test:lock:a', 30);
      expect(a).not.toBe(b);
    });

    it('returns null when the lock is already held', async () => {
      mockRedisClient.set.mockResolvedValue(null);
      await expect(service.acquireLock('test:lock:1', 30)).resolves.toBeNull();
    });

    it('carries the caller TTL into the token and to Redis', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      const token = await service.acquireLock('test:lock:custom', 105);
      expect(mockRedisClient.set).toHaveBeenCalledWith('test:lock:custom', token, 'EX', 105, 'NX');
      expect(token!.split('.')[2]).toBe('105');
    });
  });

  // ============================================================
  // releaseLock
  // ============================================================

  describe('releaseLock', () => {
    it('sends the compare-and-delete script with ONE key, the key, and the token', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      await service.releaseLock('test:lock:1', 'tok');
      expect(mockRedisClient.eval).toHaveBeenCalledWith(EXPECTED_RELEASE_SCRIPT, 1, 'test:lock:1', 'tok');
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    it('returns true when our lock was deleted — silently', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      await expect(service.releaseLock('test:lock:1', 'tok')).resolves.toBe(true);
      expect(warn).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('a miss on a lock held PAST its TTL is reported as overran_ttl', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-01T00:00:00Z') });
      mockRedisClient.set.mockResolvedValue('OK');
      const token = (await service.acquireLock('stream:reading:abc-123', 30))!;
      jest.setSystemTime(new Date('2026-10-01T00:00:31Z')); // held 31s on a 30s lock
      mockRedisClient.eval.mockResolvedValue(0);

      await expect(service.releaseLock('stream:reading:abc-123', token)).resolves.toBe(false);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('cause=overran_ttl');
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      const [event, payload] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
      expect(event).toBe('redis.lock.lost_before_release');
      expect(payload).toMatchObject({
        level: 'warning',
        tags: { lockPrefix: 'stream:reading', cause: 'overran_ttl' },
        fingerprint: ['redis.lock.lost_before_release', 'stream:reading', 'overran_ttl'],
      });
    });

    it('a miss well INSIDE the TTL is reported as lost_early (eviction / flush / restart)', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-01T00:00:00Z') });
      mockRedisClient.set.mockResolvedValue('OK');
      const token = (await service.acquireLock('chat-extend:sess-9', 30))!;
      jest.setSystemTime(new Date('2026-10-01T00:00:05Z')); // held 5s on a 30s lock
      mockRedisClient.eval.mockResolvedValue(0);

      await service.releaseLock('chat-extend:sess-9', token);

      const payload = (Sentry.captureMessage as jest.Mock).mock.calls[0][1];
      expect(payload.tags).toEqual({ lockPrefix: 'chat-extend', cause: 'lost_early' });
    });

    it('never sends the id part of the key to Sentry — only the prefix', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      const token = (await service.acquireLock('reading:create:user-SECRET-42', 30))!;
      mockRedisClient.eval.mockResolvedValue(0);

      await service.releaseLock('reading:create:user-SECRET-42', token);

      const payload = (Sentry.captureMessage as jest.Mock).mock.calls[0][1];
      expect(JSON.stringify(payload)).not.toContain('user-SECRET-42');
      expect(payload.tags.lockPrefix).toBe('reading:create');
    });

    it('an unrecognised key shape reports lockPrefix "other", never any part of the key', async () => {
      mockRedisClient.eval.mockResolvedValue(0);
      // `user:<id>:lock` — stripping the last segment would leave the id.
      await service.releaseLock('user:SECRET-ID-77:lock', 'x.1.30');
      const payload = (Sentry.captureMessage as jest.Mock).mock.calls[0][1];
      expect(payload.tags.lockPrefix).toBe('other');
      expect(JSON.stringify(payload)).not.toContain('SECRET-ID-77');
    });

    it('NEVER throws when Redis errors — resolves false, logs, no Sentry', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('ECONNRESET'));
      await expect(service.releaseLock('test:lock:1', 'tok')).resolves.toBe(false);
      expect(error).toHaveBeenCalledTimes(1);
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('NEVER throws even if Sentry itself throws in the lost-lock branch — and does not mislabel it', async () => {
      mockRedisClient.eval.mockResolvedValue(0);
      (Sentry.captureMessage as jest.Mock).mockImplementationOnce(() => {
        throw new Error('sentry down');
      });
      await expect(service.releaseLock('test:lock:1', 'x.1.30')).resolves.toBe(false);
      // The compare-and-delete RAN; a failure to report it is not a failed release.
      expect(error).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // pure helpers
  // ============================================================

  describe('classifyLostLock', () => {
    it('held >= TTL → overran_ttl; held < TTL → lost_early', () => {
      expect(classifyLostLock('u.1000.30', 1000 + 30_000).cause).toBe('overran_ttl');
      expect(classifyLostLock('u.1000.30', 1000 + 29_999).cause).toBe('lost_early');
    });

    it('reports held ms and TTL', () => {
      expect(classifyLostLock('u.1000.30', 6000)).toEqual({
        cause: 'lost_early', heldMs: 5000, ttlSeconds: 30,
      });
    });

    it('anything not in our shape is unparseable, not a crash', () => {
      for (const t of ['tok', '1', 'a.b.c', 'u.1000', 'u.1000.0', '']) {
        expect(classifyLostLock(t, 5000).cause).toBe('unparseable');
      }
    });
  });

  describe('lockKeyPrefix', () => {
    it.each([
      ['reading:create:user-1', 'reading:create'],
      ['stream:reading:r-1', 'stream:reading'],
      ['comparison:create:user-1', 'comparison:create'],
      ['ai:generate:comparison:cmp-1', 'ai:generate:comparison'],
      ['chat-extend:s1', 'chat-extend'],
      ['chat-session-stream:s1', 'chat-session-stream'],
    ])('maps the real key shape %s → %s', (key, prefix) => {
      expect(lockKeyPrefix(key)).toBe(prefix);
    });
    it('reports anything else as "other" — never derived from the key', () => {
      expect(lockKeyPrefix('abc')).toBe('other');
      expect(lockKeyPrefix(':abc')).toBe('other');
      expect(lockKeyPrefix('user:42:lock')).toBe('other');
      expect(lockKeyPrefix('reading:createXYZ')).toBe('other'); // prefix must end at a ':'
    });
    it('every allowlisted prefix is one a lock site really uses', () => {
      expect([...KNOWN_LOCK_PREFIXES].sort()).toEqual(
        ['ai:generate:comparison', 'chat-extend', 'chat-session-stream', 'comparison:create', 'reading:create', 'stream:reading'],
      );
    });
  });

  // ============================================================
  // withLock
  // ============================================================

  describe('withLock', () => {
    it('runs the function and releases with the token it acquired', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      const fn = jest.fn().mockResolvedValue('result');
      const result = await service.withLock('test:lock:fn', fn, 30);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
      const stored = mockRedisClient.set.mock.calls[0][1];
      expect(mockRedisClient.eval).toHaveBeenCalledWith(EXPECTED_RELEASE_SCRIPT, 1, 'test:lock:fn', stored);
    });

    it('releases even when the function throws', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      const fn = jest.fn().mockRejectedValue(new Error('Function failed'));

      await expect(service.withLock('test:lock:fail', fn, 30)).rejects.toThrow('Function failed');
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        EXPECTED_RELEASE_SCRIPT, 1, 'test:lock:fail', mockRedisClient.set.mock.calls[0][1],
      );
    });

    it('throws, without running the function or releasing, when the lock is held', async () => {
      mockRedisClient.set.mockResolvedValue(null);
      const fn = jest.fn().mockResolvedValue('should not run');

      await expect(service.withLock('test:lock:busy', fn, 30)).rejects.toThrow(
        'Failed to acquire lock: test:lock:busy',
      );
      expect(fn).not.toHaveBeenCalled();
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('passes the caller TTL through', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);
      await service.withLock('test:lock:ttl', jest.fn().mockResolvedValue('done'), 120);
      expect(mockRedisClient.set.mock.calls[0]).toEqual(
        ['test:lock:ttl', expect.stringMatching(TOKEN_SHAPE), 'EX', 120, 'NX'],
      );
    });
  });
});
