/**
 * B1 / O3 (Phase 1B) — optional auth on public routes + server-side paywall.
 *
 * Two defects, one root cause: `ClerkAuthGuard` returned `true` for a
 * `@Public()` route WITHOUT populating `request.auth`, even when the caller
 * sent a perfectly valid token. So a public route could not tell a subscriber
 * from an anonymous visitor, and:
 *
 *   • **O3** — `POST /api/bazi/explain-element` returns the element
 *     encyclopedia. The engine deliberately emits every layer (its docblock
 *     says so) and the paywall lived entirely in `ElementExplanation.tsx`
 *     behind an `isSubscriber` prop. A client-side paywall is not a paywall:
 *     `curl` returned the paid tiers in full.
 *   • **M1** — the rate-limit tracker keys on userId when authenticated and IP
 *     otherwise. On public routes it could only ever see the IP, so every
 *     signed-in user shared a single bucket there.
 *
 * The route stays `@Public()`. Auth is now verify-if-present: a valid token
 * identifies the caller, and anything else proceeds anonymously.
 */
import { UnauthorizedException } from '@nestjs/common';
import { BaziService, stripPaidExplanationLayers } from '../src/bazi/bazi.service';

// A realistic engine response: Layer A free, `personalized` = Layers B/C/D,
// `pillarContext` split free/paid.
const ENGINE_RESPONSE = {
  title: '正財',
  layerA: '正財代表穩定的財富來源…', // free tier
  pillarContext: {
    free: '日柱代表自身與配偶。',
    paid: '日柱正財，配偶多為務實持家之人…',
  },
  personalized: {
    pillarMeaning: '（Layer B）日柱宮位解讀…',
    godRoleMeaning: '（Layer C）正財為您的用神…',
    godRole: '用神',
    genderMeaning: '（Layer D）男命正財為妻…',
  },
  interactions: [{ type: '六合', detail: '…' }],
};

describe('O3 — stripPaidExplanationLayers', () => {
  it('removes every paid layer for an anonymous caller', () => {
    const out = stripPaidExplanationLayers(ENGINE_RESPONSE) as Record<string, unknown>;

    // Layers B/C/D all live under `personalized`.
    expect(out.personalized).toBeUndefined();
    expect((out.pillarContext as Record<string, unknown>).paid).toBeUndefined();

    // Belt and braces — assert the actual paid STRINGS are gone from the
    // serialized payload, not merely that the keys were deleted. A future
    // engine field echoing the same text elsewhere would slip a key check.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('Layer B');
    expect(serialized).not.toContain('Layer C');
    expect(serialized).not.toContain('Layer D');
    expect(serialized).not.toContain('配偶多為務實持家');
  });

  it('keeps the free tier intact — this must not become a blank response', () => {
    const out = stripPaidExplanationLayers(ENGINE_RESPONSE) as Record<string, unknown>;

    expect(out.title).toBe('正財');
    expect(out.layerA).toBe(ENGINE_RESPONSE.layerA);
    expect((out.pillarContext as Record<string, unknown>).free).toBe(
      ENGINE_RESPONSE.pillarContext.free,
    );
    expect(out.interactions).toEqual(ENGINE_RESPONSE.interactions);
  });

  it('does not mutate the engine response it was given', () => {
    const copy = JSON.parse(JSON.stringify(ENGINE_RESPONSE));
    stripPaidExplanationLayers(ENGINE_RESPONSE);
    expect(ENGINE_RESPONSE).toEqual(copy);
  });

  it('is total — passes non-object responses straight through', () => {
    for (const v of [null, undefined, 'a string', 42, [1, 2]]) {
      expect(stripPaidExplanationLayers(v)).toEqual(v);
    }
  });

  it('tolerates a response with no pillarContext', () => {
    const out = stripPaidExplanationLayers({ layerA: 'x' }) as Record<string, unknown>;
    expect(out).toEqual({ layerA: 'x' });
  });
});

// ============================================================
// O3 — the WIRING: does the service actually decide to strip?
// ============================================================

/**
 * ⚠️ This describe exists because a mutation found the gap. Making
 * `isSubscriberByClerkId` return `true` unconditionally — i.e. handing the paid
 * layers to everyone, the exact bug O3 fixes — passed the ENTIRE suite. The
 * strip helper was tested; the decision to call it was not.
 *
 * Same finding class as F6's stream door: mutation testing only covers code you
 * thought to mutate, so the separate question has to be asked — which callers
 * have no test pointing at them?
 */
describe('O3 — passthroughExplainElement gates on the caller tier', () => {
  function makeService(tier: string | null) {
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue(tier === null ? null : { subscriptionTier: tier }),
      },
    };
    const service = new BaziService(
      prisma as never,
      {} as never,
      { get: jest.fn().mockReturnValue('http://engine:5001') } as never,
      {} as never,
      {} as never,
    );
    // Stub the engine hop — this test is about the gate, not the transport.
    (service as unknown as { enginePassthrough: unknown }).enginePassthrough = jest
      .fn()
      .mockResolvedValue(JSON.parse(JSON.stringify(ENGINE_RESPONSE)));
    return { service, prisma };
  }

  it('ANONYMOUS caller (no clerkUserId) gets the free tier only', async () => {
    const { service, prisma } = makeService('PRO');
    const out = (await service.passthroughExplainElement({}, undefined)) as Record<string, unknown>;

    expect(out.personalized).toBeUndefined();
    expect(out.layerA).toBe(ENGINE_RESPONSE.layerA);
    // Never even looked a user up — there was no id to look up.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('FREE-tier caller gets the free tier only', async () => {
    const { service } = makeService('FREE');
    const out = (await service.passthroughExplainElement({}, 'clerk_free')) as Record<string, unknown>;
    expect(out.personalized).toBeUndefined();
  });

  it('SUBSCRIBER gets every layer', async () => {
    const { service } = makeService('PRO');
    const out = (await service.passthroughExplainElement({}, 'clerk_pro')) as Record<string, unknown>;

    expect(out.personalized).toEqual(ENGINE_RESPONSE.personalized);
    expect((out.pillarContext as Record<string, unknown>).paid).toBeDefined();
  });

  it('fails CLOSED — an unknown user, or a DB error, serves the free tier', async () => {
    const { service: unknownUser } = makeService(null);
    const a = (await unknownUser.passthroughExplainElement({}, 'clerk_ghost')) as Record<string, unknown>;
    expect(a.personalized).toBeUndefined();

    const { service: broken, prisma } = makeService('PRO');
    prisma.user.findUnique.mockRejectedValue(new Error('db down'));
    const b = (await broken.passthroughExplainElement({}, 'clerk_pro')) as Record<string, unknown>;
    expect(b.personalized).toBeUndefined();
  });
});

// ============================================================
// B1 — optional auth on public routes
// ============================================================

/**
 * `verifyToken` is module-scoped in the guard, so it is mocked at the module
 * boundary rather than injected.
 */
jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyToken } = require('@clerk/backend') as { verifyToken: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ClerkAuthGuard } = require('../src/auth/clerk.guard') as {
  ClerkAuthGuard: new (r: unknown, c: unknown) => {
    canActivate(ctx: unknown): Promise<boolean>;
  };
};

function makeCtx(isPublic: boolean, authHeader?: string) {
  const request: Record<string, unknown> = { headers: { authorization: authHeader } };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  };
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(isPublic) };
  const config = { get: jest.fn().mockReturnValue('sk_test_fake') };
  const guard = new ClerkAuthGuard(reflector as never, config as never);
  return { guard, ctx, request };
}

describe('B1 — public routes verify a token when one is present', () => {
  beforeEach(() => verifyToken.mockReset());

  it('attaches a VERIFIED identity on a public route', async () => {
    verifyToken.mockResolvedValue({ sub: 'user_abc', sid: 'sess_1' });
    const { guard, ctx, request } = makeCtx(true, 'Bearer good-token');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    expect(request.auth).toEqual({ userId: 'user_abc', sessionId: 'sess_1' });
    // Signature-VERIFIED, never a decoded-but-unverified `sub` — otherwise a
    // forged bearer could mint rate-limit buckets and impersonate a subscriber.
    expect(verifyToken).toHaveBeenCalledWith('good-token', { secretKey: 'sk_test_fake' });
  });

  it('proceeds ANONYMOUSLY on a bad token — a public route must not become private', async () => {
    verifyToken.mockRejectedValue(new Error('expired'));
    const { guard, ctx, request } = makeCtx(true, 'Bearer expired-token');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.auth).toBeUndefined();
  });

  it.each([
    ['no header at all', undefined],
    ['a non-Bearer scheme', 'Basic abc123'],
    ['Bearer with no token', 'Bearer '],
  ])('proceeds anonymously with %s', async (_label, header) => {
    const { guard, ctx, request } = makeCtx(true, header);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.auth).toBeUndefined();
  });

  it('still REJECTS a bad token on a PROTECTED route', async () => {
    // The optional path must not have weakened the real gate.
    verifyToken.mockRejectedValue(new Error('expired'));
    const { guard, ctx } = makeCtx(false, 'Bearer expired-token');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('still REJECTS a missing token on a PROTECTED route', async () => {
    const { guard, ctx } = makeCtx(false, undefined);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
