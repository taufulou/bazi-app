/**
 * A6 (Phase 1A) — refund / clawback idempotency.
 *
 * Every path that hands credits back is reachable more than once: the AI
 * failure handler and the client-disconnect handler can both fire for one
 * message, RevenueCat redelivers webhooks, and a user can retry a failed
 * reading. Each replay must be a no-op, not a second credit.
 *
 * These tests drive the REAL guard logic against an in-memory store that
 * enforces the same conditional-update semantics Postgres does, so a second
 * call returns `refunded: false` because the service's own `WHERE
 * refunded_at IS NULL` matched nothing — not because a mock said so. Deleting
 * a guard from the `where` clause makes the paired test fail.
 */
import { CreditsService } from '../src/credits/credits.service';
import { ChatPaymentService } from '../src/chat/chat-payment.service';
import { EntitlementsService } from '../src/payments/entitlements.service';

const USER = 'user-1';

// ============================================================
// Shared in-memory fake — conditional-update semantics
// ============================================================

interface Row {
  [k: string]: unknown;
}

/** Emulates Prisma's `where` for the shapes these guards actually use. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond !== null && typeof cond === 'object') {
      const c = cond as Record<string, unknown>;
      if ('gt' in c) return typeof value === 'number' && value > (c.gt as number);
      if ('gte' in c) return typeof value === 'number' && value >= (c.gte as number);
      if ('not' in c) return value !== c.not;
      throw new Error(`fake prisma: unsupported condition ${JSON.stringify(cond)}`);
    }
    return value === cond;
  });
}

/** Emulates Prisma's `data` for the shapes these guards actually use. */
function applyData(row: Row, data: Record<string, unknown>): void {
  for (const [key, val] of Object.entries(data)) {
    if (val !== null && typeof val === 'object' && 'increment' in (val as object)) {
      row[key] = (row[key] as number) + (val as { increment: number }).increment;
    } else if (val !== null && typeof val === 'object' && 'decrement' in (val as object)) {
      row[key] = (row[key] as number) - (val as { decrement: number }).decrement;
    } else {
      row[key] = val;
    }
  }
}

function makeTable(rows: Record<string, Row>) {
  return {
    rows,
    // ⚠️ Reads return a SNAPSHOT, not the live row. This is load-bearing for the
    // concurrency tests: handing back the live object would let a racing
    // caller's write retroactively change what an earlier reader saw, so the
    // cheap pre-read would appear to stop the double-refund and the atomic
    // `updateMany` guard — the thing that actually stops it in Postgres —
    // would never be exercised. (Verified by mutation: with a live reference,
    // deleting the guard still passed.)
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
      rows[where.id] ? { ...rows[where.id] } : null,
    ),
    findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
      const r = rows[where.id];
      if (!r) throw new Error('not found');
      return { ...r };
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
      const r = rows[where.id];
      if (!r) throw new Error('not found');
      applyData(r, data);
      return r;
    }),
    updateMany: jest.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Row }) => {
        const id = where.id as string;
        const r = rows[id];
        if (!r || !matches(r, where)) return { count: 0 };
        applyData(r, data);
        return { count: 1 };
      },
    ),
  };
}

function makeLedger() {
  const entries: Row[] = [];
  return {
    entries,
    create: jest.fn(async ({ data }: { data: Row }) => {
      entries.push(data);
      return data;
    }),
  };
}

// ============================================================
// Path 1 — reading refund
// ============================================================

describe('A6 path 1 — refundReadingCredit is idempotent', () => {
  function setup() {
    const users = makeTable({ [USER]: { id: USER, credits: 0 } });
    const readings = makeTable({
      'rd-1': { id: 'rd-1', userId: USER, creditsUsed: 2, refundedAt: null },
    });
    const creditLedger = makeLedger();
    const client = { user: users, baziReading: readings, creditLedger };
    const prisma = {
      ...client,
      $transaction: (fn: (tx: unknown) => unknown) => fn(client),
    };
    return { service: new CreditsService(prisma as never), users, readings, creditLedger };
  }

  it('refunds once, then no-ops', async () => {
    const { service, users, creditLedger } = setup();

    const first = await service.refundReadingCredit('rd-1', 'ai-failed');
    expect(first).toEqual({ refunded: true, amount: 2 });
    expect(users.rows[USER].credits).toBe(2);

    const second = await service.refundReadingCredit('rd-1', 'ai-failed');
    expect(second).toEqual({ refunded: false, amount: 0 });

    // The balance and the ledger are what actually matter — one movement only.
    expect(users.rows[USER].credits).toBe(2);
    expect(creditLedger.entries).toHaveLength(1);
    expect(creditLedger.entries[0]).toMatchObject({ userId: USER, amount: 2, readingId: 'rd-1' });
  });

  it('survives concurrent callers — only one wins the guard', async () => {
    const { service, users, creditLedger } = setup();
    const results = await Promise.all([
      service.refundReadingCredit('rd-1', 'a'),
      service.refundReadingCredit('rd-1', 'b'),
      service.refundReadingCredit('rd-1', 'c'),
    ]);
    expect(results.filter((r) => r.refunded)).toHaveLength(1);
    expect(users.rows[USER].credits).toBe(2);
    expect(creditLedger.entries).toHaveLength(1);
  });

  it('does not refund a row that was never charged', async () => {
    // A cache-hit reading costs 0 credits (F4 — intended pricing). Refunding it
    // would MINT credits the user never spent.
    const users = makeTable({ [USER]: { id: USER, credits: 0 } });
    const readings = makeTable({
      'rd-0': { id: 'rd-0', userId: USER, creditsUsed: 0, refundedAt: null },
    });
    const creditLedger = makeLedger();
    const client = { user: users, baziReading: readings, creditLedger };
    const prisma = { ...client, $transaction: (fn: (tx: unknown) => unknown) => fn(client) };
    const service = new CreditsService(prisma as never);

    await expect(service.refundReadingCredit('rd-0', 'ai-failed')).resolves.toEqual({
      refunded: false,
      amount: 0,
    });
    expect(users.rows[USER].credits).toBe(0);
    expect(creditLedger.entries).toHaveLength(0);
  });
});

// ============================================================
// Path 2 — comparison refund
// ============================================================

describe('A6 path 2 — refundComparisonCredit is idempotent', () => {
  function setup() {
    const users = makeTable({ [USER]: { id: USER, credits: 0 } });
    const comparisons = makeTable({
      'cmp-1': {
        id: 'cmp-1',
        userId: USER,
        creditsUsed: 3,
        refundedAt: null,
        paidAt: new Date('2026-01-01'),
        aiInterpretation: { some: 'report' },
      },
    });
    const creditLedger = makeLedger();
    const client = { user: users, baziComparison: comparisons, creditLedger };
    const prisma = { ...client, $transaction: (fn: (tx: unknown) => unknown) => fn(client) };
    return {
      service: new CreditsService(prisma as never),
      users,
      comparisons,
      creditLedger,
    };
  }

  it('refunds once, then no-ops', async () => {
    const { service, users, creditLedger } = setup();

    expect(await service.refundComparisonCredit('cmp-1', 'reveal-failed')).toEqual({
      refunded: true,
      amount: 3,
    });
    expect(await service.refundComparisonCredit('cmp-1', 'reveal-failed')).toEqual({
      refunded: false,
      amount: 0,
    });

    expect(users.rows[USER].credits).toBe(3);
    expect(creditLedger.entries).toHaveLength(1);
  });

  it('revokes access alongside the refund — credits back AND report gone', async () => {
    // The money half is only half the fix: leaving `paidAt` set would give a
    // refunded user their credits back while keeping the report they paid for.
    const { service, comparisons } = setup();
    await service.refundComparisonCredit('cmp-1', 'reveal-failed');

    expect(comparisons.rows['cmp-1'].paidAt).toBeNull();
    expect(comparisons.rows['cmp-1'].aiInterpretation).not.toEqual({ some: 'report' });
    expect(comparisons.rows['cmp-1'].refundedAt).toBeInstanceOf(Date);
  });
});

// ============================================================
// Path 3 — chat message refund
// ============================================================

describe('A6 path 3 — refundLastMessage is idempotent', () => {
  function setup(paymentMethod: 'FREE_QUOTA' | 'PAID_ALLOWANCE') {
    const messages = makeTable({
      'msg-1': { id: 'msg-1', sessionId: 'sess-1', paymentMethod, refundedAt: null },
    });
    const sessions = makeTable({
      'sess-1': {
        id: 'sess-1',
        userId: USER,
        freeQuotaConsumed: 1,
        paidMessagesUsed: 1,
      },
    });
    const executeRaw = jest.fn(async () => 1);
    const client = {
      chatMessage: messages,
      chatSession: sessions,
      $executeRaw: executeRaw,
    };
    const prisma = { ...client, $transaction: (fn: (tx: unknown) => unknown) => fn(client) };
    const service = new ChatPaymentService(prisma as never, {} as never);
    return { service, messages, sessions, executeRaw };
  }

  it('FREE_QUOTA: refunds once, then no-ops', async () => {
    const { service, sessions, executeRaw } = setup('FREE_QUOTA');

    expect(await service.refundLastMessage('msg-1', 'sess-1', USER, 'ai-failed')).toEqual({
      refunded: true,
      method: 'FREE_QUOTA',
    });
    expect(sessions.rows['sess-1'].freeQuotaConsumed).toBe(0);
    expect(executeRaw).toHaveBeenCalledTimes(1);

    expect(await service.refundLastMessage('msg-1', 'sess-1', USER, 'client-disconnected')).toEqual({
      refunded: false,
      method: null,
    });
    // The monthly-usage decrement must NOT run a second time.
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(sessions.rows['sess-1'].freeQuotaConsumed).toBe(0);
  });

  it('PAID_ALLOWANCE: refunds once, then no-ops', async () => {
    const { service, sessions } = setup('PAID_ALLOWANCE');

    expect(await service.refundLastMessage('msg-1', 'sess-1', USER, 'ai-failed')).toEqual({
      refunded: true,
      method: 'PAID_ALLOWANCE',
    });
    expect(sessions.rows['sess-1'].paidMessagesUsed).toBe(0);

    expect(await service.refundLastMessage('msg-1', 'sess-1', USER, 'refuse')).toEqual({
      refunded: false,
      method: null,
    });
    expect(sessions.rows['sess-1'].paidMessagesUsed).toBe(0);
  });

  it('the two real callers converging on one message refund it once', async () => {
    // The AI-failure handler and the disconnect handler are separate code
    // paths that can both reach the same message id.
    const { service, sessions } = setup('PAID_ALLOWANCE');
    const [a, b] = await Promise.all([
      service.refundLastMessage('msg-1', 'sess-1', USER, 'ai-stream-failed'),
      service.refundLastMessage('msg-1', 'sess-1', USER, 'client-disconnected'),
    ]);
    expect([a.refunded, b.refunded].filter(Boolean)).toHaveLength(1);
    expect(sessions.rows['sess-1'].paidMessagesUsed).toBe(0);
  });

  it('rejects a message belonging to a different session', async () => {
    const { service } = setup('PAID_ALLOWANCE');
    await expect(
      service.refundLastMessage('msg-1', 'other-session', USER, 'x'),
    ).resolves.toEqual({ refunded: false, method: null });
  });
});

// ============================================================
// Path 4 — RevenueCat consumable clawback
// ============================================================

describe('A6 path 4 — clawbackCredits floors at zero and is ledgered', () => {
  function setup(preUpdateBalance: number, amount: number) {
    // clawbackCredits does its arithmetic in SQL (GREATEST/LEAST in one
    // row-locked UPDATE), so the fake stands in for the query result.
    const creditLedger = makeLedger();
    const clawed = Math.min(amount, preUpdateBalance);
    const client = {
      creditLedger,
      $queryRaw: jest.fn(async () => [{ clawed_back: clawed }]),
    };
    const prisma = { ...client, $transaction: (fn: (tx: unknown) => unknown) => fn(client) };
    const service = new EntitlementsService(prisma as never, {} as never);
    return { service, creditLedger, queryRaw: client.$queryRaw };
  }

  it('claws back what is there and ledgers a matching negative', async () => {
    const { service, creditLedger } = setup(10, 4);
    await expect(service.clawbackCredits(USER, 4, 'iap-refund')).resolves.toEqual({
      clawedBack: 4,
    });
    expect(creditLedger.entries).toEqual([
      { userId: USER, amount: -4, reason: 'iap-refund' },
    ]);
  });

  it('floors at the remaining balance rather than going negative', async () => {
    // Pack already spent: claw back only what is left, never below zero.
    const { service, creditLedger } = setup(1, 5);
    await expect(service.clawbackCredits(USER, 5, 'iap-refund')).resolves.toEqual({
      clawedBack: 1,
    });
    expect(creditLedger.entries[0]).toMatchObject({ amount: -1 });
  });

  it('writes NO ledger row when fully floored', async () => {
    const { service, creditLedger } = setup(0, 5);
    await expect(service.clawbackCredits(USER, 5, 'iap-refund')).resolves.toEqual({
      clawedBack: 0,
    });
    expect(creditLedger.entries).toHaveLength(0);
  });

  it('ignores non-positive amounts without touching the DB', async () => {
    const { service, queryRaw } = setup(10, 0);
    await expect(service.clawbackCredits(USER, 0, 'x')).resolves.toEqual({ clawedBack: 0 });
    await expect(service.clawbackCredits(USER, -3, 'x')).resolves.toEqual({ clawedBack: 0 });
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
