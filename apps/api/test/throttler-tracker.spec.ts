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
  it('keys an authenticated caller on their userId, not their IP', async () => {
    verifyToken.mockResolvedValue({ sub: 'user_alice', sid: 'sess_1' });
    const { track } = makeGuard();

    const key = await track({ headers: { authorization: 'Bearer good' }, ip: '10.0.0.1' });
    expect(key).toBe('u:user_alice');
  });

  it('gives two users separate buckets even from one IP', async () => {
    const { track } = makeGuard();
    verifyToken.mockResolvedValueOnce({ sub: 'user_alice' });
    const a = await track({ headers: { authorization: 'Bearer a' }, ip: '10.0.0.1' });
    verifyToken.mockResolvedValueOnce({ sub: 'user_bob' });
    const b = await track({ headers: { authorization: 'Bearer b' }, ip: '10.0.0.1' });

    expect(a).not.toBe(b);
    // The case that motivated M1: everyone behind the web app shares one IP.
    expect([a, b]).toEqual(['u:user_alice', 'u:user_bob']);
  });

  it('⚠️ a FORGED bearer does NOT mint its own bucket — it falls back to IP', async () => {
    // THE security property. If the tracker trusted a decoded-but-unverified
    // `sub`, an attacker would get a fresh bucket per request by editing the
    // JWT payload — free, unlimited, and strictly worse than IP keying.
    verifyToken.mockRejectedValue(new Error('signature verification failed'));
    const { track } = makeGuard();

    const forged =
      'Bearer ' +
      [
        Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
        Buffer.from(JSON.stringify({ sub: 'user_attacker_chosen' })).toString('base64url'),
        '',
      ].join('.');

    const key = await track({ headers: { authorization: forged }, ip: '10.0.0.9' });
    expect(key).toBe('ip:10.0.0.9');
    expect(key).not.toContain('user_attacker_chosen');
  });

  it('keys an anonymous caller on IP', async () => {
    const { track } = makeGuard();
    expect(await track({ headers: {}, ip: '203.0.113.7' })).toBe('ip:203.0.113.7');
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('never returns a bare userId that could collide with an IP literal', async () => {
    verifyToken.mockResolvedValue({ sub: '203.0.113.7' }); // adversarial sub
    const { track } = makeGuard();
    const asUser = await track({ headers: { authorization: 'Bearer x' }, ip: '198.51.100.1' });
    const asIp = await track({ headers: {}, ip: '203.0.113.7' });
    expect(asUser).not.toBe(asIp);
  });

  it('verifies ONCE per request — the auth guard reuses what the tracker attached', async () => {
    verifyToken.mockResolvedValue({ sub: 'user_alice' });
    const { track, identity } = makeGuard();
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer good' }, ip: '1.1.1.1' };

    await track(req);
    await identity.attach(req as never); // what ClerkAuthGuard does next
    expect(verifyToken).toHaveBeenCalledTimes(1);
  });

  it('re-verification is not retried for an anonymous caller either', async () => {
    verifyToken.mockRejectedValue(new Error('nope'));
    const { track, identity } = makeGuard();
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer bad' }, ip: '1.1.1.1' };

    await track(req);
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
