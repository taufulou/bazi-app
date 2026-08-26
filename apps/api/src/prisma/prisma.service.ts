import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  buildPooledDatabaseUrl,
  connectionBudgetWarning,
  DEFAULT_CONNECTION_LIMIT,
} from '../common/database-url';

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

/** `{}` when we changed nothing, so the schema's `env("DATABASE_URL")` stands. */
function datasourceOverride(): { datasourceUrl?: string } {
  const pooled = resolvePool();
  return pooled.applied && pooled.url ? { datasourceUrl: pooled.url } : {};
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

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
  }

  async onModuleInit() {
    // Logged at boot because the effective pool size is otherwise invisible —
    // and its symptom (random 500s under load) points nowhere near it.
    this.logger.log(`Prisma pool — ${resolvePool().reason}`);
    const warning = connectionBudgetWarning(
      resolveConnectionLimit(),
      process.env.REPLICA_COUNT,
    );
    if (warning) this.logger.warn(warning);
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
