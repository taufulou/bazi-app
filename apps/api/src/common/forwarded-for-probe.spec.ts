import {
  createForwardedForProbe,
  forwardedForProbeEnabled,
  maskAddress,
  readForwardedFor,
  MAX_PROBE_REQUESTS,
} from './forwarded-for-probe';

const req = (xff?: string | string[], socket = '10.0.0.7', ip = '10.0.0.7') =>
  ({
    headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
    socket: { remoteAddress: socket },
    ip,
    path: '/api/users/me',
  }) as never;

describe('forwarded-for probe (M1b)', () => {
  const saved = process.env.LOG_FORWARDED_FOR;
  afterEach(() => {
    if (saved === undefined) delete process.env.LOG_FORWARDED_FOR;
    else process.env.LOG_FORWARDED_FOR = saved;
  });

  describe('address masking', () => {
    it('keeps the network portion and drops the host', () => {
      // Enough to recognise your own request; not a log of who called.
      expect(maskAddress('203.0.113.42')).toBe('203.0.113.x');
      expect(maskAddress('  198.51.100.9 ')).toBe('198.51.100.x');
    });

    it('masks IPv6 without mangling it', () => {
      expect(maskAddress('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:x');
      expect(maskAddress('::1')).toBe('::1:x');
    });

    it('handles empty and odd values rather than throwing', () => {
      expect(maskAddress('')).toBe('(empty)');
      expect(maskAddress('garbage')).toBe('garbage');
    });
  });

  describe('reading the chain', () => {
    it('counts the entries — the number the hop count comes from', () => {
      const r = readForwardedFor(req('203.0.113.42, 70.41.3.18'));
      expect(r.received).toBe(2);
      expect(r.chain).toEqual(['203.0.113.x', '70.41.3.x']);
    });

    it('reports zero when the edge sends no header at all', () => {
      const r = readForwardedFor(req(undefined));
      expect(r.received).toBe(0);
      expect(r.chain).toEqual([]);
    });

    it('joins a repeated header, as Node presents it', () => {
      expect(readForwardedFor(req(['203.0.113.42', '70.41.3.18'])).received).toBe(2);
    });

    it('ignores empty segments from a trailing comma', () => {
      expect(readForwardedFor(req('203.0.113.42, ,')).received).toBe(1);
    });
  });

  describe('the cap', () => {
    it('stops logging after MAX_PROBE_REQUESTS, so a forgotten flag is bounded', () => {
      const lines: string[] = [];
      const mw = createForwardedForProbe((m) => lines.push(m));
      for (let i = 0; i < MAX_PROBE_REQUESTS + 10; i++) mw(req('1.2.3.4'), {} as never, () => undefined);
      // N probe lines plus the single "cap reached" notice.
      expect(lines).toHaveLength(MAX_PROBE_REQUESTS + 1);
      expect(lines[lines.length - 1]).toContain('cap reached');
    });

    it('always calls next(), capped or not', () => {
      const mw = createForwardedForProbe(() => undefined);
      let called = 0;
      for (let i = 0; i < MAX_PROBE_REQUESTS + 3; i++) mw(req('1.2.3.4'), {} as never, () => { called += 1; });
      // A diagnostic that swallowed requests would be far worse than the gap
      // it exists to close.
      expect(called).toBe(MAX_PROBE_REQUESTS + 3);
    });
  });

  describe('the flag', () => {
    it('is off unless explicitly enabled', () => {
      for (const v of ['0', 'false', '', 'no']) {
        process.env.LOG_FORWARDED_FOR = v;
        expect(forwardedForProbeEnabled()).toBe(false);
      }
      delete process.env.LOG_FORWARDED_FOR;
      expect(forwardedForProbeEnabled()).toBe(false);
    });

    it('accepts the usual truthy spellings', () => {
      for (const v of ['1', 'true', 'YES', 'on']) {
        process.env.LOG_FORWARDED_FOR = v;
        expect(forwardedForProbeEnabled()).toBe(true);
      }
    });
  });

  it('never logs a full address', () => {
    const lines: string[] = [];
    const mw = createForwardedForProbe((m) => lines.push(m));
    mw(req('203.0.113.42, 70.41.3.18', '10.1.2.3', '203.0.113.42'), {} as never, () => undefined);
    const joined = lines.join('\n');
    for (const full of ['203.0.113.42', '70.41.3.18', '10.1.2.3']) {
      expect(joined).not.toContain(full);
    }
    expect(joined).toContain('received=2');
  });
});
