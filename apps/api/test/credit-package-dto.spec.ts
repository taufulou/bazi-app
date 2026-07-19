import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateCreditPackageDto, UpdateCreditPackageDto } from '../src/admin/dto';

/**
 * Guards the upstream half of the handleOneTimePayment fix.
 *
 * `creditAmount` flows admin form -> CreditPackage row -> Stripe checkout
 * metadata (`String(pkg.creditAmount)`) -> handleOneTimePayment, which THROWS
 * rather than acknowledging a webhook whose metadata cannot produce a grant (so
 * the customer's payment stays replayable instead of being silently swallowed).
 *
 * A package saved with creditAmount 0 would therefore make every purchase of it
 * fail its webhook and retry for ~3 days. Both routes previously took a raw
 * inline @Body() type, so nothing stopped that. These assert the floor holds on
 * create AND update — an update must not be a back door to 0.
 */
const errorsFor = (cls: never, payload: unknown): string[] => {
  const dto = plainToInstance(cls, payload);
  return validateSync(dto as object).flatMap((e) => Object.keys(e.constraints ?? {}).map(() => e.property));
};

const validCreate = {
  slug: 'value-12',
  nameZhTw: '超值包',
  nameZhCn: '超值包',
  creditAmount: 12,
  priceUsd: 1.99,
};

describe('CreateCreditPackageDto', () => {
  it('accepts a well-formed package', () => {
    expect(errorsFor(CreateCreditPackageDto as never, validCreate)).toHaveLength(0);
  });

  it('REJECTS creditAmount: 0 — the case that would storm the webhook', () => {
    expect(errorsFor(CreateCreditPackageDto as never, { ...validCreate, creditAmount: 0 })).toContain(
      'creditAmount',
    );
  });

  it('rejects a negative creditAmount', () => {
    expect(errorsFor(CreateCreditPackageDto as never, { ...validCreate, creditAmount: -5 })).toContain(
      'creditAmount',
    );
  });

  it('rejects a fractional creditAmount (credits are whole units)', () => {
    expect(errorsFor(CreateCreditPackageDto as never, { ...validCreate, creditAmount: 2.5 })).toContain(
      'creditAmount',
    );
  });

  it('rejects a missing creditAmount', () => {
    const { creditAmount: _omitted, ...noAmount } = validCreate;
    expect(errorsFor(CreateCreditPackageDto as never, noAmount)).toContain('creditAmount');
  });

  it('rejects a negative price', () => {
    expect(errorsFor(CreateCreditPackageDto as never, { ...validCreate, priceUsd: -1 })).toContain('priceUsd');
  });
});

describe('UpdateCreditPackageDto', () => {
  it('accepts a partial update that omits creditAmount', () => {
    expect(errorsFor(UpdateCreditPackageDto as never, { nameZhTw: '改名' })).toHaveLength(0);
  });

  it('REJECTS an update to creditAmount: 0 — no back door to zero', () => {
    expect(errorsFor(UpdateCreditPackageDto as never, { creditAmount: 0 })).toContain('creditAmount');
  });

  it('accepts an update to a valid creditAmount', () => {
    expect(errorsFor(UpdateCreditPackageDto as never, { creditAmount: 30 })).toHaveLength(0);
  });
});
