import { AIProvider } from '@prisma/client';
import { AIService } from '../src/ai/ai.service';

/**
 * #6 — the 5-minute prompt cache on the streaming reading path.
 *
 * `streamClaude` is the ONLY adapter that carries a cache marker. Every V2
 * reading's system prompt is byte-identical across its calls and across
 * readings, so marking it lets Call 2 (and the next reading inside five
 * minutes) read ~15.7k tokens at 0.1x instead of paying full price.
 *
 * The trap these tests exist for is the TTL. A 1-hour write costs 2x input,
 * against 1.25x for 5 minutes, so on a one-shot reading `ttl: '1h'` makes an
 * isolated reading MORE expensive than not caching at all. Chat legitimately
 * uses 1h (its turns repeat), which makes the 1h shape the one a future edit
 * is most likely to copy in.
 */

type StreamArgs = {
  system: unknown;
  messages: unknown;
  model: string;
  max_tokens: number;
};

function makeService(env: Record<string, string | undefined> = {}) {
  const config = { get: jest.fn((k: string) => env[k]) };
  const svc = new AIService(
    config as never,
    { aIUsageLog: { create: jest.fn().mockResolvedValue({}) } } as never,
    {} as never,
    {} as never,
    { record: jest.fn(), recordFailure: jest.fn(), assertUnderCap: jest.fn(), estimateCostUsd: jest.fn(() => 0.01) } as never,
    { run: (_p: unknown, _c: unknown, fn: () => unknown) => fn(), acquire: async () => () => undefined, runGenerator: (_p: unknown, _c: unknown, g: () => unknown) => g(), snapshot: () => ({}) } as never,
  );
  const calls: StreamArgs[] = [];
  (svc as unknown as { claudeClient: unknown }).claudeClient = {
    messages: {
      stream: (args: StreamArgs) => {
        calls.push(args);
        return {
          [Symbol.asyncIterator]: async function* () {
            yield { type: 'message_start', message: { usage: { input_tokens: 1 } } };
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } };
            yield { type: 'message_delta', usage: { output_tokens: 1 } };
          },
        };
      },
    },
  };
  return { svc, calls };
}

const CLAUDE = {
  provider: AIProvider.CLAUDE,
  model: 'claude-sonnet-4-5-20250929',
  apiKey: 'k',
  timeoutMs: 1000,
};

async function drive(svc: AIService, system = 'SYSTEM PROMPT', user = 'USER PROMPT') {
  const gen = (svc as unknown as {
    streamClaude: (c: unknown, s: string, u: string) => AsyncGenerator<string>;
  }).streamClaude(CLAUDE, system, user);
  for await (const chunk of gen) void chunk;
}

describe('#6 — streamClaude sends a 5-minute cache marker on the system prompt', () => {
  it('sends the system prompt as ONE text block with an ephemeral cache_control and NO ttl', async () => {
    const { svc, calls } = makeService();
    await drive(svc);

    expect(calls).toHaveLength(1);
    const system = calls[0]!.system as Array<Record<string, unknown>>;
    expect(Array.isArray(system)).toBe(true);
    expect(system).toHaveLength(1);
    expect(system[0]).toEqual({
      type: 'text',
      text: 'SYSTEM PROMPT',
      cache_control: { type: 'ephemeral' },
    });
    // The finding's trap #1, pinned directly rather than implied by toEqual:
    // the default TTL IS 5 minutes, and a `ttl` key of any value is a change
    // someone must justify here.
    expect('ttl' in (system[0]!.cache_control as object)).toBe(false);
  });

  it('leaves the user message untouched — only the shared prefix is cached', async () => {
    const { svc, calls } = makeService();
    await drive(svc, 'S', 'the chart-specific user prompt');
    expect(calls[0]!.messages).toEqual([
      { role: 'user', content: 'the chart-specific user prompt' },
    ]);
  });

  it('AI_READING_PROMPT_CACHE=0 sends the plain string, exactly as before #6', async () => {
    const { svc, calls } = makeService({ AI_READING_PROMPT_CACHE: '0' });
    await drive(svc);
    expect(calls[0]!.system).toBe('SYSTEM PROMPT');
  });

  it('treats an unset flag as ON (the documented default)', async () => {
    const { svc, calls } = makeService({ AI_READING_PROMPT_CACHE: undefined });
    await drive(svc);
    expect(Array.isArray(calls[0]!.system)).toBe(true);
  });
});
