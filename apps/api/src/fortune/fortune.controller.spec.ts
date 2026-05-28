/**
 * Unit tests for fortune.controller.ts query-param helpers.
 *
 * Currently covers:
 *  - `isTruthyQueryParam` — Phase Fortune+ progressive loading bool coercion.
 *    Audit L1 follow-up — the controller's `engineOnly` query param previously
 *    used strict `=== 'true'` which would silently fall through to the slow
 *    path for `'TRUE'`, `'True'`, `'1'` (all accepted by IsBooleanString
 *    validator). The new normalizer accepts the canonical truthy set.
 */
import { isTruthyQueryParam } from './fortune.controller';

describe('isTruthyQueryParam', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    ['True', true],
    ['1', true],
  ])('accepts %s as truthy', (input, expected) => {
    expect(isTruthyQueryParam(input)).toBe(expected);
  });

  it.each([
    ['false', false],
    ['FALSE', false],
    ['0', false],
    ['', false],
    ['yes', false],     // not a canonical truthy
    ['truee', false],   // typo guard
    ['t', false],       // not full word
    ['2', false],       // not 0/1
  ])('rejects %s as truthy', (input, expected) => {
    expect(isTruthyQueryParam(input)).toBe(expected);
  });

  it('returns false for undefined (omitted query param)', () => {
    expect(isTruthyQueryParam(undefined)).toBe(false);
  });

  it('returns false for null-ish (defensive)', () => {
    // class-validator should reject null before reaching the controller, but
    // belt-and-braces — the helper handles missing input gracefully.
    expect(isTruthyQueryParam(undefined)).toBe(false);
  });
});
