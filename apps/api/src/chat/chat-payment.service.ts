import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';

// ============================================================
// Constants — mirror @repo/shared (NestJS has known runtime issue importing
// from @repo/shared, see CLAUDE.md "@repo/shared runtime issue").
// ============================================================

/** mirrors @repo/shared CHAT_INITIAL_MESSAGES_PER_CREDIT */
export const CHAT_INITIAL_MESSAGES_PER_CREDIT = 10;

/** mirrors @repo/shared CHAT_SESSION_HARD_CAP_MESSAGES */
export const CHAT_SESSION_HARD_CAP_MESSAGES = 30;

/** mirrors @repo/shared CHAT_HISTORY_RETENTION_DAYS */
export const CHAT_HISTORY_RETENTION_DAYS = 365;

/** mirrors @repo/shared CHAT_FREE_QUOTA_BY_TIER */
export const CHAT_FREE_QUOTA_BY_TIER: Record<SubscriptionTier, number> = {
  FREE: 0,
  BASIC: 15,
  PRO: 30,
  MASTER: 60,
};

// ============================================================
// Types
// ============================================================

export type ChatPaymentMethod = 'FREE_QUOTA' | 'PAID_ALLOWANCE';

export interface DeductForMessageResult {
  method: ChatPaymentMethod;
}

export interface ExtendSessionResult {
  paidMessagesAllowance: number;
  messagesUntilHardCap: number;
  creditExtensions: number;
}

export interface MonthlyUsageSnapshot {
  chatsUsed: number;
  monthlyQuota: number;
  resetsAt: Date;
  subscriptionTier: SubscriptionTier;
}

// ============================================================
// Service
// ============================================================

/**
 * ChatPaymentService — core billing for the AI chat feature.
 *
 * Three responsibilities:
 *
 * 1. **Per-message deduction** (`deductForMessage`): on every user message,
 *    try free quota first (subscribers), then paid allowance (`creditExtensions`
 *    × 10 minus already used). Reject with 402 NEEDS_EXTENSION if neither has
 *    capacity but session is below 30-msg hard cap.
 *
 * 2. **Session extension** (`extendSession`): user pays 1 credit to grant 10
 *    more paid messages of allowance in the current session. Hard-capped so
 *    total `messageCount` can't exceed 30.
 *
 * 3. **Tier change re-snapshot** (`resnapshotChatQuotaOnTierChange`): called
 *    by Stripe webhook on subscription changes. Updates current month's
 *    `ChatMonthlyUsage.monthlyQuota` to match new tier.
 *
 * Plus utility methods: `getMonthlyUsage` (synthetic default if no row),
 * `refundLastMessage` (idempotent reverse of deductForMessage),
 * `cleanupExpiredSessions` (PDPA 12-month retention purge).
 */
@Injectable()
export class ChatPaymentService {
  private readonly logger = new Logger(ChatPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly creditsService: CreditsService,
  ) {}

  // ============================================================
  // Per-message deduction
  // ============================================================

  /**
   * Resolve payment for a single chat message. Atomic — must be called inside
   * the message-stream Prisma transaction.
   *
   * Order:
   *   1. Subscriber with free quota remaining → consume 1 free chat
   *   2. Else paid allowance available → consume 1 paid message
   *   3. Else reject (caller routes to extension flow or hard-cap UI)
   *
   * @throws HttpException(402) NEEDS_EXTENSION when no capacity but below cap
   * @throws HttpException(409) HARD_CAP_REACHED when session.messageCount >= 30
   */
  async deductForMessage(
    sessionId: string,
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<DeductForMessageResult> {
    const session = await tx.chatSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    if (session.userId !== userId) {
      throw new ForbiddenException('Session not owned by this user');
    }
    if (session.messageCount >= CHAT_SESSION_HARD_CAP_MESSAGES) {
      throw new HttpException(
        {
          code: 'HARD_CAP_REACHED',
          messagesUntilHardCap: 0,
        },
        HttpStatus.CONFLICT,
      );
    }

    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
    });

    // Try subscriber free quota first
    if (user.subscriptionTier !== 'FREE') {
      const freeQuotaConsumed = await this.tryConsumeFreeQuota(
        userId,
        user.subscriptionTier,
        tx,
      );
      if (freeQuotaConsumed) {
        await tx.chatSession.update({
          where: { id: sessionId },
          data: { freeQuotaConsumed: { increment: 1 } },
        });
        return { method: 'FREE_QUOTA' };
      }
    }

    // Else: consume from paid allowance (creditExtensions × 10) - paidMessagesUsed
    const sessionAllowance =
      session.creditExtensions * CHAT_INITIAL_MESSAGES_PER_CREDIT -
      session.paidMessagesUsed;
    if (sessionAllowance > 0) {
      await tx.chatSession.update({
        where: { id: sessionId },
        data: { paidMessagesUsed: { increment: 1 } },
      });
      return { method: 'PAID_ALLOWANCE' };
    }

    // Neither — reject; client must call /extend
    throw new HttpException(
      {
        code: 'NEEDS_EXTENSION',
        messagesUntilHardCap:
          CHAT_SESSION_HARD_CAP_MESSAGES - session.messageCount,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  /**
   * Atomically try to consume 1 chat from the user's monthly free quota.
   * Returns true if consumed, false if quota exhausted or row doesn't qualify.
   * Race-safe via `updateMany` guard.
   */
  private async tryConsumeFreeQuota(
    userId: string,
    tier: SubscriptionTier,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const periodStart = startOfCurrentMonthUtc();
    const tierQuota = CHAT_FREE_QUOTA_BY_TIER[tier];

    if (tierQuota === 0) {
      return false; // FREE tier (or unknown tier with 0 quota)
    }

    // Ensure row exists (idempotent upsert; create with chatsUsed=0)
    await tx.chatMonthlyUsage.upsert({
      where: { userId_periodStart: { userId, periodStart } },
      create: {
        userId,
        periodStart,
        chatsUsed: 0,
        monthlyQuota: tierQuota,
        subscriptionTier: tier,
      },
      update: {},
    });

    // Atomic guarded increment via raw SQL. Prisma's `updateMany` doesn't
    // support column-to-column comparisons in `where` (i.e., `chatsUsed <
    // monthlyQuota` where both sides are columns), so we use raw SQL.
    //
    // NOTE: user_id column is TEXT (Prisma's `String @id @default(uuid())`
    // maps to TEXT, not UUID, in Postgres). DO NOT cast `${userId}::uuid` —
    // Postgres has no `text = uuid` operator and the query would fail.
    //
    // NOTE: period_start column is `TIMESTAMP WITHOUT TIME ZONE`. Prisma's
    // $executeRaw sends JavaScript Date as `timestamptz`, which when compared
    // to a naive timestamp column gets implicitly converted using session
    // timezone (e.g., Asia/Kuala_Lumpur on this server) — shifting the value
    // and breaking the comparison. We pass periodStart as a naive timestamp
    // string (`YYYY-MM-DD HH:MM:SS`) cast to `::timestamp` to bypass.
    //
    // Returns affected row count.
    const periodStartSql = toNaiveTimestampString(periodStart);
    const incremented = await tx.$executeRaw`
      UPDATE chat_monthly_usage
      SET chats_used = chats_used + 1, updated_at = NOW()
      WHERE user_id = ${userId}
        AND period_start = ${periodStartSql}::timestamp
        AND chats_used < monthly_quota
    `;

    return incremented > 0;
  }

  // ============================================================
  // Extension (1 credit = 10 more paid messages in current session)
  // ============================================================

  /**
   * Purchase a 10-message paid allowance extension for the given session.
   * Deducts 1 credit, increments `creditExtensions`. Hard cap on session
   * is 30 messages — caller (frontend) MUST pre-warn user when remaining
   * capacity (30 - messageCount) < 10.
   *
   * @throws ConflictException when session is at hard cap
   * @throws BadRequestException when user has insufficient credits
   */
  async extendSession(
    sessionId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ExtendSessionResult> {
    const run = async (txc: Prisma.TransactionClient) => {
      const session = await txc.chatSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      if (session.userId !== userId) {
        throw new ForbiddenException('Session not owned by this user');
      }
      if (session.messageCount >= CHAT_SESSION_HARD_CAP_MESSAGES) {
        throw new HttpException(
          { code: 'HARD_CAP_REACHED' },
          HttpStatus.CONFLICT,
        );
      }
      // Sanity: session must not be ended
      if (session.endedAt !== null) {
        throw new BadRequestException('Session has ended');
      }

      // Atomic credit deduction (CreditsService throws BadRequestException if insufficient)
      await this.creditsService.deductCredits(
        userId,
        1,
        `chat-extend:${sessionId}`,
        { tx: txc },
      );

      const updated = await txc.chatSession.update({
        where: { id: sessionId },
        data: { creditExtensions: { increment: 1 } },
      });

      const newAllowance =
        updated.creditExtensions * CHAT_INITIAL_MESSAGES_PER_CREDIT -
        updated.paidMessagesUsed;

      return {
        paidMessagesAllowance: newAllowance,
        messagesUntilHardCap:
          CHAT_SESSION_HARD_CAP_MESSAGES - updated.messageCount,
        creditExtensions: updated.creditExtensions,
      };
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  // ============================================================
  // Stripe webhook re-snapshot
  // ============================================================

  /**
   * Re-snapshot a user's current month chat quota when their subscription tier
   * changes (called by Stripe webhook handler).
   *
   * Behavior:
   * - Upgrade (BASIC → PRO): immediately bumps `monthlyQuota` to new tier value
   *   (full new quota for current month).
   * - Downgrade (PRO → BASIC): updates `monthlyQuota` to lower value. If user
   *   already used > new quota this month, they have 0 remaining (DON'T
   *   subtract from `chatsUsed` — that would make balance negative).
   * - Idempotent: only updates when row's stored `subscriptionTier` differs.
   */
  async resnapshotChatQuotaOnTierChange(
    userId: string,
    newTier: SubscriptionTier,
  ): Promise<void> {
    const periodStart = startOfCurrentMonthUtc();
    const newQuota = CHAT_FREE_QUOTA_BY_TIER[newTier];

    await this.prisma.chatMonthlyUsage.upsert({
      where: { userId_periodStart: { userId, periodStart } },
      create: {
        userId,
        periodStart,
        chatsUsed: 0,
        monthlyQuota: newQuota,
        subscriptionTier: newTier,
        lastTierChangeAt: new Date(),
      },
      update: {}, // no-op; we'll do a guarded update below
    });

    // Guarded update: only when subscriptionTier diverges (idempotent)
    const updated = await this.prisma.chatMonthlyUsage.updateMany({
      where: {
        userId,
        periodStart,
        subscriptionTier: { not: newTier },
      },
      data: {
        monthlyQuota: newQuota,
        subscriptionTier: newTier,
        lastTierChangeAt: new Date(),
      },
    });

    if (updated.count > 0) {
      this.logger.log(
        `Chat quota re-snapshotted for user ${userId}: tier=${newTier}, quota=${newQuota}`,
      );
      // Tier actually changed — refund stranded paid messages.
      await this.refundStrandedPaidOnTierChange(userId);
    }
  }

  /**
   * Option A1 (generous refund) for the "stranded paid messages" problem.
   *
   * Background: when a FREE user purchases credit extensions (1 credit = 10
   * paid chat messages) and then upgrades to a tier with monthly free
   * quota (BASIC/PRO/MASTER), the `deductForMessage` flow consumes free
   * quota FIRST. This means the paid messages they purchased pre-upgrade
   * often go unused — and are forfeited when they start a new session
   * (Dialog 6 "新對話 將失去 N 則"). The user effectively wasted credits.
   *
   * Fix: on every confirmed tier change, scan active sessions for any
   * extensions with unused paid balance. Refund 1 credit per partially-
   * used or fully-unused extension, and zero out that session's paid
   * balance so it doesn't double-count in the badge / Dialog 3 / Dialog 6.
   *
   * Per A1 ("generous"): we refund 1 credit per credit_extension that has
   * ANY unused message, even if 9 of 10 are used. The business cost is
   * tiny (Free→tier upgrades are intentional and rare per user; the abuse
   * vector "buy ext, use 1, upgrade for refund" gives the user 1 message
   * for free at most, ~$0.10 of API cost).
   */
  private async refundStrandedPaidOnTierChange(userId: string): Promise<void> {
    const sessions = await this.prisma.chatSession.findMany({
      where: {
        userId,
        endedAt: null,
        creditExtensions: { gt: 0 },
      },
    });

    for (const s of sessions) {
      const fullyUsedExtensions = Math.floor(s.paidMessagesUsed / 10);
      const refundableExtensions = s.creditExtensions - fullyUsedExtensions;
      if (refundableExtensions <= 0) continue;

      await this.prisma.$transaction(async (tx) => {
        // Atomic refund: idempotent guard via paidMessagesUsed snapshot.
        const guarded = await tx.chatSession.updateMany({
          where: {
            id: s.id,
            paidMessagesUsed: s.paidMessagesUsed,
            creditExtensions: s.creditExtensions,
            endedAt: null,
          },
          // Zero out remaining paid: set used = full count so badge shows 0.
          data: { paidMessagesUsed: s.creditExtensions * 10 },
        });
        if (guarded.count === 0) {
          // Race: someone else updated this session between read and write.
          // Skip — they may have used or refunded already.
          return;
        }
        await tx.user.update({
          where: { id: userId },
          data: { credits: { increment: refundableExtensions } },
        });
        await tx.creditLedger.create({
          data: {
            userId,
            amount: +refundableExtensions,
            reason: `tier_upgrade_refund: ${refundableExtensions} unused chat extension(s) in session ${s.id}`,
          },
        });
        this.logger.log(
          `Refunded ${refundableExtensions} credit(s) to user ${userId} ` +
            `(session ${s.id} had ${refundableExtensions} unused/partial extensions)`,
        );
      });
    }
  }

  // ============================================================
  // Usage query (synthetic default if no row)
  // ============================================================

  /**
   * Returns the user's current-month chat usage. If no row exists, returns
   * synthetic snapshot `{chatsUsed: 0, monthlyQuota: tierQuota(user), ...}`.
   * Does NOT create a row (to avoid empty-row noise from users who never chat).
   */
  async getMonthlyUsage(userId: string): Promise<MonthlyUsageSnapshot> {
    const periodStart = startOfCurrentMonthUtc();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { subscriptionTier: true },
    });

    const row = await this.prisma.chatMonthlyUsage.findUnique({
      where: { userId_periodStart: { userId, periodStart } },
    });

    const resetsAt = startOfNextMonthUtc(periodStart);

    if (row) {
      return {
        chatsUsed: row.chatsUsed,
        monthlyQuota: row.monthlyQuota,
        resetsAt,
        subscriptionTier: row.subscriptionTier,
      };
    }

    // Synthetic default
    return {
      chatsUsed: 0,
      monthlyQuota: CHAT_FREE_QUOTA_BY_TIER[user.subscriptionTier],
      resetsAt,
      subscriptionTier: user.subscriptionTier,
    };
  }

  // ============================================================
  // Refund (idempotent reverse of deductForMessage)
  // ============================================================

  /**
   * Refund a single message that was deducted but the AI call failed.
   * Idempotent at the message-id level: each ChatMessage has a `paymentMethod`
   * field set when it was deducted; this method reverses based on that field.
   *
   * Race-safe: uses `refundedAt IS NULL` guard via `updateMany` to prevent
   * double-refund. The original `errorCode` is preserved (e.g. 'AI_FAILED'),
   * `refundedAt` is set as a separate timestamp (mirrors the BaziReading.refundedAt
   * pattern in CreditsService.refundReadingCredit).
   */
  async refundLastMessage(
    messageId: string,
    sessionId: string,
    userId: string,
    reason: string,
  ): Promise<{ refunded: boolean; method: ChatPaymentMethod | null }> {
    return this.prisma.$transaction(async (tx) => {
      const msg = await tx.chatMessage.findUnique({ where: { id: messageId } });
      if (!msg || msg.sessionId !== sessionId) {
        return { refunded: false, method: null };
      }
      if (!msg.paymentMethod) {
        // Nothing to refund (synthetic refusal, regrounding, etc.)
        return { refunded: false, method: null };
      }
      if (msg.refundedAt !== null) {
        // Already refunded
        return { refunded: false, method: null };
      }

      const session = await tx.chatSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      if (session.userId !== userId) {
        throw new ForbiddenException();
      }

      // Atomic guard: mark message as refunded ONLY if not already.
      // Preserves original errorCode (e.g. 'AI_FAILED') for debugging/audit.
      const guard = await tx.chatMessage.updateMany({
        where: { id: messageId, refundedAt: null },
        data: { refundedAt: new Date() },
      });
      if (guard.count === 0) {
        return { refunded: false, method: null };
      }

      if (msg.paymentMethod === 'FREE_QUOTA') {
        const periodStart = startOfCurrentMonthUtc();
        const periodStartSql = toNaiveTimestampString(periodStart);
        // Decrement chatsUsed, guarded against going negative.
        // NOTE: user_id is TEXT not UUID; period_start is naive timestamp —
        // see comments in tryConsumeFreeQuota for full rationale.
        await tx.$executeRaw`
          UPDATE chat_monthly_usage
          SET chats_used = chats_used - 1, updated_at = NOW()
          WHERE user_id = ${userId}
            AND period_start = ${periodStartSql}::timestamp
            AND chats_used > 0
        `;
        await tx.chatSession.updateMany({
          where: { id: sessionId, freeQuotaConsumed: { gt: 0 } },
          data: { freeQuotaConsumed: { decrement: 1 } },
        });
        this.logger.warn(
          `Refunded 1 free chat for user ${userId} (message ${messageId}): ${reason}`,
        );
        return { refunded: true, method: 'FREE_QUOTA' };
      }

      if (msg.paymentMethod === 'PAID_ALLOWANCE') {
        await tx.chatSession.updateMany({
          where: { id: sessionId, paidMessagesUsed: { gt: 0 } },
          data: { paidMessagesUsed: { decrement: 1 } },
        });
        // Note: credit is NOT auto-refunded — the credit purchased a 10-message
        // allowance. Refunding 1 message of that allowance is the right grain.
        this.logger.warn(
          `Refunded 1 paid message for user ${userId} (message ${messageId}): ${reason}`,
        );
        return { refunded: true, method: 'PAID_ALLOWANCE' };
      }

      return { refunded: false, method: null };
    });
  }

  // ============================================================
  // Expired-session cleanup (PDPA 12-month retention)
  // ============================================================

  /**
   * Hard-deletes chat sessions (and cascade-deletes their messages) where
   * `hardDeleteAt < now()`. Returns the number of sessions deleted.
   *
   * Intended to be called by an external cron / scheduled task — the in-process
   * @nestjs/schedule wiring is deferred to a follow-up phase due to a
   * blocked install at the time of Phase 1.1.
   */
  async cleanupExpiredSessions(): Promise<number> {
    const now = new Date();
    const result = await this.prisma.chatSession.deleteMany({
      where: { hardDeleteAt: { lt: now } },
    });
    if (result.count > 0) {
      this.logger.log(
        `Cleanup: hard-deleted ${result.count} expired chat sessions (PDPA 12-month retention)`,
      );
    }
    return result.count;
  }
}

// ============================================================
// Helpers
// ============================================================

/** Returns the 1st of current month in UTC (00:00:00.000). */
export function startOfCurrentMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** Returns the 1st of next month in UTC, given a current period start. */
export function startOfNextMonthUtc(periodStart: Date): Date {
  return new Date(
    Date.UTC(
      periodStart.getUTCFullYear(),
      periodStart.getUTCMonth() + 1,
      1,
      0,
      0,
      0,
      0,
    ),
  );
}

/**
 * Convert a Date to a Postgres-safe naive timestamp string `YYYY-MM-DD HH:MM:SS.mmm`
 * (no timezone). Used for raw SQL parameters comparing against
 * `TIMESTAMP WITHOUT TIME ZONE` columns — passing a Date object directly
 * triggers timezone conversion on the server (Asia/Kuala_Lumpur on this host)
 * and breaks comparisons. The string form bypasses TZ.
 */
export function toNaiveTimestampString(d: Date): string {
  // Use UTC components so the naive timestamp matches what Prisma's ORM
  // stored when serializing the same Date via `prisma.x.create({periodStart: d})`.
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${ms}`;
}
