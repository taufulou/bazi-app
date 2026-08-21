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
import { Logger } from '@nestjs/common';

jest.mock('@clerk/backend', () => ({ verifyToken: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyToken } = require('@clerk/backend') as { verifyToken: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const guardModule = require('../src/auth/clerk.guard') as {
  ClerkAuthGuard: new (r: unknown, c: unknown) => { canActivate(ctx: unknown): Promise<boolean> };
  parseAuthorizedParties: (
    raw: string | undefined,
    onNormalise?: (original: string, normalised: string) => void,
  ) => string[];
};
const { ClerkAuthGuard, parseAuthorizedParties } = guardModule;
// M1 split verification into AuthIdentityService; the guard now delegates to it,
// so constructing the guard means constructing that too. Same ConfigService
// stub, so the azp/secret wiring under test is unchanged.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthIdentityService } = require('../src/auth/auth-identity.service') as {
  AuthIdentityService: new (c: unknown) => unknown;
};

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
  const guard = new ClerkAuthGuard(reflector as never, new AuthIdentityService(config) as never);
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
      // A trailing comma would otherwise seat '' in the allowlist. That one is
      // inert while a real entry still matches — unlike the two below.
      ['a trailing comma', `${WEB},`, [WEB]],
      ['duplicates', `${WEB},${WEB}`, [WEB]],
      ['only commas', ',,,', []],
      // NORMALISED, because Clerk's match is exact and case-sensitive. Left
      // as-typed, each of these matches NOTHING — and since a non-empty
      // allowlist is enforced, that is every web session 401ing at once.
      // `clerk-azp-contract.spec.ts` proves the rejection against the real
      // verifier, and proves these normalised forms are then accepted.
      ['a trailing slash', `${WEB}/`, [WEB]],
      ['several trailing slashes', `${WEB}///`, [WEB]],
      ['uppercase', WEB.toUpperCase(), [WEB]],
      ['mixed case with a slash', `${WEB.toUpperCase()}/`, [WEB]],
      // A lone "/" normalises to '' and must be dropped, not seated.
      ['a bare slash', '/', []],
      // Normalisation must not merge two genuinely different origins…
      ['distinct ports', 'http://localhost:3000,http://localhost:3001', [
        'http://localhost:3000',
        'http://localhost:3001',
      ]],
      // …but SHOULD collapse two spellings of the same one.
      ['the same origin spelt two ways', `${WEB},${WEB.toUpperCase()}/`, [WEB]],
    ])('handles %s', (_label, raw, expected) => {
      expect(parseAuthorizedParties(raw as string | undefined)).toEqual(expected);
    });

    it('reports each entry it had to rewrite, so a bad env var is announced', () => {
      const seen: Array<[string, string]> = [];
      parseAuthorizedParties(`${WEB}/,${LOCAL}`, (o, n) => seen.push([o, n]));

      // Only the malformed one is reported — a correct entry must stay quiet or
      // the warning becomes noise and gets ignored.
      expect(seen).toEqual([[`${WEB}/`, WEB]]);
    });
  });

  describe('the allowlist reaches verifyToken', () => {
    // `objectContaining` on the allowlist, so that adding a legitimate option
    // later (clock skew, `jwtKey` for networkless verification) doesn't fail
    // three tests for reasons unrelated to their names. The "OMITTED when unset"
    // test below stays an exact match on purpose — one canary is enough.
    it('is passed on the PROTECTED path', async () => {
      verifyToken.mockResolvedValue({ sub: 'user_1', sid: 'sess_1' });
      const { guard, ctx } = makeCtx({ parties: `${WEB},${LOCAL}` });

      await guard.canActivate(ctx);

      expect(lastOptions()).toMatchObject({
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

      expect(lastOptions()).toMatchObject({
        secretKey: 'sk_test_fake',
        authorizedParties: [WEB],
      });
    });

    it('is OMITTED when unset, rather than sent as an empty list', async () => {
      verifyToken.mockResolvedValue({ sub: 'user_1', sid: 'sess_1' });
      const { guard, ctx } = makeCtx({ parties: undefined });

      await guard.canActivate(ctx);

      // The exact-match canary. `toEqual` is undefined-blind, so the
      // `not.toHaveProperty` is what actually catches a present-but-undefined key.
      expect(lastOptions()).toEqual({ secretKey: 'sk_test_fake' });
      expect(lastOptions()).not.toHaveProperty('authorizedParties');
    });

    it('never lets the two paths drift apart', async () => {
      verifyToken.mockResolvedValue({ sub: 'user_1', sid: 'sess_1' });

      const protectedCtx = makeCtx({ parties: WEB });
      await protectedCtx.guard.canActivate(protectedCtx.ctx);
      const optionsWhenProtected = lastOptions();

      const before = verifyToken.mock.calls.length;
      const publicCtx = makeCtx({ isPublic: true, parties: WEB });
      await publicCtx.guard.canActivate(publicCtx.ctx);

      // Without this, the test passed when the paths had MAXIMALLY drifted:
      // revert the public path to a bare `return true` and `lastOptions()`
      // re-reads the PROTECTED call, comparing it to itself. A drift test that
      // survives one side not verifying at all is worse than no drift test.
      expect(verifyToken.mock.calls.length).toBe(before + 1);
      expect(lastOptions()).toEqual(optionsWhenProtected);
    });
  });

  /**
   * ⚠️ These test the GUARD'S TRANSLATION of a rejection, nothing about azp.
   *
   * `verifyToken` is mocked here, so "the token had a foreign azp" is a story
   * the fixture tells — replace the rejection with `new Error('potato')` and
   * they still pass. Named accordingly, after an audit found the previous
   * titles ("401s a foreign-azp token…") claiming coverage they didn't have.
   *
   * The azp matching itself is pinned for real, against Clerk's own verifier
   * with locally-minted tokens, in `clerk-azp-contract.spec.ts`.
   */
  describe('how the guard translates a verification failure', () => {
    it('401s on a protected route', async () => {
      verifyToken.mockRejectedValue(new Error('any verification failure'));
      const { guard, ctx, request } = makeCtx({ parties: WEB });

      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid or expired token');
      expect(request.auth).toBeUndefined();
      // The generic message matters: Clerk's own error embeds the entire
      // allowlist, and that must not reach the client.
    });

    it('drops to ANONYMOUS on a public route — never 401', async () => {
      // A public route must stay public. The correct outcome is "we don't know
      // who you are", not a rejection.
      verifyToken.mockRejectedValue(new Error('any verification failure'));
      const { guard, ctx, request } = makeCtx({ isPublic: true, parties: WEB });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request.auth).toBeUndefined();
    });

    it('warns on a PUBLIC route when — and only when — the failure was azp', async () => {
      // The silent-degradation gap: a misconfigured allowlist doesn't 401 here,
      // it quietly drops every subscriber to the free tier on the one route that
      // sells paid layers, and the web proxy swallows its errors too. Ordinary
      // expiry must stay silent or the signal is buried.
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        verifyToken.mockRejectedValue(new Error('expired'));
        const ordinary = makeCtx({ isPublic: true, parties: WEB });
        await ordinary.guard.canActivate(ordinary.ctx);
        const afterOrdinary = warn.mock.calls.length;

        verifyToken.mockRejectedValue(
          Object.assign(new Error('Invalid JWT Authorized party claim (azp)'), {
            reason: 'token-invalid-authorized-parties',
          }),
        );
        const azpFailure = makeCtx({ isPublic: true, parties: WEB });
        await azpFailure.guard.canActivate(azpFailure.ctx);

        expect(warn.mock.calls.length).toBe(afterOrdinary + 1);
        expect(String(warn.mock.calls[warn.mock.calls.length - 1][0])).toContain('azp');
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('native clients are unaffected', () => {
    it('the GUARD does nothing extra to a token with no azp', async () => {
      // Scope note: with verifyToken mocked, this only rules out a guard-side
      // `if (!payload.azp) throw`. That Clerk ACCEPTS a no-azp token while an
      // allowlist is set — the claim that decides whether mobile survives the
      // env var — is proven in `clerk-azp-contract.spec.ts` against the real
      // verifier. Neither file alone is enough.
      verifyToken.mockResolvedValue({ sub: 'user_mobile', sid: 'sess_m' });
      const { guard, ctx, request } = makeCtx({ parties: WEB });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request.auth).toEqual({ userId: 'user_mobile', sessionId: 'sess_m' });
    });
  });

  describe('boot-time visibility', () => {
    // The guard is INERT when unset, so this warning is the only thing standing
    // between "configured" and "silently doing nothing". Deleting the whole
    // constructor if/else previously passed every test.
    it('warns when no allowlist is configured', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        makeCtx({ parties: undefined });
        const messages = warn.mock.calls.map((c) => String(c[0]));
        expect(messages.some((m) => m.includes('CLERK_AUTHORIZED_PARTIES'))).toBe(true);
      } finally {
        warn.mockRestore();
      }
    });

    it('does NOT warn when one is configured', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        makeCtx({ parties: WEB });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('warns about a malformed entry it had to normalise', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        makeCtx({ parties: `${WEB}/` });
        const messages = warn.mock.calls.map((c) => String(c[0]));
        expect(messages.some((m) => m.includes('normalised'))).toBe(true);
      } finally {
        warn.mockRestore();
      }
    });
  });
});
