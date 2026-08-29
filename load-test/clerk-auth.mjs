/**
 * L3 — mint a usable bearer token for a Clerk user, on a PRODUCTION instance.
 *
 * ## Why this is not two lines
 *
 * The obvious approach — `sessions.createSession({ userId })` then
 * `sessions.getToken(id, undefined, ttl)` — works perfectly against a
 * development instance and fails against production with:
 *
 *     request_invalid_for_environment
 *     "Request only valid for development instances."
 *
 * That was discovered by running the seeder against production with 3 users
 * after it had passed against dev. No amount of local testing would have found
 * it, because the local instance is precisely the one where it works.
 *
 * ## What does work
 *
 * The same thing a browser does, over plain HTTP:
 *
 *   1. `signInTokens.createSignInToken({ userId })` — a "ticket". Backend API,
 *      valid on production instances.
 *   2. `POST {fapi}/v1/client/sign_ins?_is_native=1` with `strategy=ticket`.
 *      ⚠️ `_is_native=1` is the load-bearing part: it makes Clerk return the
 *      session token in the response BODY instead of setting a browser cookie,
 *      which is what makes this usable from a script at all.
 *   3. `sessions.getToken(sessionId, undefined, ttl)` to extend the lifetime.
 *      Step 2 alone yields a **60-second** token — the very problem L3 exists
 *      to solve — so without this the tokens expire mid-run.
 *
 * Step 3 is a different endpoint from `createSession` and is expected to be
 * production-safe, but that is not verified against a live instance yet. So a
 * failure there DEGRADES to the 60s token from step 2 rather than aborting,
 * and says so. A caller that gets 60s tokens must refresh during the run.
 *
 * Measured on dev: ticket → exchange → getToken(3600) and getToken(14400) both
 * produce tokens `verifyToken` accepts, carrying no `azp` claim (so Clerk's
 * authorizedParties check short-circuits and passes).
 */

/** `pk_test_ZW5n…` / `pk_live_…` encode the Frontend API host in base64. */
export function fapiHostFromPublishableKey(pk) {
  if (!pk) return null;
  const b64 = pk.replace(/^pk_(test|live)_/, '');
  try {
    return Buffer.from(b64, 'base64').toString('utf8').replace(/\$+$/, '') || null;
  } catch {
    return null;
  }
}

export function resolveFapiHost({ flag, publishableKey }) {
  const host = flag || fapiHostFromPublishableKey(publishableKey);
  if (!host) {
    throw new Error(
      'Frontend API host unknown. Pass --fapi <host> (production is\n' +
        '  clerk.tianmingapp.com) or set CLERK_PUBLISHABLE_KEY so it can be decoded.',
    );
  }
  return host.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * @returns {Promise<{ jwt: string, sessionId: string, ttlSeconds: number, extended: boolean }>}
 */
export async function mintForUser(clerk, userId, { ttl = 3600, fapi }) {
  const ticket = await clerk.signInTokens.createSignInToken({ userId, expiresInSeconds: 600 });

  const res = await fetch(`https://${fapi}/v1/client/sign_ins?_is_native=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ strategy: 'ticket', ticket: ticket.token }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const why = json?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? `HTTP ${res.status}`;
    throw new Error(`sign_ins exchange failed — ${why}`);
  }

  const sessionId = json?.response?.created_session_id;
  const short = json?.client?.sessions?.find((s) => s.id === sessionId)?.last_active_token?.jwt;
  if (!sessionId || !short) {
    throw new Error(`sign_ins returned no session (status=${json?.response?.status ?? '?'})`);
  }

  // Extend. Falls back rather than failing: a 60s token still works, it just
  // has to be refreshed, and that is a far better outcome than no token.
  try {
    const long = await clerk.sessions.getToken(sessionId, undefined, ttl);
    return { jwt: long.jwt, sessionId, ttlSeconds: ttl, extended: true };
  } catch {
    return { jwt: short, sessionId, ttlSeconds: 60, extended: false };
  }
}
