import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from './app/lib/sentry-scrub';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    // C2 — currently DEAD CODE: Next 15/16 loads these only via
    // `instrumentation.ts`, which this app does not have. Configured anyway,
    // because the day someone adds that file (the Sentry wizard writes it) this
    // SDK activates against routes that proxy raw birth-data bodies to the
    // engine — and it would activate unscrubbed.
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
    beforeSendTransaction: scrubSentryEvent,
  });
}
