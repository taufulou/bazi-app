import { PaymentEnvironment } from '@prisma/client';

/**
 * Whether a payment moved real money (1A-core item 4).
 *
 * Both providers report it, and neither was stored, so a sandbox purchase or a
 * Stripe test-mode payment was indistinguishable from revenue. Written on
 * CREATE (and on RevenueCat's subscription update); nothing reads it yet — it
 * exists so the books can be separated later.
 *
 * Unknown input maps to `null`, never to a guess: NULL already means "not
 * recorded", and labelling an unknown payment PRODUCTION would put test money
 * in the revenue column.
 */

/** RevenueCat sends `environment: 'SANDBOX' | 'PRODUCTION'`. */
export function revenueCatEnvironment(value: string | undefined | null): PaymentEnvironment | null {
  if (value === 'PRODUCTION') return 'PRODUCTION';
  if (value === 'SANDBOX') return 'SANDBOX';
  return null;
}

/** Stripe sends `livemode: boolean` on every object. */
export function stripeEnvironment(livemode: boolean | undefined | null): PaymentEnvironment | null {
  if (livemode === true) return 'PRODUCTION';
  if (livemode === false) return 'SANDBOX';
  return null;
}
