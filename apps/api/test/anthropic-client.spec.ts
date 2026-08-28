import { createAnthropicClient } from '../src/ai/anthropic-client';
import {
  getRateLimitSnapshot,
  resetRateLimitSnapshot,
} from '../src/ai/anthropic-rate-limit';

/**
 * Ob1 — the factory must actually INSTALL the observer.
 *
 * `anthropic-rate-limit.spec.ts` proves the observer works and
 * `ai-call-log.spec.ts` proves no client is constructed outside this factory.
 * Neither notices if the factory stops passing `fetch` — a mutation that
 * removed that one line left both suites green while every client in the
 * application went blind. Same shape as the five earlier escapes in this repo:
 * a well-covered helper behind untested wiring.
 *
 * So this drives a REAL `Anthropic` client through a stub transport and asserts
 * the gauge moved, which also proves the SDK honours the `fetch` option at all
 * — a fact currently taken on trust from a type definition.
 */

const MESSAGE_BODY = JSON.stringify({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-5',
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
});

const RL_HEADERS = {
  'content-type': 'application/json',
  'anthropic-ratelimit-output-tokens-remaining': '4242',
  'anthropic-ratelimit-output-tokens-reset': '2026-08-28T05:00:00Z',
};

beforeEach(() => resetRateLimitSnapshot());

it('observes rate-limit headers on a real call through the SDK', async () => {
  const client = createAnthropicClient({
    apiKey: 'test-key',
    fetch: async () => new Response(MESSAGE_BODY, { status: 200, headers: RL_HEADERS }),
  });

  await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 16,
    messages: [{ role: 'user', content: 'hi' }],
  });

  expect(getRateLimitSnapshot()).toMatchObject({
    outputTokensRemaining: 4242,
    outputTokensReset: '2026-08-28T05:00:00Z',
    observedStatus: 200,
  });
});

it('still calls the transport the caller supplied', async () => {
  // Composition, not replacement: a test double or proxy passed by a caller
  // must stay in the chain rather than being silently dropped.
  const inner = jest.fn(
    async () => new Response(MESSAGE_BODY, { status: 200, headers: RL_HEADERS }),
  );
  const client = createAnthropicClient({ apiKey: 'test-key', fetch: inner });

  await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 16,
    messages: [{ role: 'user', content: 'hi' }],
  });

  expect(inner).toHaveBeenCalledTimes(1);
});

it('observes a 429 — the response no usage-time hook would ever see', async () => {
  const client = createAnthropicClient({
    apiKey: 'test-key',
    maxRetries: 0, // or the SDK retries and the assertion races
    fetch: async () =>
      new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }), {
        status: 429,
        headers: { ...RL_HEADERS, 'anthropic-ratelimit-output-tokens-remaining': '0' },
      }),
  });

  await expect(
    client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  ).rejects.toThrow();

  expect(getRateLimitSnapshot()).toMatchObject({
    outputTokensRemaining: 0,
    observedStatus: 429,
  });
});
