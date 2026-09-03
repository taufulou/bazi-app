import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpException } from '@nestjs/common';
import { classifyAiError } from '../src/ai/ai-call-log';
import { AIService } from '../src/ai/ai.service';

/**
 * Ob1 #14 — a provider call that DIES must leave a line.
 *
 * `AI-CALL` lines came out of `AiSpendService.record()`, which prices usage and
 * so only ever ran once usage existed. A call that failed before its first
 * response therefore emitted NOTHING at the non-streaming choke point, and
 * nothing at the streaming sites that guard on `hasUsage`. The most expensive
 * path in the system could fail completely and be invisible — which is exactly
 * what the charged-empty-reading incident looked like in the log: a bare
 * `[Stream] Setup starting` and, four seconds later, a refund line.
 */
describe('classifyAiError', () => {
  // ⚠️ The whole point of the classifier is what it LEAVES OUT. A provider
  // error can echo request content back, and these requests carry the four
  // pillars — a reversible encoding of a birth datetime, i.e. personal data
  // that must not reach a third-party log store.
  it('never returns anything derived from the error MESSAGE', () => {
    const kind = classifyAiError(
      new Error('400 invalid_request: 丁卯 戊申 戊午 庚申 (1987-09-06, 吉打)'),
    );
    expect(kind).toBe('Error');
    expect(kind).not.toMatch(/卯|申|1987|吉打|invalid/);
  });

  it('maps the provider status codes an operator triages on', () => {
    const withStatus = (status: number) =>
      classifyAiError(Object.assign(new Error('x'), { status }));
    expect(withStatus(429)).toBe('rate_limit');
    expect(withStatus(529)).toBe('overloaded');
    expect(withStatus(503)).toBe('server_503');
    expect(withStatus(400)).toBe('client_400');
  });

  it('separates OUR refusals from provider failures', () => {
    // Both would otherwise land in the 5xx bucket, because NestJS HttpException
    // exposes a numeric `status` — the same trap documented on
    // `isRetryableError`. "Anthropic is down" and "we shed load" need different
    // responses, so they must not share a row.
    const busy = new HttpException({ code: 'AI_BUSY', message: 'busy' }, 503);
    expect(classifyAiError(busy)).toBe('AI_BUSY');
    const cap = new HttpException({ code: 'AI_SPEND_CAP', message: 'cap' }, 503);
    expect(classifyAiError(cap)).toBe('AI_SPEND_CAP');
  });

  it('recognises an abort, the commonest ending of all', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(classifyAiError(abort)).toBe('abort');
  });

  it('survives a non-Error throw', () => {
    expect(classifyAiError('a string')).toBe('unknown');
    expect(classifyAiError(undefined)).toBe('unknown');
  });

  it('is TOTAL — a throwing getter must not become the thrown error', () => {
    // Call sites evaluate this as an argument, outside the try that protects
    // the logger, and two of them are in a `finally` where a throw would
    // replace the real exception with a logging one.
    const hostile = new Error('x');
    Object.defineProperty(hostile, 'name', {
      get() { throw new Error('getter exploded'); },
    });
    expect(() => classifyAiError(hostile)).not.toThrow();
    expect(classifyAiError(hostile)).toBe('unclassifiable');
  });

  it('sanitises the kind — this string is grepped by operators', () => {
    const weird = new Error('x');
    weird.name = 'Bad\nName {"injected":true}';
    expect(classifyAiError(weird)).toMatch(/^[A-Za-z0-9_]+$/);
  });
});

/**
 * The WIRING half. `classifyAiError` and `recordFailure` are both well covered
 * on their own; that is precisely the shape ("well-covered helper behind
 * untested wiring") that has produced a bug in this repo six times. What
 * matters is that the choke point actually calls them.
 */
describe('callProviderWithTimeout — the non-streaming choke point', () => {
  function build(callProviderImpl: () => Promise<unknown>) {
    const recordFailure = jest.fn();
    const svc = Object.create(AIService.prototype) as AIService;
    Object.assign(svc, {
      aiSpend: { assertUnderCap: jest.fn().mockResolvedValue(undefined), recordFailure },
      // Pass-through governor: the slot behaviour is S1's concern, not Ob1's.
      aiGovernor: { run: (_p: string, _c: string, fn: () => Promise<unknown>) => fn() },
      callProvider: jest.fn(callProviderImpl),
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
    const call = () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (svc as any).callProviderWithTimeout(
        { provider: 'CLAUDE', model: 'claude-sonnet-4-5' },
        'sys',
        'user',
        50_000,
      );
    return { call, recordFailure };
  }

  it('emits a failure line when the provider call throws', async () => {
    const boom = Object.assign(new Error('overloaded'), { status: 529 });
    const { call, recordFailure } = build(() => Promise.reject(boom));

    await expect(call()).rejects.toBe(boom);

    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(recordFailure.mock.calls[0]![0]).toMatchObject({
      provider: 'CLAUDE',
      model: 'claude-sonnet-4-5',
      error: boom,
      context: 'provider:CLAUDE',
    });
  });

  it('RETHROWS — logging must not swallow the failure', async () => {
    const boom = new Error('nope');
    const { call } = build(() => Promise.reject(boom));
    await expect(call()).rejects.toBe(boom);
  });

  it('times the failed call, so a timeout is distinguishable from an instant reject', async () => {
    const { call, recordFailure } = build(() => Promise.reject(new Error('x')));
    await expect(call()).rejects.toThrow();
    expect(typeof recordFailure.mock.calls[0]![0].durationMs).toBe('number');
  });

  it('stays silent on SUCCESS — one line per call, not two', async () => {
    const { call, recordFailure } = build(async () => ({
      content: 'ok', inputTokens: 1, outputTokens: 1,
    }));
    await expect(call()).resolves.toMatchObject({ content: 'ok' });
    expect(recordFailure).not.toHaveBeenCalled();
  });
});

/**
 * The streaming choke point already emitted a line on every exit path (its
 * `record` sits in a `finally`), but that line could not say WHICH exit. A
 * client disconnect and a clean finish both rendered as a `$0` `ok` row.
 */
describe('_streamProviderInner — how the stream ENDED', () => {
  function build(impl: () => AsyncGenerator<string>) {
    const record = jest.fn();
    const svc = Object.create(AIService.prototype) as AIService;
    Object.assign(svc, {
      aiSpend: { record, recordFailure: jest.fn(), estimateCostUsd: jest.fn(() => 0.01) },
      streamClaude: impl,
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
    const gen = () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (svc as any)._streamProviderInner(
        { provider: 'CLAUDE', model: 'claude-sonnet-4-5' },
        'sys', 'user', undefined, { inputTokens: 0, outputTokens: 0 },
      ) as AsyncGenerator<string>;
    return { gen, record };
  }

  const twoChunks = async function* () { yield 'a'; yield 'b'; };

  it('reports ok when the stream runs to completion', async () => {
    const { gen, record } = build(twoChunks);
    const chunks: string[] = [];
    for await (const chunk of gen()) chunks.push(chunk);
    expect(chunks).toEqual(['a', 'b']);
    expect(record.mock.calls[0]![0]).toMatchObject({ outcome: 'ok', errorKind: null });
  });

  it('reports ABANDONED when the consumer walks away mid-stream', async () => {
    // The commonest ending on mobile. It does not throw, so without a
    // completion flag it is indistinguishable from a clean finish.
    const { gen, record } = build(twoChunks);
    const it_ = gen();
    await it_.next();
    await it_.return(undefined as never);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![0]).toMatchObject({ outcome: 'abandoned' });
  });

  it('reports error, with a kind, when the provider throws', async () => {
    const boom = Object.assign(new Error('x'), { status: 429 });
    const { gen, record } = build(async function* () { yield 'a'; throw boom; });
    await expect(
      (async () => { for await (const chunk of gen()) void chunk; })(),
    ).rejects.toBe(boom);
    expect(record.mock.calls[0]![0]).toMatchObject({
      outcome: 'error', errorKind: 'rate_limit',
    });
  });
});

/**
 * Completeness sweep across the streaming sites.
 *
 * Only the DAILY fortune branch and the chat branch are proven by execution
 * (their specs have an Anthropic-throws test to hang the assertion on).
 * Monthly and yearly are byte-identical apart from the context string, and
 * writing two more near-identical stream harnesses buys less than an invariant
 * that catches the real risk: a site wired HALF way, or a new one added with a
 * `record` and no failure branch.
 *
 * The invariant is countable — every `hasUsage(streamUsage)` guard exists
 * precisely to skip `record()` when there is nothing to price, so every one of
 * them needs a matching failure branch or that path goes dark again.
 */
describe('every hasUsage-guarded streaming site has a failure branch', () => {
  const SITES = [
    'src/chat/chat-stream.service.ts',
    'src/fortune/fortune-stream.service.ts',
  ];

  for (const rel of SITES) {
    it(`${rel} — one recordFailure per hasUsage guard`, () => {
      const src = readFileSync(join(__dirname, '..', rel), 'utf8');
      const guards = src.match(/if \(hasUsage\(streamUsage\)\)/g)?.length ?? 0;
      const failures = src.match(/this\.aiSpend\.recordFailure\(/g)?.length ?? 0;
      // Non-zero, or the assertion passes vacuously on a file that lost both.
      expect(guards).toBeGreaterThan(0);
      expect(failures).toBe(guards);
    });

    it(`${rel} — every guarded site marks the outcome on the success path too`, () => {
      const src = readFileSync(join(__dirname, '..', rel), 'utf8');
      const guards = src.match(/if \(hasUsage\(streamUsage\)\)/g)?.length ?? 0;
      const outcomes = src.match(/outcome: aiCallError === undefined \? 'ok' : 'error'/g)?.length ?? 0;
      expect(outcomes).toBe(guards);
    });
  }
});
