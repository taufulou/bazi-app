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
import { ConflictException } from '@nestjs/common';
import { BaziService } from '../src/bazi/bazi.service';
import { CreditsService } from '../src/credits/credits.service';
import { ShutdownService } from '../src/common/shutdown.service';

const CLERK = 'clerk-1';
const USER_ID = 'user-1';
const READING_ID = 'reading-1';

const SECTIONS = {
  personality: { preview: 'peek', full: 'THE PAID CONTENT' },
  career: { preview: 'peek2', full: 'MORE PAID CONTENT' },
};

function makeService(
  readingOverrides: Record<string, unknown>,
  tier = 'FREE',
  credits?: { refundReadingCredit: jest.Mock },
) {
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
    {} as never, (credits ?? {}) as never,
    { consume: jest.fn(), peek: jest.fn(), limitFor: () => 100 } as never,
    // S2 — the cap pre-check that now runs before every quota consume.
    { assertUnderCap: jest.fn(), record: jest.fn(), recordFailure: jest.fn(), estimateCostUsd: jest.fn(() => 0.01) } as never,
    new ShutdownService(),
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
    // Since the PR #73 review fixes `streamReading` forwards the typed `code`
    // (picked by name) alongside the message — see the describe below.
    expect(JSON.parse(evt.data).code).toBe('READING_REFUNDED');
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
   * The reachability argument these tests encode: `regenerateReading`'s WHERE
   * requires `refundedAt: null` (enforced since todo #3), so it can only ever
   * match a row that was charged and NOT refunded. For rows the pipeline
   * produced that was already implied by `isDegraded: true` — `ai.service.ts`
   * computes ONE exclusive status per attempt and refunds only on 'failed' —
   * but an operator refund breaks the implication, which is why the WHERE no
   * longer leans on it.
   *
   * An earlier revision cleared `refundedAt` and zeroed `creditsUsed` here to
   * close a double-refund that regeneration was believed to open. It closed
   * nothing (the WHERE already requires the column to be null) and it broke the
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
    // The reachability argument above depends on BOTH conjuncts staying in the
    // WHERE: `refundedAt: null` is what guarantees the row was not refunded,
    // `isDegraded: true` is what makes it a regeneration candidate at all.
    expect(call.where).toMatchObject({ isDegraded: true, refundedAt: null });
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

// ============================================================
// The SSE `error` event's wire contract (PR #73 review fix A)
// ============================================================

describe('streamReading — the SSE error payload carries typed fields, picked by NAME', () => {
  /**
   * Until the PR #73 review fixes `streamReading` forwarded `err.message` ONLY,
   * so no typed `code` ever reached a client and a test that asserted one was
   * (rightly) deleted as guarding a contract that did not exist. The contract
   * exists now: step 2b REFUNDS a charged-empty non-streamable row and the web
   * branches on `refunded` to show its refund banner. These tests pin the exact
   * payload for every exception SHAPE the catch can see, because the one way to
   * get this wrong — spreading `getResponse()` — only leaks for a string-built
   * exception (`{message, error, statusCode}`), never for an object-built one.
   */
  // Resolves the RAW event list; the structural assertions run in the test
  // body. An `expect` that throws inside an rxjs `complete` callback goes to
  // `reportUnhandledError`, never rejects the promise, and the test would die
  // as a 5 s timeout with no matcher message instead of a legible red.
  const collect = (service: BaziService) =>
    new Promise<Array<{ type: string; data: string }>>((resolve) => {
      const events: Array<{ type: string; data: string }> = [];
      service.streamReading(CLERK, READING_ID).subscribe({
        next: (e) => events.push(e as { type: string; data: string }),
        complete: () => resolve(events),
      });
    });
  const payloadOf = (events: Array<{ type: string; data: string }>): Record<string, unknown> => {
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    return JSON.parse(events[0].data);
  };

  it('forwards code/refunded/refundedAmount for a typed refusal, and nothing else', async () => {
    // A paid-empty HEALTH row: past 1b (not refunded), 1c (charged), step 2
    // (no content) → 2b refuses AND refunds. `toEqual` is exact — a leaked
    // `statusCode` or `error` key fails it.
    const refundReadingCredit = jest.fn().mockResolvedValue({ refunded: true, amount: 2 });
    const { service } = makeService(
      { readingType: 'HEALTH', aiInterpretation: null, creditsUsed: 2 },
      'FREE',
      { refundReadingCredit },
    );
    const payload = payloadOf(await collect(service));
    expect(payload).toEqual({
      message: expect.stringContaining('已退回'),
      code: 'READING_TYPE_NOT_STREAMABLE',
      refunded: true,
      refundedAmount: 2,
    });
    // `refundedAmount: 2` is the row's `creditsUsed`; this proves the money
    // actually moved rather than the number being copied from the row.
    expect(refundReadingCredit).toHaveBeenCalledTimes(1);
    expect(refundReadingCredit).toHaveBeenCalledWith(READING_ID, 'not-streamable:HEALTH');
  });

  it('forwards message ONLY for a string-built HttpException — the shape a spread would leak', async () => {
    // The real step-3 refusal. Nest builds `{message, error: 'Conflict',
    // statusCode: 409}` for a string argument; pick-by-name forwards none of
    // the internals.
    const { service } = makeService({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)._setupStream = jest
      .fn()
      .mockRejectedValue(new ConflictException('Maximum concurrent streams reached'));
    const payload = payloadOf(await collect(service));
    expect(payload).toEqual({ message: 'Maximum concurrent streams reached' });
  });

  it('forwards message ONLY for a plain Error', async () => {
    const { service } = makeService({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)._setupStream = jest.fn().mockRejectedValue(new Error('boom'));
    const payload = payloadOf(await collect(service));
    expect(payload).toEqual({ message: 'boom' });
  });
});

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
      { consume: jest.fn(), peek: jest.fn(), limitFor: () => 100 } as never,
    // S2 — the cap pre-check that now runs before every quota consume.
    { assertUnderCap: jest.fn(), record: jest.fn(), recordFailure: jest.fn(), estimateCostUsd: jest.fn(() => 0.01) } as never,
      new ShutdownService(),
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
