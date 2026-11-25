/**
 * The one place Sentry is configured (1C item 7). Pure, so a test can assert
 * every privacy-relevant field — the init used to be a bare
 * `{ dsn, tracesSampleRate }`, the only one of four surfaces with no PII settings.
 */
import { scrubBreadcrumb, scrubSentryEvent } from './sentry-scrub';

export function sentryInitOptions(dsn: string) {
  return {
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    // A screenshot or the view hierarchy of a chart screen IS the chart.
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeSend: <T>(event: T): T => scrubSentryEvent(event),
    beforeSendTransaction: <T>(event: T): T => scrubSentryEvent(event),
    beforeBreadcrumb: <T>(breadcrumb: T): T => scrubBreadcrumb(breadcrumb),
  };
}
