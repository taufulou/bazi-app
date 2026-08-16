import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Swagger must be OPT-IN.
 *
 * The gate was `NODE_ENV !== 'production'`, which fails OPEN — an unset
 * NODE_ENV publishes the entire API surface. It was held shut by one `ENV`
 * line in `docker/Dockerfile.api`, and no `railway.json` in the repo pins that
 * Dockerfile as the builder, so a host that does not set NODE_ENV would have
 * exposed it silently.
 *
 * It also gates the API's one accepted advisory: `@nestjs/swagger` pins
 * `js-yaml` at exactly 5.2.1 and npm cannot override a package nested inside a
 * workspace. Harmless because the only call is `jsyaml.dump` and because this
 * block never runs in production — the second half of which is this gate.
 */
const raw = readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8');
/** Comments quote the OLD gate on purpose; assert against code only. */
const main = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('Swagger exposure gate', () => {
  it('is opt-in, never a negation of production', () => {
    expect(main).toContain("process.env.ENABLE_SWAGGER === 'true'");
    expect(main).toContain("process.env.NODE_ENV === 'development'");
    // The fail-open shape must not come back.
    expect(main).not.toMatch(/NODE_ENV\s*!==\s*['"]production['"]/);
  });

  it('models the decision the way the runtime evaluates it', () => {
    // Behavioural mirror of the gate, exercised over the env states a host can
    // actually produce. `undefined` is the one that mattered.
    const enabled = (nodeEnv?: string, flag?: string) =>
      flag === 'true' || nodeEnv === 'development';

    expect(enabled(undefined, undefined)).toBe(false); // unset NODE_ENV — was TRUE before
    expect(enabled('production', undefined)).toBe(false);
    expect(enabled('', undefined)).toBe(false);
    expect(enabled('staging', undefined)).toBe(false);
    expect(enabled('test', undefined)).toBe(false);
    expect(enabled('development', undefined)).toBe(true);
    expect(enabled('production', 'true')).toBe(true); // deliberate opt-in still works
  });

  it('the old gate would have exposed docs on an unset NODE_ENV', () => {
    // Kept as the counter-example, so the reason survives the fix.
    const oldGate = (nodeEnv?: string) => nodeEnv !== 'production';
    expect(oldGate(undefined)).toBe(true);
  });
});
