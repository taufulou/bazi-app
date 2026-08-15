/**
 * B5 — the web half of the Clerk `azp` allowlist.
 *
 * A deliberate duplicate of `parseAuthorizedParties` in
 * `apps/api/src/auth/clerk.guard.ts`, for the same reason the Sentry scrubber is
 * duplicated: `apps/web` cannot import from `apps/api`, and `@repo/shared` is
 * off-limits to the NestJS runtime. `sentry-scrub-parity.spec.ts` is the
 * precedent; `authorized-parties-parity.spec.ts` is this pair's.
 *
 * It exists as a module rather than four chained calls inline in `middleware.ts`
 * because the inline version had no test anywhere in `apps/web` and dropped the
 * two things that make the API's version safe:
 *
 * 1. **Dedupe**, so a repeated entry does not silently inflate the list.
 * 2. **`onNormalise`**, which is load-bearing. Clerk matches `azp` EXACTLY and
 *    case-sensitively, so an operator who types `https://App.Example.com/`
 *    produces an entry matching nothing — and because a non-empty allowlist IS
 *    enforced, the result is every web page load 401ing with no clue why.
 *    Normalising silently hides the typo; reporting it makes the misconfiguration
 *    announce itself.
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
