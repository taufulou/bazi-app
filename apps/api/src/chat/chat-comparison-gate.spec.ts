import { BadRequestException } from '@nestjs/common';
import { ChatService } from './chat.service';

/**
 * Bundle A §A6 — a comparison chat requires the comparison to be PAID FOR.
 *
 * Ownership alone is not enough. The compat chat context is built from
 * `calculationData` via the engine, NOT from `aiInterpretation`, so it carries
 * the dimension scores, 配偶宮 findings, knockouts and the score pivot — i.e. the
 * paid analysis. Before Bundle A that was safe only because creating a
 * comparison cost 3 credits; creation is now free.
 */
describe('ChatService.assertComparisonUnlocked', () => {
  function build(row: Record<string, unknown> | null) {
    const prisma = { baziComparison: { findUnique: jest.fn().mockResolvedValue(row) } };
    // Only `prisma` is exercised; the rest of the constructor deps are inert here.
    const svc = Object.create(ChatService.prototype) as ChatService;
    (svc as unknown as { prisma: unknown }).prisma = prisma;
    return svc;
  }

  it('allows an unlocked comparison', async () => {
    const svc = build({ paidAt: new Date() });
    await expect(svc.assertComparisonUnlocked('cmp-1')).resolves.toBeUndefined();
  });

  it('REJECTS an unpaid comparison', async () => {
    const svc = build({ paidAt: null });
    await expect(svc.assertComparisonUnlocked('cmp-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('REJECTS a missing comparison rather than failing open', async () => {
    const svc = build(null);
    await expect(svc.assertComparisonUnlocked('nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('uses the COMPARISON_NOT_UNLOCKED code the clients dispatch on', async () => {
    const svc = build({ paidAt: null });
    await svc.assertComparisonUnlocked('cmp-1').catch((e: BadRequestException) => {
      expect((e.getResponse() as { code?: string }).code).toBe('COMPARISON_NOT_UNLOCKED');
    });
    expect.assertions(1);
  });
});
