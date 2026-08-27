import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  buildPooledDatabaseUrl,
  connectionBudgetWarning,
  DEFAULT_CONNECTION_LIMIT,
  type PooledUrlResult,
} from '../common/database-url';
import { replicaCountFromEnv } from '../common/replica-count';

/**
 * M2 — the pool is bounded here rather than left to Prisma's default, which is
 * `num_physical_cpus * 2 + 1` PER PROCESS and reads the host's core count
 * inside a container. See `common/database-url.ts` for the full reasoning.
 *
 * `DATABASE_CONNECTION_LIMIT` overrides the per-process limit; a
 * `connection_limit` already present in `DATABASE_URL` beats both.
 */
function resolveConnectionLimit(): number {
  const raw = process.env.DATABASE_CONNECTION_LIMIT;
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  // A zero or negative pool cannot serve a request, so garbage falls back
  // rather than producing a database client that deadlocks on first use.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CONNECTION_LIMIT;
}

/**
 * ⚠️ Resolved at CALL time, not at module scope.
 *
 * `ConfigModule.forRoot({ envFilePath: [...] })` loads `.env` into
 * `process.env` during Nest bootstrap — which happens AFTER this module is
 * imported. Computing at module scope therefore reads an unset DATABASE_URL in
 * local dev (where it comes from the file) while working fine in production
 * (where the platform sets real env vars). That asymmetry is the worst kind:
 * the bound pool is silently absent in exactly the environment where you would
 * try to observe it. Pure and cheap, so recomputing is free.
 */
function resolvePool() {
  return buildPooledDatabaseUrl(process.env.DATABASE_URL, {
    connectionLimit: resolveConnectionLimit(),
  });
}

/**
 * Set by `datasourceOverride()` and claimed by the constructor on the very next
 * statement. JS is single-threaded, so the value the constructor reads is
 * exactly the one that was passed to `super()`.
 *
 * ⚠️ The alternative — recomputing in `onModuleInit` purely to log — can print
 * a different answer from the one in force if `process.env.DATABASE_URL` was
 * populated in between. That log line is the designated way to confirm M2 is
 * live, so it must report what happened, not re-derive what probably happened.
 */
let pendingPool: PooledUrlResult | null = null;

/** `{}` when we changed nothing, so the schema's `env("DATABASE_URL")` stands. */
function datasourceOverride(): { datasourceUrl?: string } {
  pendingPool = resolvePool();
  return pendingPool.applied && pendingPool.url ? { datasourceUrl: pendingPool.url } : {};
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  /** What `super()` was actually given — see `pendingPool`. */
  private readonly appliedPool: PooledUrlResult;

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      // Only override when we actually changed something. Passing the URL back
      // unchanged would still work, but it would move the source of truth off
      // the schema's env() for no reason.
      // Called inside super() because a property initializer on this class
      // forces super() to be the first statement — a plain function call in
      // the argument list is allowed where a preceding statement is not.
      ...datasourceOverride(),
    });
    this.appliedPool = pendingPool as PooledUrlResult;
  }

  async onModuleInit() {
    // Logged at boot because the effective pool size is otherwise invisible —
    // and its symptom (random 500s under load) points nowhere near it.
    this.logger.log(`Prisma pool — ${this.appliedPool.reason}`);
    // ⚠️ The EFFECTIVE limit, not the configured one. When DATABASE_URL carries
    // its own `connection_limit` we respect it, so the env value is not what is
    // in force — and warning against the wrong number silenced this check in
    // precisely the case where an operator had raised the limit by hand.
    const warning = connectionBudgetWarning(
      this.appliedPool.effectiveConnectionLimit ?? resolveConnectionLimit(),
      replicaCountFromEnv(),
    );
    if (warning) this.logger.warn(warning);
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
