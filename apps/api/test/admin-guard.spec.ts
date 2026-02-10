/**
 * Tests for AdminGuard — role-based access control with Redis caching.
 * Verifies admin check via Clerk API, caching behavior, and fail-closed error handling.
 */
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { AdminGuard } from '../src/auth/admin.guard';

// ============================================================
// Mock @clerk/backend
// ============================================================

const mockClerkClient = {
  users: {
    getUser: jest.fn(),
  },
};

jest.mock('@clerk/backend', () => ({
  createClerkClient: jest.fn(() => mockClerkClient),
}));

// ============================================================
// Mock dependencies
// ============================================================

const mockRedis = {
  getOrSet: jest.fn(),
  del: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue('test_clerk_secret_key'),
};

// ============================================================
// Helper: create mock ExecutionContext
// ============================================================

const createMockContext = (userId?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ auth: userId ? { userId } : undefined }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getClass: () => Object,
    getHandler: () => (() => {}),
    getArgs: () => [],
    getArgByIndex: () => ({}),
    switchToRpc: () => ({} as any),
    switchToWs: () => ({} as any),
    getType: () => 'http',
  }) as unknown as ExecutionContext;

// ============================================================
// Tests
// ============================================================

describe('AdminGuard', () => {
  let guard: AdminGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new AdminGuard(mockConfigService as any, mockRedis as any);
  });

  it('should return true for admin user', async () => {
    mockRedis.getOrSet.mockImplementation(
      async (_key: string, _ttl: number, factory: () => Promise<boolean>) =>
        factory(),
    );
    mockClerkClient.users.getUser.mockResolvedValue({
      publicMetadata: { role: 'admin' },
    });

    const result = await guard.canActivate(createMockContext('user_admin_123'));

    expect(result).toBe(true);
    expect(mockClerkClient.users.getUser).toHaveBeenCalledWith('user_admin_123');
  });

  it('should throw ForbiddenException for non-admin user', async () => {
    mockRedis.getOrSet.mockImplementation(
      async (_key: string, _ttl: number, factory: () => Promise<boolean>) =>
        factory(),
    );
    mockClerkClient.users.getUser.mockResolvedValue({
      publicMetadata: { role: 'user' },
    });

    await expect(
      guard.canActivate(createMockContext('user_regular_456')),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      guard.canActivate(createMockContext('user_regular_456')),
    ).rejects.toThrow('Admin access required');
  });

  it('should throw ForbiddenException when no userId in request', async () => {
    await expect(guard.canActivate(createMockContext())).rejects.toThrow(
      ForbiddenException,
    );

    await expect(guard.canActivate(createMockContext())).rejects.toThrow(
      'Authentication required',
    );

    // Should not reach Redis or Clerk
    expect(mockRedis.getOrSet).not.toHaveBeenCalled();
    expect(mockClerkClient.users.getUser).not.toHaveBeenCalled();
  });

  it('should return true from Redis cache hit (admin=true) without calling Clerk', async () => {
    mockRedis.getOrSet.mockResolvedValue(true);

    const result = await guard.canActivate(createMockContext('user_cached_admin'));

    expect(result).toBe(true);
    expect(mockRedis.getOrSet).toHaveBeenCalledWith(
      'admin:role:user_cached_admin',
      60,
      expect.any(Function),
    );
    // Clerk API should NOT be called when cache returns a value directly
    expect(mockClerkClient.users.getUser).not.toHaveBeenCalled();
  });

  it('should throw ForbiddenException from Redis cache hit (admin=false) without calling Clerk', async () => {
    mockRedis.getOrSet.mockResolvedValue(false);

    await expect(
      guard.canActivate(createMockContext('user_cached_nonadmin')),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      guard.canActivate(createMockContext('user_cached_nonadmin')),
    ).rejects.toThrow('Admin access required');

    // Clerk API should NOT be called when cache returns a value directly
    expect(mockClerkClient.users.getUser).not.toHaveBeenCalled();
  });

  it('should call Clerk API on cache miss and cache the result', async () => {
    // Simulate cache miss: getOrSet invokes the factory callback
    mockRedis.getOrSet.mockImplementation(
      async (_key: string, _ttl: number, factory: () => Promise<boolean>) =>
        factory(),
    );
    mockClerkClient.users.getUser.mockResolvedValue({
      publicMetadata: { role: 'admin' },
    });

    const result = await guard.canActivate(createMockContext('user_uncached_789'));

    expect(result).toBe(true);
    expect(mockClerkClient.users.getUser).toHaveBeenCalledWith('user_uncached_789');
    expect(mockRedis.getOrSet).toHaveBeenCalledWith(
      'admin:role:user_uncached_789',
      60,
      expect.any(Function),
    );
  });

  it('should throw ForbiddenException when Clerk API fails (fail closed)', async () => {
    mockRedis.getOrSet.mockImplementation(
      async (_key: string, _ttl: number, factory: () => Promise<boolean>) =>
        factory(),
    );
    mockClerkClient.users.getUser.mockRejectedValue(
      new Error('Clerk API unavailable'),
    );

    await expect(
      guard.canActivate(createMockContext('user_error_000')),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      guard.canActivate(createMockContext('user_error_000')),
    ).rejects.toThrow('Unable to verify admin status');
  });

  it('should re-fetch from Clerk after cache invalidation via redis.del()', async () => {
    // First call: cache hit returns true
    mockRedis.getOrSet.mockResolvedValueOnce(true);

    const result1 = await guard.canActivate(createMockContext('user_invalidate_111'));
    expect(result1).toBe(true);
    expect(mockClerkClient.users.getUser).not.toHaveBeenCalled();

    // Simulate cache invalidation
    await mockRedis.del('admin:role:user_invalidate_111');
    expect(mockRedis.del).toHaveBeenCalledWith('admin:role:user_invalidate_111');

    // Second call: cache miss, getOrSet invokes factory
    mockRedis.getOrSet.mockImplementationOnce(
      async (_key: string, _ttl: number, factory: () => Promise<boolean>) =>
        factory(),
    );
    mockClerkClient.users.getUser.mockResolvedValue({
      publicMetadata: { role: 'admin' },
    });

    const result2 = await guard.canActivate(createMockContext('user_invalidate_111'));
    expect(result2).toBe(true);
    expect(mockClerkClient.users.getUser).toHaveBeenCalledWith('user_invalidate_111');
    expect(mockClerkClient.users.getUser).toHaveBeenCalledTimes(1);
  });
});
