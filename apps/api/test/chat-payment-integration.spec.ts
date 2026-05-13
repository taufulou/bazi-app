/**
 * Integration tests for ChatPaymentService — exercises the raw SQL paths
 * (`tryConsumeFreeQuota`, `refundLastMessage` FREE_QUOTA branch) against a
 * real Postgres instance. Catches bugs that the unit-test mocks miss
 * (e.g., the original `${userId}::uuid` cast bug from Phase 1.1 audit).
 *
 * Gated by `TEST_INTEGRATION=1` env var — opt-in to avoid breaking CI in
 * environments without local Postgres. Run via:
 *   TEST_INTEGRATION=1 jest test/chat-payment-integration.spec.ts
 *
 * Requires:
 * - Postgres running with DATABASE_URL set
 * - Migrations applied (npm run db:migrate)
 */
import { PrismaClient } from '@prisma/client';
import { ChatPaymentService } from '../src/chat/chat-payment.service';

const RUN_INTEGRATION = process.env.TEST_INTEGRATION === '1';

// Use Jest's `describe.skip` when not opted in
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

describeIntegration('ChatPaymentService — integration (real Postgres)', () => {
  let prisma: PrismaClient;
  let mockCreditsService: any;
  let service: ChatPaymentService;

  // Test fixtures — created once, cleaned up at end
  let testUserId: string;
  let testProfileId: string;
  let testReadingId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    // Create minimum fixtures: user + birth profile + bazi reading
    const user = await prisma.user.create({
      data: {
        clerkUserId: `test-clerk-${Date.now()}`,
        subscriptionTier: 'BASIC',
        credits: 100,
      },
    });
    testUserId = user.id;

    const profile = await prisma.birthProfile.create({
      data: {
        userId: testUserId,
        name: 'Test',
        birthDate: new Date('1990-01-01'),
        birthTime: '12:00',
        birthCity: 'Test City',
        birthTimezone: 'Asia/Taipei',
        gender: 'MALE',
      },
    });
    testProfileId = profile.id;

    const reading = await prisma.baziReading.create({
      data: {
        userId: testUserId,
        birthProfileId: testProfileId,
        readingType: 'LIFETIME',
        calculationData: {},
      },
    });
    testReadingId = reading.id;

    mockCreditsService = {
      deductCredits: jest.fn().mockResolvedValue(undefined),
    };
    service = new ChatPaymentService(prisma as any, mockCreditsService);
  });

  afterAll(async () => {
    // Cascade delete: User → ChatSession → ChatMessage, BirthProfile, BaziReading
    await prisma.user.delete({ where: { id: testUserId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clear chat tables for this user before each test (cascade-safe)
    await prisma.chatMessage.deleteMany({
      where: { session: { userId: testUserId } },
    });
    await prisma.chatSession.deleteMany({ where: { userId: testUserId } });
    await prisma.chatMonthlyUsage.deleteMany({ where: { userId: testUserId } });
  });

  // ============================================================
  // Raw SQL path: tryConsumeFreeQuota (regression test for Bug A)
  // ============================================================

  describe('tryConsumeFreeQuota raw SQL', () => {
    it('runs the guarded UPDATE query against real Postgres without error', async () => {
      // Create a session
      const session = await prisma.chatSession.create({
        data: {
          userId: testUserId,
          readingId: testReadingId,
          messageCount: 0,
          contextVersion: 'v1.0.0',
          preAnalysisVersion: 'v1.0.0',
          hardDeleteAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });

      // Call deductForMessage — exercises tryConsumeFreeQuota raw SQL
      const result = await prisma.$transaction(async (tx) => {
        return service.deductForMessage(session.id, testUserId, tx);
      });

      // Should consume from free quota (BASIC tier, fresh row)
      expect(result.method).toBe('FREE_QUOTA');

      // Verify row was created and chats_used = 1
      const row = await prisma.chatMonthlyUsage.findFirst({
        where: { userId: testUserId },
      });
      expect(row).not.toBeNull();
      expect(row!.chatsUsed).toBe(1);
      expect(row!.monthlyQuota).toBe(15); // BASIC quota
      expect(row!.subscriptionTier).toBe('BASIC');

      // Verify session counter incremented
      const sessionAfter = await prisma.chatSession.findUnique({
        where: { id: session.id },
      });
      expect(sessionAfter!.freeQuotaConsumed).toBe(1);
    });

    it('falls through to PAID_ALLOWANCE when free quota exhausted', async () => {
      // Pre-populate row at quota cap
      const periodStart = new Date(Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        1,
      ));
      await prisma.chatMonthlyUsage.create({
        data: {
          userId: testUserId,
          periodStart,
          chatsUsed: 15, // exhausted
          monthlyQuota: 15,
          subscriptionTier: 'BASIC',
        },
      });

      // Create a session with 1 paid extension already purchased
      const session = await prisma.chatSession.create({
        data: {
          userId: testUserId,
          readingId: testReadingId,
          messageCount: 15,
          creditExtensions: 1, // 10 paid messages available
          paidMessagesUsed: 0,
          freeQuotaConsumed: 15,
          contextVersion: 'v1.0.0',
          preAnalysisVersion: 'v1.0.0',
          hardDeleteAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });

      const result = await prisma.$transaction(async (tx) => {
        return service.deductForMessage(session.id, testUserId, tx);
      });

      expect(result.method).toBe('PAID_ALLOWANCE');

      const sessionAfter = await prisma.chatSession.findUnique({
        where: { id: session.id },
      });
      expect(sessionAfter!.paidMessagesUsed).toBe(1);
      // chatsUsed should NOT have changed
      const row = await prisma.chatMonthlyUsage.findFirst({
        where: { userId: testUserId },
      });
      expect(row!.chatsUsed).toBe(15);
    });
  });

  // ============================================================
  // Raw SQL path: refundLastMessage FREE_QUOTA branch (regression test for Bug A)
  // ============================================================

  describe('refundLastMessage FREE_QUOTA decrement', () => {
    it('decrements chats_used via raw SQL against real Postgres', async () => {
      // Set up: row with 5 used, session with 5 freeQuotaConsumed, persisted message
      const periodStart = new Date(Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        1,
      ));
      await prisma.chatMonthlyUsage.create({
        data: {
          userId: testUserId,
          periodStart,
          chatsUsed: 5,
          monthlyQuota: 15,
          subscriptionTier: 'BASIC',
        },
      });

      const session = await prisma.chatSession.create({
        data: {
          userId: testUserId,
          readingId: testReadingId,
          messageCount: 5,
          freeQuotaConsumed: 5,
          contextVersion: 'v1.0.0',
          preAnalysisVersion: 'v1.0.0',
          hardDeleteAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });

      const message = await prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: 'USER',
          content: 'test message',
          paymentMethod: 'FREE_QUOTA',
          errorCode: 'AI_FAILED', // simulate AI failure
        },
      });

      const result = await service.refundLastMessage(
        message.id,
        session.id,
        testUserId,
        'integration-test',
      );

      expect(result).toEqual({ refunded: true, method: 'FREE_QUOTA' });

      // Verify row decremented
      const row = await prisma.chatMonthlyUsage.findFirst({
        where: { userId: testUserId },
      });
      expect(row!.chatsUsed).toBe(4);

      // Verify session counter decremented
      const sessionAfter = await prisma.chatSession.findUnique({
        where: { id: session.id },
      });
      expect(sessionAfter!.freeQuotaConsumed).toBe(4);

      // Verify refundedAt was set
      const messageAfter = await prisma.chatMessage.findUnique({
        where: { id: message.id },
      });
      expect(messageAfter!.refundedAt).not.toBeNull();
      // Original errorCode preserved
      expect(messageAfter!.errorCode).toBe('AI_FAILED');
    });

    it('is idempotent — second refund of same message is no-op', async () => {
      const periodStart = new Date(Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        1,
      ));
      await prisma.chatMonthlyUsage.create({
        data: {
          userId: testUserId,
          periodStart,
          chatsUsed: 1,
          monthlyQuota: 15,
          subscriptionTier: 'BASIC',
        },
      });

      const session = await prisma.chatSession.create({
        data: {
          userId: testUserId,
          readingId: testReadingId,
          messageCount: 1,
          freeQuotaConsumed: 1,
          contextVersion: 'v1.0.0',
          preAnalysisVersion: 'v1.0.0',
          hardDeleteAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });

      const message = await prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: 'USER',
          content: 'test',
          paymentMethod: 'FREE_QUOTA',
        },
      });

      // First refund — succeeds
      const r1 = await service.refundLastMessage(message.id, session.id, testUserId, 'first');
      expect(r1.refunded).toBe(true);

      // Second refund — no-op via refundedAt guard
      const r2 = await service.refundLastMessage(message.id, session.id, testUserId, 'second');
      expect(r2.refunded).toBe(false);

      // chats_used should be 0 (not -1)
      const row = await prisma.chatMonthlyUsage.findFirst({
        where: { userId: testUserId },
      });
      expect(row!.chatsUsed).toBe(0);
    });
  });
});
