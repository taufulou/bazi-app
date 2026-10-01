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

/**
 * #24 — the STREAMING path, which is what every reading and chat turn uses.
 *
 * Everything above drives `messages.create`. `messages.stream()` goes through
 * the same SDK transport (`fetchWithTimeout` → `this.fetch`, SDK 0.73.0
 * `client.js`), but that was only ever true by reading the SDK. This proves it
 * by running a real streamed call through the factory: the rate-limit headers
 * arrive with the response that STARTS the stream, before any body is read.
 */
const SSE_BODY = [
  ['message_start', { type: 'message_start', message: {
    id: 'msg_s', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [],
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 1 },
  } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }],
  ['message_stop', { type: 'message_stop' }],
]
  .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  .join('');

it('observes rate-limit headers on a STREAMED call through the SDK (#24)', async () => {
  const client = createAnthropicClient({
    apiKey: 'test-key',
    fetch: async () =>
      new Response(SSE_BODY, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'anthropic-ratelimit-output-tokens-remaining': '7777',
          'anthropic-ratelimit-output-tokens-reset': '2026-10-01T05:00:00Z',
        },
      }),
  });

  const final = await client.messages
    .stream({ model: 'claude-sonnet-4-5', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] })
    .finalMessage();

  // the stream really completed (so this is not a header-only short-circuit)…
  expect(final.content).toEqual([expect.objectContaining({ type: 'text', text: 'ok' })]);
  // …and the gauge moved, and the response was counted.
  expect(getRateLimitSnapshot()).toMatchObject({
    outputTokensRemaining: 7777,
    outputTokensReset: '2026-10-01T05:00:00Z',
    observedStatus: 200,
    requestsStarted: 1,
    transportErrors: 0,
    responsesSeen: 1,
    okWithoutHeaders: 0,
  });
});
