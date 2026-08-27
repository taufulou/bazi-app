import { createShutdownHandler, shutdownHardExitMs, ShutdownRunnerDeps } from './shutdown-runner';

/**
 * M6 — the three defects an audit found in the signal handler were all
 * failure-path behaviour that `main.ts` made untestable. These lock them.
 */

const flushed = () => new Promise((r) => setTimeout(r, 0));

function build(over: Partial<ShutdownRunnerDeps> = {}) {
  const order: string[] = [];
  const exits: number[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  let fireHardExit: (() => void) | null = null;
  let cancelled = false;

  const deps: ShutdownRunnerDeps = {
    drain: async (sig) => {
      order.push(`drain:${sig}`);
    },
    closeApp: async () => {
      order.push('closeApp');
    },
    closeIdleConnections: () => {
      order.push('closeIdleConnections');
    },
    exit: (code) => {
      order.push(`exit:${code}`);
      exits.push(code);
    },
    flush: async () => {
      order.push('flush');
    },
    logger: {
      warn: (m) => warns.push(m),
      error: (m) => errors.push(m),
    },
    hardExitMs: 25_000,
    // Captured rather than timed, so the watchdog can be fired deliberately.
    schedule: (fn) => {
      fireHardExit = fn;
      return {
        cancel: () => {
          cancelled = true;
        },
      };
    },
    ...over,
  };

  return {
    handler: createShutdownHandler(deps),
    order,
    exits,
    warns,
    errors,
    fire: () => fireHardExit?.(),
    wasCancelled: () => cancelled,
  };
}

describe('createShutdownHandler (M6)', () => {
  it('drains, closes idle sockets, closes the app, flushes, then exits 0', async () => {
    const h = build();
    h.handler('SIGTERM');
    await flushed();

    expect(h.order).toEqual([
      'drain:SIGTERM',
      // ⚠️ Before closeApp. `server.close()` waits on every open connection,
      // so one idle keep-alive socket would otherwise leave it pending for ever.
      'closeIdleConnections',
      'closeApp',
      // ⚠️ Before exit. `process.exit()` discards buffered stdout, which is a
      // pipe in every container — the "Drain complete" line would be lost.
      'flush',
      'exit:0',
    ]);
  });

  it('exits NON-ZERO when the close throws', async () => {
    const h = build({
      closeApp: async () => {
        throw new Error('close blew up');
      },
    });
    h.handler('SIGTERM');
    await flushed();

    // Exiting 0 after a failed shutdown tells the platform it stopped cleanly,
    // so nothing alerts and the failure never surfaces.
    expect(h.exits).toEqual([1]);
    expect(h.errors[0]).toContain('close blew up');
    // Still flushed — the error log is the thing you most want to survive.
    expect(h.order).toContain('flush');
  });

  it('exits non-zero when the DRAIN throws, not just the close', async () => {
    const h = build({
      drain: async () => {
        throw new Error('drain blew up');
      },
    });
    h.handler('SIGTERM');
    await flushed();
    expect(h.exits).toEqual([1]);
  });

  it('escalates on a second signal instead of ignoring it', async () => {
    const h = build({ closeApp: () => new Promise(() => undefined) }); // wedged
    h.handler('SIGTERM');
    await flushed();

    h.handler('SIGINT');
    // Swallowing this leaves an operator with no way out but `kill -9` from
    // another terminal.
    expect(h.exits).toEqual([130]);
    expect(h.warns[0]).toContain('again');
  });

  it('forces an exit when the close wedges past the hard budget', async () => {
    const h = build({ closeApp: () => new Promise(() => undefined) });
    h.handler('SIGTERM');
    await flushed();

    expect(h.exits).toEqual([]); // still waiting
    h.fire(); // the watchdog
    expect(h.exits).toEqual([1]);
    expect(h.errors[0]).toContain('exceeded 25000ms');
  });

  it('cancels the watchdog on the happy path', async () => {
    const h = build();
    h.handler('SIGTERM');
    await flushed();
    // A live timer would hold the loop open and could fire after a clean exit.
    expect(h.wasCancelled()).toBe(true);
  });

  it('tolerates a Node build without closeIdleConnections', async () => {
    const h = build({ closeIdleConnections: undefined });
    h.handler('SIGTERM');
    await flushed();
    expect(h.exits).toEqual([0]);
    expect(h.order).not.toContain('closeIdleConnections');
  });
});

describe('shutdownHardExitMs', () => {
  const saved = process.env.SHUTDOWN_HARD_EXIT_MS;
  afterEach(() => {
    if (saved === undefined) delete process.env.SHUTDOWN_HARD_EXIT_MS;
    else process.env.SHUTDOWN_HARD_EXIT_MS = saved;
  });

  it('defaults above the drain worst case (~19s) and below a 30s SIGKILL', () => {
    delete process.env.SHUTDOWN_HARD_EXIT_MS;
    const v = shutdownHardExitMs();
    expect(v).toBeGreaterThan(19_000);
    expect(v).toBeLessThan(30_000);
  });

  it('honours an override and rejects garbage', () => {
    process.env.SHUTDOWN_HARD_EXIT_MS = '5000';
    expect(shutdownHardExitMs()).toBe(5_000);
    for (const bad of ['abc', '0', '-1', '']) {
      process.env.SHUTDOWN_HARD_EXIT_MS = bad;
      expect(shutdownHardExitMs()).toBe(25_000);
    }
  });
});
