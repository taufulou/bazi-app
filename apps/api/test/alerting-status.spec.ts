import {
  resolveAlertingStatus,
  reportAlertingStatus,
  SPEND_ALERT_EVENTS,
  SENTRY_DSN_ENV,
} from '../src/common/alerting-status';

/**
 * #13 — "the alerts are built" and "the alerts reach someone" are different
 * claims, and only the first was ever true.
 *
 * `AiSpendService` fires three `Sentry.captureMessage` events. `Sentry.init()`
 * runs only `if (process.env.SENTRY_DSN)`, so with no DSN every one of them is
 * a silent no-op — no throw, no log, nothing at boot. A control that reads as
 * present in the code and is inert in production is the worst shape there is,
 * because an audit passes it.
 */
describe('alerting status', () => {
  const DSN = 'https://abc123@o12345.ingest.sentry.io/456';

  it('reports NOT configured when the DSN is absent', () => {
    const s = resolveAlertingStatus({});
    expect(s.sentryConfigured).toBe(false);
    expect(s.warnings).toHaveLength(1);
  });

  it('names every silenced event, so the warning is actionable', () => {
    const [w] = resolveAlertingStatus({}).warnings;
    for (const e of SPEND_ALERT_EVENTS) expect(w).toContain(e);
  });

  it('calls out that the breaker fails OPEN — the reason this matters most', () => {
    // `cap_tripped` and `threshold_80` mean a control FIRED. `breaker_unavailable`
    // means there is no control: Redis is unreadable, the call is ALLOWED, and
    // spend is bounded only by the Anthropic account limit. An operator reading
    // the warning has to learn that from the warning.
    const [w] = resolveAlertingStatus({}).warnings;
    expect(w).toContain('breaker_unavailable');
    expect(w.toUpperCase()).toContain('UNCAPPED');
  });

  it('treats a MALFORMED dsn as worse than a missing one', () => {
    // `Sentry.init()` is attempted, so "is it configured" answers yes while
    // nothing is deliverable — the failure hides behind a truthy check.
    const s = resolveAlertingStatus({ [SENTRY_DSN_ENV]: 'not-a-url' });
    expect(s.sentryConfigured).toBe(true);
    expect(s.sentryHost).toBeNull();
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toContain('not a parseable URL');
  });

  it('reports configured, with the HOST and never the DSN', () => {
    const s = resolveAlertingStatus({ [SENTRY_DSN_ENV]: DSN });
    expect(s.sentryConfigured).toBe(true);
    expect(s.sentryHost).toBe('o12345.ingest.sentry.io');
    expect(s.warnings).toEqual([]);
    // The DSN embeds a key; the host answers "which project pages me".
    expect(JSON.stringify(s)).not.toContain('abc123');
  });

  it('ignores a whitespace-only DSN', () => {
    expect(resolveAlertingStatus({ [SENTRY_DSN_ENV]: '   ' }).sentryConfigured).toBe(false);
  });

  describe('boot report', () => {
    const run = (env: NodeJS.ProcessEnv) => {
      const log: string[] = [], warn: string[] = [];
      reportAlertingStatus(resolveAlertingStatus(env), (m) => log.push(m), (m) => warn.push(m));
      return { log, warn };
    };

    it('warns when alerts are silent', () => {
      const { log, warn } = run({});
      expect(warn).toHaveLength(1);
      expect(log).toEqual([]);
    });

    it('confirms the good case POSITIVELY', () => {
      // "No warning" is also what a missing check looks like. Verifying that
      // alerts are wired needs a line that says so.
      const { log, warn } = run({ [SENTRY_DSN_ENV]: DSN });
      expect(warn).toEqual([]);
      expect(log).toHaveLength(1);
      expect(log[0]).toContain('armed');
    });

    it('still tells the operator a RULE is required — the half it cannot check', () => {
      // A DSN only means events are deliverable. Nothing here can see whether
      // Sentry has an alert rule on these names, and the log must not imply it.
      const { log } = run({ [SENTRY_DSN_ENV]: DSN });
      expect(log[0]).toMatch(/RULE must still exist/i);
      for (const e of SPEND_ALERT_EVENTS) expect(log[0]).toContain(e);
    });
  });

  it('the event list matches what AiSpendService actually emits', async () => {
    // The alert rule is written from SPEND_ALERT_EVENTS. If the service renames
    // an event or adds a fourth, the rule silently stops covering it — so the
    // list is checked against the source rather than trusted.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '..', 'src/ai/ai-spend.service.ts'), 'utf8');
    const emitted = [...src.matchAll(/captureMessage\(\s*'([^']+)'/g)].map((m) => m[1]!);
    expect(emitted.length).toBeGreaterThan(0);
    expect([...new Set(emitted)].sort()).toEqual([...SPEND_ALERT_EVENTS].sort());
  });
});
