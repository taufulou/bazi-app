import Anthropic from '@anthropic-ai/sdk';
import type { ClientOptions } from '@anthropic-ai/sdk';
import { observeRateLimits } from './anthropic-rate-limit';

/**
 * Ob1 — the one place an Anthropic client is constructed.
 *
 * Seven `new Anthropic({...})` calls were spread across `chat`, `ai` and
 * `fortune`, each independently deciding what options to pass. Nothing about
 * that arrangement is wrong until you need a property to hold for EVERY client
 * — at which point it becomes seven places to remember and an eighth that will
 * be added without it.
 *
 * The property Ob1 needs is the rate-limit observer on `fetch`. It is the kind
 * of thing whose absence is invisible: a client without it still works
 * perfectly, and the only symptom is that one surface's traffic is missing from
 * a gauge nobody checks until the day it matters.
 *
 * ⚠️ Registered in `scripts/check-ai-spend-metering.mjs`'s
 * `CLIENT_FACTORY_EXEMPT`. This file constructs a client and deliberately never
 * calls the provider — the spend controls live with the callers. If a provider
 * call is ever added here, that guard's `TRIGGER_CLIENT_FACTORY` rule fails,
 * which is the intended outcome: the exemption's premise would no longer hold.
 */
export function createAnthropicClient(options: ClientOptions): Anthropic {
  const override = anthropicBaseUrlOverride();
  if (override) warnOnceAboutOverride(override);
  return new Anthropic({
    ...options,
    // An explicit option wins, so a test double passing its own baseURL is not
    // silently redirected by an env var left set on the machine.
    baseURL: options.baseURL ?? override ?? undefined,
    // Compose rather than replace: if a caller ever supplies its own transport
    // (a test double, a proxy), it stays in the chain and is still observed.
    fetch: observeRateLimits(options.fetch),
  });
}

/**
 * L1 — point every Anthropic client at something else.
 *
 * Phase 3 drives 100 concurrent users through production. Against the real API
 * that is several hundred dollars a run and measures Anthropic's concurrency
 * rather than ours, so the load test needs the client redirected at a mock.
 * Nothing in the app supported that: all seven construction sites passed an
 * `apiKey` and nothing else.
 *
 * This being the only place a client is built (Ob1) is what makes it one line
 * rather than seven — and, more usefully, means there is exactly one place a
 * reader has to check to answer "is this instance talking to the real API?".
 *
 * ⚠️ THE DANGEROUS FAILURE IS FORGETTING TO UNSET IT. A stale value points
 * production at a mock service that has been torn down, and every reading fails
 * in a way that looks like an Anthropic outage. So it is loud in three places:
 * a boot-time warning, this docblock, and `GET /api/admin/ops`, which reports
 * it under `aiBaseUrlOverride` precisely so the question can be answered
 * without shell access during an incident.
 *
 * Read at CALL time, not module scope: `ConfigModule` loads `.env` after this
 * module is imported, so a module-scope read would skip the override in local
 * development while working in production — the same trap `PrismaService` hit.
 */
export function anthropicBaseUrlOverride(): string | null {
  const raw = (process.env.ANTHROPIC_BASE_URL ?? '').trim();
  return raw === '' ? null : raw;
}

let warned = false;
function warnOnceAboutOverride(url: string): void {
  if (warned) return;
  warned = true;
  // Not the app Logger: this can fire before Nest's logger is configured, and
  // the one thing it must not do is be silent.
  console.warn(
    `[anthropic-client] ⚠️  ANTHROPIC_BASE_URL is set — every Anthropic call ` +
      `goes to ${url}, NOT the real API. This is the load-test switch (L1). ` +
      `If you are not running a load test, UNSET IT: readings will fail or be ` +
      `fabricated. Visible at GET /api/admin/ops as aiBaseUrlOverride.`,
  );
}

/** Tests only — the warn-once latch is module state. */
export function resetBaseUrlWarning(): void {
  warned = false;
}
