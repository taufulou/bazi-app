import { ShutdownService } from './shutdown.service';

/**
 * M6 — graceful shutdown.
 *
 * The timing knobs are read at CALL time, so these tests set `process.env`
 * directly and construct the service normally. An earlier version read them at
 * module scope and the suite had to load the module through
 * `jest.isolateModules` to vary them — which is precisely why the bug was
 * invisible: the tests were compensating for it.
 */

const TIMING_KEYS = [
  'SHUTDOWN_DRAIN_DELAY_MS',
  'SHUTDOWN_STREAM_GRACE_MS',
  'SHUTDOWN_POST_ABORT_GRACE_MS',
  'SHUTDOWN_SETTLE_MS',
] as const;

const FAST = {
  SHUTDOWN_DRAIN_DELAY_MS: '20',
  SHUTDOWN_STREAM_GRACE_MS: '120',
  SHUTDOWN_POST_ABORT_GRACE_MS: '120',
  SHUTDOWN_SETTLE_MS: '10',
};

function setEnv(env: Record<string, string>) {
  for (const k of TIMING_KEYS) delete process.env[k];
  Object.assign(process.env, env);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ShutdownService', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of TIMING_KEYS) delete process.env[k];
    Object.assign(process.env, saved);
  });

  describe('configuration is read lazily', () => {
    it('honours env set AFTER the service is constructed', async () => {
      // Regression lock. When these were module-scope consts, a value coming
      // from `.env` (loaded by ConfigModule during bootstrap, i.e. after this
      // module is imported) was ignored — working in production and silently
      // not in local dev.
      setEnv({});
      const svc = new ShutdownService();
      setEnv({ ...FAST, SHUTDOWN_DRAIN_DELAY_MS: '0', SHUTDOWN_SETTLE_MS: '0' });

      const started = Date.now();
      await svc.drain('SIGTERM');
      // With the old module-scope read this would have paid the 3s default.
      expect(Date.now() - started).toBeLessThan(1_000);
    });

    it('falls back to the real defaults on garbage rather than disabling the drain', async () => {
      setEnv({
        SHUTDOWN_DRAIN_DELAY_MS: 'not-a-number',
        SHUTDOWN_STREAM_GRACE_MS: '-5',
        SHUTDOWN_SETTLE_MS: '0',
      });
      const svc = new ShutdownService();
      const started = Date.now();
      const done = svc.drain('SIGTERM');
      await sleep(200);
      expect(svc.isShuttingDown).toBe(true);
      expect(Date.now() - started).toBeLessThan(3_000); // still in the 3s default
      await done;
      expect(Date.now() - started).toBeGreaterThanOrEqual(3_000);
    }, 20_000);
  });

  describe('readiness flag', () => {
    it('flips synchronously, before any waiting', async () => {
      setEnv(FAST);
      const svc = new ShutdownService();
      expect(svc.isShuttingDown).toBe(false);
      const done = svc.drain('SIGTERM');
      // Not awaited: if the flag only flipped at the end, the load balancer
      // would keep routing here for the whole drain.
      expect(svc.isShuttingDown).toBe(true);
      await done;
    });
  });

  describe('programmatic close vs real signal', () => {
    it('skips the drain entirely when no signal name is given', async () => {
      setEnv({
        SHUTDOWN_DRAIN_DELAY_MS: '2000',
        SHUTDOWN_STREAM_GRACE_MS: '2000',
        SHUTDOWN_SETTLE_MS: '2000',
      });
      const svc = new ShutdownService();
      const started = Date.now();
      await svc.drain(); // app.close() — what tests do
      expect(Date.now() - started).toBeLessThan(500);
    });

    it('waits the drain delay on a real signal', async () => {
      setEnv({ ...FAST, SHUTDOWN_DRAIN_DELAY_MS: '120', SHUTDOWN_STREAM_GRACE_MS: '0' });
      const svc = new ShutdownService();
      const started = Date.now();
      await svc.drain('SIGTERM');
      expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    });

    it('is idempotent — a second call does not drain again', async () => {
      setEnv(FAST);
      const svc = new ShutdownService();
      await svc.drain('SIGTERM');
      const started = Date.now();
      await svc.drain('SIGTERM');
      expect(Date.now() - started).toBeLessThan(20);
    });
  });

  describe('stream registration', () => {
    it('aborts a stream that outlives the grace window', async () => {
      setEnv(FAST);
      const svc = new ShutdownService();
      const abort = jest.fn();
      svc.registerStream(abort);
      expect(svc.activeStreamCount).toBe(1);
      await svc.drain('SIGTERM');
      expect(abort).toHaveBeenCalledTimes(1);
      expect(svc.activeStreamCount).toBe(0);
    });

    it('returns early once the last stream finishes, without burning the grace', async () => {
      setEnv({ ...FAST, SHUTDOWN_DRAIN_DELAY_MS: '0', SHUTDOWN_STREAM_GRACE_MS: '3000' });
      const svc = new ShutdownService();
      const abort = jest.fn();
      const release = svc.registerStream(abort);

      const started = Date.now();
      const done = svc.drain('SIGTERM');
      setTimeout(release, 60);
      await done;

      expect(Date.now() - started).toBeLessThan(1_500);
      expect(abort).not.toHaveBeenCalled();
    });

    it('does not abort a released stream', async () => {
      setEnv(FAST);
      const svc = new ShutdownService();
      const abort = jest.fn();
      svc.registerStream(abort)();
      expect(svc.activeStreamCount).toBe(0);
      await svc.drain('SIGTERM');
      expect(abort).not.toHaveBeenCalled();
    });

    it('release is idempotent and cannot corrupt the count', () => {
      setEnv(FAST);
      const svc = new ShutdownService();
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
      setEnv(FAST);
      const svc = new ShutdownService();
      await svc.drain('SIGTERM');
      const abort = jest.fn();
      const release = svc.registerStream(abort);
      expect(abort).toHaveBeenCalledTimes(1);
      expect(svc.activeStreamCount).toBe(0);
      expect(() => release()).not.toThrow();
    });

    it('one throwing abort does not strand the others or reject the drain', async () => {
      setEnv(FAST);
      const svc = new ShutdownService();
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

  describe('post-abort cleanup window', () => {
    it('WAITS for an aborted stream to finish persisting before returning', async () => {
      // The bug this locks: aborting a stream is what STARTS its Prisma/Redis
      // writes. The first version aborted, cleared the registry and slept a
      // flat 500ms, so `app.close()` disconnected the pool mid-write.
      setEnv({
        SHUTDOWN_DRAIN_DELAY_MS: '0',
        SHUTDOWN_STREAM_GRACE_MS: '30',
        SHUTDOWN_POST_ABORT_GRACE_MS: '3000',
        SHUTDOWN_SETTLE_MS: '0',
      });
      const svc = new ShutdownService();
      let persistDone = false;
      // Held in an object because the abort callback must call the release the
      // same statement produces.
      const holder: { release?: () => void } = {};
      holder.release = svc.registerStream(() => {
        // Mimic a real stream: the abort kicks off async cleanup, and only
        // when that finishes does the `finally` release the registration.
        setTimeout(() => {
          persistDone = true;
          holder.release!();
        }, 150);
      });

      await svc.drain('SIGTERM');
      expect(persistDone).toBe(true);
    });

    it('does not clear the registry before that wait', async () => {
      setEnv({
        SHUTDOWN_DRAIN_DELAY_MS: '0',
        SHUTDOWN_STREAM_GRACE_MS: '30',
        SHUTDOWN_POST_ABORT_GRACE_MS: '3000',
        SHUTDOWN_SETTLE_MS: '0',
      });
      const svc = new ShutdownService();
      const countsSeen: number[] = [];
      const holder: { release?: () => void } = {};
      holder.release = svc.registerStream(() => {
        setTimeout(() => {
          // If the registry had been cleared at abort time, this would be 0
          // and the drain would already have moved on.
          countsSeen.push(svc.activeStreamCount);
          holder.release!();
        }, 80);
      });

      await svc.drain('SIGTERM');
      expect(countsSeen).toEqual([1]);
    });

    it('gives up after the post-abort grace rather than hanging', async () => {
      setEnv({
        SHUTDOWN_DRAIN_DELAY_MS: '0',
        SHUTDOWN_STREAM_GRACE_MS: '20',
        SHUTDOWN_POST_ABORT_GRACE_MS: '120',
        SHUTDOWN_SETTLE_MS: '0',
      });
      const svc = new ShutdownService();
      svc.registerStream(() => undefined); // never releases

      const started = Date.now();
      await svc.drain('SIGTERM');
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(120); // waited the grace
      expect(elapsed).toBeLessThan(2_000); // but bounded
      expect(svc.activeStreamCount).toBe(0); // straggler cleared at the end
    });

    it('skips the post-abort wait entirely when nothing needed aborting', async () => {
      setEnv({
        SHUTDOWN_DRAIN_DELAY_MS: '0',
        SHUTDOWN_STREAM_GRACE_MS: '20',
        SHUTDOWN_POST_ABORT_GRACE_MS: '3000',
        SHUTDOWN_SETTLE_MS: '0',
      });
      const svc = new ShutdownService();
      const started = Date.now();
      await svc.drain('SIGTERM');
      // A quiet instance must not pay the post-abort budget.
      expect(Date.now() - started).toBeLessThan(500);
    });
  });

  describe('shared signal', () => {
    it('is unaborted before shutdown and aborted after', async () => {
      setEnv(FAST);
      const svc = new ShutdownService();
      expect(svc.signal.aborted).toBe(false);
      await svc.drain('SIGTERM');
      expect(svc.signal.aborted).toBe(true);
    });

    it('is aborted on a programmatic close too', async () => {
      setEnv(FAST);
      const svc = new ShutdownService();
      await svc.drain();
      expect(svc.signal.aborted).toBe(true);
    });
  });
});
