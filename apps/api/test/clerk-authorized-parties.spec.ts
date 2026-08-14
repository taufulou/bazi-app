/**
 * B5 — Clerk `authorizedParties` (the JWT `azp` claim allowlist).
 *
 * Without it, this API accepts a token minted for ANY frontend origin on the
 * same Clerk instance — a second app, a staging site, or an attacker-controlled
 * origin that has been added to the instance. `azp` is the claim Clerk sets to
 * the origin that requested the token, and it is inside the signature, so it
 * cannot be edited by the bearer.
 *
 * ⚠️ SCOPE, verified against `@clerk/backend`'s own implementation:
 *
 *     assertAuthorizedPartiesClaim = (azp, authorizedParties) => {
 *       if (!azp || !authorizedParties || authorizedParties.length === 0) return;
 *       if (!authorizedParties.includes(azp)) throw ...
 *     }
 *
 * A token with NO `azp` short-circuits before the allowlist is consulted. That
 * is deliberate on Clerk's part and is what keeps NATIVE clients working — the
 * mobile app has no web origin, so its tokens carry no `azp`. This is therefore
 * a constraint on tokens that CARRY an origin, not a complete origin lock, and
 * the tests below pin that boundary in both directions so nobody later "fixes"
 * the mobile case by adding a fake origin to the list.
 */
jest.mock('@clerk/backend', () => ({ verifyToken: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyToken } = require('@clerk/backend') as { verifyToken: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const guardModule = require('../src/auth/clerk.guard') as {
  ClerkAuthGuard: new (r: unknown, c: unknown) => { canActivate(ctx: unknown): Promise<boolean> };
  parseAuthorizedParties: (raw: string | undefined) => string[];
};
const { ClerkAuthGuard, parseAuthorizedParties } = guardModule;

const WEB = 'https://tianming.up.railway.app';
const LOCAL = 'http://localhost:3000';

function makeCtx(opts: { isPublic?: boolean; parties?: string; header?: string } = {}) {
  const request: Record<string, unknown> = {
    headers: { authorization: opts.header ?? 'Bearer some-token' },
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  };
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(opts.isPublic ?? false) };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'CLERK_SECRET_KEY') return 'sk_test_fake';
      if (key === 'CLERK_AUTHORIZED_PARTIES') return opts.parties;
      return undefined;
    }),
  };
  const guard = new ClerkAuthGuard(reflector as never, config as never);
  return { guard, ctx, request };
}

/** The options the guard handed to `verifyToken` on its most recent call. */
function lastOptions(): Record<string, unknown> {
  const calls = verifyToken.mock.calls;
  return calls[calls.length - 1][1];
}

describe('B5 — Clerk azp allowlist', () => {
  beforeEach(() => verifyToken.mockReset());

  describe('parseAuthorizedParties', () => {
    it.each([
      ['undefined', undefined, []],
      ['empty string', '', []],
      ['a single origin', WEB, [WEB]],
      ['two origins', `${WEB},${LOCAL}`, [WEB, LOCAL]],
      ['surrounding whitespace', ` ${WEB} , ${LOCAL} `, [WEB, LOCAL]],
      // A trailing comma in a Railway env var would otherwise put '' in the
      // allowlist — a live member that matches nothing, quietly, forever.
      ['a trailing comma', `${WEB},`, [WEB]],
      ['duplicates', `${WEB},${WEB}`, [WEB]],
      ['only commas', ',,,', []],
    ])('handles %s', (_label, raw, expected) => {
      expect(parseAuthorizedParties(raw as string | undefined)).toEqual(expected);
    });
  });

  describe('the allowlist reaches verifyToken', () => {
    it('is passed on the PROTECTED path', async () => {
      verifyToken.mockResolvedValue({ sub: 'user_1', sid: 'sess_1' });
      const { guard, ctx } = makeCtx({ parties: `${WEB},${LOCAL}` });

      await guard.canActivate(ctx);

      expect(lastOptions()).toEqual({
        secretKey: 'sk_test_fake',
        authorizedParties: [WEB, LOCAL],
      });
    });

    it('is passed on the PUBLIC (optional-auth) path too', async () => {
      // The surface B1 built to READ identity is exactly as exposed to a
      // foreign-origin token as a protected one — explain-element hands paid
      // layers to whoever the token says they are.
      verifyToken.mockResolvedValue({ sub: 'user_1', sid: 'sess_1' });
      const { guard, ctx } = makeCtx({ isPublic: true, parties: WEB });

      await guard.canActivate(ctx);

      expect(lastOptions()).toEqual({
        secretKey: 'sk_test_fake',
        authorizedParties: [WEB],
      });
    });

    it('is OMITTED when unset, rather than sent as an empty list', async () => {
      verifyToken.mockResolvedValue({ sub: 'user_1', sid: 'sess_1' });
      const { guard, ctx } = makeCtx({ parties: undefined });

      await guard.canActivate(ctx);

      expect(lastOptions()).toEqual({ secretKey: 'sk_test_fake' });
      expect(lastOptions()).not.toHaveProperty('authorizedParties');
    });

    it('never lets the two paths drift apart', async () => {
      verifyToken.mockResolvedValue({ sub: 'user_1', sid: 'sess_1' });

      const protectedCtx = makeCtx({ parties: WEB });
      await protectedCtx.guard.canActivate(protectedCtx.ctx);
      const optionsWhenProtected = lastOptions();

      const publicCtx = makeCtx({ isPublic: true, parties: WEB });
      await publicCtx.guard.canActivate(publicCtx.ctx);
      const optionsWhenPublic = lastOptions();

      expect(optionsWhenPublic).toEqual(optionsWhenProtected);
    });
  });

  describe('rejection behaviour (Clerk raises; the guard translates)', () => {
    it('401s a foreign-azp token on a protected route', async () => {
      // What @clerk/backend throws for a non-allowlisted azp.
      verifyToken.mockRejectedValue(
        new Error(`Invalid JWT Authorized party claim (azp) "https://evil.example". Expected "${WEB}".`),
      );
      const { guard, ctx, request } = makeCtx({ parties: WEB });

      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid or expired token');
      expect(request.auth).toBeUndefined();
    });

    it('drops a foreign-azp token to ANONYMOUS on a public route — never 401', async () => {
      // A public route must stay public. The correct outcome is "we don't know
      // who you are", not a rejection.
      verifyToken.mockRejectedValue(new Error('Invalid JWT Authorized party claim (azp)'));
      const { guard, ctx, request } = makeCtx({ isPublic: true, parties: WEB });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request.auth).toBeUndefined();
    });
  });

  describe('native clients are unaffected', () => {
    it('accepts a token with no azp while an allowlist is configured', async () => {
      // Mobile sends no web origin, so its tokens carry no azp and Clerk
      // short-circuits the check. Pinned because the obvious "hardening" —
      // requiring azp — would 401 every mobile user.
      verifyToken.mockResolvedValue({ sub: 'user_mobile', sid: 'sess_m' });
      const { guard, ctx, request } = makeCtx({ parties: WEB });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request.auth).toEqual({ userId: 'user_mobile', sessionId: 'sess_m' });
    });
  });
});
