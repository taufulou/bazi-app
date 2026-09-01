/**
 * Is anyone actually going to SEE the spend alerts?
 *
 * ## The problem this makes visible
 *
 * `AiSpendService` fires three Sentry events, and every one of them is a
 * `captureMessage`. `Sentry.init()` in `main.ts` runs only `if
 * (process.env.SENTRY_DSN)`, so with no DSN each of those calls is a silent
 * no-op — no throw, no log, no hint at boot. The early-warning system is fully
 * built and can be fully disconnected, and nothing anywhere says so.
 *
 * That is the worst shape a control can have: it looks present in the code,
 * reads as covered in an audit, and is inert in production.
 *
 * ## What is at stake, per event
 *
 * | event | level | meaning if unseen |
 * |---|---|---|
 * | `ai.spend.threshold_80` | warning | the day's budget is 80% gone and nobody is told; the first signal becomes a hard refusal at 100%. |
 * | `ai.spend.cap_tripped` | error | the breaker is REFUSING paying customers. Fails closed, so it is safe — but silent. |
 * | `ai.spend.breaker_unavailable` | error | **fails OPEN.** Redis is unreadable, the code ALLOWS the call, and the only ceiling left is the Anthropic account limit. Spend is uncapped and nobody knows. |
 *
 * ⚠️ The third is the one that matters most and is the one usually left off the
 * list. The other two mean a control fired; this one means there is no control.
 */

export const SENTRY_DSN_ENV = 'SENTRY_DSN';

/** Every event name an alert rule has to cover. Exported so tests and the ops view agree. */
export const SPEND_ALERT_EVENTS = [
  'ai.spend.threshold_80',
  'ai.spend.cap_tripped',
  'ai.spend.breaker_unavailable',
] as const;

export interface AlertingStatus {
  /** True when `Sentry.init()` will have run — i.e. captureMessage is not a no-op. */
  sentryConfigured: boolean;
  /**
   * Host only, never the DSN. A DSN embeds a public key; it is not a secret in
   * the way a token is, but it does not belong in an admin JSON body either,
   * and the host is what actually answers "which project am I paging".
   */
  sentryHost: string | null;
  /** The event names an alert rule must exist for. */
  spendAlertEvents: readonly string[];
  /** Populated when something would stop an alert reaching a human. */
  warnings: string[];
}

function hostFromDsn(dsn: string): string | null {
  try {
    return new URL(dsn).host || null;
  } catch {
    return null;
  }
}

export function resolveAlertingStatus(env: NodeJS.ProcessEnv = process.env): AlertingStatus {
  const dsn = env[SENTRY_DSN_ENV]?.trim();
  const configured = Boolean(dsn);
  const host = dsn ? hostFromDsn(dsn) : null;
  const warnings: string[] = [];

  if (!configured) {
    warnings.push(
      `${SENTRY_DSN_ENV} is not set — Sentry.init() never runs, so all ${SPEND_ALERT_EVENTS.length} ` +
        `spend alerts (${SPEND_ALERT_EVENTS.join(', ')}) are silent no-ops. ` +
        'ai.spend.breaker_unavailable fails OPEN, so an unnoticed Redis outage means UNCAPPED spend.',
    );
  } else if (!host) {
    // A malformed DSN is worse than none: init() is attempted, so the "is it
    // configured" question answers yes while nothing is deliverable.
    warnings.push(
      `${SENTRY_DSN_ENV} is set but is not a parseable URL — Sentry will not deliver. ` +
        'Spend alerts are silent.',
    );
  }

  return { sentryConfigured: configured, sentryHost: host, spendAlertEvents: SPEND_ALERT_EVENTS, warnings };
}

/**
 * Boot-time report. Mirrors `reportWebOrigins`: say the safe thing loudly, and
 * confirm the good case POSITIVELY — "no warning" is not an answer to "are my
 * alerts wired", because it is also what a missing check looks like.
 */
export function reportAlertingStatus(
  status: AlertingStatus,
  log: (msg: string) => void,
  warn: (msg: string) => void,
): void {
  for (const w of status.warnings) warn(w);
  if (status.sentryConfigured && status.warnings.length === 0) {
    log(
      `Spend alerts armed → Sentry (${status.sentryHost}). ` +
        `An alert RULE must still exist for: ${SPEND_ALERT_EVENTS.join(', ')}.`,
    );
  }
}
