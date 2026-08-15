import { PaymentsController } from '../src/payments/payments.controller';

/**
 * Phase 1 gate — pin the rate limits on the three subscription-mutating routes.
 *
 * `@Throttle` was reasoned about at length in a comment above `upgrade` and
 * pinned by nothing: `payments-controller.spec.ts` invokes handler methods
 * directly, so deleting the decorator left the whole suite green. These three
 * routes each mutate a live Stripe subscription BEFORE they can fail, and each
 * reaches `syncUserTier -> refundStrandedPaidOnTierChange`, which INCREMENTS
 * credits — a path that used to require a webhook and is now user-triggerable.
 *
 * Reading the metadata is the only way to assert a decorator that the framework,
 * not the handler, acts on.
 */

/** The key `@nestjs/throttler` writes: `THROTTLER:LIMIT` + the named bucket. */
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';

function throttleFor(method: keyof PaymentsController): { limit?: unknown; ttl?: unknown } {
  const handler = PaymentsController.prototype[method] as unknown as object;
  const limit = Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler);
  const ttl = Reflect.getMetadata(`${THROTTLER_TTL}default`, handler);
  return { limit, ttl };
}

describe('payments — subscription-mutating routes are rate limited', () => {
  it.each([
    ['upgradeSubscription'],
    ['cancelSubscription'],
    ['reactivateSubscription'],
  ] as const)('%s carries a 5/min throttle', (method) => {
    const { limit, ttl } = throttleFor(method);
    expect(limit).toBe(5);
    expect(ttl).toBe(60_000);
  });

  it('the metadata reader itself works — an unthrottled route reads undefined', () => {
    // Positive control. Without it, a typo in the metadata key would make every
    // assertion above read `undefined === undefined` and pass vacuously.
    const { limit } = throttleFor('getCreditPackages');
    expect(limit).toBeUndefined();
  });
});
