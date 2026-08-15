import { parseAuthorizedParties as apiParse } from '../src/auth/clerk.guard';
// Same cross-app reach as `sentry-scrub-parity.spec.ts`, for the same reason:
// the duplication is forced, so something has to compare the two copies.
import { parseAuthorizedParties as webParse } from '../../web/app/lib/authorized-parties';

/**
 * B5 — the azp allowlist parser exists twice (API guard + web middleware).
 *
 * The web copy was four chained calls inline in `middleware.ts` with no test
 * anywhere in `apps/web`, and it had dropped dedupe and the `onNormalise`
 * callback. Two mutations were green against the whole repo: removing
 * `.toLowerCase()`/trailing-slash strip (after which `https://App.Example.com/`
 * 401s every web page load while the API accepts the same token), and replacing
 * the options object with `{}` (silently reverting B5's second half).
 *
 * Parity is asserted on BEHAVIOUR over a shared case table, not by reading.
 */

const CASES: Array<[string, string | undefined]> = [
  ['unset', undefined],
  ['empty', ''],
  ['single', 'https://app.example.com'],
  ['trailing slash', 'https://app.example.com/'],
  ['multiple trailing slashes', 'https://app.example.com///'],
  ['uppercase host', 'https://App.Example.COM'],
  ['both defects at once', 'https://App.Example.com/'],
  ['whitespace padding', '  https://app.example.com  '],
  ['two entries', 'https://a.example.com,https://b.example.com'],
  ['trailing comma', 'https://a.example.com,'],
  ['duplicate entries', 'https://a.example.com,https://a.example.com'],
  ['duplicate after normalising', 'https://A.example.com/,https://a.example.com'],
  ['bare slash only', '/'],
  ['only commas', ',,,'],
];

describe('B5 azp parser parity (api ↔ web)', () => {
  it.each(CASES)('agrees on %s', (_label, raw) => {
    expect(webParse(raw)).toEqual(apiParse(raw));
  });

  it.each(CASES)('reports the same normalisations for %s', (_label, raw) => {
    const apiSeen: string[] = [];
    const webSeen: string[] = [];
    apiParse(raw, (o, n) => apiSeen.push(`${o}->${n}`));
    webParse(raw, (o, n) => webSeen.push(`${o}->${n}`));
    expect(webSeen).toEqual(apiSeen);
  });

  it('both dedupe, so a repeated entry cannot inflate the list', () => {
    expect(webParse('https://a.example.com,https://a.example.com')).toEqual([
      'https://a.example.com',
    ]);
  });

  it('both report the typo that would 401 every session', () => {
    // The load-bearing case. Normalising silently hides it; reporting is what
    // makes the misconfiguration announce itself instead of looking like an
    // outage of unknown cause.
    const seen: string[] = [];
    webParse('https://App.Example.com/', (o, n) => seen.push(`${o}->${n}`));
    expect(seen).toEqual(['https://App.Example.com/->https://app.example.com']);
  });

  it('an empty allowlist stays empty — it must be a no-op, never a lockout', () => {
    expect(webParse(undefined)).toEqual([]);
    expect(webParse('')).toEqual([]);
    expect(webParse(',,,')).toEqual([]);
  });
});
