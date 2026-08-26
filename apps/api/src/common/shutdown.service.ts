import { Injectable, Logger, BeforeApplicationShutdown } from '@nestjs/common';

/**
 * M6 — graceful shutdown.
 *
 * ## Why this exists
 *
 * `app.enableShutdownHooks()` was already on, and on its own it is close to
 * useless here. It closes the HTTP server, and Node's `server.close()` waits
 * for in-flight requests — but an **SSE stream never ends on its own**. A
 * fortune or chat stream holds its socket open for 20-45s of token generation,
 * so `close()` blocks until Railway's SIGKILL lands and every open stream dies
 * as a TCP reset. The user loses a reading they paid credits for, and the
 * server never runs the persist path that would have salvaged it.
 *
 * Worse, without a readiness flip the load balancer keeps routing NEW requests
 * at an instance that is already closing, so a deploy produces a burst of
 * connection errors on top of the cut streams.
 *
 * ## The sequence
 *
 *   SIGTERM
 *     1. flip `isShuttingDown`  → /health/ready answers 503 immediately
 *     2. wait DRAIN_DELAY       → the LB observes the 503 and stops routing
 *     3. wait for active streams to drain, up to STREAM_GRACE
 *     4. abort whatever is left → each stream takes its OWN client-disconnect
 *                                 path, which already persists what is
 *                                 parseable and releases the AI slot
 *     5. settle, then let Nest close the server
 *
 * Step 4 is the reason this class holds abort callbacks rather than killing
 * sockets: the streaming services already have tested abort handling (watchdog
 * timeout, client disconnect). Reusing it means a shutdown-cut stream salvages
 * exactly as much as a browser-closed one, through code that is already
 * covered by specs.
 *
 * ## The budget must fit inside the platform's SIGKILL deadline
 *
 * Everything above is worthless if the process is killed mid-drain, so the
 * defaults are deliberately conservative: 3 + 10 + 0.5 ≈ **14s worst case**.
 * ⚠️ The exact Railway grace period is not verifiable from the codebase — if it
 * turns out to be shorter than ~20s, lower `SHUTDOWN_STREAM_GRACE_MS` rather
 * than discovering it as truncated drains. Step 3 exits early the moment the
 * last stream finishes, so the worst case is rare, not typical.
 */

/** Time for the load balancer to observe the 503 and stop routing to us. */
export const SHUTDOWN_DRAIN_DELAY_MS = envInt('SHUTDOWN_DRAIN_DELAY_MS', 3_000);

/** How long to let already-running streams finish before aborting them. */
export const SHUTDOWN_STREAM_GRACE_MS = envInt('SHUTDOWN_STREAM_GRACE_MS', 10_000);

/** Lets aborted streams flush their final SSE frame before the server closes. */
export const SHUTDOWN_SETTLE_MS = envInt('SHUTDOWN_SETTLE_MS', 500);

/** Poll interval while waiting for the active-stream count to reach zero. */
const DRAIN_POLL_MS = 250;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  // NaN / negative / non-finite all fall back rather than producing a zero or
  // an infinite wait. A typo'd env var must not silently disable the drain.
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

@Injectable()
export class ShutdownService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(ShutdownService.name);
  private shuttingDown = false;
  private readonly controller = new AbortController();
  private readonly activeStreams = new Set<() => void>();

  /**
   * Read by `ReadinessService`. True from the instant SIGTERM arrives, which
   * is what takes this instance out of rotation.
   */
  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /**
   * Aborts when the drain window expires. Combine it with a per-request
   * controller via `AbortSignal.any([...])` for non-stream work that should
   * also give up on shutdown.
   */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Active long-lived streams. Exposed for logging and tests. */
  get activeStreamCount(): number {
    return this.activeStreams.size;
  }

  /**
   * Register a running stream so shutdown can (a) wait for it and (b) abort it
   * if it outlives the grace window.
   *
   * ⚠️ The returned function MUST be called from the stream's `finally`.
   * Leaking a registration makes every future shutdown burn the full stream
   * grace waiting for something that already ended.
   *
   * If shutdown has ALREADY begun, `abort` is invoked immediately and the
   * stream is never added — otherwise a request that slipped past the readiness
   * flip would register into a set nobody will drain again.
   */
  registerStream(abort: () => void): () => void {
    if (this.shuttingDown) {
      this.safeAbort(abort);
      return () => undefined;
    }
    this.activeStreams.add(abort);
    let released = false;
    return () => {
      // Idempotent: a double-release must not corrupt the count.
      if (released) return;
      released = true;
      this.activeStreams.delete(abort);
    };
  }

  /**
   * Nest's `beforeApplicationShutdown` is the WRONG place to drain, which is
   * not obvious and cost an audit round to find. Measured hook order on close:
   *
   *   1. onModuleDestroy            ← PrismaService.$disconnect(), redis.quit()
   *   2. beforeApplicationShutdown  ← a drain here has no database left
   *   3. onApplicationShutdown
   *
   * So a drain hung off the hook would politely wait for streams to persist
   * into a disconnected pool and a closed Redis client (ioredis does not
   * auto-reconnect after an explicit `quit()`). `main.ts` therefore drives this
   * method from its own signal handler and only calls `app.close()` once it
   * resolves — draining first, tearing down second.
   *
   * `signal` is the OS signal name for a real SIGTERM/SIGINT and `undefined`
   * for a programmatic `app.close()`. That distinction is load-bearing: it is
   * what keeps the multi-second drain out of the test suite, where every
   * `app.close()` would otherwise pay for it.
   */
  async drain(signal?: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    if (!signal) {
      // Programmatic close (tests, or an explicit app.close()). Abort anything
      // still registered so nothing is left dangling, but skip the waits.
      this.abortAll();
      return;
    }

    const started = Date.now();
    this.logger.log(
      `${signal} received — draining (${this.activeStreams.size} active stream(s)); ` +
        `readiness now reports 503`,
    );

    await sleep(SHUTDOWN_DRAIN_DELAY_MS);
    await this.waitForStreams();

    const remaining = this.activeStreams.size;
    if (remaining > 0) {
      this.logger.warn(
        `${remaining} stream(s) still running after ${SHUTDOWN_STREAM_GRACE_MS}ms — ` +
          `aborting; each takes its own client-disconnect path and persists what it has`,
      );
    }
    this.abortAll();
    await sleep(SHUTDOWN_SETTLE_MS);

    this.logger.log(`Drain complete in ${Date.now() - started}ms — closing server`);
  }

  /** Resolves as soon as the last stream finishes, or when the grace expires. */
  private async waitForStreams(): Promise<void> {
    const deadline = Date.now() + SHUTDOWN_STREAM_GRACE_MS;
    while (this.activeStreams.size > 0 && Date.now() < deadline) {
      await sleep(Math.min(DRAIN_POLL_MS, Math.max(0, deadline - Date.now())));
    }
  }

  private abortAll(): void {
    // Snapshot first: an abort callback releases its registration, which
    // mutates the set we would otherwise be iterating.
    for (const abort of [...this.activeStreams]) this.safeAbort(abort);
    this.activeStreams.clear();
    if (!this.controller.signal.aborted) this.controller.abort();
  }

  /**
   * One stream throwing during abort must not strand the others, nor reject
   * the shutdown hook — Nest would log an unhandled rejection and carry on
   * closing anyway, having skipped the rest of the drain.
   */
  private safeAbort(abort: () => void): void {
    try {
      abort();
    } catch (err) {
      this.logger.warn(
        `Stream abort threw during shutdown: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Retained as a backstop for a programmatic `app.close()` (tests) and for any
   * path that closes the app without going through `main.ts`'s handler. On the
   * signal path `main.ts` has already called `drain`, so this returns at once
   * on the idempotency guard.
   */
  async beforeApplicationShutdown(signal?: string): Promise<void> {
    await this.drain(signal);
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  // Deliberately NOT unref'd. An unref'd timer lets Node exit if nothing else
  // is holding the loop open — which during shutdown is exactly the state we
  // are heading towards, so it would cut short the drain it is implementing.
  return new Promise((resolve) => setTimeout(resolve, ms));
}
