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
 * (`{ record: jest.fn(), recordFailure: jest.fn(), assertUnderCap: jest.fn() } as never`) that no
 * assertion could reach. So the coverage claim rested on a list someone had to
 * keep complete.
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
  costPerInputToken: 0,
  costPerOutputToken: 0,
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
        usage: { inputTokens: 1000, outputTokens: 2000 },
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
      expect.objectContaining({ usage: { inputTokens: 500, outputTokens: 100 } }),
    );
  });
});
