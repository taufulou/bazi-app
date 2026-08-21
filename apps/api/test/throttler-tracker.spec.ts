jest.mock('@clerk/backend', () => ({ verifyToken: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyToken } = require('@clerk/backend') as { verifyToken: jest.Mock };

import { AuthIdentityService } from '../src/auth/auth-identity.service';
import { UserAwareThrottlerGuard } from '../src/throttler/user-aware-throttler.guard';
import { resolveTrustProxyHops } from '../src/common/trust-proxy';

const config = {
  get: (k: string) => (k === 'CLERK_SECRET_KEY' ? 'sk_test_fake' : undefined),
} as never;

function makeGuard() {
  const identity = new AuthIdentityService(config);
  const guard = new UserAwareThrottlerGuard(
    { throttlers: [] } as never,
    { increment: jest.fn() } as never,
    { getAllAndOverride: jest.fn() } as never,
    identity,
  );
  // `getTracker` is protected; this spec is the reason it exists.
  const track = (req: unknown) =>
    (guard as unknown as { getTracker(r: unknown): Promise<string> }).getTracker(req);
  return { guard, identity, track };
}

beforeEach(() => verifyToken.mockReset());

describe('M1(c) — the rate-limit bucket is keyed on a VERIFIED identity', () => {
  it('⚠️ NEVER verifies in the tracker — the cheap gate must precede the expensive one', async () => {
    // THE regression this design exists to prevent. An earlier version awaited
    // `attach()` here, which awaits Clerk's `verifyToken`; a forged token's
    // unknown `kid` always misses Clerk's JWKS cache and fetches from the
    // network with no timeout. So `Bearer <garbage>` forced an unbounded
    // outbound call BEFORE the rate limiter had decided anything.
    const { track } = makeGuard();
    await track({ headers: { authorization: 'Bearer anything-at-all' }, ip: '10.0.0.1' });
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('keys on the userId once the token has been verified for a previous request', async () => {
    verifyToken.mockResolvedValue({ sub: 'user_alice', sid: 'sess_1' });
    const { track, identity } = makeGuard();
    const headers = { authorization: 'Bearer good' };

    // Request 1: nothing cached yet, so it buckets by IP — the accepted cost.
    expect(await track({ headers, ip: '10.0.0.1' })).toBe('ip:10.0.0.1');
    // ClerkAuthGuard then verifies for real, which populates the peek cache.
    await identity.attach({ headers } as never);
    // Request 2 onward: keyed per user, with no verification in the tracker.
    verifyToken.mockClear();
    expect(await track({ headers, ip: '10.0.0.1' })).toBe('u:user_alice');
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('uses request.auth directly when the auth guard ran first', async () => {
    const { track } = makeGuard();
    const key = await track({ headers: {}, auth: { userId: 'user_bob' }, ip: '10.0.0.1' });
    expect(key).toBe('u:user_bob');
  });

  it('gives two users separate buckets even from one IP', async () => {
    const { track, identity } = makeGuard();
    const hA = { authorization: 'Bearer a' };
    const hB = { authorization: 'Bearer b' };
    verifyToken.mockResolvedValueOnce({ sub: 'user_alice' });
    await identity.attach({ headers: hA } as never);
    verifyToken.mockResolvedValueOnce({ sub: 'user_bob' });
    await identity.attach({ headers: hB } as never);

    // The case that motivated M1: everyone behind the web app shares one IP.
    expect(await track({ headers: hA, ip: '10.0.0.1' })).toBe('u:user_alice');
    expect(await track({ headers: hB, ip: '10.0.0.1' })).toBe('u:user_bob');
  });

  it('⚠️ a FORGED bearer does NOT mint its own bucket — it falls back to IP', async () => {
    // If the tracker trusted a decoded-but-unverified `sub`, an attacker would
    // get a fresh bucket per request by editing the JWT payload — free,
    // unlimited, and strictly worse than IP keying.
    verifyToken.mockRejectedValue(new Error('signature verification failed'));
    const { track, identity } = makeGuard();

    const forged =
      'Bearer ' +
      [
        Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
        Buffer.from(JSON.stringify({ sub: 'user_attacker_chosen' })).toString('base64url'),
        '',
      ].join('.');

    // Even after the auth guard has tried and failed to verify it.
    await identity.attach({ headers: { authorization: forged } } as never);
    const key = await track({ headers: { authorization: forged }, ip: '10.0.0.9' });

    expect(key).toBe('ip:10.0.0.9');
    expect(key).not.toContain('user_attacker_chosen');
  });

  it('a DIFFERENT token does not inherit a cached identity', async () => {
    verifyToken.mockResolvedValue({ sub: 'user_alice' });
    const { track, identity } = makeGuard();
    await identity.attach({ headers: { authorization: 'Bearer alice-token' } } as never);

    const key = await track({ headers: { authorization: 'Bearer someone-elses' }, ip: '10.0.0.2' });
    expect(key).toBe('ip:10.0.0.2');
  });

  it('keys an anonymous caller on IP', async () => {
    const { track } = makeGuard();
    expect(await track({ headers: {}, ip: '203.0.113.7' })).toBe('ip:203.0.113.7');
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('never returns a bare userId that could collide with an IP literal', async () => {
    verifyToken.mockResolvedValue({ sub: '203.0.113.7' }); // adversarial sub
    const { track, identity } = makeGuard();
    const headers = { authorization: 'Bearer x' };
    await identity.attach({ headers } as never);

    const asUser = await track({ headers, ip: '198.51.100.1' });
    const asIp = await track({ headers: {}, ip: '203.0.113.7' });
    expect(asUser).not.toBe(asIp);
  });

  it('verifies ONCE per request — the auth guard reuses what attach recorded', async () => {
    verifyToken.mockResolvedValue({ sub: 'user_alice' });
    const { identity } = makeGuard();
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer good' } };

    await identity.attach(req as never);
    await identity.attach(req as never);
    expect(verifyToken).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failed verification for the same request', async () => {
    verifyToken.mockRejectedValue(new Error('nope'));
    const { identity } = makeGuard();
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer bad' } };

    await identity.attach(req as never);
    await identity.attach(req as never);
    // Idempotence keyed on a separate flag, not on `auth` being set — otherwise
    // every failed verification would be retried by each later caller.
    expect(verifyToken).toHaveBeenCalledTimes(1);
  });
});

describe('M1(b) — trust proxy is a hop count, never a boolean', () => {
  it.each(['true', 'TRUE', 'yes', 'on', '-1', '1.5', 'all', '11'])(
    'refuses %p and falls back to trusting nothing',
    (raw) => {
      const r = resolveTrustProxyHops(raw);
      expect(r.hops).toBe(0);
      expect(r.rejected).toBe(raw);
    },
  );

  it.each([['0', 0], ['1', 1], ['2', 2], [' 3 ', 3]] as Array<[string, number]>)(
    'accepts %p as %i hops',
    (raw, hops) => {
      const r = resolveTrustProxyHops(raw);
      expect(r).toEqual({ hops });
    },
  );

  it('defaults to 0 when unset — over-throttle rather than under-throttle', () => {
    expect(resolveTrustProxyHops(undefined)).toEqual({ hops: 0 });
    expect(resolveTrustProxyHops('')).toEqual({ hops: 0 });
  });
});
