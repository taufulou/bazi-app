/**
 * `QuotaService.check` — the non-consuming pre-flight added for #21a.
 *
 * It exists so a caller that CHARGES CREDITS before reaching `consume` can
 * refuse first. Two properties matter and neither is obvious from the code:
 * it must be indistinguishable from `consume` to `isQuotaError`, and it must
 * not spend a unit.
 */
import { QuotaService } from '../src/ai/quota.service';
import { isQuotaError } from '../src/ai/typed-refusals';

describe('QuotaService.check', () => {
  const build = (limit: number, used: number, throws = false) => {
    const incrementRateLimit = jest.fn().mockResolvedValue(used + 1);
    const getRateLimit = throws
      ? jest.fn().mockRejectedValue(new Error('redis down'))
      : jest.fn().mockResolvedValue(used);
    const svc = Object.create(QuotaService.prototype) as QuotaService;
    Object.assign(svc, {
      redis: { getRateLimit, incrementRateLimit },
      logger: { warn: jest.fn(), error: jest.fn() },
      limitFor: () => limit,
      key: (k: string, u: string) => `quota:${k}:${u}`,
    });
    return { svc, incrementRateLimit, getRateLimit };
  };

  it('passes under the limit and spends nothing', async () => {
    const { svc, incrementRateLimit } = build(5, 2);
    await expect(svc.check('reading', 'u1')).resolves.toBeUndefined();
    expect(incrementRateLimit).not.toHaveBeenCalled();
  });

  it('refuses AT the limit — the boundary `consume` would refuse on the next unit', async () => {
    // `consume` increments first and throws on `used > limit`, so the
    // pre-increment equivalent is `used >= limit`. Off by one here and the
    // caller charges for the request that quota is about to reject.
    const { svc } = build(5, 5);
    await expect(svc.check('reading', 'u1')).rejects.toBeDefined();
  });

  it('throws something `isQuotaError` matches — the refusal must be recognisable', async () => {
    // The refund backstop and every graceful-degradation catch key off this
    // predicate. A hand-built second throw is how it silently stops matching.
    const { svc } = build(1, 1);
    await svc.check('reading', 'u1').then(
      () => { throw new Error('should have refused'); },
      (err) => expect(isQuotaError(err)).toBe(true),
    );
  });

  it('is a no-op when the limit is 0 (disabled)', async () => {
    const { svc, getRateLimit } = build(0, 999);
    await expect(svc.check('reading', 'u1')).resolves.toBeUndefined();
    expect(getRateLimit).not.toHaveBeenCalled();
  });

  it('fails OPEN when Redis is unreachable — same direction as `consume`', async () => {
    // Quota is a fairness control, not a safety one. S1 and S2 still apply, and
    // refusing every reading during a Redis blip would be far worse.
    const { svc } = build(5, 99, true);
    await expect(svc.check('reading', 'u1')).resolves.toBeUndefined();
  });
});
