/**
 * The Sentry scrubber exists twice — `apps/api/src/common/sentry-scrub.ts` and
 * `apps/web/app/lib/sentry-scrub.ts` — and it has to.
 *
 * `apps/web` cannot import from `apps/api`, and the shared package is off-limits
 * to the NestJS runtime (the `@repo/shared` note in CLAUDE.md: NestJS files must
 * not import it at runtime). So there is no single home both can use, and the
 * duplication is deliberate.
 *
 * What is NOT acceptable is silent drift. A key added to one copy while the
 * other keeps shipping that field is exactly the failure this pair invites: the
 * API was configured first and the web client — the SDK that runs on the pages
 * where birth data is TYPED — was left with no PII settings at all.
 *
 * This test fails the moment the two key lists diverge.
 */
import * as api from '../src/common/sentry-scrub';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const web = require('../../web/app/lib/sentry-scrub') as {
  PII_KEY_LIST: string[];
  PII_SUBTREE_KEY_LIST: string[];
  REDACTED: string;
  scrubSentryEvent: <T>(e: T) => T;
  redactFreeText: (s: string) => string;
};

/** The API copy keeps its sets private; re-derive by probing. */
function apiRedacts(key: string): boolean {
  const out = api.scrubSentryEvent({ extra: { [key]: 'PROBE_VALUE' } }) as {
    extra?: Record<string, unknown>;
  };
  return out.extra?.[key] === api.REDACTED;
}

function webRedacts(key: string): boolean {
  const out = web.scrubSentryEvent({ extra: { [key]: 'PROBE_VALUE' } }) as {
    extra?: Record<string, unknown>;
  };
  return out.extra?.[key] === web.REDACTED;
}

describe('Sentry scrubber parity (api ↔ web)', () => {
  const allKeys = [...new Set([...web.PII_KEY_LIST, ...web.PII_SUBTREE_KEY_LIST])];

  it('uses the same redaction marker', () => {
    expect(web.REDACTED).toBe(api.REDACTED);
  });

  it.each(allKeys)('both copies redact "%s"', (key) => {
    expect(apiRedacts(key)).toBe(true);
    expect(webRedacts(key)).toBe(true);
  });

  it('neither copy redacts a benign key', () => {
    // Guards against the parity test passing because one side redacts
    // everything.
    expect(apiRedacts('readingId')).toBe(false);
    expect(webRedacts('readingId')).toBe(false);
  });

  it('free-text redaction agrees on the shapes that matter', () => {
    const sample = 'born 1987-09-06 at 16:11, 丁卯 year, a@b.com, eyJhbGciOiJIUzI1NiJ9.a.b';
    expect(web.redactFreeText(sample)).toBe(api.redactFreeText(sample));
  });

  it('agrees on the whole realistic event', () => {
    const event = {
      message: 'Engine failed for 丁卯',
      request: { data: { birthDate: '1987-09-06' }, headers: { authorization: 'Bearer x' } },
      user: { id: 'u1', email: 'a@b.com' },
      extra: { ganZhi: { year: '丁卯' }, content: '我先生會外遇嗎', readingId: 'r1' },
    };

    expect(JSON.stringify(web.scrubSentryEvent(event))).toBe(
      JSON.stringify(api.scrubSentryEvent(event)),
    );
  });
});
