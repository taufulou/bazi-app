import {
  absorbRateLimitHeaders,
  getRateLimitSnapshot,
  observeRateLimits,
  resetRateLimitSnapshot,
} from '../src/ai/anthropic-rate-limit';

const headers = (h: Record<string, string>) => new Headers(h);

const FULL = {
  'anthropic-ratelimit-output-tokens-remaining': '18000',
  'anthropic-ratelimit-output-tokens-limit': '32000',
  'anthropic-ratelimit-output-tokens-reset': '2026-08-28T04:05:06Z',
  'anthropic-ratelimit-requests-remaining': '49',
};

describe('absorbRateLimitHeaders', () => {
  beforeEach(() => resetRateLimitSnapshot());

  it('reads the four counters Ob1 logs', () => {
    absorbRateLimitHeaders(headers(FULL), 200);
    const s = getRateLimitSnapshot();
    expect(s.outputTokensRemaining).toBe(18000);
    expect(s.outputTokensLimit).toBe(32000);
    expect(s.outputTokensReset).toBe('2026-08-28T04:05:06Z');
    expect(s.requestsRemaining).toBe(49);
    expect(s.observedStatus).toBe(200);
    expect(s.observedAt).toEqual(expect.any(Number));
  });

  it('starts empty rather than zero — "unknown" and "none left" are different', () => {
    // A zero default would read as "we are out of output tokens" on a process
    // that has simply not called Anthropic yet.
    expect(getRateLimitSnapshot()).toMatchObject({
      outputTokensRemaining: null,
      outputTokensReset: null,
      observedAt: null,
    });
  });

  it('captures a 429 — the reading you most want', () => {
    // This is the whole argument for hooking the transport: a 429 never
    // reaches `record()`, so no usage-time hook could ever see these headers.
    absorbRateLimitHeaders(
      headers({ ...FULL, 'anthropic-ratelimit-output-tokens-remaining': '0' }),
      429,
    );
    expect(getRateLimitSnapshot()).toMatchObject({
      outputTokensRemaining: 0,
      observedStatus: 429,
    });
  });

  it('does NOT blank a good reading when a response carries no rate-limit headers', () => {
    absorbRateLimitHeaders(headers(FULL), 200);
    // A proxy error page, a 502 from the edge, a CORS preflight — none of these
    // are observations, and treating them as one would erase real data.
    absorbRateLimitHeaders(headers({ 'content-type': 'text/html' }), 502);
    expect(getRateLimitSnapshot()).toMatchObject({
      outputTokensRemaining: 18000,
      observedStatus: 200,
    });
  });

  it('treats an unparseable counter as unknown, not as zero', () => {
    absorbRateLimitHeaders(
      headers({ ...FULL, 'anthropic-ratelimit-output-tokens-remaining': 'n/a' }),
      200,
    );
    expect(getRateLimitSnapshot().outputTokensRemaining).toBeNull();
  });

  it('hands back a copy — a caller cannot corrupt the shared gauge', () => {
    absorbRateLimitHeaders(headers(FULL), 200);
    const first = getRateLimitSnapshot();
    first.outputTokensRemaining = -1;
    expect(getRateLimitSnapshot().outputTokensRemaining).toBe(18000);
  });
});

describe('observeRateLimits', () => {
  beforeEach(() => resetRateLimitSnapshot());

  it('returns the response untouched and records the headers', async () => {
    const body = new Response('hello', { status: 200, headers: FULL });
    const wrapped = observeRateLimits(async () => body);
    const out = await wrapped('https://api.anthropic.com/v1/messages');
    // Identity, not equality: the body must not be cloned or buffered, or
    // streaming breaks.
    expect(out).toBe(body);
    expect(await out.text()).toBe('hello');
    expect(getRateLimitSnapshot().outputTokensRemaining).toBe(18000);
  });

  it('never fails a call when observation throws', async () => {
    const hostile = {
      status: 200,
      get headers(): Headers {
        throw new Error('boom');
      },
    } as unknown as Response;
    const wrapped = observeRateLimits(async () => hostile);
    await expect(wrapped('https://api.anthropic.com/v1/messages')).resolves.toBe(hostile);
  });

  it('propagates a transport rejection unchanged', async () => {
    const wrapped = observeRateLimits(async () => {
      throw new Error('ECONNRESET');
    });
    await expect(wrapped('https://api.anthropic.com/v1/messages')).rejects.toThrow('ECONNRESET');
  });

  it('composes rather than replaces a caller-supplied transport', async () => {
    const inner = jest.fn(async () => new Response('', { status: 200, headers: FULL }));
    await observeRateLimits(inner)('https://api.anthropic.com/v1/messages', { method: 'POST' });
    expect(inner).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', {
      method: 'POST',
    });
  });
});
