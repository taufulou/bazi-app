import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ENGINE_CALLER_HEADER,
  ENGINE_KEY_HEADER,
  ENGINE_REQUEST_ID_HEADER,
  resolveEngineKey,
} from '../src/common/engine-client';
// Reaching across app boundaries is normally wrong. It is right here for the
// same reason `sentry-scrub-parity.spec.ts` does it: the duplication is
// deliberate and unavoidable, so something has to compare the two copies.
import { resolveEngineKey as resolveWebEngineKey } from '../../web/app/lib/engine-client';

/**
 * B3-a — the engine client exists TWICE, for the same reason the Sentry
 * scrubber does: `apps/web` cannot import from `apps/api`, and `@repo/shared` is
 * off-limits to the NestJS runtime. This is the sibling of
 * `sentry-scrub-parity.spec.ts` and exists for the same failure: a duplicate
 * that drifts is worse than no duplicate, because the second copy looks tested.
 *
 * The web copy has no jest project of its own, so this spec reaches across and
 * checks the properties that must not diverge. Behaviour is verified by
 * importing the API copy and by reading the web copy's source — crude, but it is
 * the difference between the web door being checked and not being checked at
 * all. The alternative (deleting `apps/web/app/lib/engine-client.ts` and its
 * header names silently going unkeyed) passed every test in the repo.
 */

const WEB_HELPER = join(__dirname, '..', '..', 'web', 'app', 'lib', 'engine-client.ts');
const webSource = readFileSync(WEB_HELPER, 'utf8');

describe('B3-a engine-client parity (api ↔ web)', () => {
  it('the web helper exists where the CI guard allowlists it', () => {
    expect(webSource.length).toBeGreaterThan(0);
  });

  it('both use the same header names', () => {
    // Diverge here and the engine records the web route as `absent<-unknown`
    // forever, and 401s it the moment enforcement is switched on.
    expect(webSource).toContain(`'${ENGINE_KEY_HEADER}'`);
    expect(webSource).toContain(`'${ENGINE_CALLER_HEADER}'`);
    expect(webSource).toContain(`'${ENGINE_REQUEST_ID_HEADER}'`);
  });

  it('the web helper actually attaches the key', () => {
    // Deleting this one line was green across the whole repo before this spec:
    // the free chart preview would have gone unkeyed with nothing to notice it.
    expect(webSource).toMatch(/ENGINE_KEY_HEADER\]:\s*key/);
  });

  it('both resolve the key the same way', () => {
    const cases: NodeJS.ProcessEnv[] = [
      { ENGINE_KEY: 'alpha' },
      { ENGINE_KEYS: 'beta,gamma' },
      { ENGINE_KEY: 'alpha', ENGINE_KEYS: 'beta' },
      { ENGINE_KEY: '   ' },
      {},
    ];
    for (const env of cases) {
      expect(resolveWebEngineKey(env)).toBe(resolveEngineKey(env));
    }
  });

  it('the web helper warns when the key is missing', () => {
    // Same reasoning as the API side: without it, an unkeyed web route is
    // silent. Web is the surface reachable WITHOUT signing in, so it is the one
    // where a silent failure is least likely to be noticed by a developer.
    expect(webSource).toMatch(/warnedMissingKey/);
    expect(webSource).toMatch(/console\.warn/);
  });

  it('the web key is not exposed to the browser bundle', () => {
    expect(webSource).not.toContain('NEXT_PUBLIC_ENGINE_KEY');
  });
});
