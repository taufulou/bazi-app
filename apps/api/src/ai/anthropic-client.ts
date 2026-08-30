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
  const client = buildClient(options, override);
  // Record where this client ACTUALLY resolved to — see `effectiveAnthropicBaseUrl`.
  lastEffectiveBaseUrl = client.baseURL;
  return client;
}

function buildClient(options: ClientOptions, override: string | null): Anthropic {
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

let lastEffectiveBaseUrl: string | null = null;

/**
 * Where AI traffic is ACTUALLY going, as resolved by the most recently built
 * client. `null` until one is constructed (they are lazy).
 *
 * ⚠️ This exists because `anthropicBaseUrlOverride()` alone cannot answer the
 * question, and discovering that was the whole point of running the thing.
 *
 * **The Anthropic SDK reads `ANTHROPIC_BASE_URL` from the environment itself.**
 * So after this switch was renamed to `LOADTEST_ANTHROPIC_BASE_URL` — which was
 * right, because the generic name is one other tooling sets — the generic
 * variable STILL redirects every call, just through the SDK instead of through
 * us. That is strictly more dangerous than before: traffic goes somewhere else
 * while our own field reports `null`, i.e. the ops view would answer "not
 * overridden" during precisely the incident it was built for.
 *
 * Reporting the resolved `client.baseURL` is the only answer that cannot lie,
 * because it is the value the SDK will actually use whatever set it.
 */
export function effectiveAnthropicBaseUrl(): string | null {
  return lastEffectiveBaseUrl;
}

/** Tests only. */
export function resetEffectiveBaseUrl(): void {
  lastEffectiveBaseUrl = null;
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
 * ⚠️ NOT named `ANTHROPIC_BASE_URL`. That is a CONVENTIONAL name other tooling
 * sets for its own reasons — Claude Code exports it as `https://api.anthropic.com`
 * — and the first local boot after this shipped produced a false alarm because
 * of exactly that. A variable that redirects where the app sends its API key
 * must not share a name the ecosystem treats as generic: the failure mode is a
 * silent redirect of production AI traffic by a variable the app does not own.
 * The `LOADTEST_` prefix makes both the purpose and the ownership unmistakable.
 *
 * Read at CALL time, not module scope: `ConfigModule` loads `.env` after this
 * module is imported, so a module-scope read would skip the override in local
 * development while working in production — the same trap `PrismaService` hit.
 */
export const LOADTEST_BASE_URL_ENV = 'LOADTEST_ANTHROPIC_BASE_URL';

export function anthropicBaseUrlOverride(): string | null {
  const raw = (process.env[LOADTEST_BASE_URL_ENV] ?? '').trim();
  return raw === '' ? null : raw;
}

let warned = false;
function warnOnceAboutOverride(url: string): void {
  if (warned) return;
  warned = true;
  // Not the app Logger: this can fire before Nest's logger is configured, and
  // the one thing it must not do is be silent.
  console.warn(
    `[anthropic-client] ⚠️  ${LOADTEST_BASE_URL_ENV} is set — every Anthropic ` +
      `call goes to ${url} instead of the SDK default. This is the load-test ` +
      `switch (L1). If you are not running a load test, UNSET IT: readings will ` +
      `fail or be fabricated. Visible at GET /api/admin/ops as aiBaseUrlOverride.`,
  );
}

/** Tests only — the warn-once latch is module state. */
export function resetBaseUrlWarning(): void {
  warned = false;
}
