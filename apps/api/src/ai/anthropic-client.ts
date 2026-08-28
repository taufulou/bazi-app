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
  return new Anthropic({
    ...options,
    // Compose rather than replace: if a caller ever supplies its own transport
    // (a test double, a proxy), it stays in the chain and is still observed.
    fetch: observeRateLimits(options.fetch),
  });
}
