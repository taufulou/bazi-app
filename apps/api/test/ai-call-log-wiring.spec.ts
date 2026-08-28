import { Logger } from '@nestjs/common';
import { AiSpendService } from '../src/ai/ai-spend.service';
import { AI_CALL_LOG_PREFIX, hashUserId } from '../src/ai/ai-call-log';
import {
  absorbRateLimitHeaders,
  resetRateLimitSnapshot,
} from '../src/ai/anthropic-rate-limit';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn() }));

/**
 * Ob1 — the WIRING, not the formatter.
 *
 * `ai-call-log.spec.ts` proves `formatAiCallLog` renders the right string. That
 * is the half that would keep passing if nothing ever called it. This asserts
 * the line actually leaves `AiSpendService.record()` — the property that makes
 * Ob1 true in production, and the one this repo has now watched fail six times
 * as "well-covered helper behind untested wiring".
 */

function makeRedis() {
  const store = new Map<string, number>();
  return {
    get: jest.fn(async (k: string) => (store.has(k) ? String(store.get(k)) : null)),
    incrByFloat: jest.fn(async (k: string, amt: number) => {
      const next = (store.get(k) ?? 0) + amt;
      store.set(k, next);
      return next;
    }),
  };
}

function makeService(env: Record<string, string | number> = {}) {
  const redis = makeRedis();
  const service = new AiSpendService(redis as never, { get: (k: string) => env[k] } as never);
  const lines: string[] = [];
  jest
    .spyOn(Logger.prototype, 'log')
    .mockImplementation((msg: unknown) => void lines.push(String(msg)));
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  return { service, redis, lines, warn };
}

const aiLines = (lines: string[]) => lines.filter((l) => l.startsWith(AI_CALL_LOG_PREFIX));
const parseOne = (lines: string[]) =>
  JSON.parse(aiLines(lines)[0].slice(AI_CALL_LOG_PREFIX.length + 1));

beforeEach(() => {
  jest.restoreAllMocks();
  resetRateLimitSnapshot();
});

describe('record() emits the Ob1 line', () => {
  it('logs one line per metered call, carrying every field', async () => {
    absorbRateLimitHeaders(
      new Headers({
        'anthropic-ratelimit-output-tokens-remaining': '17500',
        'anthropic-ratelimit-output-tokens-reset': '2026-08-28T04:05:06Z',
      }),
      200,
    );
    const { service, lines } = makeService();

    await service.record({
      provider: 'CLAUDE',
      model: 'claude-sonnet-4-5',
      usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 20, cacheWriteTokens: 5 },
      context: 'chat:stream',
      durationMs: 3200.7,
      userId: 'user-42',
    });

    expect(aiLines(lines)).toHaveLength(1);
    expect(parseOne(lines)).toEqual({
      route: 'chat:stream',
      provider: 'CLAUDE',
      model: 'claude-sonnet-4-5',
      ms: 3201, // rounded — a fractional millisecond is noise
      inTok: 1000,
      outTok: 500,
      cacheReadTok: 20,
      cacheWriteTok: 5,
      costUsd: expect.any(Number),
      userIdHash: hashUserId('user-42'),
      rlOutRemaining: 17500,
      rlOutReset: '2026-08-28T04:05:06Z',
    });
  });

  it('never writes the raw user id', async () => {
    const { service, lines } = makeService();
    await service.record({
      provider: 'CLAUDE',
      model: 'claude-sonnet-4-5',
      usage: { inputTokens: 10, outputTokens: 10 },
      context: 'chat:sync',
      userId: '3c0c5b50-0b8d-44ca-820b-df10b73d969c',
    });
    expect(aiLines(lines)[0]).not.toContain('3c0c5b50');
  });

  it('still logs when the call is priced at zero', async () => {
    // `record` returns early on a zero cost. The line has to be emitted BEFORE
    // that return, or every free path — a cache hit, a model priced at 0 —
    // vanishes from the log while genuinely having happened.
    const { service, lines } = makeService();
    await service.record({
      provider: 'CLAUDE',
      model: 'claude-sonnet-4-5',
      usage: { inputTokens: 0, outputTokens: 0 },
      context: 'reading:LIFETIME',
    });
    expect(aiLines(lines)).toHaveLength(1);
    expect(parseOne(lines).costUsd).toBe(0);
  });

  it('falls back to "unknown" rather than omitting the route', async () => {
    const { service, lines } = makeService();
    await service.record({
      provider: 'CLAUDE',
      model: 'claude-sonnet-4-5',
      usage: { inputTokens: 5, outputTokens: 5 },
    });
    expect(parseOne(lines).route).toBe('unknown');
    expect(parseOne(lines).userIdHash).toBeNull();
    expect(parseOne(lines).ms).toBeNull();
  });

  it('reports rate limits as null before any response has been seen', async () => {
    const { service, lines } = makeService();
    await service.record({
      provider: 'CLAUDE',
      model: 'claude-sonnet-4-5',
      usage: { inputTokens: 5, outputTokens: 5 },
      context: 'chat:sync',
    });
    expect(parseOne(lines)).toMatchObject({ rlOutRemaining: null, rlOutReset: null });
  });

  it('keeps record()\'s never-throws promise when the log itself fails', async () => {
    // Every one of the eleven call sites invokes `record` as a bare `void`, so
    // a rejection here is unhandled and takes the process down.
    const { service, lines, warn } = makeService();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {
      throw new Error('log transport down');
    });
    await expect(
      service.record({
        provider: 'CLAUDE',
        model: 'claude-sonnet-4-5',
        usage: { inputTokens: 100, outputTokens: 100 },
        context: 'chat:sync',
      }),
    ).resolves.toBeGreaterThan(0); // and the SPEND is still counted
    expect(aiLines(lines)).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(AI_CALL_LOG_PREFIX));
  });

  it('does not log when usage is malformed — pricing fails first, loudly', async () => {
    const { service, lines } = makeService();
    await expect(
      service.record({
        provider: 'CLAUDE',
        model: 'claude-sonnet-4-5',
        usage: undefined as never,
        context: 'chat:sync',
      }),
    ).resolves.toBe(0);
    expect(aiLines(lines)).toHaveLength(0);
  });
});
