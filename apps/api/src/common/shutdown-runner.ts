/**
 * M6 — the signal-handling half of graceful shutdown.
 *
 * Extracted from `bootstrap()` because everything interesting about it is a
 * failure path — a wedged `app.close()`, a second Ctrl-C, a non-zero exit —
 * and none of that is reachable from a test while it lives inline in a
 * function that calls itself at import time. `main.ts` had zero tests, so the
 * three defects an audit found here (no close timeout, swallowed second
 * signal, `exit(0)` on failure) were all invisible to the suite.
 *
 * Every side effect is injected, so a test can assert the sequence without
 * actually killing the process.
 */

export interface ShutdownRunnerDeps {
  /** `ShutdownService.drain` — flips readiness, waits, aborts, waits again. */
  drain: (signal: string) => Promise<void>;
  /** `app.close()` — runs Nest's lifecycle hooks and closes the server. */
  closeApp: () => Promise<void>;
  /**
   * `server.closeIdleConnections()` where available.
   *
   * ⚠️ Without this, `server.close()` waits on EVERY open connection, and an
   * idle keep-alive socket — the steady state for any browser or mobile client
   * — keeps it pending for ever. Draining the streams does not help: those
   * sockets have no request in flight. Optional because the method only exists
   * on Node >= 18.2.
   */
  closeIdleConnections?: () => void;
  exit: (code: number) => void;
  /** Best-effort flush of buffered stdout/stderr and the Sentry queue. */
  flush: () => Promise<void>;
  logger: { warn(message: string): void; error(message: string): void };
  /** Hard ceiling on the whole sequence, drain included. */
  hardExitMs: number;
  /** Injectable purely so tests need not wait real seconds. */
  schedule?: (fn: () => void, ms: number) => { cancel: () => void };
}

const defaultSchedule = (fn: () => void, ms: number) => {
  // NOT unref'd: this is the backstop for a wedged close, so it has to be able
  // to fire when nothing else is keeping the loop alive.
  const t = setTimeout(fn, ms);
  return { cancel: () => clearTimeout(t) };
};

/**
 * Returns the signal handler. The returned function is safe to register for
 * several signals — the first one wins and the rest escalate.
 */
export function createShutdownHandler(deps: ShutdownRunnerDeps): (signal: string) => void {
  const schedule = deps.schedule ?? defaultSchedule;
  let closing = false;

  return (signal: string) => {
    if (closing) {
      // ⚠️ ESCALATE, do not ignore. The drain can legitimately run ~19s, and
      // if `closeApp()` wedges there is nothing left to interrupt it — an
      // operator whose second Ctrl-C did nothing is reaching for `kill -9`
      // from another terminal. 130 is the conventional SIGINT exit code.
      deps.logger.warn(`${signal} received again — abandoning graceful shutdown`);
      deps.exit(130);
      return;
    }
    closing = true;

    void (async () => {
      let exitCode = 0;
      const hardExit = schedule(() => {
        deps.logger.error(
          `Shutdown exceeded ${deps.hardExitMs}ms — forcing exit; ` +
            `in-flight cleanup may be incomplete`,
        );
        deps.exit(1);
      }, deps.hardExitMs);

      try {
        await deps.drain(signal);
        // Must precede the close, or the close may never resolve.
        deps.closeIdleConnections?.();
        await deps.closeApp();
      } catch (err) {
        deps.logger.error(
          `Shutdown failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        // ⚠️ Non-zero. Exiting 0 after a failed shutdown tells the platform the
        // container stopped cleanly, so nothing alerts and the failure is
        // invisible.
        exitCode = 1;
      } finally {
        hardExit.cancel();
        // ⚠️ `process.exit()` does NOT flush pending async writes. stdout is a
        // pipe in every container, so the drain's own "Drain complete" line —
        // the documented way to confirm M6 worked — can be lost exactly when
        // someone is reading for it. Same for queued Sentry events.
        await deps.flush();
        deps.exit(exitCode);
      }
    })();
  };
}

/**
 * Hard ceiling on the whole shutdown. Must sit ABOVE the drain's own worst
 * case (~19s at default settings) and BELOW the platform's SIGKILL deadline,
 * so a wedged close is caught by us rather than by the platform.
 */
export function shutdownHardExitMs(): number {
  const n = Number(process.env.SHUTDOWN_HARD_EXIT_MS ?? '');
  return Number.isFinite(n) && n > 0 ? n : 25_000;
}
