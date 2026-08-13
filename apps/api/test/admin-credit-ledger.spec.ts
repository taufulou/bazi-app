/**
 * A7 (Phase 1A) — admin money ops are ledgered and atomic.
 *
 * `PATCH /api/admin/users/:id/credits` mints or removes real value. It was the
 * one credit path that wrote no `CreditLedger` row, so `sum(ledger)` stopped
 * reconciling against `user.credits` the moment support touched an account —
 * and it computed the new balance in JS from a stale read, so any spend landing
 * in the gap was silently handed back.
 *
 * These assert the two properties that make the endpoint auditable and safe:
 * a ledger row naming the acting admin, and a relative (not absolute) write.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AdminService } from '../src/admin/admin.service';
import { CreditsService } from '../src/credits/credits.service';
import { AdjustCreditsDto, ADMIN_CREDIT_ADJUST_MAX } from '../src/admin/dto/adjust-credits.dto';

const USER = 'user-1';
const ADMIN = 'clerk_admin_42';

interface UserRow {
  id: string;
  credits: number;
}

/**
 * @param onPreRead fires after the service's initial `findUnique` resolves —
 *        used to simulate a concurrent spend landing in the read/write gap.
 */
function setup(startingCredits: number, onPreRead?: (row: UserRow) => void) {
  const row: UserRow = { id: USER, credits: startingCredits };
  const ledger: Array<Record<string, unknown>> = [];
  const auditLogs: Array<Record<string, unknown>> = [];
  let preReadDone = false;

  const userTable = {
    findUnique: jest.fn(async () => {
      const snapshot = { ...row };
      if (!preReadDone) {
        preReadDone = true;
        onPreRead?.(row);
      }
      return snapshot;
    }),
    findUniqueOrThrow: jest.fn(async () => ({ ...row })),
    update: jest.fn(async ({ data }: { data: { credits?: { increment?: number } } }) => {
      if (data.credits?.increment === undefined) {
        throw new Error('fake prisma: expected a relative increment');
      }
      row.credits += data.credits.increment;
      return { ...row };
    }),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { credits?: { gte: number } };
        data: { credits: { decrement: number } };
      }) => {
        if (where.credits?.gte !== undefined && row.credits < where.credits.gte) {
          return { count: 0 };
        }
        row.credits -= data.credits.decrement;
        return { count: 1 };
      },
    ),
  };

  const client = {
    user: userTable,
    creditLedger: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        ledger.push(data);
        return data;
      }),
    },
    adminAuditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return data;
      }),
    },
  };

  const prisma = {
    ...client,
    $transaction: (fn: (tx: unknown) => unknown) => fn(client),
  };

  const service = new AdminService(
    prisma as never,
    {} as never,
    new CreditsService(prisma as never),
  );
  return { service, row, ledger, auditLogs, userTable };
}

const adjust = (amount: number, reason = 'support case #123') => ({ amount, reason });

describe('A7 — admin credit adjustments are ledgered', () => {
  it('writes a positive CreditLedger row naming the acting admin', async () => {
    const { service, ledger, row } = setup(5);

    await service.adjustUserCredits(USER, adjust(10) as never, ADMIN);

    expect(row.credits).toBe(15);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ userId: USER, amount: 10 });
    // The ledger has no actor column, so "who did this" has to survive in the
    // reason or it is unanswerable from the ledger alone.
    expect(ledger[0].reason).toContain(ADMIN);
    expect(ledger[0].reason).toContain('support case #123');
  });

  it('writes a negative CreditLedger row for a deduction', async () => {
    const { service, ledger, row } = setup(20);

    await service.adjustUserCredits(USER, adjust(-8, 'chargeback') as never, ADMIN);

    expect(row.credits).toBe(12);
    expect(ledger[0]).toMatchObject({ userId: USER, amount: -8 });
    expect(ledger[0].reason).toContain(ADMIN);
  });

  it('still writes the AdminAuditLog, with the true post-change balance', async () => {
    const { service, auditLogs } = setup(5);

    await service.adjustUserCredits(USER, adjust(10) as never, ADMIN);

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      adminUserId: ADMIN,
      action: 'adjust_credits',
      entityType: 'user',
      entityId: USER,
    });
    expect(auditLogs[0].oldValue).toEqual({ credits: 5 });
    expect(auditLogs[0].newValue).toMatchObject({ credits: 15, amount: 10 });
  });

  it('does NOT erase a spend that lands between the read and the write', async () => {
    // The defect this replaces: `credits: user.credits + amount` wrote an
    // absolute value computed from a stale read, so a user who spent 3 credits
    // mid-request got them back for free.
    const { service, row, ledger } = setup(10, (live) => {
      live.credits -= 3; // concurrent reading purchase
    });

    await service.adjustUserCredits(USER, adjust(1) as never, ADMIN);

    // 10 - 3 (spend) + 1 (grant) = 8. An absolute write would produce 11.
    expect(row.credits).toBe(8);
    expect(ledger[0]).toMatchObject({ amount: 1 });
  });

  it('refuses to drive the balance negative', async () => {
    const { service, row, ledger, auditLogs } = setup(2);

    await expect(
      service.adjustUserCredits(USER, adjust(-5) as never, ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(row.credits).toBe(2);
    expect(ledger).toHaveLength(0);
    expect(auditLogs).toHaveLength(0);
  });

  it('holds the floor even when the balance drops after the pre-check', async () => {
    // The pre-check reads 10 and waves a -8 through; a spend then takes the
    // balance to 4. The atomic guard is what has to stop it.
    const { service, row, ledger } = setup(10, (live) => {
      live.credits -= 6;
    });

    await expect(
      service.adjustUserCredits(USER, adjust(-8) as never, ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(row.credits).toBe(4);
    expect(ledger).toHaveLength(0);
  });

  it('404s an unknown user before touching anything', async () => {
    const { service, ledger } = setup(5);
    (service as unknown as { prisma: { user: { findUnique: jest.Mock } } }).prisma.user.findUnique =
      jest.fn(async () => null);

    await expect(
      service.adjustUserCredits('nope', adjust(5) as never, ADMIN),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ledger).toHaveLength(0);
  });
});

describe('A7 — AdjustCreditsDto guard rails', () => {
  const failedProps = (payload: unknown): string[] =>
    validateSync(plainToInstance(AdjustCreditsDto, payload) as object).map((e) => e.property);

  it('accepts a normal grant', () => {
    expect(failedProps({ amount: 10, reason: 'support case #123' })).toEqual([]);
  });

  it('rejects an empty or whitespace reason — the audit row would explain nothing', () => {
    expect(failedProps({ amount: 10, reason: '' })).toContain('reason');
    expect(failedProps({ amount: 10, reason: '   ' })).toContain('reason');
  });

  it('rejects a zero adjustment', () => {
    expect(failedProps({ amount: 0, reason: 'oops' })).toContain('amount');
  });

  it('rejects a fat-fingered amount beyond the guard rail', () => {
    expect(failedProps({ amount: ADMIN_CREDIT_ADJUST_MAX + 1, reason: 'typo' })).toContain('amount');
    expect(failedProps({ amount: -(ADMIN_CREDIT_ADJUST_MAX + 1), reason: 'typo' })).toContain('amount');
  });

  it('rejects a non-integer amount', () => {
    expect(failedProps({ amount: 1.5, reason: 'half' })).toContain('amount');
  });
});
