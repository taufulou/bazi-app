/**
 * M6 — graceful shutdown.
 *
 * The timing constants are module-level and read `process.env` at import, so
 * every test here loads the module through `jest.isolateModules` with short
 * values. Using the real 3s/10s defaults would make this suite take a minute
 * and would tell us nothing extra.
 */

type ShutdownServiceType = import('./shutdown.service').ShutdownService;

const FAST_ENV = {
  SHUTDOWN_DRAIN_DELAY_MS: '20',
  SHUTDOWN_STREAM_GRACE_MS: '120',
  SHUTDOWN_SETTLE_MS: '10',
};

function loadService(env: Record<string, string> = FAST_ENV): ShutdownServiceType {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  let instance!: ShutdownServiceType;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ShutdownService } = require('./shutdown.service');
    instance = new ShutdownService();
  });
  process.env = saved;
  return instance;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ShutdownService', () => {
  describe('readiness flag', () => {
    it('is false before shutdown and true immediately after SIGTERM begins', async () => {
      const svc = loadService();
      expect(svc.isShuttingDown).toBe(false);

      const done = svc.drain('SIGTERM');
      // Not awaited: the flag must flip synchronously, BEFORE the drain waits.
      // If it only flipped at the end, the load balancer would keep routing to
      // us for the whole drain — the exact failure this class exists to fix.
      expect(svc.isShuttingDown).toBe(true);
      await done;
    });
  });

  describe('programmatic close vs real signal', () => {
    it('skips the drain entirely when no signal name is given', async () => {
      const svc = loadService({
        SHUTDOWN_DRAIN_DELAY_MS: '2000',
        SHUTDOWN_STREAM_GRACE_MS: '2000',
        SHUTDOWN_SETTLE_MS: '2000',
      });
      const started = Date.now();
      await svc.drain(); // app.close() — what tests do
      // Guards the discriminator. If this regressed to always draining, every
      // `app.close()` in the suite would pay seconds.
      expect(Date.now() - started).toBeLessThan(500);
    });

    it('waits the drain delay on a real signal', async () => {
      const svc = loadService({
        SHUTDOWN_DRAIN_DELAY_MS: '120',
        SHUTDOWN_STREAM_GRACE_MS: '0',
        SHUTDOWN_SETTLE_MS: '0',
      });
      const started = Date.now();
      await svc.drain('SIGTERM');
      expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    });

    it('is idempotent — a second call does not drain again', async () => {
      const svc = loadService();
      await svc.drain('SIGTERM');
      const started = Date.now();
      await svc.drain('SIGTERM');
      expect(Date.now() - started).toBeLessThan(20);
    });
  });

  describe('stream registration', () => {
    it('aborts a stream that outlives the grace window', async () => {
      const svc = loadService();
      const abort = jest.fn();
      svc.registerStream(abort);

      expect(svc.activeStreamCount).toBe(1);
      await svc.drain('SIGTERM');
      expect(abort).toHaveBeenCalledTimes(1);
      expect(svc.activeStreamCount).toBe(0);
    });

    it('returns early once the last stream finishes, without burning the grace', async () => {
      const svc = loadService({
        SHUTDOWN_DRAIN_DELAY_MS: '0',
        SHUTDOWN_STREAM_GRACE_MS: '3000',
        SHUTDOWN_SETTLE_MS: '0',
      });
      const abort = jest.fn();
      const release = svc.registerStream(abort);

      const started = Date.now();
      const done = svc.drain('SIGTERM');
      setTimeout(release, 60); // stream finishes on its own
      await done;

      // The point of polling rather than a flat sleep: a fast drain is fast.
      expect(Date.now() - started).toBeLessThan(1500);
      // And a stream that ended must NOT be aborted afterwards.
      expect(abort).not.toHaveBeenCalled();
    });

    it('does not abort a released stream', async () => {
      const svc = loadService();
      const abort = jest.fn();
      svc.registerStream(abort)();
      expect(svc.activeStreamCount).toBe(0);
      await svc.drain('SIGTERM');
      expect(abort).not.toHaveBeenCalled();
    });

    it('release is idempotent and cannot corrupt the count', () => {
      const svc = loadService();
      const other = svc.registerStream(jest.fn());
      const release = svc.registerStream(jest.fn());
      release();
      release();
      release();
      expect(svc.activeStreamCount).toBe(1);
      other();
      expect(svc.activeStreamCount).toBe(0);
    });

    it('aborts immediately when a stream registers AFTER shutdown began', async () => {
      const svc = loadService();
      await svc.drain('SIGTERM');

      const abort = jest.fn();
      const release = svc.registerStream(abort);
      // Otherwise a request that slipped past the readiness flip would sit in a
      // set nothing will ever drain again.
      expect(abort).toHaveBeenCalledTimes(1);
      expect(svc.activeStreamCount).toBe(0);
      expect(() => release()).not.toThrow();
    });

    it('one throwing abort does not strand the others or reject the hook', async () => {
      const svc = loadService();
      const ok1 = jest.fn();
      const ok2 = jest.fn();
      svc.registerStream(ok1);
      svc.registerStream(() => {
        throw new Error('stream blew up on abort');
      });
      svc.registerStream(ok2);

      await expect(svc.drain('SIGTERM')).resolves.toBeUndefined();
      expect(ok1).toHaveBeenCalledTimes(1);
      expect(ok2).toHaveBeenCalledTimes(1);
    });
  });

  describe('shared signal', () => {
    it('is unaborted before shutdown and aborted after', async () => {
      const svc = loadService();
      expect(svc.signal.aborted).toBe(false);
      await svc.drain('SIGTERM');
      expect(svc.signal.aborted).toBe(true);
    });
  });

  describe('env parsing', () => {
    it('falls back to the default on a garbage value rather than disabling the drain', async () => {
      const svc = loadService({
        SHUTDOWN_DRAIN_DELAY_MS: 'not-a-number',
        SHUTDOWN_STREAM_GRACE_MS: '-5',
        SHUTDOWN_SETTLE_MS: '0',
      });
      // Both bad values must have fallen back to the real defaults (3s / 10s),
      // so a signal-driven drain is slow. Asserting on the observable delay
      // rather than the constants keeps this honest if the defaults change.
      const started = Date.now();
      const done = svc.drain('SIGTERM');
      await sleep(200);
      expect(svc.isShuttingDown).toBe(true);
      expect(Date.now() - started).toBeLessThan(3_000); // still draining
      await done;
      expect(Date.now() - started).toBeGreaterThanOrEqual(3_000);
    }, 20_000);
  });
});
