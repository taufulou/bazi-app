import { Logger } from '@nestjs/common';
import {
  ENGINE_CALLERS,
  ENGINE_CALLER_HEADER,
  ENGINE_KEY_HEADER,
  ENGINE_REQUEST_ID_HEADER,
  buildEngineHeaders,
  engineFetch,
  resetEngineKeyWarningForTests,
  resolveEngineKey,
} from '../src/common/engine-client';

const KEY = 'k'.repeat(43);
const OTHER = 'z'.repeat(43);

describe('B3-a engine client', () => {
  const saved = { ENGINE_KEY: process.env.ENGINE_KEY, ENGINE_KEYS: process.env.ENGINE_KEYS };

  beforeEach(() => {
    delete process.env.ENGINE_KEY;
    delete process.env.ENGINE_KEYS;
    resetEngineKeyWarningForTests();
  });

  afterAll(() => {
    if (saved.ENGINE_KEY === undefined) delete process.env.ENGINE_KEY;
    else process.env.ENGINE_KEY = saved.ENGINE_KEY;
    if (saved.ENGINE_KEYS === undefined) delete process.env.ENGINE_KEYS;
    else process.env.ENGINE_KEYS = saved.ENGINE_KEYS;
  });

  describe('resolveEngineKey', () => {
    it('prefers ENGINE_KEY', () => {
      expect(resolveEngineKey({ ENGINE_KEY: KEY, ENGINE_KEYS: OTHER })).toBe(KEY);
    });

    it('falls back to the first entry of ENGINE_KEYS', () => {
      // Setting the engine's LIST variable on the API service by mistake should
      // degrade to "sends the first key", not to "sends nothing" — which would
      // be silent until the enforce flip 401'd everything.
      expect(resolveEngineKey({ ENGINE_KEYS: `${KEY}, ${OTHER}` })).toBe(KEY);
    });

    it('trims surrounding whitespace', () => {
      expect(resolveEngineKey({ ENGINE_KEY: `  ${KEY}  ` })).toBe(KEY);
    });

    it('is empty when neither is set', () => {
      expect(resolveEngineKey({})).toBe('');
    });

    it('treats a whitespace-only value as unset', () => {
      expect(resolveEngineKey({ ENGINE_KEY: '   ' })).toBe('');
    });
  });

  describe('buildEngineHeaders', () => {
    it('attaches the key when configured', () => {
      process.env.ENGINE_KEY = KEY;
      expect(buildEngineHeaders({ caller: 'bazi.reading' })[ENGINE_KEY_HEADER]).toBe(KEY);
    });

    it('omits the header entirely when unset rather than sending an empty one', () => {
      // An empty `X-Engine-Key` would be counted as `invalid` by the engine —
      // "someone is sending a wrong key" — instead of `absent`, which is what
      // an unkeyed caller actually is. The two drive different responses.
      expect(buildEngineHeaders({ caller: 'bazi.reading' })).not.toHaveProperty(
        ENGINE_KEY_HEADER,
      );
    });

    it('always names the caller', () => {
      expect(buildEngineHeaders({ caller: 'fortune.daily' })[ENGINE_CALLER_HEADER]).toBe(
        'fortune.daily',
      );
    });

    it('generates a distinct request id per call', () => {
      const a = buildEngineHeaders({ caller: 'bazi.reading' })[ENGINE_REQUEST_ID_HEADER];
      const b = buildEngineHeaders({ caller: 'bazi.reading' })[ENGINE_REQUEST_ID_HEADER];
      expect(a).toBeTruthy();
      expect(a).not.toBe(b);
    });

    it('reuses a supplied request id', () => {
      const headers = buildEngineHeaders({ caller: 'bazi.reading', requestId: 'req-7' });
      expect(headers[ENGINE_REQUEST_ID_HEADER]).toBe('req-7');
    });

    it('merges call-site headers', () => {
      const headers = buildEngineHeaders({
        caller: 'bazi.reading',
        extra: { 'Content-Type': 'application/json' },
      });
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers[ENGINE_CALLER_HEADER]).toBe('bazi.reading');
    });

    it('every caller name survives the engine label charset', () => {
      // Iterates the REAL exported const. The earlier version declared its own
      // copy of the names and checked that — so adding `'bazi reading v2'` to
      // the production union passed, while the engine rewrote it on arrival to
      // `bazi_reading_v2`: precisely the failure this test is named for.
      expect(ENGINE_CALLERS.length).toBeGreaterThan(0);
      for (const c of ENGINE_CALLERS) {
        expect(c).toMatch(/^[A-Za-z0-9._/-]{1,48}$/);
      }
    });

    it('caller names are unique', () => {
      // Two sites sharing a name collapse into one rollup row, and B3-b's
      // per-caller coverage question becomes unanswerable for both.
      expect(new Set(ENGINE_CALLERS).size).toBe(ENGINE_CALLERS.length);
    });
  });

  describe('missing-key warning', () => {
    // This warning is the ONLY signal on the API side that we are calling the
    // engine unkeyed. Nothing asserted it before, so deleting it left 27 tests
    // green and the caller-side failure mode silent.
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => warn.mockRestore());

    it('warns when no key is configured', () => {
      buildEngineHeaders({ caller: 'bazi.reading' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('ENGINE_KEY');
    });

    it('warns only once per process', () => {
      buildEngineHeaders({ caller: 'bazi.reading' });
      buildEngineHeaders({ caller: 'fortune.daily' });
      buildEngineHeaders({ caller: 'chat.context' });
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('stays silent when a key is configured', () => {
      process.env.ENGINE_KEY = KEY;
      buildEngineHeaders({ caller: 'bazi.reading' });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('engineFetch', () => {
    const originalFetch = global.fetch;
    let calls: Array<[string, RequestInit]>;

    beforeEach(() => {
      calls = [];
      global.fetch = jest.fn(async (url: unknown, init: unknown) => {
        calls.push([String(url), init as RequestInit]);
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('sends the key and caller', async () => {
      process.env.ENGINE_KEY = KEY;
      await engineFetch('http://engine/calculate', {
        method: 'POST',
        caller: 'bazi.reading',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const [url, init] = calls[0];
      const headers = init.headers as Record<string, string>;
      expect(url).toBe('http://engine/calculate');
      expect(headers[ENGINE_KEY_HEADER]).toBe(KEY);
      expect(headers[ENGINE_CALLER_HEADER]).toBe('bazi.reading');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('passes method, body and signal through untouched', async () => {
      const signal = AbortSignal.timeout(1000);
      await engineFetch('http://engine/daily-fortune', {
        method: 'POST',
        caller: 'fortune.daily',
        body: '{"a":1}',
        signal,
      });
      const [, init] = calls[0];
      expect(init.method).toBe('POST');
      expect(init.body).toBe('{"a":1}');
      expect(init.signal).toBe(signal);
    });

    it('does not leak `caller` into the request init', async () => {
      await engineFetch('http://engine/calculate', { method: 'POST', caller: 'bazi.reading' });
      expect(calls[0][1]).not.toHaveProperty('caller');
      expect(calls[0][1]).not.toHaveProperty('requestId');
    });

    it('returns non-2xx responses instead of throwing', async () => {
      // Call sites own their own error mapping (502 vs 422 vs pass-through). A
      // helper that threw here would change failure behaviour at eleven sites.
      global.fetch = jest.fn(async () => new Response('nope', { status: 401 })) as never;
      const res = await engineFetch('http://engine/calculate', {
        method: 'POST',
        caller: 'bazi.reading',
      });
      expect(res.status).toBe(401);
    });

    it('propagates a network rejection unchanged', async () => {
      global.fetch = jest.fn(async () => {
        throw new TypeError('fetch failed');
      }) as never;
      await expect(
        engineFetch('http://engine/calculate', { method: 'POST', caller: 'bazi.reading' }),
      ).rejects.toThrow('fetch failed');
    });
  });
});
