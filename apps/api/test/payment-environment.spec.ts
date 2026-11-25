/**
 * 1A-core item 4 — whether a payment moved real money.
 *
 * The helpers map provider values; the source guard proves every Stripe
 * CREATE writes the column. A source guard because the property is about the
 * write SITES (six of them), and a behavioural test per site would mostly
 * re-test fixture plumbing — a missed site is exactly how this column would
 * silently stay NULL for one payment type.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { revenueCatEnvironment, stripeEnvironment } from '../src/payments/payment-environment';

describe('payment environment mapping', () => {
  it.each([
    ['PRODUCTION', 'PRODUCTION'],
    ['SANDBOX', 'SANDBOX'],
    ['production', null], // RevenueCat sends upper case; anything else is not guessed
    [undefined, null],
    [null, null],
  ])('revenueCatEnvironment(%p) → %p', (input, expected) => {
    expect(revenueCatEnvironment(input as string | undefined)).toBe(expected);
  });

  it.each([
    [true, 'PRODUCTION'],
    [false, 'SANDBOX'],
    [undefined, null],
    [null, null],
  ])('stripeEnvironment(%p) → %p', (input, expected) => {
    expect(stripeEnvironment(input as boolean | undefined)).toBe(expected);
  });
});

describe('every Stripe Subscription/Transaction create records the environment', () => {
  const src = readFileSync(join(__dirname, '../src/payments/stripe.service.ts'), 'utf8');

  it('each `platform: \'STRIPE\'` inside a create payload is followed by an environment line', () => {
    const lines = src.split('\n');
    const createPlatformLines = lines
      .map((l, i) => ({ l, i }))
      // `where:` filters also mention platform STRIPE; only data payloads are
      // a line of their own ending in a comma.
      .filter(({ l }) => /^\s+platform: 'STRIPE',$/.test(l));

    expect(createPlatformLines.length).toBe(6); // the six create sites (design item 4)
    for (const { i } of createPlatformLines) {
      expect(lines[i + 1]).toMatch(/^\s+environment: stripeEnvironment\((sub|invoice|session)\.livemode\),$/);
    }
  });
});
