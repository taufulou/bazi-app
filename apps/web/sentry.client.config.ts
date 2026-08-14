import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from './app/lib/sentry-scrub';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    // C2 — this init had NO PII settings, and it is the one that runs on the
    // pages where birth data is typed. The first pass configured the API only.
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
    beforeSendTransaction: scrubSentryEvent,
    // ⚠️ Session Replay is OFF and must stay off until the birth-data forms are
    // masked. These two values were already here and are currently INERT —
    // `replayIntegration` is not in the default integration set, so nothing
    // records today. That makes the config misleading rather than dangerous,
    // which is worse in one specific way: replay envelopes DO NOT pass through
    // `beforeSend`, so the scrubber above would not protect a recording. Adding
    // the integration would capture the form DOM keystroke by keystroke.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}
