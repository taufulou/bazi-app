import { AiSpendService } from '../src/ai/ai-spend.service';

/**
 * `record()` must never throw — behaviourally, not just by docblock.
 *
 * All eleven call sites invoke it as a bare `void this.aiSpend.record(...)`
 * with no `.catch()`, on the strength of that promise. A rejection there is
 * unhandled, and there is no process-level handler, so it takes the API down.
 * An audit found the pricing call sitting OUTSIDE the try that makes the
 * promise true, and nothing covering it — reverting the fix left the whole
 * suite green.
 */

function makeService(redis: Partial<Record<string, unknown>> = {}) {
  return new AiSpendService(
    {
      incrByFloat: jest.fn(async () => 1),
      getFloat: jest.fn(async () => 0),
      ...redis,
    } as never,
    { get: () => undefined } as never,
  );
}

describe('AiSpendService.record — never throws', () => {
  it('survives a caller passing no usage at all', async () => {
    // The realistic trigger: a spread that resolves to undefined.
    await expect(
      makeService().record({ provider: 'CLAUDE', model: 'claude-x', usage: undefined as never }),
    ).resolves.toBe(0);
  });

  it('survives a malformed usage object', async () => {
    await expect(
      makeService().record({
        provider: 'CLAUDE',
        model: 'claude-x',
        usage: { inputTokens: 'lots' } as never,
      }),
    ).resolves.not.toThrow();
  });

  it('survives an unknown model', async () => {
    // Priced at the most expensive rate rather than free — but still no throw.
    await expect(
      makeService().record({
        provider: 'CLAUDE',
        model: 'a-model-nobody-has-heard-of',
        usage: { inputTokens: 100, outputTokens: 100 },
      }),
    ).resolves.toEqual(expect.any(Number));
  });

  it('survives Redis being unreachable', async () => {
    const svc = makeService({ incrByFloat: jest.fn(async () => { throw new Error('redis down'); }) });
    await expect(
      svc.record({ provider: 'CLAUDE', model: 'claude-x', usage: { inputTokens: 10, outputTokens: 10 } }),
    ).resolves.toEqual(expect.any(Number));
  });

  it('is safe when invoked exactly as its callers do — bare void, no catch', async () => {
    // The contract under test is the one the call sites rely on: an unhandled
    // rejection here is a process kill, not a failed assertion.
    const rejections: unknown[] = [];
    const onUnhandled = (e: unknown) => rejections.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      void makeService().record({ provider: 'CLAUDE', model: 'm', usage: undefined as never });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(rejections).toEqual([]);
  });
});
