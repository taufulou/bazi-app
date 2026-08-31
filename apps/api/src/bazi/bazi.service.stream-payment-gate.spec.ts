import { BaziService } from './bazi.service';

/**
 * `_setupStream` must refuse a reading that was NEVER PAID FOR.
 *
 * The route's only gate used to be `refundedAt`, which catches a reading that
 * WAS charged and then given back — not one that was never charged at all. This
 * route has no charge of its own, so it relies entirely on `createReading`
 * having taken payment.
 *
 * A row with no interpretation and no charge therefore fell through to the full
 * V2 generation and was delivered FREE, at real Anthropic cost, with
 * `getReading`'s `isEntitled = !refundedAt` then serving the complete report
 * rather than a preview. One 3-credit balance would have yielded unlimited
 * readings.
 *
 * ⚠️ The `aiInterpretation` conjunct is what keeps legitimate CACHE HITS out —
 * those are also `creditsUsed: 0` but always carry an interpretation. A bare
 * `creditsUsed === 0` gate would refuse readings the user already paid for.
 */
describe('BaziService._setupStream — never-paid gate', () => {
  const USER_ID = 'user-1';

  function build(reading: Record<string, unknown> | null) {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID }) },
      baziReading: { findFirst: jest.fn().mockResolvedValue(reading) },
    };
    const service = Object.create(BaziService.prototype) as BaziService;
    Object.assign(service, {
      prisma,
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      redis: { incrementRateLimit: jest.fn(), getClient: jest.fn() },
    });
    return service;
  }

  const setup = (svc: BaziService, sub: unknown) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any)._setupStream('clerk_1', 'reading-1', sub);

  const subscriber = () => ({ next: jest.fn(), complete: jest.fn() });

  it('REFUSES a row that was never charged and has no interpretation', async () => {
    const svc = build({
      id: 'reading-1', userId: USER_ID, creditsUsed: 0,
      aiInterpretation: null, refundedAt: null, isDegraded: false,
    });
    await expect(setup(svc, subscriber())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'READING_NOT_PAID' }),
    });
  });

  it('still serves a CACHE HIT, which is also creditsUsed 0 but has content', async () => {
    const emit = jest.fn();
    const svc = build({
      id: 'reading-1', userId: USER_ID, creditsUsed: 0,
      aiInterpretation: { sections: { personality: { preview: 'p', full: 'f' } } },
      refundedAt: null, isDegraded: false,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).emitStaticSections = emit;
    await setup(svc, subscriber());
    expect(emit).toHaveBeenCalled();
  });

  it('still refuses a REFUNDED row via the pre-existing gate', async () => {
    const svc = build({
      id: 'reading-1', userId: USER_ID, creditsUsed: 3,
      aiInterpretation: null, refundedAt: new Date(), isDegraded: false,
    });
    await expect(setup(svc, subscriber())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'READING_REFUNDED' }),
    });
  });

  it('does NOT refuse a normally-charged row awaiting generation', async () => {
    const svc = build({
      id: 'reading-1', userId: USER_ID, creditsUsed: 3,
      aiInterpretation: null, refundedAt: null, isDegraded: false,
    });
    // Passes both gates; fails later for want of a fuller harness, which is
    // what we want — the assertion is that it is NOT refused by our gate.
    await expect(setup(svc, subscriber())).rejects.not.toMatchObject({
      response: expect.objectContaining({ code: 'READING_NOT_PAID' }),
    });
  });
});
