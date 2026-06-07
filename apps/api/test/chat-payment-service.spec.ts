/**
 * Unit tests for ChatPaymentService — covers per-message deduction,
 * extension purchase, tier-change re-snapshot, refund (idempotent + race-safe),
 * synthetic monthly-usage default, and PDPA cleanup.
 *
 * Mocks Prisma directly per the existing CreditsService test pattern.
 */
import { ForbiddenException, HttpException, BadRequestException } from '@nestjs/common';
import {
  ChatPaymentService,
  CHAT_FREE_QUOTA_BY_TIER,
  CHAT_INITIAL_MESSAGES_PER_CREDIT,
  CHAT_SESSION_HARD_CAP_MESSAGES,
  CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT,
  CHAT_HISTORY_RETENTION_DAYS,
} from '../src/chat/chat-payment.service';
import * as shared from '@repo/shared';

// ============================================================
// Constant drift detection — locks the local mirror values against
// @repo/shared. Per CLAUDE.md «@repo/shared runtime issue» the NestJS
// chat-payment.service.ts keeps a local copy of these constants instead
// of importing from @repo/shared at runtime. The downside is that the
// two definitions can drift silently — e.g. someone bumps the shared
// value and forgets the mirror. The behaviors split: FE thinks the new
// limit applies, BE keeps using the old. These tests catch that.
// ============================================================
describe('chat-payment constants — mirror parity with @repo/shared', () => {
  it('CHAT_INITIAL_MESSAGES_PER_CREDIT matches shared', () => {
    expect(CHAT_INITIAL_MESSAGES_PER_CREDIT).toBe(shared.CHAT_INITIAL_MESSAGES_PER_CREDIT);
  });
  it('CHAT_SESSION_HARD_CAP_MESSAGES matches shared', () => {
    expect(CHAT_SESSION_HARD_CAP_MESSAGES).toBe(shared.CHAT_SESSION_HARD_CAP_MESSAGES);
  });
  it('CHAT_HISTORY_RETENTION_DAYS matches shared', () => {
    expect(CHAT_HISTORY_RETENTION_DAYS).toBe(shared.CHAT_HISTORY_RETENTION_DAYS);
  });
  it('CHAT_FREE_QUOTA_BY_TIER matches shared (deep equal)', () => {
    expect(CHAT_FREE_QUOTA_BY_TIER).toStrictEqual(shared.CHAT_FREE_QUOTA_BY_TIER);
  });
  it('CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT matches shared', () => {
    expect(CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT).toBe(
      shared.CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT,
    );
  });
  it('shared WARNING_THRESHOLD is LIMIT + 1 (load-bearing invariant for FE dialog)', () => {
    // The dialog fires the moment refunding stops — i.e. on the first
    // refuse NOT covered by the cap. If WARNING_THRESHOLD ever drifts
    // (e.g. someone hardcodes 5), the dialog would fire BEFORE the user
    // is actually being charged, confusing them.
    expect(shared.CHAT_CONSECUTIVE_REFUSE_WARNING_THRESHOLD).toBe(
      shared.CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT + 1,
    );
  });
});

describe('ChatPaymentService', () => {
  let mockChatSession: any;
  let mockChatMessage: any;
  let mockChatMonthlyUsage: any;
  let mockUser: any;
  let mockUserUpdate: jest.Mock;
  let mockCreditLedgerCreate: jest.Mock;
  let mockPrisma: any;
  let mockCreditsService: any;
  let service: ChatPaymentService;

  // executeRaw return value (number of affected rows) — set per test
  let executeRawResult: number;

  beforeEach(() => {
    executeRawResult = 0;

    mockChatSession = {
      findUniqueOrThrow: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    };
    mockChatMessage = {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    };
    mockChatMonthlyUsage = {
      upsert: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    };
    mockUser = {
      findUniqueOrThrow: jest.fn(),
    };
    // Hoist user.update + creditLedger.create so T8/T9 tests can assert
    // on them after `service.resnapshotChatQuotaOnTierChange()` returns.
    mockUserUpdate = jest.fn().mockResolvedValue({});
    mockCreditLedgerCreate = jest.fn().mockResolvedValue({});

    const txClient = {
      chatSession: mockChatSession,
      chatMessage: mockChatMessage,
      chatMonthlyUsage: mockChatMonthlyUsage,
      user: { ...mockUser, update: mockUserUpdate },
      creditLedger: { create: mockCreditLedgerCreate },
      $executeRaw: jest.fn(async () => executeRawResult),
    };

    mockPrisma = {
      ...txClient,
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => cb(txClient)),
    };

    mockCreditsService = {
      deductCredits: jest.fn().mockResolvedValue(undefined),
    };

    service = new ChatPaymentService(mockPrisma as any, mockCreditsService as any);
  });

  // ============================================================
  // deductForMessage — free quota path
  // ============================================================

  describe('deductForMessage — subscriber free quota', () => {
    it('consumes 1 free chat for BASIC subscriber under quota', async () => {
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        messageCount: 5,
        creditExtensions: 0,
        paidMessagesUsed: 0,
      });
      mockUser.findUniqueOrThrow.mockResolvedValue({ subscriptionTier: 'BASIC' });
      mockChatMonthlyUsage.upsert.mockResolvedValue({});
      executeRawResult = 1; // increment succeeded
      mockChatSession.update.mockResolvedValue({});

      const result = await service.deductForMessage('s1', 'u1', mockPrisma);

      expect(result).toEqual({ method: 'FREE_QUOTA' });
      expect(mockChatSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { freeQuotaConsumed: { increment: 1 } },
      });
    });

    it('falls through to paid allowance when free quota exhausted', async () => {
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        messageCount: 5,
        creditExtensions: 1,
        paidMessagesUsed: 2,
      });
      mockUser.findUniqueOrThrow.mockResolvedValue({ subscriptionTier: 'BASIC' });
      mockChatMonthlyUsage.upsert.mockResolvedValue({});
      executeRawResult = 0; // free quota guard failed (chats_used >= monthly_quota)
      mockChatSession.update.mockResolvedValue({});

      const result = await service.deductForMessage('s1', 'u1', mockPrisma);

      expect(result).toEqual({ method: 'PAID_ALLOWANCE' });
      expect(mockChatSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { paidMessagesUsed: { increment: 1 } },
      });
    });

    it('skips free quota path entirely for FREE tier', async () => {
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        messageCount: 0,
        creditExtensions: 1,
        paidMessagesUsed: 0,
      });
      mockUser.findUniqueOrThrow.mockResolvedValue({ subscriptionTier: 'FREE' });
      mockChatSession.update.mockResolvedValue({});

      const result = await service.deductForMessage('s1', 'u1', mockPrisma);

      expect(result).toEqual({ method: 'PAID_ALLOWANCE' });
      expect(mockChatMonthlyUsage.upsert).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // deductForMessage — error paths
  // ============================================================

  describe('deductForMessage — error paths', () => {
    it('throws 409 HARD_CAP_REACHED when messageCount >= 30', async () => {
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        messageCount: CHAT_SESSION_HARD_CAP_MESSAGES,
        creditExtensions: 3,
        paidMessagesUsed: 0,
      });

      await expect(
        service.deductForMessage('s1', 'u1', mockPrisma),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'HARD_CAP_REACHED' },
      });
    });

    it('throws 402 NEEDS_EXTENSION when below cap but no capacity', async () => {
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        messageCount: 10,
        creditExtensions: 1,
        paidMessagesUsed: CHAT_INITIAL_MESSAGES_PER_CREDIT, // exhausted
      });
      mockUser.findUniqueOrThrow.mockResolvedValue({ subscriptionTier: 'FREE' });

      await expect(
        service.deductForMessage('s1', 'u1', mockPrisma),
      ).rejects.toMatchObject({
        status: 402,
        response: {
          code: 'NEEDS_EXTENSION',
          messagesUntilHardCap: 20,
        },
      });
    });

    it('throws ForbiddenException when session not owned by user', async () => {
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'other-user',
        messageCount: 0,
        creditExtensions: 0,
        paidMessagesUsed: 0,
      });

      await expect(
        service.deductForMessage('s1', 'u1', mockPrisma),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================
  // extendSession
  // ============================================================

  describe('extendSession', () => {
    it('deducts 1 credit and increments creditExtensions', async () => {
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        messageCount: 10,
        creditExtensions: 0,
        paidMessagesUsed: 0,
        endedAt: null,
      });
      mockChatSession.update.mockResolvedValue({
        creditExtensions: 1,
        paidMessagesUsed: 0,
        messageCount: 10,
      });

      const result = await service.extendSession('s1', 'u1');

      expect(mockCreditsService.deductCredits).toHaveBeenCalledWith(
        'u1',
        1,
        'chat-extend:s1',
        expect.objectContaining({ tx: expect.anything() }),
      );
      expect(result).toEqual({
        paidMessagesAllowance: CHAT_INITIAL_MESSAGES_PER_CREDIT,
        messagesUntilHardCap: 20,
        creditExtensions: 1,
      });
    });

    it('throws HARD_CAP_REACHED at 30 messages', async () => {
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        messageCount: CHAT_SESSION_HARD_CAP_MESSAGES,
        creditExtensions: 3,
        paidMessagesUsed: 0,
        endedAt: null,
      });

      await expect(service.extendSession('s1', 'u1')).rejects.toMatchObject({
        status: 409,
        response: { code: 'HARD_CAP_REACHED' },
      });
      expect(mockCreditsService.deductCredits).not.toHaveBeenCalled();
    });

    it('rejects extension on ended session', async () => {
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        messageCount: 10,
        creditExtensions: 0,
        paidMessagesUsed: 0,
        endedAt: new Date(),
      });

      await expect(service.extendSession('s1', 'u1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockCreditsService.deductCredits).not.toHaveBeenCalled();
    });

    it('reports partial-credit value when remaining cap < 10', async () => {
      // Edge case at msg 25: only 5 messages until hard cap
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        messageCount: 25,
        creditExtensions: 1,
        paidMessagesUsed: CHAT_INITIAL_MESSAGES_PER_CREDIT,
        endedAt: null,
      });
      mockChatSession.update.mockResolvedValue({
        creditExtensions: 2,
        paidMessagesUsed: 10,
        messageCount: 25,
      });

      const result = await service.extendSession('s1', 'u1');

      // newAllowance = 2 × 10 - 10 = 10 (nominal). But messagesUntilHardCap is 5.
      // Frontend uses min(allowance, messagesUntilHardCap) for display.
      expect(result.paidMessagesAllowance).toBe(10);
      expect(result.messagesUntilHardCap).toBe(5);
      expect(result.creditExtensions).toBe(2);
    });

    it('throws ForbiddenException when session not owned', async () => {
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'other-user',
        messageCount: 10,
        creditExtensions: 0,
        paidMessagesUsed: 0,
        endedAt: null,
      });

      await expect(service.extendSession('s1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockCreditsService.deductCredits).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // resnapshotChatQuotaOnTierChange
  // ============================================================

  describe('resnapshotChatQuotaOnTierChange', () => {
    it('upgrades quota from BASIC to PRO immediately for current month', async () => {
      mockChatMonthlyUsage.upsert.mockResolvedValue({});
      mockChatMonthlyUsage.updateMany.mockResolvedValue({ count: 1 });

      await service.resnapshotChatQuotaOnTierChange('u1', 'PRO');

      expect(mockChatMonthlyUsage.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          userId: 'u1',
          subscriptionTier: { not: 'PRO' },
        }),
        data: expect.objectContaining({
          monthlyQuota: CHAT_FREE_QUOTA_BY_TIER.PRO,
          subscriptionTier: 'PRO',
        }),
      });
    });

    it('downgrades to FREE caps quota at 0', async () => {
      mockChatMonthlyUsage.upsert.mockResolvedValue({});
      mockChatMonthlyUsage.updateMany.mockResolvedValue({ count: 1 });

      await service.resnapshotChatQuotaOnTierChange('u1', 'FREE');

      expect(mockChatMonthlyUsage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            monthlyQuota: 0,
            subscriptionTier: 'FREE',
          }),
        }),
      );
    });

    it('is idempotent — no-op when stored tier matches new tier', async () => {
      mockChatMonthlyUsage.upsert.mockResolvedValue({});
      mockChatMonthlyUsage.updateMany.mockResolvedValue({ count: 0 });

      await service.resnapshotChatQuotaOnTierChange('u1', 'BASIC');

      // Guard `subscriptionTier: { not: 'BASIC' }` filtered out the row;
      // updateMany returned count=0; should not throw or log error
      expect(mockChatMonthlyUsage.updateMany).toHaveBeenCalled();
    });
  });

  // ============================================================
  // refundStrandedPaidOnTierChange (Option A1) — T8/T9 unit tests
  //
  // T8 covers the math (cases below). T9 covers multi-session.
  // Both fire as a side-effect of `resnapshotChatQuotaOnTierChange`
  // when `updated.count > 0` (tier actually changed).
  // ============================================================

  describe('refundStrandedPaidOnTierChange (A1) — T8 math', () => {
    function setupTierChange() {
      mockChatMonthlyUsage.upsert.mockResolvedValue({});
      mockChatMonthlyUsage.updateMany.mockResolvedValue({ count: 1 });
      // The atomic guard inside the txn: by default succeed (count=1).
      mockChatSession.updateMany.mockResolvedValue({ count: 1 });
    }

    it('case 2 ext + 15 used → refunds 1 credit (1 fully used + 1 partial)', async () => {
      setupTierChange();
      mockChatSession.findMany.mockResolvedValue([
        { id: 's1', creditExtensions: 2, paidMessagesUsed: 15, endedAt: null },
      ]);

      await service.resnapshotChatQuotaOnTierChange('u1', 'PRO');

      // Math: 2 - floor(15/10) = 2 - 1 = 1
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { credits: { increment: 1 } },
      });
      expect(mockCreditLedgerCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          amount: 1,
          reason: expect.stringContaining('1 unused chat extension(s)'),
        }),
      });
      // paidMessagesUsed zeroed out (set to creditExtensions × 10 = 20)
      expect(mockChatSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { paidMessagesUsed: 20 } }),
      );
    });

    it('case 2 ext + 5 used → refunds 2 credits (both partial)', async () => {
      setupTierChange();
      mockChatSession.findMany.mockResolvedValue([
        { id: 's1', creditExtensions: 2, paidMessagesUsed: 5, endedAt: null },
      ]);

      await service.resnapshotChatQuotaOnTierChange('u1', 'PRO');

      // Math: 2 - floor(5/10) = 2 - 0 = 2
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { credits: { increment: 2 } },
      });
    });

    it('case 2 ext + 20 used (full) → refunds 0 credits (no transaction)', async () => {
      setupTierChange();
      mockChatSession.findMany.mockResolvedValue([
        { id: 's1', creditExtensions: 2, paidMessagesUsed: 20, endedAt: null },
      ]);

      await service.resnapshotChatQuotaOnTierChange('u1', 'PRO');

      // refundableExtensions = 2 - 2 = 0 → continue
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it('case 2 ext + 19 used → refunds 1 credit', async () => {
      setupTierChange();
      mockChatSession.findMany.mockResolvedValue([
        { id: 's1', creditExtensions: 2, paidMessagesUsed: 19, endedAt: null },
      ]);

      await service.resnapshotChatQuotaOnTierChange('u1', 'PRO');

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { credits: { increment: 1 } },
      });
    });

    it('case 1 ext + 0 used → refunds 1 credit (fully unused)', async () => {
      setupTierChange();
      mockChatSession.findMany.mockResolvedValue([
        { id: 's1', creditExtensions: 1, paidMessagesUsed: 0, endedAt: null },
      ]);

      await service.resnapshotChatQuotaOnTierChange('u1', 'PRO');

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { credits: { increment: 1 } },
      });
    });

    it('case 1 ext + 9 used → refunds 1 credit (still partial)', async () => {
      setupTierChange();
      mockChatSession.findMany.mockResolvedValue([
        { id: 's1', creditExtensions: 1, paidMessagesUsed: 9, endedAt: null },
      ]);

      await service.resnapshotChatQuotaOnTierChange('u1', 'PRO');

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { credits: { increment: 1 } },
      });
    });

    it('idempotency: atomic guard rejects refund when paidMessagesUsed snapshot drifted', async () => {
      mockChatMonthlyUsage.upsert.mockResolvedValue({});
      mockChatMonthlyUsage.updateMany.mockResolvedValue({ count: 1 });
      mockChatSession.findMany.mockResolvedValue([
        { id: 's1', creditExtensions: 1, paidMessagesUsed: 5, endedAt: null },
      ]);
      // Race: someone else updated this session between read and write.
      mockChatSession.updateMany.mockResolvedValue({ count: 0 });

      await service.resnapshotChatQuotaOnTierChange('u1', 'PRO');

      // No double-refund — credit + ledger must NOT be touched
      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockCreditLedgerCreate).not.toHaveBeenCalled();
    });

    it('does NOT fire refund when tier was unchanged (idempotent resnapshot)', async () => {
      mockChatMonthlyUsage.upsert.mockResolvedValue({});
      // updateMany count=0 means tier already matched — no refund should fire
      mockChatMonthlyUsage.updateMany.mockResolvedValue({ count: 0 });
      mockChatSession.findMany.mockResolvedValue([
        { id: 's1', creditExtensions: 1, paidMessagesUsed: 0, endedAt: null },
      ]);

      await service.resnapshotChatQuotaOnTierChange('u1', 'PRO');

      // findMany must NOT have been called (refund path skipped entirely)
      expect(mockChatSession.findMany).not.toHaveBeenCalled();
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });
  });

  describe('refundStrandedPaidOnTierChange (A1) — T9 multi-session', () => {
    it('refunds each active session separately, one ledger entry per session', async () => {
      mockChatMonthlyUsage.upsert.mockResolvedValue({});
      mockChatMonthlyUsage.updateMany.mockResolvedValue({ count: 1 });
      mockChatSession.updateMany.mockResolvedValue({ count: 1 });
      mockChatSession.findMany.mockResolvedValue([
        { id: 'sA', creditExtensions: 1, paidMessagesUsed: 3, endedAt: null },
        { id: 'sB', creditExtensions: 1, paidMessagesUsed: 2, endedAt: null },
      ]);

      await service.resnapshotChatQuotaOnTierChange('u1', 'PRO');

      // 2 sessions → 2 separate transactions
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
      // 2 user.update calls (1 credit each)
      expect(mockUserUpdate).toHaveBeenCalledTimes(2);
      expect(mockUserUpdate).toHaveBeenNthCalledWith(1, {
        where: { id: 'u1' },
        data: { credits: { increment: 1 } },
      });
      expect(mockUserUpdate).toHaveBeenNthCalledWith(2, {
        where: { id: 'u1' },
        data: { credits: { increment: 1 } },
      });
      // 2 ledger entries, one per session
      expect(mockCreditLedgerCreate).toHaveBeenCalledTimes(2);
      expect(mockCreditLedgerCreate.mock.calls[0][0].data.reason).toContain('sA');
      expect(mockCreditLedgerCreate.mock.calls[1][0].data.reason).toContain('sB');
    });

    it('skips fully-used sessions while still refunding partial ones', async () => {
      mockChatMonthlyUsage.upsert.mockResolvedValue({});
      mockChatMonthlyUsage.updateMany.mockResolvedValue({ count: 1 });
      mockChatSession.updateMany.mockResolvedValue({ count: 1 });
      mockChatSession.findMany.mockResolvedValue([
        { id: 'sA', creditExtensions: 1, paidMessagesUsed: 10, endedAt: null }, // fully used → skip
        { id: 'sB', creditExtensions: 1, paidMessagesUsed: 0, endedAt: null },  // refund 1
      ]);

      await service.resnapshotChatQuotaOnTierChange('u1', 'PRO');

      // Only ONE transaction fires (for sB). sA was skipped before opening txn.
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockUserUpdate).toHaveBeenCalledTimes(1);
      expect(mockCreditLedgerCreate.mock.calls[0][0].data.reason).toContain('sB');
    });
  });

  // ============================================================
  // getMonthlyUsage — synthetic default
  // ============================================================

  describe('getMonthlyUsage', () => {
    it('returns synthetic default when no row exists', async () => {
      mockUser.findUniqueOrThrow.mockResolvedValue({ subscriptionTier: 'PRO' });
      mockChatMonthlyUsage.findUnique.mockResolvedValue(null);

      const result = await service.getMonthlyUsage('u1');

      expect(result.chatsUsed).toBe(0);
      expect(result.monthlyQuota).toBe(CHAT_FREE_QUOTA_BY_TIER.PRO);
      expect(result.subscriptionTier).toBe('PRO');
      expect(result.resetsAt).toBeInstanceOf(Date);
    });

    it('returns row data when row exists', async () => {
      mockUser.findUniqueOrThrow.mockResolvedValue({ subscriptionTier: 'BASIC' });
      mockChatMonthlyUsage.findUnique.mockResolvedValue({
        chatsUsed: 7,
        monthlyQuota: 15,
        subscriptionTier: 'BASIC',
      });

      const result = await service.getMonthlyUsage('u1');

      expect(result.chatsUsed).toBe(7);
      expect(result.monthlyQuota).toBe(15);
    });

    it('does NOT create a row for users who never chatted', async () => {
      mockUser.findUniqueOrThrow.mockResolvedValue({ subscriptionTier: 'FREE' });
      mockChatMonthlyUsage.findUnique.mockResolvedValue(null);

      await service.getMonthlyUsage('u1');

      expect(mockChatMonthlyUsage.upsert).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // refundLastMessage — idempotent + race-safe
  // ============================================================

  describe('refundLastMessage', () => {
    it('refunds FREE_QUOTA message: decrements chatsUsed + freeQuotaConsumed', async () => {
      mockChatMessage.findUnique.mockResolvedValue({
        id: 'm1',
        sessionId: 's1',
        paymentMethod: 'FREE_QUOTA',
        errorCode: null,
        refundedAt: null,
      });
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'u1',
      });
      mockChatMessage.updateMany.mockResolvedValue({ count: 1 });
      executeRawResult = 1;
      mockChatSession.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.refundLastMessage('m1', 's1', 'u1', 'ai-failed');

      expect(result).toEqual({ refunded: true, method: 'FREE_QUOTA' });
      expect(mockChatSession.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', freeQuotaConsumed: { gt: 0 } },
        data: { freeQuotaConsumed: { decrement: 1 } },
      });
    });

    it('preserves original errorCode when refunding (does not overwrite with REFUNDED)', async () => {
      mockChatMessage.findUnique.mockResolvedValue({
        id: 'm1',
        sessionId: 's1',
        paymentMethod: 'FREE_QUOTA',
        errorCode: 'AI_FAILED',
        refundedAt: null,
      });
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'u1',
      });
      mockChatMessage.updateMany.mockResolvedValue({ count: 1 });
      executeRawResult = 1;
      mockChatSession.updateMany.mockResolvedValue({ count: 1 });

      await service.refundLastMessage('m1', 's1', 'u1', 'ai-failed');

      // The guard updates `refundedAt`, NOT errorCode. Original 'AI_FAILED' preserved.
      expect(mockChatMessage.updateMany).toHaveBeenCalledWith({
        where: { id: 'm1', refundedAt: null },
        data: { refundedAt: expect.any(Date) },
      });
      // Verify errorCode is NOT being overwritten
      const updateCallArgs = mockChatMessage.updateMany.mock.calls[0][0];
      expect(updateCallArgs.data).not.toHaveProperty('errorCode');
    });

    it('refunds PAID_ALLOWANCE message: decrements paidMessagesUsed only (no credit refund)', async () => {
      mockChatMessage.findUnique.mockResolvedValue({
        id: 'm1',
        sessionId: 's1',
        paymentMethod: 'PAID_ALLOWANCE',
        errorCode: null,
        refundedAt: null,
      });
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'u1',
      });
      mockChatMessage.updateMany.mockResolvedValue({ count: 1 });
      mockChatSession.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.refundLastMessage('m1', 's1', 'u1', 'ai-failed');

      expect(result).toEqual({ refunded: true, method: 'PAID_ALLOWANCE' });
      expect(mockChatSession.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', paidMessagesUsed: { gt: 0 } },
        data: { paidMessagesUsed: { decrement: 1 } },
      });
      // No credit refund — that's intentional (1 credit = 10 message allowance,
      // refunding 1 of 10 is the right grain via session counter).
    });

    it('is idempotent — race-safe via updateMany guard on refundedAt', async () => {
      mockChatMessage.findUnique.mockResolvedValue({
        id: 'm1',
        sessionId: 's1',
        paymentMethod: 'FREE_QUOTA',
        errorCode: null,
        refundedAt: null,
      });
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'u1',
      });
      // Race lost — another caller already set refundedAt
      mockChatMessage.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.refundLastMessage('m1', 's1', 'u1', 'ai-failed');

      expect(result).toEqual({ refunded: false, method: null });
    });

    it('returns no-op for already-refunded messages', async () => {
      mockChatMessage.findUnique.mockResolvedValue({
        id: 'm1',
        sessionId: 's1',
        paymentMethod: 'FREE_QUOTA',
        errorCode: null,
        refundedAt: new Date(),
      });

      const result = await service.refundLastMessage('m1', 's1', 'u1', 'reason');

      expect(result).toEqual({ refunded: false, method: null });
      expect(mockChatMessage.updateMany).not.toHaveBeenCalled();
    });

    it('returns no-op when message has no paymentMethod (e.g., synthetic refusal)', async () => {
      mockChatMessage.findUnique.mockResolvedValue({
        id: 'm1',
        sessionId: 's1',
        paymentMethod: null,
        errorCode: null,
        refundedAt: null,
      });

      const result = await service.refundLastMessage('m1', 's1', 'u1', 'reason');

      expect(result).toEqual({ refunded: false, method: null });
    });

    it('throws ForbiddenException when session not owned by user', async () => {
      mockChatMessage.findUnique.mockResolvedValue({
        id: 'm1',
        sessionId: 's1',
        paymentMethod: 'FREE_QUOTA',
        errorCode: null,
        refundedAt: null,
      });
      mockChatSession.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        userId: 'other-user',
      });

      await expect(
        service.refundLastMessage('m1', 's1', 'u1', 'reason'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================
  // cleanupExpiredSessions
  // ============================================================

  describe('cleanupExpiredSessions', () => {
    it('hard-deletes sessions where hardDeleteAt < now()', async () => {
      mockChatSession.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.cleanupExpiredSessions();

      expect(result).toBe(3);
      expect(mockChatSession.deleteMany).toHaveBeenCalledWith({
        where: { hardDeleteAt: { lt: expect.any(Date) } },
      });
    });

    it('returns 0 when no expired sessions found', async () => {
      mockChatSession.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.cleanupExpiredSessions();

      expect(result).toBe(0);
    });
  });

  // ============================================================
  // Constants exposed for shared/test use
  // ============================================================

  describe('exported constants', () => {
    it('CHAT_FREE_QUOTA_BY_TIER matches plan: BASIC=15, PRO=30, MASTER=60', () => {
      expect(CHAT_FREE_QUOTA_BY_TIER.FREE).toBe(0);
      expect(CHAT_FREE_QUOTA_BY_TIER.BASIC).toBe(15);
      expect(CHAT_FREE_QUOTA_BY_TIER.PRO).toBe(30);
      expect(CHAT_FREE_QUOTA_BY_TIER.MASTER).toBe(60);
    });

    it('hard cap is 30 messages per session', () => {
      expect(CHAT_SESSION_HARD_CAP_MESSAGES).toBe(30);
    });

    it('1 credit = 10 messages', () => {
      expect(CHAT_INITIAL_MESSAGES_PER_CREDIT).toBe(10);
    });
  });
});
