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
        data: { refundedAt: new Date(), failedReason: reason },
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

  async getBalance(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    return user?.credits ?? 0;
  }
}
