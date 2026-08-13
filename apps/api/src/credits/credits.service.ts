import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Per-credit-movement service. Centralizes deductions, refunds, and ledger writes.
 *
 * Why this exists:
 * - Existing code scattered `user.credits: { decrement: N }` across multiple services.
 * - No audit trail for individual credit movements (only Stripe Transaction rows for money).
 * - Refunds for failed AI readings need atomic + idempotent semantics.
 *
 * Companion table: `CreditLedger` (positive = grant/refund, negative = deduction).
 */
@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deduct credits from a user. Throws BadRequestException if insufficient balance.
   * Writes a CreditLedger row with negative amount.
   *
   * @param userId — internal user.id (NOT clerkUserId)
   * @param amount — positive integer credits to deduct
   * @param reason — short string describing the deduction (e.g., "reading-create:CAREER")
   * @param options.readingId — optional reading link
   * @param options.comparisonId — optional comparison link
   * @param options.tx — optional Prisma transaction client; if provided, uses caller's tx
   */
  async deductCredits(
    userId: string,
    amount: number,
    reason: string,
    options?: {
      readingId?: string;
      comparisonId?: string;
      tx?: Prisma.TransactionClient;
    },
  ): Promise<void> {
    if (amount <= 0) {
      throw new BadRequestException(`Deduction amount must be positive, got ${amount}`);
    }
    const client = options?.tx ?? this.prisma;
    const updated = await client.user.updateMany({
      where: { id: userId, credits: { gte: amount } },
      data: { credits: { decrement: amount } },
    });
    if (updated.count === 0) {
      throw new BadRequestException(`Insufficient credits (need ${amount})`);
    }
    await client.creditLedger.create({
      data: {
        userId,
        amount: -amount,
        reason,
        readingId: options?.readingId ?? null,
        comparisonId: options?.comparisonId ?? null,
      },
    });
  }

  /**
   * Refund credit for a failed Bazi reading. IDEMPOTENT — calling twice is safe.
   * Returns { refunded: boolean, amount } indicating whether THIS call performed the refund.
   *
   * Atomic guard: only proceeds if reading.refundedAt IS NULL AND creditsUsed > 0.
   * Race-safe via updateMany guard — concurrent callers will see one refund only.
   */
  async refundReadingCredit(
    readingId: string,
    reason: string,
  ): Promise<{ refunded: boolean; amount: number }> {
    return this.prisma.$transaction(async (tx) => {
      const reading = await tx.baziReading.findUnique({ where: { id: readingId } });
      if (!reading || reading.creditsUsed === 0 || reading.refundedAt !== null) {
        return { refunded: false, amount: 0 };
      }
      const amount = reading.creditsUsed;

      // Atomic guard against double-refund race
      const guard = await tx.baziReading.updateMany({
        where: { id: readingId, refundedAt: null, creditsUsed: { gt: 0 } },
        data: { refundedAt: new Date(), failedReason: reason },
      });
      if (guard.count === 0) {
        return { refunded: false, amount: 0 }; // race lost — another caller already refunded
      }

      // Refund credit + ledger entry
      await tx.user.update({
        where: { id: reading.userId },
        data: { credits: { increment: amount } },
      });
      await tx.creditLedger.create({
        data: {
          userId: reading.userId,
          amount: +amount,
          reason: `refund: ${reason}`,
          readingId,
        },
      });
      this.logger.warn(`Refunded ${amount} credits for failed reading ${readingId}: ${reason}`);
      return { refunded: true, amount };
    });
  }

  /**
   * Refund credit for a failed Bazi comparison. Mirrors refundReadingCredit.
   */
  async refundComparisonCredit(
    comparisonId: string,
    reason: string,
  ): Promise<{ refunded: boolean; amount: number }> {
    return this.prisma.$transaction(async (tx) => {
      const comparison = await tx.baziComparison.findUnique({ where: { id: comparisonId } });
      if (!comparison || comparison.creditsUsed === 0 || comparison.refundedAt !== null) {
        return { refunded: false, amount: 0 };
      }
      const amount = comparison.creditsUsed;

      const guard = await tx.baziComparison.updateMany({
        where: { id: comparisonId, refundedAt: null, creditsUsed: { gt: 0 } },
        data: {
          refundedAt: new Date(),
          failedReason: reason,
          // ⚠️ Clear the unlock. `paidAt` is what every reveal/paywall/chat gate
          // reads, so leaving it set would keep a refunded user's access — they
          // have their credits back AND the report. The reveal CAS re-sets it
          // (and resets refundedAt) if they pay again.
          paidAt: null,
          // ⚠️ And drop the artefact, mirroring the reading path
          // (`ai.service.ts`, where the reading refund nulls its interpretation).
          // `Prisma.DbNull` not `undefined`: undefined
          // means "don't update", and `WHERE ai_interpretation IS NULL` depends
          // on a real SQL NULL. Without this a refunded row is still readable
          // through any path that keys on the interpretation's presence.
          aiInterpretation: Prisma.DbNull,
        },
      });
      if (guard.count === 0) {
        return { refunded: false, amount: 0 };
      }

      await tx.user.update({
        where: { id: comparison.userId },
        data: { credits: { increment: amount } },
      });
      await tx.creditLedger.create({
        data: {
          userId: comparison.userId,
          amount: +amount,
          reason: `refund: ${reason}`,
          comparisonId,
        },
      });
      this.logger.warn(`Refunded ${amount} credits for failed comparison ${comparisonId}: ${reason}`);
      return { refunded: true, amount };
    });
  }

  /**
   * Signed admin/manual adjustment. Positive grants, negative deducts.
   * Writes a `CreditLedger` row either way — this is the ONLY sanctioned way to
   * move credits outside the purchase/spend/refund flows, and it exists so the
   * ledger stays a complete record of every movement. `sum(CreditLedger.amount)`
   * must reconcile against `user.credits`; a raw `user.update({ credits })`
   * silently breaks that invariant.
   *
   * Atomicity matters more here than it looks. The obvious implementation —
   * read `user.credits`, add the delta, write the absolute result — loses any
   * concurrent spend: a user burning 3 credits while an admin grants +1 ends up
   * with their 3 credits handed back. So the negative branch is a guarded
   * `updateMany` (the `deductCredits` pattern) and the positive branch is a
   * relative `increment`; neither reads-then-writes.
   *
   * @param amount signed, non-zero
   * @param reason free text; callers that act on behalf of a person should
   *               encode who (e.g. `admin_adjust:<adminUserId>:<note>`)
   * @returns the true before/after balances, read inside the same transaction
   */
  async adjustCredits(
    userId: string,
    amount: number,
    reason: string,
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<{ before: number; after: number }> {
    if (!Number.isInteger(amount) || amount === 0) {
      throw new BadRequestException(`Adjustment must be a non-zero integer, got ${amount}`);
    }

    const run = async (client: Prisma.TransactionClient) => {
      let after: number;

      if (amount < 0) {
        const needed = -amount;
        const guard = await client.user.updateMany({
          where: { id: userId, credits: { gte: needed } },
          data: { credits: { decrement: needed } },
        });
        if (guard.count === 0) {
          // Only read to build the message — we're on the way to throwing.
          const current = await client.user.findUniqueOrThrow({
            where: { id: userId },
            select: { credits: true },
          });
          throw new BadRequestException(
            `Cannot adjust: user has ${current.credits} credits, adjustment of ${amount} would go negative`,
          );
        }
        // `updateMany` returns a count, not the row.
        const row = await client.user.findUniqueOrThrow({
          where: { id: userId },
          select: { credits: true },
        });
        after = row.credits;
      } else {
        const row = await client.user.update({
          where: { id: userId },
          data: { credits: { increment: amount } },
          select: { credits: true },
        });
        after = row.credits;
      }

      await client.creditLedger.create({ data: { userId, amount, reason } });

      // ⚠️ `before` is DERIVED from the post-write value, never read separately.
      // Prisma interactive transactions run at the database default isolation
      // (READ COMMITTED on Postgres), so each statement takes a fresh snapshot:
      // a spend committing between a separate "before" read and the write would
      // produce an incoherent pair — e.g. before=10, after=8, for amount=+1 —
      // written verbatim into AdminAuditLog. Deriving it guarantees
      // `after - before === amount` always reads as the adjustment that happened.
      const before = after - amount;

      this.logger.log(`Adjusted ${amount} credits for user ${userId} (${before} → ${after}): ${reason}`);
      return { before, after };
    };

    // Prisma has no nested interactive transactions — when the caller supplies
    // one, join it so the ledger row and their own writes commit together.
    return options?.tx ? run(options.tx) : this.prisma.$transaction(run);
  }

  async getBalance(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    return user?.credits ?? 0;
  }
}
