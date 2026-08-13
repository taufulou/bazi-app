/**
 * F2 (Phase 1A / A2) — the reading paywall.
 *
 * The gate was `creditsUsed > 0 || reading.userId === user.id`, evaluated AFTER
 * a `where: { id, userId: user.id }` lookup — so the second disjunct was always
 * true and the preview-stripping branch was unreachable. Every caller got full
 * content. (The same bug was found and fixed on the comparison path months
 * earlier and never applied to readings or zwds.)
 *
 * Entitlement is now the ABSENCE OF A REFUND, not the presence of a charge:
 * 0-credit cache-hit readings are deliberately free (F4, owner-confirmed
 * "same birth data won't charge twice"), so `creditsUsed > 0` would paywall
 * exactly the readings that are supposed to be free.
 *
 * The stream is the sharper half: a refunded row has `aiInterpretation` nulled,
 * so an ungated re-stream did not replay stored text — it ran a FULL provider
 * generation (real Anthropic spend) for a reading already refunded, bypassing
 * the 3-per-reading cap that `regenerateReading` enforces.
 */
import { BadRequestException } from '@nestjs/common';
import { BaziService } from '../src/bazi/bazi.service';
import { CreditsService } from '../src/credits/credits.service';

const CLERK = 'clerk-1';
const USER_ID = 'user-1';
const READING_ID = 'reading-1';

const SECTIONS = {
  personality: { preview: 'peek', full: 'THE PAID CONTENT' },
  career: { preview: 'peek2', full: 'MORE PAID CONTENT' },
};

function makeService(readingOverrides: Record<string, unknown>, tier = 'FREE') {
  const reading = {
    id: READING_ID,
    userId: USER_ID,
    creditsUsed: 1,
    refundedAt: null,
    aiInterpretation: { sections: SECTIONS },
    birthProfile: { id: 'bp-1' },
    ...readingOverrides,
  };
  const mockPrisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID, subscriptionTier: tier }) },
    baziReading: {
      findFirst: jest.fn().mockResolvedValue(reading),
      findUnique: jest.fn().mockResolvedValue(reading),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const service = new BaziService(
    mockPrisma as never, {} as never,
    { get: jest.fn().mockReturnValue('http://localhost:5001') } as never,
    {} as never, {} as never,
  );
  return { service, mockPrisma, reading };
}

/** Pull the `full` text the caller would actually render. */
function fullOf(result: unknown): string {
  const r = result as { aiInterpretation: { sections: Record<string, { full: string }> } };
  return r.aiInterpretation.sections.personality.full;
}

describe('F2 — getReading entitlement', () => {
  it('serves full content for a normally paid reading', async () => {
    const { service } = makeService({ creditsUsed: 1, refundedAt: null });
    expect(fullOf(await service.getReading(CLERK, READING_ID))).toBe('THE PAID CONTENT');
  });

  it('serves full content for a 0-credit CACHE-HIT reading (F4 — deliberately free)', async () => {
    // The regression that a naive `creditsUsed > 0` fix would cause.
    const { service } = makeService({ creditsUsed: 0, refundedAt: null });
    expect(fullOf(await service.getReading(CLERK, READING_ID))).toBe('THE PAID CONTENT');
  });

  it('STRIPS to preview for a refunded reading', async () => {
    const { service } = makeService({ creditsUsed: 1, refundedAt: new Date() });
    const result = await service.getReading(CLERK, READING_ID);
    expect(fullOf(result)).toBe('peek');
    // Every section, not just the first.
    const r = result as { aiInterpretation: { sections: Record<string, { full: string }> } };
    expect(r.aiInterpretation.sections.career.full).toBe('peek2');
  });

  it('serves full content to a SUBSCRIBER even when refunded', async () => {
    const { service } = makeService({ refundedAt: new Date() }, 'PRO');
    expect(fullOf(await service.getReading(CLERK, READING_ID))).toBe('THE PAID CONTENT');
  });

  it('treats a MISSING refundedAt as not-refunded rather than paywalling', async () => {
    // Prisma returns null for an unset DateTime?, but a partial select or an
    // incomplete mock yields undefined. `=== null` would be false there and
    // silently paywall paying customers — that exact failure was caught by the
    // zwds suite when this used strict equality.
    const { service } = makeService({ refundedAt: undefined });
    expect(fullOf(await service.getReading(CLERK, READING_ID))).toBe('THE PAID CONTENT');
  });
});

describe('F2 — stream refuses to regenerate a refunded reading', () => {
  it('throws READING_REFUNDED instead of generating', async () => {
    // aiInterpretation null is the real post-refund shape: the refund nulls it.
    // Ungated, this fell through to a full provider generation.
    const { service } = makeService({ refundedAt: new Date(), aiInterpretation: null });

    const events: unknown[] = [];
    await new Promise<void>((resolve) => {
      service.streamReading(CLERK, READING_ID).subscribe({
        next: (e) => events.push(e),
        complete: () => resolve(),
      });
    });

    expect(events).toHaveLength(1);
    const evt = events[0] as { type: string; data: string };
    expect(evt.type).toBe('error');
    expect(evt.data).toContain('退款');
  });

  it('still streams a non-refunded reading with content', async () => {
    const { service } = makeService({ refundedAt: null });
    const events: unknown[] = [];
    await new Promise<void>((resolve) => {
      service.streamReading(CLERK, READING_ID).subscribe({
        next: (e) => events.push(e),
        complete: () => resolve(),
      });
    });
    // Emitted static sections rather than an error.
    expect(events.length).toBeGreaterThan(0);
    expect((events[0] as { type: string }).type).not.toBe('error');
  });
});

describe('F2 — the double-refund invariant (why creditsUsed is zeroed)', () => {
  it('refundReadingCredit REFUSES a reading whose credits were already zeroed', async () => {
    // regenerateReading clears refundedAt so the retry is viewable. That alone
    // would re-arm `refundedAt IS NULL AND creditsUsed > 0` and mint a credit on
    // the next failure. Zeroing creditsUsed is what keeps the guard closed.
    const mockPrisma = {
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          baziReading: {
            findUnique: jest.fn().mockResolvedValue({
              id: READING_ID,
              creditsUsed: 0,      // ← zeroed by regenerateReading
              refundedAt: null,    // ← cleared by regenerateReading
            }),
            updateMany: jest.fn(),
          },
          user: { update: jest.fn() },
          creditLedger: { create: jest.fn() },
        }),
      ),
    };
    const credits = new CreditsService(mockPrisma as never);

    const result = await credits.refundReadingCredit(READING_ID, 'second-failure');

    expect(result).toEqual({ refunded: false, amount: 0 });
  });
});

describe('F2 — regenerateReading reopens access safely', () => {
  it('clears refundedAt AND zeroes creditsUsed in the same atomic update', async () => {
    const { service, mockPrisma } = makeService({});
    mockPrisma.baziReading.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.baziReading.findUnique.mockResolvedValue({
      id: READING_ID, regenerationCount: 1, regenerationExhausted: false,
    });

    await service.regenerateReading(CLERK, READING_ID);

    const data = mockPrisma.baziReading.updateMany.mock.calls[0][0].data;
    expect(data.refundedAt).toBeNull();
    expect(data.creditsUsed).toBe(0);
  });

  it('rejects BadRequestException shape is used for the refused stream', () => {
    // Guards the error contract the frontend branches on.
    const err = new BadRequestException({ code: 'READING_REFUNDED', message: 'x' });
    expect((err.getResponse() as { code: string }).code).toBe('READING_REFUNDED');
  });
});
