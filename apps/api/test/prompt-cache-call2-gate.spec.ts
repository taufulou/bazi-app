import { ServiceUnavailableException } from '@nestjs/common';
import {
  AIService,
  PROMPT_CACHE_GATE_MAX_WAIT_MS,
  PROMPT_CACHE_GATE_BACKOFF_RESOLVE_MS,
} from '../src/ai/ai.service';
import { AI_BUSY_CODE } from '../src/ai/ai-governor.service';

/**
 * #6 — Call 2 waits for Call 1 to begin streaming, so it READS the prompt cache.
 *
 * A V2 reading's two calls share one byte-identical system prompt, cached at
 * the 5-minute TTL. A cache entry is readable only once the request writing it
 * has begun streaming, so two calls started TOGETHER both pay the 1.25x write
 * and neither reads — which made caching cost MORE than not caching on an
 * isolated reading. The gate is the whole saving, and every way it can open
 * too early (both write) or too late (a starved or hung reading) is a test here.
 *
 * Driven through the PUBLIC entry point, `streamLifetimeV2`, with only
 * `streamProvider` scripted: the gate lives in the wiring between
 * `_executeStreamV2Common`, Call 1's retry loop and `_streamV2Call2Loop`, and
 * that wiring is what has to be proven — not a helper in isolation.
 */

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Handler = (attempt: number, log: string[], signal: AbortSignal) => AsyncGenerator<string>;

function build(opts: {
  env?: Record<string, string | undefined>;
  provider?: string;
  call1: Handler;
  call2?: Handler;
  computeBackoff?: (attempt: number, err: Error) => number;
}) {
  const log: string[] = [];
  const attempts = { call1: 0, call2: 0 };
  const events: Array<{ type: string; data: unknown }> = [];
  const warn = jest.fn();
  const refundReadingCredit = jest.fn().mockResolvedValue({ refunded: true, amount: 3 });
  const env = opts.env ?? {};

  // eslint-disable-next-line require-yield
  const defaultCall2: Handler = async function* (_a, l) {
    l.push('enter:call2');
  };

  const svc = Object.create(AIService.prototype) as AIService;
  Object.assign(svc, {
    providers: [{ provider: opts.provider ?? 'CLAUDE', model: 'claude-sonnet-4-5', apiKey: 'k', timeoutMs: 1000 }],
    configService: { get: (k: string) => env[k] },
    aiSpend: { record: jest.fn(), recordFailure: jest.fn(), assertUnderCap: jest.fn(), estimateCostUsd: jest.fn(() => 0.01) },
    aiGovernor: { runGenerator: (_p: unknown, _c: unknown, g: () => unknown) => g() },
    logger: { log: jest.fn(), warn, error: jest.fn(), debug: jest.fn() },
    creditsService: { refundReadingCredit },
    prisma: { baziReading: { update: jest.fn().mockResolvedValue({}) } },
    streamProvider: (
      _c: unknown, _s: unknown, _u: unknown, sig: AbortSignal, _usage: unknown,
      attribution: { route: string },
    ) => {
      if (attribution.route.endsWith(':call1')) {
        attempts.call1 += 1;
        return opts.call1(attempts.call1, log, sig);
      }
      attempts.call2 += 1;
      return (opts.call2 ?? defaultCall2)(attempts.call2, log, sig);
    },
    buildLifetimeV2Prompts: () => ({ systemPrompt: 'sys', userPromptCall1: 'c1', userPromptCall2: 'c2' }),
    cacheInterpretation: jest.fn().mockResolvedValue(undefined),
    generateBirthDataHash: jest.fn().mockReturnValue('hash'),
    ...(opts.computeBackoff && { computeBackoff: opts.computeBackoff }),
  });

  let done = false;
  let subscription!: { unsubscribe: () => void };
  const finished = new Promise<void>((resolve) => {
    subscription = svc.streamLifetimeV2({}, 'reading-1', 'user-42').subscribe({
      next: (ev) => {
        let data: unknown = ev.data;
        try {
          data = JSON.parse(String(ev.data));
        } catch {
          /* heartbeat */
        }
        events.push({ type: String(ev.type), data });
      },
      complete: () => {
        done = true;
        resolve();
      },
      error: () => {
        done = true;
        resolve();
      },
    });
  });

  return {
    log, attempts, events, warn, refundReadingCredit, finished, subscription,
    isDone: () => done,
    capLogged: () => warn.mock.calls.some((c) => String(c[0]).includes('gate cap=')),
  };
}

/** Let promise chains and any due timers run, without moving time on. */
const settle = () => jest.advanceTimersByTimeAsync(0);

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('#6 — the Call-2 prompt-cache gate', () => {
  it('1. Call 2 starts once Call 1 has yielded its FIRST chunk — not before, and not only when Call 1 ends', async () => {
    const release = deferred();
    const keepStreaming = deferred();
    const h = build({
      call1: async function* (_a, log) {
        log.push('enter:call1');
        await release.promise;
        log.push('yield:call1');
        yield 'x';
        // Still mid-stream: the gate must already be open by now. If only the
        // loop-exit trigger opened it, Call 2 would wait for this to finish.
        await keepStreaming.promise;
        yield 'y';
      },
    });

    await settle();
    // Call 1 is running but has not streamed anything: Call 2 must still wait.
    expect(h.log).toEqual(['enter:call1']);

    release.resolve();
    await settle();
    expect(h.log).toEqual(['enter:call1', 'yield:call1', 'enter:call2']);
    expect(h.isDone()).toBe(false); // Call 1 has not finished

    // Opening the gate must also DISARM its cap timer. A ~180s reading runs far
    // past the 30s cap; a timer left armed would fire mid-reading and log that
    // "both calls will write the prompt cache" — a false alarm about the very
    // saving this gate exists to secure.
    await jest.advanceTimersByTimeAsync(PROMPT_CACHE_GATE_MAX_WAIT_MS + 1);
    expect(h.capLogged()).toBe(false);
    expect(h.attempts.call2).toBe(1);

    keepStreaming.resolve();
    await settle();
    await h.finished;
    expect(h.capLogged()).toBe(false);
  });

  it('2. Call 1 failing before any chunk does NOT starve Call 2', async () => {
    const h = build({
      // eslint-disable-next-line require-yield
      call1: async function* (_a, log) {
        log.push('enter:call1');
        throw Object.assign(new Error('bad request'), { status: 400 }); // not retryable
      },
    });
    await settle();
    await h.finished;
    expect(h.log).toEqual(['enter:call1', 'enter:call2']);
  });

  it('3. a Call 1 that never streams opens the gate at the cap — logged, and no timer leaks', async () => {
    const hold = deferred();
    const h = build({
      // eslint-disable-next-line require-yield
      call1: async function* (_a, log) {
        log.push('enter:call1');
        await hold.promise;
      },
    });

    await jest.advanceTimersByTimeAsync(PROMPT_CACHE_GATE_MAX_WAIT_MS - 1);
    expect(h.log).toEqual(['enter:call1']);
    expect(h.capLogged()).toBe(false);

    await jest.advanceTimersByTimeAsync(2);
    expect(h.log).toEqual(['enter:call1', 'enter:call2']);
    expect(h.capLogged()).toBe(true);

    hold.resolve();
    await settle();
    await h.finished;
    // Every timer the generation armed — heartbeat, cap, backoffs — is gone.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('4. with Call 1 already complete the gate is pre-opened: Call 2 starts at once', async () => {
    // `haveCall1` is only true when Call 1 has nothing left to produce. An
    // empty Call 1 section list is the one way to reach it on the first
    // provider, so this drives `_executeStreamV2Common` directly.
    const log: string[] = [];
    const svc = Object.create(AIService.prototype) as AIService;
    Object.assign(svc, {
      providers: [{ provider: 'CLAUDE', model: 'm', apiKey: 'k', timeoutMs: 1000 }],
      configService: { get: () => undefined },
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      creditsService: { refundReadingCredit: jest.fn().mockResolvedValue({ refunded: false, amount: 0 }) },
      prisma: { baziReading: { update: jest.fn().mockResolvedValue({}) } },
      cacheInterpretation: jest.fn().mockResolvedValue(undefined),
      generateBirthDataHash: jest.fn().mockReturnValue('hash'),
      streamProvider: (
        _c: unknown, _s: unknown, _u: unknown, _sig: unknown, _usage: unknown,
        attribution: { route: string },
      ) =>
        // eslint-disable-next-line require-yield
        (async function* () {
          log.push(`enter:${attribution.route.split(':').pop()}`);
        })(),
    });
    const subscriber = { next: jest.fn(), complete: jest.fn(), error: jest.fn(), closed: false };

    // Installed BEFORE the call: the gate (and any cap timer) is built in the
    // synchronous prefix of `_executeStreamV2Common`, before its first await.
    const armed = jest.spyOn(global, 'setTimeout');
    const run = (svc as unknown as { _executeStreamV2Common: (o: unknown) => Promise<void> })
      ._executeStreamV2Common({
        calculationData: {},
        readingId: 'r1',
        subscriber,
        readingType: 'LIFETIME',
        userId: 'u1',
        promptsBuilder: () => ({ systemPrompt: 's', userPromptCall1: 'c1', userPromptCall2: 'c2' }),
        call1SectionKeys: [],
        call2ExpectedKeysProvider: () => ['a'],
        enhancedInsightsKey: 'x',
      });
    await settle();
    await run;

    expect(log).toEqual(['call2'].map((c) => `enter:${c}`));
    expect(jest.getTimerCount()).toBe(0);
    // PRE-opened, not opened-a-tick-later by the loop-exit trigger: the cap
    // timer is never armed at all. (`getTimerCount` alone cannot tell — an armed
    // timer is cleared by the loop-exit resolve in the same tick.)
    expect(armed.mock.calls.some(([, ms]) => ms === PROMPT_CACHE_GATE_MAX_WAIT_MS)).toBe(false);
    armed.mockRestore();
  });

  it('5. a LONG retry backoff (Retry-After) opens the gate at backoff entry — Call 2 writes, the retry reads', async () => {
    const h = build({
      call1: async function* (attempt, log) {
        log.push(`enter:call1:a${attempt}`);
        if (attempt === 1) {
          // A real 429 from the provider — retryable — WITH a Retry-After, in
          // the shape `retryAfterMsFromError` reads. Without the header,
          // `computeBackoff` is jitter-only and this would test case 5b.
          throw Object.assign(new Error('rate_limit_error'), {
            status: 429,
            headers: { 'retry-after': '20' },
          });
        }
        yield 'x';
      },
    });

    await settle();
    // Attempt 1 failed and Call 1 is now asleep for ~20s: Call 2 is already in.
    expect(h.log).toEqual(['enter:call1:a1', 'enter:call2']);

    await jest.advanceTimersByTimeAsync(25_000);
    await h.finished;
    expect(h.log).toEqual(['enter:call1:a1', 'enter:call2', 'enter:call1:a2']);
    // The gate opened at backoff entry and its cap timer went with it: well past
    // 30s, and no cap line.
    await jest.advanceTimersByTimeAsync(PROMPT_CACHE_GATE_MAX_WAIT_MS);
    expect(h.capLogged()).toBe(false);
  });

  it('5b. a SHORT (jitter-only) backoff keeps the gate CLOSED — the retry writes, Call 2 reads', async () => {
    expect(1_000).toBeLessThan(PROMPT_CACHE_GATE_BACKOFF_RESOLVE_MS);
    const h = build({
      computeBackoff: () => 1_000,
      call1: async function* (attempt, log) {
        log.push(`enter:call1:a${attempt}`);
        if (attempt === 1) {
          throw Object.assign(new Error('overloaded_error'), { status: 529 });
        }
        log.push(`yield:call1:a${attempt}`);
        yield 'x';
      },
    });

    await settle();
    expect(h.log).toEqual(['enter:call1:a1']); // asleep, gate still closed

    await jest.advanceTimersByTimeAsync(1_000);
    await h.finished;
    expect(h.log).toEqual([
      'enter:call1:a1',
      'enter:call1:a2',
      'yield:call1:a2',
      'enter:call2',
    ]);
  });

  it('6. AI_READING_PROMPT_CACHE=0 restores the PARALLEL start — Call 2 runs before Call 1 streams', async () => {
    const release = deferred();
    const h = build({
      env: { AI_READING_PROMPT_CACHE: '0' },
      call1: async function* (_a, log) {
        log.push('enter:call1');
        await release.promise;
        log.push('yield:call1');
        yield 'x';
      },
    });

    await settle();
    // No gate object at all: Call 2 is already running while Call 1 is silent.
    expect(h.log).toContain('enter:call2');
    expect(h.log).not.toContain('yield:call1');

    release.resolve();
    await settle();
    await h.finished;
    expect(h.capLogged()).toBe(false);
  });

  it('7. a self-refusal on Call 1 skips Call 2 entirely — same refusal, same handling, no second queue wait', async () => {
    const busy = new ServiceUnavailableException({ code: AI_BUSY_CODE, message: 'busy' });
    const h = build({
      // eslint-disable-next-line require-yield
      call1: async function* (_a, log) {
        log.push('enter:call1');
        throw busy;
      },
    });

    await settle();
    await h.finished;

    // Call 2 never reached the provider — it would only have queued ~15s for
    // the identical refusal.
    expect(h.attempts.call2).toBe(0);
    expect(h.log).toEqual(['enter:call1']);

    // …and the caller surfaces the refusal exactly as it does for a Call 2
    // refusal today: named in the refund, and in the final message.
    expect(h.refundReadingCredit).toHaveBeenCalledWith('reading-1', 'self-refusal:AI_BUSY-LIFETIME');
    const final = h.events.find((e) => e.type === 'final')?.data as { status: string; message: string };
    expect(final.status).toBe('failed');
    expect(final.message).toMatch(/temporarily busy/i);
    // Both calls still report completion, so the client's progress UI settles.
    expect(
      h.events.filter((e) => e.type === 'call_complete').map((e) => (e.data as { call: number }).call),
    ).toEqual([1, 2]);
  });

  it('8. if something unexpected escapes Call 1\'s loop, Call 2 is NEVER started afterwards', async () => {
    // The generation is over at that point; starting Call 2 would spend money
    // on a reading nobody is listening to. The gate's exit value therefore
    // defaults to 'refused' and is set to 'proceed' only on a NORMAL exit.
    const svcErr = new Error('bookkeeping blew up');
    const h = build({
      computeBackoff: () => {
        throw svcErr;
      },
      // eslint-disable-next-line require-yield
      call1: async function* (_a, log) {
        log.push('enter:call1');
        // Retryable, so Call 1's catch reaches `computeBackoff` — which throws
        // from INSIDE the catch, i.e. out of the attempt loop entirely.
        throw Object.assign(new Error('overloaded_error'), { status: 529 });
      },
    });

    await settle();
    await h.finished;
    // Well past the cap: nothing may wake Call 2 up late either.
    await jest.advanceTimersByTimeAsync(PROMPT_CACHE_GATE_MAX_WAIT_MS + 1);
    expect(h.attempts.call2).toBe(0);
    expect(h.log).toEqual(['enter:call1']);
  });

  it('9. a consumer that LEAVES before Call 1\'s first chunk never gets a Call 2 started for nobody', async () => {
    // Line-audit regression: the disconnect teardown aborts the controllers in
    // `externalControllers` ONCE. Call 2 registers its controller only after the
    // gate opens — after that teardown — so without the `subscriber.closed`
    // check it would run a full paid call nobody reads.
    const h = build({
      // eslint-disable-next-line require-yield
      call1: async function* (_a, log, signal) {
        log.push('enter:call1');
        await new Promise((_, reject) =>
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
          ),
        );
      },
    });

    await settle();
    expect(h.log).toEqual(['enter:call1']);

    h.subscription.unsubscribe(); // the client disconnects
    await settle();
    await jest.advanceTimersByTimeAsync(PROMPT_CACHE_GATE_MAX_WAIT_MS + 1);

    expect(h.attempts.call2).toBe(0);
    expect(h.log).toEqual(['enter:call1']);
  });

  it('10. a GPT/Gemini fallback is NOT gated — there is no Anthropic cache to read there', async () => {
    const release = deferred();
    const h = build({
      provider: 'GPT',
      call1: async function* (_a, log) {
        log.push('enter:call1');
        await release.promise;
        log.push('yield:call1');
        yield 'x';
      },
    });

    await settle();
    expect(h.log).toContain('enter:call2'); // parallel, as before #6
    expect(h.log).not.toContain('yield:call1');

    release.resolve();
    await settle();
    await h.finished;
    expect(h.capLogged()).toBe(false);
  });
});
