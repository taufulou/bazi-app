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

  it('STRIPS a refunded reading for a SUBSCRIBER too (F-4)', async () => {
    // Flipped from the original expectation. The gate used to read
    // `isSubscriber || isEntitled`, which handed a refunded subscriber the full
    // report — removing exactly the coverage the gate exists to provide.
    //
    // Subscribers are not exempt from paying: `createReading` computes
    // `creditsUsed = fromCache ? 0 : service.creditCost` with no tier branch.
    // A refunded subscriber has their credits back and is no more entitled to
    // this reading than a free user. The chat gate (F6) and the fortune window
    // (F5) both already had no subscriber exemption; this was the odd one out.
    const { service } = makeService({ refundedAt: new Date() }, 'PRO');
    expect(fullOf(await service.getReading(CLERK, READING_ID))).toBe('peek');
  });

  it('still serves full content to a SUBSCRIBER who was NOT refunded', async () => {
    // Negative control — the fix must not paywall ordinary subscribers.
    const { service } = makeService({ refundedAt: null }, 'PRO');
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

describe('F2 — regeneration must not destroy the record of a real charge', () => {
  /**
   * The reachability argument these tests encode: `ai.service.ts` computes ONE
   * exclusive status per attempt and sets `isDegraded` only on 'degraded',
   * while the refund fires only on 'failed'. `regenerateReading`'s WHERE
   * requires `isDegraded: true`, so it can only ever match a row that was
   * charged and NOT refunded.
   *
   * An earlier revision cleared `refundedAt` and zeroed `creditsUsed` here to
   * close a double-refund that regeneration was believed to open. It closed
   * nothing (the column is already null on every matching row) and it broke the
   * case that IS reachable — see the second test.
   */
  it('leaves refundedAt and creditsUsed untouched', async () => {
    const { service, mockPrisma } = makeService({});
    mockPrisma.baziReading.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.baziReading.findUnique.mockResolvedValue({
      id: READING_ID, regenerationCount: 1, regenerationExhausted: false,
    });

    await service.regenerateReading(CLERK, READING_ID);

    const call = mockPrisma.baziReading.updateMany.mock.calls[0][0];
    // The reachability argument above depends on this guard staying in the WHERE.
    expect(call.where).toMatchObject({ isDegraded: true });
    expect(call.data).not.toHaveProperty('creditsUsed');
    expect(call.data).not.toHaveProperty('refundedAt');
  });

  it('a degraded reading that fails again STILL refunds the original charge', async () => {
    // The user paid 3 credits, got partial content, took the free retry, and the
    // retry failed too. They must get the 3 credits back. Zeroing `creditsUsed`
    // during regeneration tripped `refundReadingCredit`'s own `creditsUsed > 0`
    // guard and silently swallowed the refund.
    const reading = {
      id: READING_ID,
      userId: 'user-1',
      creditsUsed: 3,     // survived regeneration
      refundedAt: null,   // never refunded — 'degraded', not 'failed'
    };
    const userUpdate = jest.fn();
    const ledgerCreate = jest.fn();
    const mockPrisma = {
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          baziReading: {
            findUnique: jest.fn().mockResolvedValue({ ...reading }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          user: { update: userUpdate },
          creditLedger: { create: ledgerCreate },
        }),
      ),
    };
    const credits = new CreditsService(mockPrisma as never);

    const result = await credits.refundReadingCredit(READING_ID, 'regen-also-failed');

    expect(result).toEqual({ refunded: true, amount: 3 });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { credits: { increment: 3 } },
    });
    expect(ledgerCreate).toHaveBeenCalled();
  });

  it('a reading already refunded once is not refunded twice', async () => {
    // The invariant the removed zeroing was reaching for. It is already held by
    // `refundedAt`, which regeneration no longer clears.
    const mockPrisma = {
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          baziReading: {
            findUnique: jest.fn().mockResolvedValue({
              id: READING_ID, userId: 'user-1', creditsUsed: 3,
              refundedAt: new Date('2026-08-01'),
            }),
            updateMany: jest.fn(),
          },
          user: { update: jest.fn() },
          creditLedger: { create: jest.fn() },
        }),
      ),
    };
    const credits = new CreditsService(mockPrisma as never);

    await expect(
      credits.refundReadingCredit(READING_ID, 'second-failure'),
    ).resolves.toEqual({ refunded: false, amount: 0 });
  });

});

// Removed: a test that constructed a `BadRequestException({ code: 'READING_REFUNDED' })`
// inline and asserted its own `code`. It exercised NestJS, not this codebase —
// it would have passed with `bazi.service.ts` deleted — while describing itself
// as locking "the error contract the frontend branches on". No frontend branches
// on it: `streamReading` forwards only `err.message` into the SSE error event,
// so the code never reaches a client. Deleted rather than "fixed", because the
// contract it claimed to guard does not exist.

// ============================================================
// F-4 sibling — getComparison (B1/B2 audit finding 6)
// ============================================================

describe('F-4 sibling — getComparison has no subscriber exemption either', () => {
  /**
   * ⚠️ F-4's stated "tell" was that the chat and fortune gates carry no
   * subscriber exemption while `getReading` did. The audit pointed out that
   * `getComparison`, one screen away, still did — and that removing
   * `isSubscriber ||` there passed all 1534 tests, so it was neither a pinned
   * product decision nor covered.
   *
   * The refund case was already handled more strongly than on the reading path
   * (`refundComparisonCredit` clears `paidAt` AND nulls `aiInterpretation`
   * atomically). The live gap is the state `bazi.service.ts:922-924` names:
   * "an unpaid row with a stale interpretation falls through to the charge" —
   * 3 credits on the SSE path, free to a subscriber here.
   */
  const CMP_ID = 'cmp-1';

  function makeCmpService(paidAt: Date | null, tier = 'PRO') {
    const comparison = {
      id: CMP_ID,
      userId: USER_ID,
      paidAt,
      aiInterpretation: { sections: SECTIONS },
    };
    const mockPrisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID, subscriptionTier: tier }) },
      baziComparison: { findFirst: jest.fn().mockResolvedValue(comparison) },
    };
    const service = new BaziService(
      mockPrisma as never, {} as never,
      { get: jest.fn().mockReturnValue('http://localhost:5001') } as never,
      {} as never, {} as never,
    );
    return { service };
  }

  const cmpFull = (r: unknown): string =>
    (r as { aiInterpretation: { sections: Record<string, { full: string }> } })
      .aiInterpretation.sections.personality.full;

  it('STRIPS an unpaid comparison for a SUBSCRIBER', async () => {
    const { service } = makeCmpService(null, 'PRO');
    expect(cmpFull(await service.getComparison(CLERK, CMP_ID))).toBe('peek');
  });

  it('still serves a PAID comparison to a subscriber', async () => {
    const { service } = makeCmpService(new Date(), 'PRO');
    expect(cmpFull(await service.getComparison(CLERK, CMP_ID))).toBe('THE PAID CONTENT');
  });

  it('still serves a PAID comparison to a FREE user', async () => {
    // Negative control in the other direction — paying is what entitles, not tier.
    const { service } = makeCmpService(new Date(), 'FREE');
    expect(cmpFull(await service.getComparison(CLERK, CMP_ID))).toBe('THE PAID CONTENT');
  });
});
