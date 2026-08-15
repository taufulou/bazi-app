import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';

/**
 * S1 — concurrency governor for AI generation.
 *
 * S2 caps how much we SPEND. This caps how much we spend AT ONCE, and the two
 * are not the same control: the spend breaker reads a counter that is only
 * updated when a call FINISHES, so between `assertUnderCap` and `record` there
 * is a blind window as long as the call itself — 60s for chat, up to 300s for a
 * compatibility reading. With unbounded concurrency, the overshoot inside that
 * window is unbounded too. The Phase-2A audit put it at roughly 2× the daily cap
 * at 200 concurrent readings, reachable by legitimate peak traffic.
 *
 * Bounding in-flight calls turns that into arithmetic: worst-case overshoot is
 * `pool size × cost per call`, which at 25 readings × ~$0.30 is under $8.
 *
 * ## Two pools, deliberately
 *
 * A single pool would let a burst of cheap chat turns starve reading generation,
 * or one slow batch of readings freeze every chat in the app. They have
 * different latencies (readings run tens of seconds and can afford to queue;
 * chat is interactive and must fail fast) so they get different budgets and
 * different queue behaviour.
 *
 * ## Why a slot is held for the WHOLE stream
 *
 * The resource being protected is an in-flight upstream request, which for SSE
 * lasts until the last token. Releasing at first-byte would let N slots admit
 * far more than N concurrent upstream calls — the number would look bounded and
 * not be.
 */

export type AiPool = 'reading' | 'interactive';

export const AI_BUSY_CODE = 'AI_BUSY';

interface PoolState {
  inFlight: number;
  waiters: Array<{ resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
  peak: number;
  admitted: number;
  rejected: number;
}

/** Defaults derived from budget, not rate limits — see the plan's S1 row. */
const DEFAULT_LIMITS: Record<AiPool, number> = { reading: 25, interactive: 40 };

/**
 * How long a caller waits for a slot before we give up.
 *
 * Readings already take tens of seconds, so a short queue is invisible next to
 * the work itself. Chat is interactive: a user staring at a composer would
 * rather be told we are busy than watch a spinner, so it fails fast.
 */
const QUEUE_TIMEOUT_MS: Record<AiPool, number> = { reading: 15_000, interactive: 3_000 };

@Injectable()
export class AiGovernorService {
  private readonly logger = new Logger(AiGovernorService.name);
  private readonly pools: Record<AiPool, PoolState> = {
    reading: { inFlight: 0, waiters: [], peak: 0, admitted: 0, rejected: 0 },
    interactive: { inFlight: 0, waiters: [], peak: 0, admitted: 0, rejected: 0 },
  };

  constructor(private readonly config: ConfigService) {}

  /** `0` disables the pool entirely — the documented rollback. */
  limitFor(pool: AiPool): number {
    const key = pool === 'reading' ? 'AI_MAX_CONCURRENT_READING' : 'AI_MAX_CONCURRENT_INTERACTIVE';
    const raw = this.config.get<string | number>(key);
    const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_LIMITS[pool];
    return parsed;
  }

  /**
   * Run `fn` while holding a slot.
   *
   * Always use this rather than acquire/release by hand: the release lives in a
   * `finally`, so a throw, a timeout or an abandoned stream cannot leak a slot.
   * A leaked slot is permanent — the pool shrinks by one for the life of the
   * process, and the failure is invisible until throughput quietly collapses.
   */
  async run<T>(pool: AiPool, context: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire(pool, context);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Generator-friendly variant: yields through `gen` while holding a slot.
   *
   * `finally` in a generator also runs when the consumer abandons it, which is
   * what a client disconnect looks like — so the slot comes back then too.
   */
  async *runGenerator<T>(
    pool: AiPool,
    context: string,
    gen: () => AsyncGenerator<T>,
  ): AsyncGenerator<T> {
    const release = await this.acquire(pool, context);
    try {
      yield* gen();
    } finally {
      release();
    }
  }

  /**
   * Take a slot, waiting if the pool is full. Returns the release function.
   *
   * The returned function is idempotent — double-release would hand the same
   * slot out twice and silently inflate the pool.
   */
  async acquire(pool: AiPool, context = ''): Promise<() => void> {
    const limit = this.limitFor(pool);
    const state = this.pools[pool];

    if (limit === 0) {
      // Disabled: no accounting, no queue, no possibility of a leaked slot.
      return () => undefined;
    }

    // ⚠️ `while`, not `if`. Release decrements and THEN resolves a waiter, and
    // that resolution is a microtask — so any caller whose continuation was
    // already queued can barge in, take the freed slot synchronously, and the
    // woken waiter then increments anyway. Demonstrated at limit=1 reaching
    // inFlight=2, and each simultaneous release can over-admit again, so the
    // ceiling degrades toward 2x. Re-checking on wake also makes a runtime
    // limit REDUCTION shed load instead of pinning inFlight at the old
    // high-water mark for as long as the queue is non-empty.
    while (state.inFlight >= this.limitFor(pool)) {
      await this.waitForSlot(pool, state, limit, context);
    }

    state.inFlight += 1;
    state.admitted += 1;
    if (state.inFlight > state.peak) state.peak = state.inFlight;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      state.inFlight -= 1;
      const next = state.waiters.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve();
      }
    };
  }

  private waitForSlot(
    pool: AiPool,
    state: PoolState,
    limit: number,
    context: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Drop ourselves from the queue so a later release doesn't hand a slot
        // to a waiter that has already given up — that slot would be consumed
        // by nobody and the pool would shrink.
        const i = state.waiters.findIndex((w) => w.timer === timer);
        if (i !== -1) state.waiters.splice(i, 1);
        state.rejected += 1;
        this.logger.warn(
          `AI pool "${pool}" full (${limit} in flight, ${state.waiters.length} queued) — ` +
            `refusing after ${QUEUE_TIMEOUT_MS[pool]}ms${context ? ` [${context}]` : ''}`,
        );
        Sentry.captureMessage('ai.governor.busy', {
          level: 'warning',
          extra: { pool, limit, queued: state.waiters.length, context },
        });
        reject(
          new ServiceUnavailableException({
            code: AI_BUSY_CODE,
            message: '目前使用人數較多，請稍後再試。',
          }),
        );
      }, QUEUE_TIMEOUT_MS[pool]);

      state.waiters.push({ resolve, reject, timer });
    });
  }

  /** For Ob2's ops endpoint, and for asserting in tests. */
  snapshot(): Record<AiPool, { inFlight: number; queued: number; limit: number; peak: number; admitted: number; rejected: number }> {
    const out = {} as ReturnType<AiGovernorService['snapshot']>;
    for (const pool of ['reading', 'interactive'] as AiPool[]) {
      const s = this.pools[pool];
      out[pool] = {
        inFlight: s.inFlight,
        queued: s.waiters.length,
        limit: this.limitFor(pool),
        peak: s.peak,
        admitted: s.admitted,
        rejected: s.rejected,
      };
    }
    return out;
  }
}
