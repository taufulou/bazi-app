import * as fs from 'fs';
import * as path from 'path';
import { READING_TYPE_MAP, STREAMABLE_READING_SLUGS } from '../app/lib/readings-api';

/**
 * `STREAMABLE_READING_SLUGS` (web) is a hand-copied twin of
 * `STREAMABLE_READING_TYPES` (API, `create-reading.dto.ts`), and it has to be:
 * the web cannot import from the API package. What is NOT acceptable is silent
 * drift — the repo's convention for a mirrored cross-workspace constant is a
 * test, not a comment (see `apps/api/test/sentry-scrub-parity.spec.ts`).
 *
 * The drift failure here is loud (a stale slug list omits `stream: true` and
 * every create of that type is refused with STREAM_REQUIRED), but loud in
 * production is still the wrong place to find out.
 *
 * Why this lives on the WEB side and reads the API file as TEXT, unlike the
 * Sentry precedent (API side, `require`s the web module): `readings-api.ts`
 * pulls in `./api`, `./auth-redirect` and `@repo/shared`, and whether their
 * import-time code is clean under the API runner was never established; the
 * DTO in turn needs a generated Prisma client, which the web test job does not
 * produce. Parsing the source is the approach the engine already uses for the
 * same problem (`tests/test_observability.py` parses `sentry-scrub.ts`), and
 * the extractor fails loudly if the file changes shape.
 */
describe('STREAMABLE_READING_SLUGS (web) ↔ STREAMABLE_READING_TYPES (api)', () => {
  const dtoPath = path.resolve(__dirname, '../../api/src/bazi/dto/create-reading.dto.ts');
  const dto = fs.readFileSync(dtoPath, 'utf8');

  function apiStreamableTypes(): string[] {
    const block = dto.match(/export const STREAMABLE_READING_TYPES = \[([\s\S]*?)\] as const/);
    if (!block) {
      throw new Error(
        `create-reading.dto.ts changed shape — update this extractor, do not delete the test (${dtoPath})`,
      );
    }
    // Strip comments first: a `// ReadingType.LOVE,` (streamer disabled by
    // commenting it out) must count as REMOVED, or this test stays green in
    // exactly the silent-drift direction it exists to catch.
    const body = (block[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    return [...body.matchAll(/ReadingType\.([A-Z_]+)/g)]
      .map((m) => m[1])
      .filter((t): t is string => typeof t === 'string')
      .sort();
  }

  it('the extractor actually finds the API list (a silent empty match would pass anything)', () => {
    expect(apiStreamableTypes().length).toBeGreaterThan(0);
  });

  it('every web slug maps to a real enum value — a typo would otherwise compare `undefined`', () => {
    for (const slug of STREAMABLE_READING_SLUGS) {
      expect(READING_TYPE_MAP[slug]).toEqual(expect.any(String));
    }
  });

  it('the two lists are the SAME set, in both directions', () => {
    // Set equality: a type added to the API and not the web fails here, and so
    // does a slug added to the web with no API streamer behind it.
    const webTypes = STREAMABLE_READING_SLUGS.map((s) => READING_TYPE_MAP[s]).sort();
    expect(webTypes).toEqual(apiStreamableTypes());
  });
});
