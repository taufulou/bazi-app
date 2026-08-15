/**
 * Unit tests for AIService retry helpers (Step 5 of ai-retry-and-credit-refund plan).
 * - isRetryableError: error classification
 * - computeBackoff: jitter + Retry-After
 * - summarizeError: user-safe messages
 * - callProviderWithRetry: retry loop semantics, time budget, fallback
 */
import { AIService } from '../src/ai/ai.service';

const mockConfigService = { get: jest.fn().mockReturnValue(undefined) };
const mockPrisma: any = {};
const mockRedis: any = {};
const mockCredits: any = {};

function makeService(): AIService {
  return new AIService(mockConfigService as any, mockPrisma, mockRedis, mockCredits, { record: jest.fn(), assertUnderCap: jest.fn() } as never, { run: (_p: unknown, _c: unknown, fn: () => unknown) => fn(), acquire: async () => () => undefined, runGenerator: (_p: unknown, _c: unknown, g: () => unknown) => g(), snapshot: () => ({}) } as never);
}

describe('AIService retry helpers', () => {
  let svc: AIService;

  beforeEach(() => {
    svc = makeService();
  });

  // ============================================================
  // isRetryableError
  // ============================================================

  describe('isRetryableError', () => {
    it('retries on Anthropic overloaded_error message', () => {
      const err = new Error('{"type":"overloaded_error","message":"Overloaded"}');
      expect(svc.isRetryableError(err)).toBe(true);
    });

    it('retries on rate_limit_error message', () => {
      expect(svc.isRetryableError(new Error('rate_limit_error: too many requests'))).toBe(true);
    });

    it('retries on HTTP 529 via SDK error.status', () => {
      const err = new Error('overloaded') as any;
      err.status = 529;
      expect(svc.isRetryableError(err)).toBe(true);
    });

    it('retries on HTTP 429 via SDK error.status', () => {
      const err = new Error('rate limited') as any;
      err.status = 429;
      expect(svc.isRetryableError(err)).toBe(true);
    });

    it('retries on 5xx server errors', () => {
      const err = new Error('server error') as any;
      err.status = 503;
      expect(svc.isRetryableError(err)).toBe(true);
    });

    it('does NOT retry on 400 client errors', () => {
      const err = new Error('bad request') as any;
      err.status = 400;
      expect(svc.isRetryableError(err)).toBe(false);
    });

    it('does NOT retry on 401 unauthorized', () => {
      const err = new Error('unauthorized') as any;
      err.status = 401;
      expect(svc.isRetryableError(err)).toBe(false);
    });

    it('does NOT retry on 404 not found', () => {
      const err = new Error('not found') as any;
      err.status = 404;
      expect(svc.isRetryableError(err)).toBe(false);
    });

    it('retries on network blips (ECONNRESET)', () => {
      expect(svc.isRetryableError(new Error('ECONNRESET socket'))).toBe(true);
    });

    it('retries on socket hang up', () => {
      expect(svc.isRetryableError(new Error('socket hang up'))).toBe(true);
    });

    it('does NOT retry on plain Errors with no status', () => {
      expect(svc.isRetryableError(new Error('some generic error'))).toBe(false);
    });

    it('does NOT retry on non-Error values', () => {
      expect(svc.isRetryableError('string error' as any)).toBe(false);
      expect(svc.isRetryableError(null)).toBe(false);
      expect(svc.isRetryableError(undefined)).toBe(false);
    });
  });

  // ============================================================
  // computeBackoff
  // ============================================================

  describe('computeBackoff', () => {
    it('returns positive value bounded by 2^attempt * 1000', () => {
      const err = new Error('overloaded');
      for (let attempt = 1; attempt <= 3; attempt++) {
        const max = Math.pow(2, attempt) * 1000;
        for (let trial = 0; trial < 20; trial++) {
          const v = svc.computeBackoff(attempt, err);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(max);
        }
      }
    });

    // ⚠️ S3 — these two previously asserted that `Retry-After` was parsed out of
    // `err.message`, which is where NO provider SDK puts it. Anthropic and
    // OpenAI expose it on `err.headers`; the branch never fired in production,
    // so every 429 fell through to blind jitter while the tests reported the
    // feature as working. Rewritten against the shapes the SDKs actually throw.
    const withHeaders = (headers: Record<string, string>) =>
      Object.assign(new Error('429 rate_limit_error'), { headers });

    it('honors Retry-After from the error HEADERS', () => {
      const v = svc.computeBackoff(1, withHeaders({ 'retry-after': '5' }));
      // Lower bound + jitter, never below the provider's own number.
      expect(v).toBeGreaterThanOrEqual(5000);
    });

    it('matches the header case-insensitively', () => {
      const v = svc.computeBackoff(1, withHeaders({ 'Retry-After': '5' }));
      expect(v).toBeGreaterThanOrEqual(5000);
    });

    it('reads a fetch Headers instance', () => {
      const err = Object.assign(new Error('429'), {
        headers: new Headers({ 'retry-after': '7' }),
      });
      expect(svc.computeBackoff(1, err)).toBeGreaterThanOrEqual(7000);
    });

    it('accepts the HTTP-date form the spec also allows', () => {
      const when = new Date(Date.now() + 8000).toUTCString();
      const v = svc.computeBackoff(1, withHeaders({ 'retry-after': when }));
      expect(v).toBeGreaterThanOrEqual(6000); // ~8s, minus second-rounding
    });

    it('caps Retry-After at AI_RETRY_AFTER_CAP_MS before adding jitter', () => {
      // Anthropic can send 600s on a daily limit. Sleeping 10 minutes with a
      // request open is worse than failing over.
      const v = svc.computeBackoff(1, withHeaders({ 'retry-after': '600' }));
      expect(v).toBeGreaterThanOrEqual(30000);
      expect(v).toBeLessThan(30000 + 2000 + 1); // cap + max jitter at attempt 1
    });

    it('adds jitter ON TOP rather than sleeping exactly the header value', () => {
      // Honouring the header alone syncs every retrying worker onto the same
      // instant — the thundering herd the jitter exists to prevent.
      const runs = new Set(
        Array.from({ length: 40 }, () =>
          svc.computeBackoff(4, withHeaders({ 'retry-after': '1' })),
        ),
      );
      expect(runs.size).toBeGreaterThan(1);
    });

    it('ignores an absent, empty, or non-positive Retry-After', () => {
      const cases: Record<string, string>[] = [
        {},
        { 'retry-after': '' },
        { 'retry-after': '0' },
        { 'retry-after': '-5' },
      ];
      for (const headers of cases) {
        expect(svc.computeBackoff(1, withHeaders(headers))).toBeLessThanOrEqual(2000);
      }
    });

    it('no longer parses the message text', () => {
      // The old behaviour, explicitly retired: a message that merely mentions
      // retry-after must not produce a 5s floor.
      const v = svc.computeBackoff(1, new Error('rate limit, retry-after 5'));
      expect(v).toBeLessThanOrEqual(2000);
    });
  });

  // ============================================================
  // summarizeError
  // ============================================================

  describe('summarizeError', () => {
    it('summarizes overloaded errors', () => {
      expect(svc.summarizeError(new Error('Overloaded'))).toBe('AI service is busy');
    });

    it('summarizes rate limit errors', () => {
      expect(svc.summarizeError(new Error('rate_limit_error'))).toBe('AI rate limit reached');
      expect(svc.summarizeError(new Error('HTTP 429 error'))).toBe('AI rate limit reached');
    });

    it('summarizes timeout errors', () => {
      expect(svc.summarizeError(new Error('Request timeout'))).toBe('AI service slow to respond');
      expect(svc.summarizeError(new Error('ETIMEDOUT'))).toBe('AI service slow to respond');
    });

    it('falls back to generic message', () => {
      expect(svc.summarizeError(new Error('unknown weirdness'))).toBe('transient AI error');
    });
  });

  // ============================================================
  // callProviderWithRetry — uses spy on callProviderWithTimeout
  // ============================================================

  describe('callProviderWithRetry', () => {
    const config: any = {
      provider: 'CLAUDE',
      model: 'claude-test',
      apiKey: 'sk-test',
      timeoutMs: 1000,
      costPerInputToken: 0,
      costPerOutputToken: 0,
    };

    it('returns immediately on first success', async () => {
      const spy = jest
        .spyOn(svc as any, 'callProviderWithTimeout')
        .mockResolvedValueOnce({ content: 'ok', inputTokens: 1, outputTokens: 1 });

      const result = await (svc as any).callProviderWithRetry(
        config, 'sys', 'user', 1000, { maxRetries: 3 },
      );
      expect(result.content).toBe('ok');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('retries up to maxRetries on retryable errors then throws', async () => {
      const overloadedErr = new Error('overloaded_error');
      const spy = jest
        .spyOn(svc as any, 'callProviderWithTimeout')
        .mockRejectedValue(overloadedErr);

      // Stub computeBackoff to 0 for fast test
      jest.spyOn(svc, 'computeBackoff').mockReturnValue(0);

      await expect(
        (svc as any).callProviderWithRetry(config, 'sys', 'user', 1000, { maxRetries: 3 }),
      ).rejects.toThrow('overloaded_error');

      expect(spy).toHaveBeenCalledTimes(3); // 1 initial + 2 retries → 3 attempts total = maxRetries
    });

    it('does NOT retry on non-retryable errors (4xx)', async () => {
      const badErr = new Error('bad request') as any;
      badErr.status = 400;
      const spy = jest
        .spyOn(svc as any, 'callProviderWithTimeout')
        .mockRejectedValue(badErr);

      await expect(
        (svc as any).callProviderWithRetry(config, 'sys', 'user', 1000, { maxRetries: 3 }),
      ).rejects.toThrow('bad request');

      expect(spy).toHaveBeenCalledTimes(1); // no retry
    });

    it('succeeds on retry when first attempt fails transiently', async () => {
      const overloadedErr = new Error('overloaded_error');
      const spy = jest
        .spyOn(svc as any, 'callProviderWithTimeout')
        .mockRejectedValueOnce(overloadedErr)
        .mockResolvedValueOnce({ content: 'recovered', inputTokens: 1, outputTokens: 1 });

      jest.spyOn(svc, 'computeBackoff').mockReturnValue(0);

      const result = await (svc as any).callProviderWithRetry(
        config, 'sys', 'user', 1000, { maxRetries: 3 },
      );
      expect(result.content).toBe('recovered');
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('aborts when total time budget exceeded', async () => {
      const overloadedErr = new Error('overloaded_error');
      jest
        .spyOn(svc as any, 'callProviderWithTimeout')
        .mockRejectedValue(overloadedErr);
      jest.spyOn(svc, 'computeBackoff').mockReturnValue(50);

      const totalStartMs = Date.now() - 999999; // already exceeded
      await expect(
        (svc as any).callProviderWithRetry(config, 'sys', 'user', 1000, {
          maxRetries: 3,
          totalStartMs,
          maxTotalMs: 1000,
        }),
      ).rejects.toThrow();
    });

    it('calls onRetry callback before each retry', async () => {
      const overloadedErr = new Error('overloaded_error');
      jest
        .spyOn(svc as any, 'callProviderWithTimeout')
        .mockRejectedValueOnce(overloadedErr)
        .mockResolvedValueOnce({ content: 'ok', inputTokens: 0, outputTokens: 0 });
      jest.spyOn(svc, 'computeBackoff').mockReturnValue(0);

      const onRetry = jest.fn();
      await (svc as any).callProviderWithRetry(config, 'sys', 'user', 1000, {
        maxRetries: 3,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(2, 3, 'AI service is busy');
    });
  });
});
