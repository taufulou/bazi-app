import { ServiceUnavailableException } from '@nestjs/common';
import { AIService } from '../src/ai/ai.service';
import { AI_SPEND_CAP_CODE } from '../src/ai/ai-spend.service';

/**
 * S2 — the breaker at its CHOKE POINTS.
 *
 * The first cut of S2 wired `assertUnderCap` into `generateInterpretation` and
 * called the reading pipeline covered. It was not: `bazi.service.ts` dispatches
 * LIFETIME/CAREER/ANNUAL/LOVE to V2 generators and COMPATIBILITY to its own
 * method, none of which pass through it — they call `callProviderWithTimeout`
 * directly, twice in parallel. Streaming was worse: uncapped AND uncounted,
 * because `usageOut` was optional and five of six call sites omitted it.
 *
 * Two audits found this independently, and neither the 22 service tests nor the
 * CI guard caught it, because every spec injected an ANONYMOUS stub
 * (`{ record: jest.fn(), recordFailure: jest.fn(), assertUnderCap: jest.fn(), estimateCostUsd: jest.fn(() => 0.01) } as never`) that no
 * assertion could reach. So the coverage claim rested on a list someone had to
 * keep complete.
 *
 * ⚠️ `estimateCostUsd` is in that literal DELIBERATELY, and a copy of this shape
 * must carry all four methods. `persistUsageRow` prices the `ai_usage_log` row
 * through it, and its own try/catch would swallow the `TypeError` from a stub
 * that omits it — writing `costUsd: 0`, i.e. reproducing the exact defect under
 * test while every spec stayed green.
 *
 * These tests hold a NAMED stub and assert against it, at the two methods every
 * provider call must pass through. If either check is deleted, they fail.
 */

function makeSpendStub(overrides: { rejectCap?: boolean } = {}) {
  return {
    assertUnderCap: jest.fn(async () => {
      if (overrides.rejectCap) {
        throw new ServiceUnavailableException({
          code: AI_SPEND_CAP_CODE,
          message: 'capped',
        });
      }
    }),
    record: jest.fn(async () => 0),
  };
}

/** Pass-through governor — S1's own behaviour is covered by its own spec. */
function makeGovernorStub() {
  return {
    run: (_pool: unknown, _ctx: unknown, fn: () => unknown) => fn(),
    acquire: async () => () => undefined,
    runGenerator: (_pool: unknown, _ctx: unknown, gen: () => unknown) => gen(),
    snapshot: () => ({}),
  };
}

function makeService(spend: ReturnType<typeof makeSpendStub>) {
  const config = { get: jest.fn().mockReturnValue(undefined) };
  return new AIService(
    config as never,
    {} as never,
    {} as never,
    {} as never,
    spend as never,
    makeGovernorStub() as never,
  );
}

/** Reaches the private choke points without booting the whole generation stack. */
type Chokepoints = {
  callProviderWithTimeout: (c: unknown, s: string, u: string, t: number) => Promise<unknown>;
  streamProvider: (c: unknown, s: string, u: string) => AsyncGenerator<string>;
  callProvider: jest.Mock;
  streamClaude: jest.Mock;
};

const CLAUDE_CONFIG = {
  provider: 'CLAUDE',
  model: 'claude-sonnet-4-5-20250929',
  apiKey: 'k',
  timeoutMs: 1000,
};

describe('S2 chokepoint — callProviderWithTimeout (every non-streaming call)', () => {
  it('refuses BEFORE the provider is called when the cap is reached', async () => {
    const spend = makeSpendStub({ rejectCap: true });
    const service = makeService(spend) as unknown as Chokepoints;
    const callProvider = jest.fn();
    (service as unknown as { callProvider: unknown }).callProvider = callProvider;

    await expect(
      service.callProviderWithTimeout(CLAUDE_CONFIG, 'sys', 'user', 1000),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    // The point of a breaker: the money is not spent.
    expect(callProvider).not.toHaveBeenCalled();
  });

  it('consults the breaker on the happy path, BEFORE and AFTER the queue', async () => {
    // Twice, deliberately. The pre-queue check avoids occupying a slot with a
    // call we already know we will refuse. The post-queue check exists because
    // the first verdict can be up to 15s stale by the time a slot frees — and
    // the queue only fills when the pool is saturated, i.e. exactly when the
    // in-flight calls are about to trip the cap. Dropping either one re-opens a
    // window S1 was introduced to shrink.
    const spend = makeSpendStub();
    const service = makeService(spend) as unknown as Chokepoints;
    (service as unknown as { callProvider: unknown }).callProvider = jest
      .fn()
      .mockResolvedValue({ content: 'ok', inputTokens: 1, outputTokens: 1 });

    await service.callProviderWithTimeout(CLAUDE_CONFIG, 'sys', 'user', 1000);

    expect(spend.assertUnderCap).toHaveBeenCalledTimes(2);
  });
});

describe('S2 chokepoint — streamProvider (every streaming call)', () => {
  const drain = async (gen: AsyncGenerator<string>) => {
    const out: string[] = [];
    for await (const chunk of gen) out.push(chunk);
    return out;
  };

  it('refuses before streaming when the cap is reached', async () => {
    const spend = makeSpendStub({ rejectCap: true });
    const service = makeService(spend) as unknown as Chokepoints;
    const streamClaude = jest.fn();
    (service as unknown as { streamClaude: unknown }).streamClaude = streamClaude;

    await expect(drain(service.streamProvider(CLAUDE_CONFIG, 'sys', 'user'))).rejects.toThrow();
    expect(streamClaude).not.toHaveBeenCalled();
  });

  it('records the stream usage even when NO usageOut ref was passed', async () => {
    // The original bug: `usageOut` was optional and 5 of 6 call sites omitted
    // it, so streaming tokens were discarded at the source and the breaker
    // could never see the app's largest generation.
    const spend = makeSpendStub();
    const service = makeService(spend) as unknown as Chokepoints;
    (service as unknown as { streamClaude: unknown }).streamClaude = async function* (
      _c: unknown,
      _s: string,
      _u: string,
      _sig: unknown,
      usageOut: { inputTokens: number; outputTokens: number },
    ) {
      yield 'hello';
      usageOut.inputTokens = 1000;
      usageOut.outputTokens = 2000;
    };

    await drain(service.streamProvider(CLAUDE_CONFIG, 'sys', 'user'));

    expect(spend.record).toHaveBeenCalledWith(
      expect.objectContaining({
        model: CLAUDE_CONFIG.model,
        // #6 — always the five-field shape. The cache counters are `0`, not
        // absent: conditional keys would keep this matcher green by accident.
        usage: {
          inputTokens: 1000,
          outputTokens: 2000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cacheWrite5mTokens: 0,
        },
      }),
    );
  });

  it('records tokens generated before an ABANDONED stream', async () => {
    // Client disconnect and the watchdog both abort mid-stream. Anthropic bills
    // what was generated up to that point, so recording only on clean
    // completion under-counts exactly the case mobile produces most.
    const spend = makeSpendStub();
    const service = makeService(spend) as unknown as Chokepoints;
    (service as unknown as { streamClaude: unknown }).streamClaude = async function* (
      _c: unknown,
      _s: string,
      _u: string,
      _sig: unknown,
      usageOut: { inputTokens: number; outputTokens: number },
    ) {
      usageOut.inputTokens = 500;
      usageOut.outputTokens = 100;
      yield 'partial';
      yield 'never reached';
    };

    // Consume one chunk then abandon — this is what `break` in the caller does.
    const gen = service.streamProvider(CLAUDE_CONFIG, 'sys', 'user');
    await gen.next();
    await gen.return(undefined as never);

    expect(spend.record).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: {
          inputTokens: 500,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cacheWrite5mTokens: 0,
        },
      }),
    );
  });

  /**
   * #6 — once a reading caches its system prompt, `input_tokens` is only the
   * UNCACHED remainder. The cached part arrives in `message_start` as separate
   * counters, and if they do not reach `record()` the breaker silently loses
   * most of every reading's input — the under-count direction.
   *
   * Drives the REAL `streamClaude` (only the SDK client is faked) so the whole
   * path is covered: `message_start` → `absorbInputSideUsage` → `usageOut` →
   * `_streamProviderInner`'s `finally` → `record()`.
   */
  it('#6 — carries the prompt-cache counters from message_start to record()', async () => {
    const spend = makeSpendStub();
    const service = makeService(spend) as unknown as Chokepoints;
    (service as unknown as { claudeClient: unknown }).claudeClient = {
      messages: {
        stream: () => ({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: 'message_start',
              message: {
                usage: {
                  input_tokens: 6_831,
                  cache_read_input_tokens: 100,
                  cache_creation_input_tokens: 15_756,
                  cache_creation: { ephemeral_5m_input_tokens: 15_756, ephemeral_1h_input_tokens: 0 },
                },
              },
            };
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } };
            yield { type: 'message_delta', usage: { output_tokens: 42 } };
          },
        }),
      },
    };

    await drain(service.streamProvider(CLAUDE_CONFIG, 'sys', 'user'));

    expect(spend.record).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: {
          inputTokens: 6_831,
          outputTokens: 42,
          cacheReadTokens: 100,
          cacheWriteTokens: 15_756,
          cacheWrite5mTokens: 15_756,
        },
      }),
    );
  });
});
