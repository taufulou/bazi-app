/**
 * B5 — the `azp` allowlist helpers.
 *
 * Split out of `clerk.guard.ts` by M1 so `AuthIdentityService` can use them
 * without importing the guard (which imports the service — a cycle). The
 * mirror on the web side is `apps/web/app/lib/authorized-parties.ts`, and
 * `authorized-parties-parity.spec.ts` compares the two.
 */
/**
 * Was this verification failure specifically an `azp` allowlist rejection?
 *
 * `@clerk/backend` tags it `token-invalid-authorized-parties` on the error's
 * `reason` (`TokenVerificationErrorReason`). Matching the tag rather than the
 * message text, which embeds the allowlist and will change wording.
 */
export function isAuthorizedPartiesFailure(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { reason?: unknown }).reason === 'token-invalid-authorized-parties'
  );
}

/**
 * Parse `CLERK_AUTHORIZED_PARTIES` — a comma-separated origin list.
 *
 * NORMALISES, because the matcher does not. Clerk compares with
 * `authorizedParties.includes(azp)` — exact and case-sensitive — against an
 * origin it emits as lowercase scheme + host (+ port when non-default) with no
 * trailing slash. So an operator who types `https://App.Example.com/` produces
 * an entry that matches nothing, and since a non-empty allowlist IS enforced,
 * the result is **every web session 401ing**, immediately, with no clue why.
 *
 * An earlier version guarded only the harmless case (a stray `''` from a
 * trailing comma, which is inert as long as some real entry matches) and left
 * the harmful one to a sentence in a doc. Prose is not a control. Scheme and
 * host are case-insensitive per the URL spec and an origin never carries a
 * trailing slash, so lowercasing and stripping `/` is safe, not lossy.
 *
 * `onNormalise` reports entries we had to rewrite, so a malformed env var is
 * announced at boot instead of silently tolerated.
 *
 * Exported for tests.
 */
export function parseAuthorizedParties(
  raw: string | undefined,
  onNormalise?: (original: string, normalised: string) => void,
): string[] {
  if (!raw) return [];
  const out = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const normalised = entry.replace(/\/+$/, '').toLowerCase();
      if (normalised !== entry) onNormalise?.(entry, normalised);
      return normalised;
    })
    .filter(Boolean); // a bare "/" normalises to '' — drop it
  return [...new Set(out)];
}
