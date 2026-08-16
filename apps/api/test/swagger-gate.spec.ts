import { readFileSync } from 'fs';
import { join } from 'path';
import * as Joi from 'joi';
import { isSwaggerEnabled } from '../src/common/swagger-gate';

/**
 * Swagger must be OPT-IN, and must stay independent of NODE_ENV.
 *
 * ⚠️ The previous version of this file was theatre. Two of its three tests
 * asserted on lambdas defined inside the test itself — they could not fail —
 * and the third was a string search, which stayed green when the gate was
 * replaced with a literal `true` as long as the old strings remained anywhere
 * in the file. Worse, its model asserted `enabled(undefined, undefined) === false`
 * while the running system did the opposite.
 *
 * These call the REAL exported gate, and the last group reproduces the
 * mechanism that made the previous fix wrong.
 */

describe('isSwaggerEnabled — behaviour', () => {
  it('is false when the variable is absent', () => {
    expect(isSwaggerEnabled({})).toBe(false);
    expect(isSwaggerEnabled({ ENABLE_SWAGGER: undefined })).toBe(false);
  });

  it.each(['true', 'TRUE', ' True ', '1', 'yes', 'on'])(
    'accepts %p — operators do not all write "true"',
    (v) => expect(isSwaggerEnabled({ ENABLE_SWAGGER: v })).toBe(true),
  );

  it.each(['false', '0', 'no', '', 'maybe', 'truthy', 'enable'])(
    'rejects %p',
    (v) => expect(isSwaggerEnabled({ ENABLE_SWAGGER: v })).toBe(false),
  );

  it('IGNORES NODE_ENV entirely, in every state', () => {
    // The load-bearing property. Not "production is false" — ALL of them are
    // false, because the decision must not be derivable from NODE_ENV at all.
    for (const NODE_ENV of ['development', 'production', 'test', 'staging', '', undefined]) {
      expect(isSwaggerEnabled({ NODE_ENV })).toBe(false);
      expect(isSwaggerEnabled({ NODE_ENV, ENABLE_SWAGGER: 'true' })).toBe(true);
    }
  });
});

describe('the trap that defeated the previous fix', () => {
  it('Joi turns an UNSET NODE_ENV into "development" and writes it back', () => {
    // This is why a gate may not read NODE_ENV. `@nestjs/config` assigns the
    // validated object over process.env, and the gate runs after
    // NestFactory.create — so the host's "unset" is never what the gate sees.
    // Mirrors app.module.ts's schema for this key.
    const { value } = Joi.object({
      NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
    })
      .unknown()
      .validate({});
    expect(value.NODE_ENV).toBe('development');

    // The previous gate, given exactly that post-validation environment:
    const previousGate = (env: NodeJS.ProcessEnv) =>
      env.ENABLE_SWAGGER === 'true' || env.NODE_ENV === 'development';
    expect(previousGate(value)).toBe(true); // ← published docs on a bare host
    expect(isSwaggerEnabled(value)).toBe(false); // ← current gate does not
  });
});

describe('the gate is actually wired up', () => {
  // A behavioural test of the helper proves nothing if main.ts stopped calling
  // it — the "well-covered helper behind untested wiring" failure this project
  // keeps producing.
  const main = readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('main.ts mounts Swagger through the gate, and logs behind the same call', () => {
    expect(main).toContain("import { isSwaggerEnabled } from './common/swagger-gate'");
    // Both the mount and the startup log line — they were independently written
    // before, so the log advertised a URL the mount had already refused.
    expect((main.match(/if \(isSwaggerEnabled\(\)\)/g) || []).length).toBe(2);
  });

  it('nothing inside bootstrap() decides anything from NODE_ENV', () => {
    // Scoped to the bootstrap body on purpose. The two NODE_ENV reads above it
    // are Sentry's `environment` label and sample rate, which run at module
    // load — BEFORE ConfigModule — so they see the host's real value and are
    // reporting metadata, not an access decision. Everything after
    // `NestFactory.create` reads the Joi-defaulted value and must not branch
    // on it.
    const body = main.slice(main.indexOf('async function bootstrap'));
    expect(body).not.toMatch(/NODE_ENV/);
  });
});
