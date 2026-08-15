/**
 * F5 (Phase 1A audit) — the three chat doors onto fortune content.
 *
 * `fortune-window.spec.ts` covers the rule. This covers WHERE it is enforced:
 *
 *   1. `ChatService.createSession`      — fail fast, before a session row exists
 *   2. `ChatService.sendMessage`        — non-streaming send
 *   3. `ChatStreamService`              — the streaming send the web client uses
 *
 * Doors 2 and 3 both go through `ChatContextService.getChatContextForFortune`,
 * which is where the load-bearing check lives: the anchor is pinned on the
 * session row at create time, so a subscriber can open a +4yr session and then
 * downgrade. Gating only `createSession` would leave that session serving
 * content the tier no longer entitles them to — the same reasoning behind the
 * comparison path's mid-session `paidAt` re-check.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SubscriptionTier } from '@prisma/client';
import { ChatService } from '../src/chat/chat.service';
import { ChatContextService } from '../src/chat/chat-context.service';

const USER_ID = 'user-uuid-1';
const CLERK = 'clerk_user_1';
const PROFILE_ID = 'profile-uuid-1';

// The exploit from the audit: a year far outside every window.
const EXPLOIT_ANCHOR = '2030-01-01';

const codeOf = (err: unknown): string | undefined =>
  ((err as ForbiddenException)?.getResponse?.() as { code?: string })?.code;

// ============================================================
// Door 1 — createSession
// ============================================================

function makeChatService(tier: SubscriptionTier) {
  const assertFortuneWindowForTier = jest.fn();
  const mockPrisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID, subscriptionTier: tier }) },
    birthProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: PROFILE_ID, userId: USER_ID }),
    },
    chatSession: { create: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
  };
  const mockContext = {
    assertFortuneWindowForTier,
    getCurrentSnapshotVersionsForFortune: jest.fn().mockReturnValue({
      contextVersion: 'v1.0.0',
      preAnalysisVersion: 'fort-year=v1.1.0',
    }),
  };
  const service = new ChatService(
    mockPrisma as never,
    { get: jest.fn(() => undefined) } as never,
    {} as never,
    mockContext as never,
    {} as never,
    {} as never,
    { record: jest.fn(), assertUnderCap: jest.fn() } as never,
  );
  return { service, mockPrisma, assertFortuneWindowForTier };
}

const fortuneArgs = (scope: 'DAY' | 'MONTH' | 'YEAR', anchor: string) => ({
  fortune: { profileId: PROFILE_ID, fortuneScope: scope, fortuneAnchorDate: anchor },
});

describe('F5 door 1 — createSession consults the window', () => {
  it('passes the session tier, scope and anchor to the gate', async () => {
    const { service, assertFortuneWindowForTier } = makeChatService(SubscriptionTier.FREE);

    await service
      .createSession(CLERK, fortuneArgs('YEAR', EXPLOIT_ANCHOR) as never)
      .catch(() => undefined);

    expect(assertFortuneWindowForTier).toHaveBeenCalledWith(
      SubscriptionTier.FREE,
      'YEAR',
      EXPLOIT_ANCHOR,
    );
  });

  it('does NOT create a session row when the gate throws', async () => {
    const { service, mockPrisma, assertFortuneWindowForTier } = makeChatService(
      SubscriptionTier.FREE,
    );
    assertFortuneWindowForTier.mockImplementation(() => {
      throw new ForbiddenException({ code: 'SUBSCRIBER_ONLY', message: 'x' });
    });

    await expect(
      service.createSession(CLERK, fortuneArgs('YEAR', EXPLOIT_ANCHOR) as never),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // An out-of-window request must cost nothing — no row, no credit.
    expect(mockPrisma.chatSession.create).not.toHaveBeenCalled();
  });

  it('gates AFTER ownership, so it cannot be used to probe other users profiles', async () => {
    const { service, mockPrisma, assertFortuneWindowForTier } = makeChatService(
      SubscriptionTier.FREE,
    );
    mockPrisma.birthProfile.findUnique.mockResolvedValue({
      id: PROFILE_ID,
      userId: 'somebody-else',
    });

    await expect(
      service.createSession(CLERK, fortuneArgs('YEAR', EXPLOIT_ANCHOR) as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(assertFortuneWindowForTier).not.toHaveBeenCalled();
  });
});

// ============================================================
// Doors 2 + 3 — the shared context builder
// ============================================================

function makeContextService(tier: SubscriptionTier | null) {
  const prisma = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue(tier === null ? null : { subscriptionTier: tier }),
    },
    birthProfile: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const config = {
    get: jest.fn((k: string) =>
      k === 'FORTUNE_DEFAULT_TZ' ? 'Asia/Taipei' : undefined,
    ),
  };
  const service = new ChatContextService(
    config as never,
    prisma as never,
    { get: jest.fn(), set: jest.fn() } as never,
  );
  return { service, prisma };
}

describe('F5 doors 2+3 — getChatContextForFortune gates before doing anything', () => {
  it('refuses a FREE user an out-of-window anchor', async () => {
    const { service } = makeContextService(SubscriptionTier.FREE);

    const err = await service
      .getChatContextForFortune(PROFILE_ID, EXPLOIT_ANCHOR, 'FORTUNE', 'YEAR', USER_ID)
      .catch((e) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(codeOf(err)).toBe('SUBSCRIBER_ONLY');
  });

  it('refuses a SUBSCRIBER beyond the +4yr window', async () => {
    // The half that is easy to forget: paid tiers are not unlimited, and for
    // them the marginal cost of an extra year is ZERO (free-message quota).
    const { service } = makeContextService(SubscriptionTier.MASTER);

    const err = await service
      .getChatContextForFortune(PROFILE_ID, '2099-01-01', 'FORTUNE', 'YEAR', USER_ID)
      .catch((e) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(codeOf(err)).toBe('OUT_OF_WINDOW');
  });

  it('gates BEFORE the profile lookup — a refused request costs nothing', async () => {
    const { service, prisma } = makeContextService(SubscriptionTier.FREE);

    await service
      .getChatContextForFortune(PROFILE_ID, EXPLOIT_ANCHOR, 'FORTUNE', 'YEAR', USER_ID)
      .catch(() => undefined);

    // No profile read, and therefore no cache read and no engine call either.
    expect(prisma.birthProfile.findUnique).not.toHaveBeenCalled();
  });

  it('fails closed when the user row is missing', async () => {
    // ⚠️ Assert the SPECIFIC exception, not just its class. The profile mock
    // also resolves null, so a bare `toBeInstanceOf(NotFoundException)` passes
    // even with the gate deleted — it would be catching the profile lookup's
    // "not found" a hundred lines later. The audit caught this one.
    const { service, prisma } = makeContextService(null);

    const err = await service
      .getChatContextForFortune(PROFILE_ID, EXPLOIT_ANCHOR, 'FORTUNE', 'YEAR', USER_ID)
      .catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).message).toMatch(/User not found/);
    expect(prisma.birthProfile.findUnique).not.toHaveBeenCalled();
  });

  it('resolves "now" in the platform timezone, not UTC', async () => {
    // A security control, not cosmetics: it decides WHICH single calendar day a
    // FREE user may read. At 17:00Z it is already tomorrow in Taipei, so a UTC
    // clock would refuse today and admit yesterday — content the HTTP route
    // refuses. Swapping the tz argument passed every one of these tests before.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T17:00:00Z'));
    try {
      const { service, prisma } = makeContextService(SubscriptionTier.FREE);

      // Taipei says 2026-08-14. Under UTC this would be refused.
      const ok = await service
        .getChatContextForFortune(PROFILE_ID, '2026-08-14', 'FORTUNE', 'DAY', USER_ID)
        .catch((e) => e);
      expect(ok).toBeInstanceOf(NotFoundException); // reached the profile lookup
      expect(prisma.birthProfile.findUnique).toHaveBeenCalled();

      // And the UTC date is correctly OUT of a FREE user's window.
      const refused = await service
        .getChatContextForFortune(PROFILE_ID, '2026-08-13', 'FORTUNE', 'DAY', USER_ID)
        .catch((e) => e);
      expect(refused).toBeInstanceOf(ForbiddenException);
      expect(codeOf(refused)).toBe('SUBSCRIBER_ONLY');
    } finally {
      jest.useRealTimers();
    }
  });

  it('lets an in-window request through to the profile lookup', async () => {
    // Proves the gate is not simply refusing everything — this must reach the
    // NotFoundException from the (deliberately empty) profile mock.
    const { service, prisma } = makeContextService(SubscriptionTier.PRO);
    const thisYear = `${new Date().getUTCFullYear()}-01-01`;

    const err = await service
      .getChatContextForFortune(PROFILE_ID, thisYear, 'FORTUNE', 'YEAR', USER_ID)
      .catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect(prisma.birthProfile.findUnique).toHaveBeenCalled();
  });
});

// ============================================================
// Door 4 — extendSession
// ============================================================

describe('F5 door 4 — extendSession will not sell messages that cannot be spent', () => {
  function makeExtendService(tier: SubscriptionTier, anchor: string) {
    const assertFortuneWindowForTier = jest.fn();
    const extendSession = jest.fn().mockResolvedValue({ ok: true });
    const mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: USER_ID, subscriptionTier: tier }),
      },
      chatSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sess-1',
          userId: USER_ID,
          readingType: 'FORTUNE',
          fortuneScope: 'YEAR',
          fortuneAnchorDate: new Date(`${anchor}T00:00:00Z`),
          contextVersion: 'v1.0.0',
          preAnalysisVersion: 'fort-year=v1.1.0',
        }),
      },
    };
    const service = new ChatService(
      mockPrisma as never,
      { get: jest.fn(() => undefined) } as never,
      { extendSession } as never,
      {
        assertFortuneWindowForTier,
        getCurrentSnapshotVersionsForFortune: jest.fn().mockReturnValue({
          contextVersion: 'v1.0.0',
          preAnalysisVersion: 'fort-year=v1.1.0',
        }),
      } as never,
      {} as never,
      {
        acquireLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(undefined),
      } as never,
      { record: jest.fn(), assertUnderCap: jest.fn() } as never,
    );
    return { service, extendSession, assertFortuneWindowForTier };
  }

  it('checks the window before charging', async () => {
    const { service, assertFortuneWindowForTier } = makeExtendService(
      SubscriptionTier.FREE,
      EXPLOIT_ANCHOR,
    );
    await service.extendSession(CLERK, 'sess-1').catch(() => undefined);
    expect(assertFortuneWindowForTier).toHaveBeenCalledWith(
      SubscriptionTier.FREE,
      'YEAR',
      EXPLOIT_ANCHOR,
    );
  });

  it('does NOT deduct a credit when the session has fallen out of window', async () => {
    const { service, extendSession, assertFortuneWindowForTier } = makeExtendService(
      SubscriptionTier.FREE,
      EXPLOIT_ANCHOR,
    );
    assertFortuneWindowForTier.mockImplementation(() => {
      throw new ForbiddenException({ code: 'SUBSCRIBER_ONLY', message: 'x' });
    });

    await expect(service.extendSession(CLERK, 'sess-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(extendSession).not.toHaveBeenCalled();
  });

  it('still extends an in-window session', async () => {
    const { service, extendSession } = makeExtendService(SubscriptionTier.PRO, '2026-01-01');
    await service.extendSession(CLERK, 'sess-1');
    expect(extendSession).toHaveBeenCalled();
  });
});

describe('F5 — the signature itself is the coverage guarantee', () => {
  it('requires userId — a caller cannot reach fortune context without one', () => {
    // `userId` is a REQUIRED 5th parameter and the defaults on readingType /
    // fortuneScope were dropped, so any new call site that forgets the gate is
    // a compile error rather than a silently ungated read. Both existing
    // production call sites (chat.service + chat-stream.service) were found by
    // the compiler when this changed.
    expect(ChatContextService.prototype.getChatContextForFortune).toHaveLength(5);
  });
});
