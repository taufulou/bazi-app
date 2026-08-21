/**
 * A3 (Phase 1A) — webhook hardening.
 *
 * Two independent defects, both on money-bearing webhook paths:
 *
 * 1. Stripe and RevenueCat webhook controllers were subject to the global
 *    100-req/min throttle while the Clerk one was not. Provider retries are
 *    finite: a 429 during a burst (renewals cluster at billing-period
 *    boundaries) delays credit grants and, once retries are exhausted, drops
 *    the event silently — the customer paid and got nothing. Authenticity comes
 *    from the signature/secret, not from rate limiting.
 *
 * 2. RevenueCat auth used `===` on a STATIC bearer token. String equality
 *    short-circuits at the first differing byte, so timing leaks a
 *    prefix-match oracle. Unlike Stripe/Clerk HMACs (which vary per request),
 *    this token is replayed verbatim on every call — the exact shape that
 *    oracle attacks.
 */
import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants';
import { RevenueCatService } from '../src/payments/revenuecat.service';
import { StripeWebhookController } from '../src/webhooks/stripe-webhook.controller';
import { RevenueCatWebhookController } from '../src/webhooks/revenuecat-webhook.controller';
import { ClerkWebhookController } from '../src/webhooks/clerk-webhook.controller';
import type { ConfigService } from '@nestjs/config';

const SECRET = 'rc_whsec_0123456789abcdef0123456789abcdef';

function makeRcService(secret: string | undefined) {
  const config = {
    get: (key: string) => (key === 'RC_WEBHOOK_SECRET' ? secret : undefined),
  } as unknown as ConfigService;
  return new RevenueCatService(
    {} as never, // prisma — unused by verifyAuthHeader
    {} as never, // entitlements
    config,
  );
}

/**
 * `@SkipThrottle()` writes `THROTTLER:SKIP<name>`, not the bare constant —
 * the throttler name is appended, and ours is the default one. Asserting the
 * bare key yields `undefined` for EVERY controller, which makes a
 * `toBeDefined()`/`toEqual()` pair pass vacuously. Assert `true` explicitly.
 */
const SKIP_DEFAULT_KEY = `${THROTTLER_SKIP}default`;

describe('A3 — webhook throttle exemption', () => {
  it('sanity: the Clerk controller (already exempt) reads as skipped', () => {
    // Anchors the metadata key itself. If a throttler upgrade changes the key
    // shape, this fails first and explains the other failures.
    expect(Reflect.getMetadata(SKIP_DEFAULT_KEY, ClerkWebhookController)).toBe(true);
  });

  it.each([
    ['Stripe', StripeWebhookController],
    ['RevenueCat', RevenueCatWebhookController],
  ])('%s webhook controller is exempt from the global throttler', (_name, ctrl) => {
    // Signature/secret-verified providers retry a finite number of times; a 429
    // costs a real payment event. Read the decorator metadata rather than
    // trusting a comment.
    expect(Reflect.getMetadata(SKIP_DEFAULT_KEY, ctrl)).toBe(true);
  });
});

describe('A3 — RevenueCat auth is constant-time and fails closed', () => {
  it('accepts the correct bearer token', () => {
    expect(makeRcService(SECRET).verifyAuthHeader(`Bearer ${SECRET}`)).toBe(true);
  });

  it.each([
    ['wrong secret, same length', `Bearer ${'x'.repeat(SECRET.length)}`],
    ['correct prefix, wrong tail', `Bearer ${SECRET.slice(0, -1)}X`],
    ['missing the Bearer scheme', SECRET],
    ['empty string', ''],
    ['shorter than expected', 'Bearer short'],
    ['longer than expected', `Bearer ${SECRET}extra`],
  ])('rejects: %s', (_label, header) => {
    expect(makeRcService(SECRET).verifyAuthHeader(header)).toBe(false);
  });

  it('rejects an undefined header without throwing', () => {
    expect(makeRcService(SECRET).verifyAuthHeader(undefined)).toBe(false);
  });

  it('FAILS CLOSED when RC_WEBHOOK_SECRET is unset — even for a plausible header', () => {
    expect(makeRcService(undefined).verifyAuthHeader(`Bearer ${SECRET}`)).toBe(false);
    expect(makeRcService('').verifyAuthHeader('Bearer ')).toBe(false);
  });

  it('does not throw on length mismatch (timingSafeEqual requires equal lengths)', () => {
    // The guard that makes this safe is easy to delete by accident: passing
    // unequal buffers to timingSafeEqual throws a RangeError, which would
    // surface as a 500 instead of a clean rejection.
    const svc = makeRcService(SECRET);
    for (const h of ['B', 'Bearer', `Bearer ${SECRET}${'y'.repeat(200)}`]) {
      expect(() => svc.verifyAuthHeader(h)).not.toThrow();
      expect(svc.verifyAuthHeader(h)).toBe(false);
    }
  });

  it('actually calls timingSafeEqual — the constant-time property has no behavioural proxy', () => {
    // ⚠️ This asserts the MECHANISM, deliberately. The previous version of this
    // test fed in one header differing in the first byte and one differing in
    // the last, and asserted both returned false — which `===` satisfies
    // perfectly. Swapping `timingSafeEqual` for `===` was mutation-tested and
    // failed NOTHING across all 41 RevenueCat tests.
    //
    // Timing is a non-functional property: no assertion on a return value can
    // observe it, and a real timing measurement is too flaky for CI. Only the
    // mechanism can be pinned.
    //
    // `jest.spyOn(crypto, 'timingSafeEqual')` is not available here — the
    // node:crypto exports are non-configurable and it throws "Cannot redefine
    // property". So inspect the runtime function body: TS compiles the named
    // import to `(0, node_crypto_1.timingSafeEqual)(...)`, so the identifier is
    // present iff the primitive is actually invoked. Replace it with `===` and
    // this fails.
    const body = RevenueCatService.prototype.verifyAuthHeader.toString();
    expect(body).toContain('timingSafeEqual');

    // Guard the surrounding contract behaviourally, since the mechanism check
    // above can't see argument values.
    const svc = makeRcService(SECRET);
    expect(svc.verifyAuthHeader(`Bearer ${SECRET}`)).toBe(true);
    expect(svc.verifyAuthHeader(`Bearer ${SECRET.slice(0, -1)}X`)).toBe(false);
  });
});
