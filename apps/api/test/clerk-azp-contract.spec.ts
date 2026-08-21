/**
 * B5 CONTRACT — the `azp` claims we rely on, checked against Clerk's REAL
 * verifier instead of a mock.
 *
 * `clerk-authorized-parties.spec.ts` mocks `verifyToken`, so it can only prove
 * that our guard PASSES the allowlist and TRANSLATES a rejection. Its
 * "rejects a foreign azp" and "accepts a token with no azp" tests were pinned by
 * a mock that had been told what to do — swap the rejection message for
 * `new Error('potato')` and they still pass. That is a description of Clerk's
 * behaviour, not a test of it, and the mobile claim in particular is
 * load-bearing: if a native token DID carry an `azp`, setting the env var would
 * 401 every mobile user, including paid IAP entitlement checks.
 *
 * So this file mints real RS256 tokens locally and runs Clerk's own
 * `verifyJwt`. No network, no Clerk instance, no mock. It ties OUR parser
 * directly to THEIR matcher, which is the seam where the trailing-slash and
 * case bugs live.
 *
 * What it still cannot prove: what Clerk's FAPI servers actually put in `azp`
 * for a given client. That is a server behaviour, and the only way to know it is
 * to decode a real token from each platform (see the B5 launch gate in
 * docs/security/audit-2026-08.md). This file pins the MATCHING rules; the
 * launch gate pins the VALUES.
 */
import { generateKeyPairSync } from 'crypto';
import { signJwt, verifyJwt } from '@clerk/backend/jwt';
import { parseAuthorizedParties } from '../src/auth/clerk.guard';

const WEB = 'https://tianming.up.railway.app';

// Generate KeyObjects and export separately: @types/node's `generateKeyPairSync`
// encoding options only allow pkcs1/spki for the public half, so there is no way
// to ask for a JWK inline. `KeyObject.export({format:'jwk'})` is the typed route.
//
// pkcs8 for the private half — pkcs1 makes the WebCrypto import throw
// `ERR_OSSL_ASN1_WRONG_TAG`. JWK for the public half, which is what verifyJwt wants.
const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const publicKey = keyPair.publicKey.export({ format: 'jwk' }) as JsonWebKey;

const NOW = Math.floor(Date.now() / 1000);

async function mint(claims: Record<string, unknown>): Promise<string> {
  return signJwt(
    { sub: 'user_1', iat: NOW - 10, exp: NOW + 600, nbf: NOW - 10, ...claims },
    privateKey,
    { algorithm: 'RS256' },
  );
}

/** Run Clerk's verifier; resolve to the sub, or to the rejection reason. */
async function verify(token: string, authorizedParties?: string[]) {
  try {
    const payload = await verifyJwt(token, {
      key: publicKey,
      ...(authorizedParties && { authorizedParties }),
    });
    return { ok: true as const, sub: payload.sub };
  } catch (err: unknown) {
    return {
      ok: false as const,
      reason: (err as { reason?: string }).reason,
      message: (err as Error).message,
    };
  }
}

describe('B5 contract — Clerk azp matching (real verifier)', () => {
  describe('the allowlist itself', () => {
    it('accepts a token whose azp is on the list', async () => {
      const res = await verify(await mint({ azp: WEB }), [WEB]);
      expect(res).toMatchObject({ ok: true, sub: 'user_1' });
    });

    it('REJECTS a foreign azp — this is the whole control', async () => {
      const res = await verify(await mint({ azp: 'https://evil.example' }), [WEB]);

      expect(res.ok).toBe(false);
      // Matched on the tag, not the prose: the message embeds the allowlist and
      // will change wording. The guard's silent-downgrade warning keys off this
      // same field.
      expect(res).toMatchObject({ reason: 'token-invalid-authorized-parties' });
    });

    it('accepts any azp when the list is EMPTY — omission and [] are the same', async () => {
      // Which is why the guard's "unset means no check" is a real statement
      // about behaviour and not just about our own code.
      const token = await mint({ azp: 'https://evil.example' });
      expect(await verify(token, [])).toMatchObject({ ok: true });
      expect(await verify(token, undefined)).toMatchObject({ ok: true });
    });
  });

  describe('native clients (the load-bearing claim)', () => {
    it('ACCEPTS a token with no azp even while an allowlist is configured', async () => {
      // Clerk short-circuits on `!azp` before consulting the list. This is what
      // keeps the mobile app working when the env var is set — and it is now
      // evidence rather than a comment.
      const res = await verify(await mint({}), [WEB]);
      expect(res).toMatchObject({ ok: true, sub: 'user_1' });
    });

    it('also accepts an EMPTY-STRING azp', async () => {
      // `!azp` is falsy-based, so '' short-circuits too.
      const res = await verify(await mint({ azp: '' }), [WEB]);
      expect(res).toMatchObject({ ok: true });
    });
  });

  describe('matching is EXACT — the operator footguns', () => {
    it('rejects a trailing slash in the allowlist entry', async () => {
      const res = await verify(await mint({ azp: WEB }), [`${WEB}/`]);
      expect(res).toMatchObject({ reason: 'token-invalid-authorized-parties' });
    });

    it('rejects a case difference in the allowlist entry', async () => {
      const res = await verify(await mint({ azp: WEB }), [WEB.toUpperCase()]);
      expect(res).toMatchObject({ reason: 'token-invalid-authorized-parties' });
    });

    it('rejects a bare host — Clerk’s own docs show one, and it matches nothing', async () => {
      // `@clerk/backend/dist/tokens/verify.d.ts` gives
      // `authorizedParties: ['http://localhost:3001', 'api.example.com']` as an
      // example. The second form can never match an origin-shaped azp.
      const res = await verify(await mint({ azp: WEB }), ['tianming.up.railway.app']);
      expect(res).toMatchObject({ reason: 'token-invalid-authorized-parties' });
    });
  });

  describe('our parser feeds their matcher correctly', () => {
    // The point of this block: the two halves are only correct TOGETHER. A
    // parser test alone cannot see that Clerk compares exactly; a matcher test
    // alone cannot see what our env parsing produces.
    it.each([
      ['exact', WEB],
      ['a trailing slash', `${WEB}/`],
      ['uppercase', WEB.toUpperCase()],
      ['whitespace and a trailing comma', ` ${WEB} ,`],
      ['a duplicate', `${WEB},${WEB}`],
    ])('an env var written with %s still admits the real token', async (_label, raw) => {
      const res = await verify(await mint({ azp: WEB }), parseAuthorizedParties(raw));
      expect(res).toMatchObject({ ok: true, sub: 'user_1' });
    });

    it('still rejects a foreign origin after normalisation', async () => {
      // Normalising must not have widened the allowlist into matching anything.
      const res = await verify(
        await mint({ azp: 'https://evil.example' }),
        parseAuthorizedParties(`${WEB}/`),
      );
      expect(res).toMatchObject({ reason: 'token-invalid-authorized-parties' });
    });

    it('a multi-origin dev value admits BOTH local origins', async () => {
      // Dev runs on localhost AND 127.0.0.1 (the HSTS dodge documented in
      // CLAUDE.md), and azp differs per origin. A single-value allowlist would
      // lock one of them out.
      const parties = parseAuthorizedParties('http://localhost:3000,http://127.0.0.1:3000');
      expect(await verify(await mint({ azp: 'http://localhost:3000' }), parties)).toMatchObject({
        ok: true,
      });
      expect(await verify(await mint({ azp: 'http://127.0.0.1:3000' }), parties)).toMatchObject({
        ok: true,
      });
    });
  });
});
