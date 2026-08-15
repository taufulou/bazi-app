/**
 * F6 (Phase 1B) — chat must not open on a REFUNDED reading.
 *
 * The third door onto paid reading content, and the one F2 missed. F2 closed
 * `getReading` (strips to preview) and `_setupStream` (throws READING_REFUNDED).
 * Chat was left checking ownership only — `chat.service.ts` selected
 * `{id, userId, readingType}`, with no `refundedAt` — while the comparison
 * branch twenty lines below gated on `paidAt` *with a comment stating the exact
 * principle*: "Ownership is NOT enough … the web UI happens to gate the chat
 * mount, but this API is directly reachable."
 *
 * Chat is not a replay of stored text: it rebuilds the analysis from the birth
 * profile via the engine, so nulling `aiInterpretation` on refund does nothing
 * to stop it. And for LIFETIME the refuse template is `null`, so the session
 * answers anything.
 *
 * Exploit it closes: create LIFETIME (−3) → AI fails → refund (+3) →
 * `/stream` correctly 400s → `POST /chat/sessions {readingId}` → 201 →
 * extend (−1) → 10 unbounded questions. Net 1 credit for content the stream
 * gate was just fixed to withhold.
 *
 * Four doors, mirroring F5: createSession · sendMessage · the SSE stream ·
 * extendSession.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ChatService } from '../src/chat/chat.service';

const CLERK = 'clerk_user_1';
const USER_ID = 'user-uuid-1';
const READING_ID = 'reading-uuid-1';

const codeOf = (err: unknown): string | undefined =>
  ((err as BadRequestException)?.getResponse?.() as { code?: string })?.code;

function makeService(readingOverrides: Record<string, unknown> = {}) {
  const reading = {
    id: READING_ID,
    userId: USER_ID,
    readingType: 'LIFETIME',
    refundedAt: null,
    ...readingOverrides,
  };
  const extendSession = jest.fn().mockResolvedValue({ ok: true });
  const getMonthlyUsage = jest.fn().mockResolvedValue({
    chatsUsed: 0, monthlyQuota: 5,
    resetsAt: new Date('2026-09-01'), subscriptionTier: 'FREE',
  });
  const mockPrisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: USER_ID,
        subscriptionTier: 'FREE',
      }),
    },
    baziReading: { findUnique: jest.fn().mockResolvedValue(reading) },
    chatSession: {
      create: jest.fn().mockResolvedValue({ id: 'sess-1' }),
      findUnique: jest.fn().mockResolvedValue({
        id: 'sess-1',
        userId: USER_ID,
        readingId: READING_ID,
        readingType: 'LIFETIME',
        contextVersion: 'v1.0.0',
        preAnalysisVersion: 'pa-v1',
      }),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const service = new ChatService(
    mockPrisma as never,
    { get: jest.fn(() => undefined) } as never,
    { extendSession, getMonthlyUsage } as never,
    {
      getCurrentSnapshotVersions: jest.fn().mockReturnValue({
        contextVersion: 'v1.0.0',
        preAnalysisVersion: 'pa-v1',
      }),
    } as never,
    {} as never,
    {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    } as never,
    { record: jest.fn(), assertUnderCap: jest.fn() } as never,
  );
  return { service, mockPrisma, extendSession };
}

describe('F6 door 1 — createSession', () => {
  it('refuses a refunded reading with READING_REFUNDED', async () => {
    const { service, mockPrisma } = makeService({ refundedAt: new Date() });

    const err = await service
      .createSession(CLERK, { readingId: READING_ID } as never)
      .catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(codeOf(err)).toBe('READING_REFUNDED');
    // Refused before a session row exists — no credit, no artefact.
    expect(mockPrisma.chatSession.create).not.toHaveBeenCalled();
  });

  it('selects refundedAt at all — the omission that WAS the bug', async () => {
    const { service, mockPrisma } = makeService();
    await service.createSession(CLERK, { readingId: READING_ID } as never).catch(() => undefined);

    expect(mockPrisma.baziReading.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ refundedAt: true }),
      }),
    );
  });

  it('treats a MISSING refundedAt as not-refunded rather than refusing', async () => {
    // Prisma returns null for an unset DateTime?, but a partial select or an
    // incomplete mock yields undefined. `=== null` would be false there and
    // lock out paying customers — the exact slip caught during F2.
    const { service, mockPrisma } = makeService({ refundedAt: undefined });
    await service.createSession(CLERK, { readingId: READING_ID } as never);
    expect(mockPrisma.chatSession.create).toHaveBeenCalled();
  });

  it('still opens on a normal reading', async () => {
    const { service, mockPrisma } = makeService();
    await service.createSession(CLERK, { readingId: READING_ID } as never);
    expect(mockPrisma.chatSession.create).toHaveBeenCalled();
  });

  it('gates AFTER ownership, so it cannot probe other users readings', async () => {
    const { service } = makeService({ userId: 'somebody-else', refundedAt: new Date() });
    await expect(
      service.createSession(CLERK, { readingId: READING_ID } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('F6 doors 2+3 — the per-message re-check', () => {
  it('assertReadingNotRefunded throws on a refunded row', async () => {
    const { service } = makeService({ refundedAt: new Date() });
    const err = await service.assertReadingNotRefunded(READING_ID).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(codeOf(err)).toBe('READING_REFUNDED');
  });

  it('passes a non-refunded row', async () => {
    const { service } = makeService();
    await expect(service.assertReadingNotRefunded(READING_ID)).resolves.toBeUndefined();
  });

  it('fails CLOSED when the reading has vanished', async () => {
    const { service, mockPrisma } = makeService();
    mockPrisma.baziReading.findUnique.mockResolvedValue(null);
    await expect(service.assertReadingNotRefunded(READING_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('re-checks on EVERY message, not just at create — a refund can land mid-session', async () => {
    // The session was legitimately opened; the refund arrives afterwards. The
    // create-time gate cannot see that, which is why the per-message check is
    // the load-bearing one (same reasoning as the comparison path's paidAt
    // re-check, and as F5's fortune window).
    const { service, mockPrisma } = makeService();
    await expect(service.assertReadingNotRefunded(READING_ID)).resolves.toBeUndefined();

    mockPrisma.baziReading.findUnique.mockResolvedValue({ refundedAt: new Date() });
    await expect(service.assertReadingNotRefunded(READING_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('F6 door 2 — sendMessage (the door the audit found untested)', () => {
  /**
   * ⚠️ This describe exists because the F6 line audit deleted
   * `assertReadingNotRefunded(session.readingId)` from `sendMessage` and the
   * ENTIRE 1530-test suite passed.
   *
   * The original F6 spec tested the HELPER directly, not this CALLER — and
   * `chat-service.spec.ts`'s `beforeEach` defaults `baziReading.findUnique` to
   * a non-refunded row, so its six `sendMessage` tests traverse the gate
   * without ever exercising it. `POST /sessions/:id/messages-sync` is a live
   * authenticated route, so dropping that line would have restored the F6
   * exploit on a real endpoint with a green suite.
   *
   * The lesson is narrower than "ask which callers have no test": I DID ask
   * that, answered it for the stream door, and never re-asked for the sibling
   * caller twenty lines away in the same file. Ask it per CALLER, not per file.
   */
  function makeSendService(refundedAt: Date | null) {
    const deductForMessage = jest.fn().mockResolvedValue({ method: 'FREE_QUOTA' });
    const getChatContextForReading = jest.fn().mockResolvedValue({ chart: {} });
    const mockPrisma: Record<string, unknown> = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID, subscriptionTier: 'FREE' }) },
      baziReading: { findUnique: jest.fn().mockResolvedValue({ refundedAt }) },
      chatSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sess-1',
          userId: USER_ID,
          readingId: READING_ID,
          readingType: 'LIFETIME',
          startedAt: new Date(),
          endedAt: null,
          contextVersion: 'v1.0.0',
          preAnalysisVersion: 'pa-v1',
          messageCount: 0,
          firstMessageAt: null,
          creditExtensions: 0,
          paidMessagesUsed: 0,
        }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      chatMessage: {
        create: jest.fn().mockResolvedValue({ id: 'm1' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(mockPrisma)),
    };
    const service = new ChatService(
      mockPrisma as never,
      { get: jest.fn(() => undefined) } as never,
      {
        deductForMessage,
        // Must resolve: the entitlement-refusal branch does `.catch()` on it.
        refundLastMessage: jest.fn().mockResolvedValue({ refunded: true, method: 'FREE_QUOTA' }),
        getMonthlyUsage: jest.fn().mockResolvedValue({
          chatsUsed: 0, monthlyQuota: 5, resetsAt: new Date(), subscriptionTier: 'FREE',
        }),
      } as never,
      {
        getChatContextForReading,
        getCurrentSnapshotVersions: jest.fn().mockReturnValue({
          contextVersion: 'v1.0.0',
          preAnalysisVersion: 'pa-v1',
        }),
      } as never,
      { refuseListPreFlight: jest.fn().mockReturnValue({ refused: false }) } as never,
      { acquireLock: jest.fn().mockResolvedValue(true), releaseLock: jest.fn() } as never,
      { record: jest.fn(), assertUnderCap: jest.fn() } as never,
    );
    return { service, getChatContextForReading, deductForMessage };
  }

  it('refuses a refunded reading BEFORE building any context', async () => {
    const { service, getChatContextForReading } = makeSendService(new Date());

    const err = await service.sendMessage(CLERK, 'sess-1', 'hello').catch((e) => e);

    expect(codeOf(err)).toBe('READING_REFUNDED');
    // The gate must precede the engine call, or the refusal costs us a
    // chat-context build (and, further down, an Anthropic call).
    expect(getChatContextForReading).not.toHaveBeenCalled();
  });

  it('lets a non-refunded reading through to context building', async () => {
    // Negative control: proves the gate is not simply refusing everything.
    const { service, getChatContextForReading } = makeSendService(null);
    await service.sendMessage(CLERK, 'sess-1', 'hello').catch(() => undefined);
    expect(getChatContextForReading).toHaveBeenCalled();
  });
});

describe('F6 door 4 — extendSession', () => {
  it('will not sell 10 messages every send would refuse', async () => {
    const { service, extendSession, mockPrisma } = makeService({ refundedAt: new Date() });

    await expect(service.extendSession(CLERK, 'sess-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(extendSession).not.toHaveBeenCalled();
    expect(mockPrisma.baziReading.findUnique).toHaveBeenCalled();
  });

  it('still extends a normal session', async () => {
    const { service, extendSession } = makeService();
    await service.extendSession(CLERK, 'sess-1');
    expect(extendSession).toHaveBeenCalled();
  });
});
