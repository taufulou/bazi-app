/**
 * M7 — readiness.
 *
 * "Is this instance fit to receive traffic right now?" — distinct from
 * liveness ("is the process up?"), which `GET /health` already answers with a
 * static object.
 *
 * ## Why this is a separate endpoint from `/health`
 *
 * The plan says "`/health` + DB + Redis". The checks are the plan's; the path
 * deliberately is not. Two reasons:
 *
 *  - `/health` is the documented production liveness path and is what uptime
 *    monitors poll. Making it query Postgres turns every external ping into a
 *    database round-trip.
 *  - A liveness probe that fails when a *dependency* is down asks the platform
 *    to restart a process that is working fine. Restarting cannot reach
 *    Postgres. That is a restart loop during someone else's outage.
 *
 * So `/health` stays cheap and static, and `/health/ready` is the one to point
 * a platform healthcheck at.
 *
 * ## What is fatal and what is not
 *
 * Postgres and Redis are REQUIRED; the Bazi engine is advisory. The engine is
 * reachable by only a handful of routes and the rest of the API is fully
 * useful without it, so failing readiness on it would take the whole instance
 * out over a partial loss.
 *
 * Redis being required deserves its own note, because it is arguable.
 * `RedisThrottlerStorage` fails OPEN — during a Redis outage there is no rate
 * limiting at all. Given a denial-of-wallet threat model, an instance that
 * cannot throttle is not one we want taking traffic, so "out of rotation" beats
 * "serving unmetered". That reasoning is worth revisiting if Redis ever becomes
 * flaky enough that the cure costs more than the disease.
 *
 * ## The engine hop and B3-b (plan R4 #11)
 *
 * Putting the engine on a continuously-polled endpoint is exactly the thing
 * that could hold B3-b's gate open forever: an UNKEYED probe every few seconds
 * means B3-a's unkeyed counter never settles and the pre-flight can never say
 * GO. The hop goes through `engineFetch` with `caller: 'health.probe'`, so it
 * is keyed automatically and the CI guard enforces that it stays so.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { engineFetch } from '../common/engine-client';

/** Per-dependency budget. Beyond this the dependency is reported unhealthy. */
export const READINESS_CHECK_TIMEOUT_MS = 3_000;

/**
 * How long a computed report is reused.
 *
 * `/health/ready` is public, unauthenticated and `@SkipThrottle()`d — it has to
 * be, or the platform cannot poll it — and it issues a database query. Without
 * this, it is a free amplifier: one cheap HTTP request per Postgres round-trip,
 * from anyone. One second is short enough that a real outage is reported almost
 * immediately and long enough that a flood collapses to one probe per second.
 */
export const READINESS_CACHE_MS = 1_000;

export type CheckStatus = 'healthy' | 'unhealthy';

export interface DependencyCheck {
  status: CheckStatus;
  latencyMs: number;
  /** False for advisory dependencies, whose failure does not block readiness. */
  required: boolean;
  error?: string;
}

export interface ReadinessReport {
  /** The verdict. Drives the HTTP status: 200 when true, 503 when false. */
  ready: boolean;
  status: 'ready' | 'degraded' | 'not_ready';
  timestamp: string;
  service: string;
  version: string;
  checks: Record<string, DependencyCheck>;
}

@Injectable()
export class ReadinessService {
  private readonly logger = new Logger(ReadinessService.name);
  private cached: { at: number; report: ReadinessReport } | null = null;
  private inFlight: Promise<ReadinessReport> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<ReadinessReport> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < READINESS_CACHE_MS) {
      return this.cached.report;
    }
    // Collapse concurrent probes onto one real check. Without this the cache
    // only helps SEQUENTIAL callers: N simultaneous requests all miss and all
    // hit the database.
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.run()
      .then((report) => {
        this.cached = { at: Date.now(), report };
        return report;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /** Drop the memoised report. For tests, and for anything that needs a fresh read. */
  invalidate(): void {
    this.cached = null;
  }

  private async run(): Promise<ReadinessReport> {
    const [database, redis, baziEngine] = await Promise.all([
      this.timed('database', true, () => this.prisma.$queryRaw`SELECT 1`),
      // PING, not set+get. This runs on every probe forever: a write would be
      // pointless key churn against a `volatile-lru` instance, and two round
      // trips where one answers the question.
      this.timed('redis', true, () => this.redis.getClient().ping()),
      this.timed('baziEngine', false, async () => {
        const url = this.config.get<string>('BAZI_ENGINE_URL') || 'http://localhost:5001';
        const res = await engineFetch(`${url}/health`, {
          caller: 'health.probe',
          signal: AbortSignal.timeout(READINESS_CHECK_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`engine returned ${res.status}`);
      }),
    ]);

    const checks = { database, redis, baziEngine };
    const requiredFailed = Object.values(checks).some(
      (c) => c.required && c.status === 'unhealthy',
    );
    const advisoryFailed = Object.values(checks).some(
      (c) => !c.required && c.status === 'unhealthy',
    );

    return {
      ready: !requiredFailed,
      status: requiredFailed ? 'not_ready' : advisoryFailed ? 'degraded' : 'ready',
      timestamp: new Date().toISOString(),
      service: 'bazi-api',
      version: '0.1.0',
      checks,
    };
  }

  private async timed(
    name: string,
    required: boolean,
    probe: () => Promise<unknown>,
  ): Promise<DependencyCheck> {
    const start = Date.now();
    try {
      await this.withTimeout(probe(), name);
      return { status: 'healthy', latencyMs: Date.now() - start, required };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      // A required dependency failing is the reason a deploy will not go live,
      // so it must be findable in the logs. Advisory failures are noise.
      if (required) this.logger.warn(`Readiness: ${name} unhealthy — ${error}`);
      return { status: 'unhealthy', latencyMs: Date.now() - start, required, error };
    }
  }

  /**
   * A per-dependency deadline, because a HUNG dependency is worse than a failed
   * one: without this the whole probe waits on the slowest driver, and the
   * platform's own healthcheck timeout fires instead — which reports "the API
   * did not answer" rather than "Postgres did not answer".
   *
   * The timer is always cleared. An un-cleared `setTimeout` per probe, on an
   * endpoint polled forever, keeps the event loop busy and delays shutdown.
   */
  private withTimeout<T>(promise: Promise<T>, name: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${name} check timed out after ${READINESS_CHECK_TIMEOUT_MS}ms`)),
        READINESS_CHECK_TIMEOUT_MS,
      );
    });
    return Promise.race([promise, deadline]).finally(() => {
      if (timer) clearTimeout(timer);
    }) as Promise<T>;
  }
}
