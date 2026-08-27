import { parseReplicaCount } from './replica-count';

/**
 * M2 — bound the Prisma connection pool.
 *
 * ## Why this is not left to Prisma's default
 *
 * Unset, Prisma sizes the pool at `num_physical_cpus * 2 + 1` **per process**.
 * That default is written for a box you own; in a container it reads the
 * HOST's core count rather than the share you were allocated, so a small
 * service routinely opens 17-65 connections. Multiply by replicas (M8) and a
 * stock Postgres `max_connections` of 100 is reachable with two instances and
 * no traffic to speak of. The failure looks like random 500s under load —
 * `too many clients already` surfacing from whichever query lost the race —
 * rather than anything that points at connection count.
 *
 * `pool_timeout` matters for the same reason: at the default the request waits
 * on a checkout that may never come, so an exhausted pool presents as latency
 * with no error until something upstream gives up.
 */

/** Connections per PROCESS. `replicas × this` must stay under max_connections. */
export const DEFAULT_CONNECTION_LIMIT = 10;

/** Seconds a query waits for a free connection before failing loudly. */
export const DEFAULT_POOL_TIMEOUT = 20;

/**
 * Postgres' own stock ceiling. Used only to decide whether to warn — we cannot
 * read the server's real `max_connections` before the pool is built, and
 * blocking boot on a guess would be worse than a log line.
 */
export const ASSUMED_MAX_CONNECTIONS = 100;

/**
 * Superuser slots Postgres reserves plus headroom for migrations, psql, and
 * anything else that connects. Warn before we reach the true ceiling, not at it.
 */
export const CONNECTION_HEADROOM = 20;

export interface PooledUrlResult {
  /** The URL to hand Prisma, or `undefined` to leave the schema's env() alone. */
  url: string | undefined;
  /** Whether we added anything. False when overridden or unparseable. */
  applied: boolean;
  /** Human-readable explanation, logged at boot. */
  reason: string;
  /**
   * The limit ACTUALLY in force, which is not always the one we were asked for.
   *
   * ⚠️ This exists because the connection-budget warning was computing against
   * the env/default value even when the URL carried its own `connection_limit`
   * — so the one guard meant to catch an over-provisioned fleet went silent in
   * exactly the case where a human had overridden the default. `null` when the
   * URL is absent or unparseable, i.e. when we genuinely cannot know.
   */
  effectiveConnectionLimit: number | null;
}

/**
 * Append `connection_limit` / `pool_timeout` to a Postgres URL.
 *
 * ⚠️ An existing `connection_limit` in the URL WINS and is left untouched.
 * The connection string is the operator's lever — someone who has pointed the
 * app at pgbouncer, or who is firefighting, must be able to set this without
 * editing code, and silently overriding them would make the URL a lie.
 */
export function buildPooledDatabaseUrl(
  rawUrl: string | undefined,
  opts: { connectionLimit?: number; poolTimeout?: number } = {},
): PooledUrlResult {
  if (!rawUrl) {
    return {
      url: undefined,
      applied: false,
      reason: 'DATABASE_URL is not set',
      effectiveConnectionLimit: null,
    };
  }

  const limit = opts.connectionLimit ?? DEFAULT_CONNECTION_LIMIT;
  const timeout = opts.poolTimeout ?? DEFAULT_POOL_TIMEOUT;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // A URL we cannot parse is one we must not rewrite. Hand it back unchanged
    // and let Prisma produce its own, far better, error about it.
    return {
      url: rawUrl,
      applied: false,
      reason: 'DATABASE_URL is not parseable — left as-is',
      effectiveConnectionLimit: null,
    };
  }

  const fromUrl = parsed.searchParams.get('connection_limit');
  if (fromUrl !== null) {
    const parsedFromUrl = Number.parseInt(fromUrl, 10);
    return {
      url: rawUrl,
      applied: false,
      reason: `connection_limit=${fromUrl} already set in DATABASE_URL — respected`,
      // Non-numeric would be Prisma's error to raise, not ours to guess at.
      effectiveConnectionLimit:
        Number.isFinite(parsedFromUrl) && parsedFromUrl > 0 ? parsedFromUrl : null,
    };
  }

  parsed.searchParams.set('connection_limit', String(limit));
  // Set independently: someone may have tuned the timeout without the limit.
  if (!parsed.searchParams.has('pool_timeout')) {
    parsed.searchParams.set('pool_timeout', String(timeout));
  }

  return {
    url: parsed.toString(),
    applied: true,
    reason: `connection_limit=${limit} pool_timeout=${parsed.searchParams.get('pool_timeout')}`,
    effectiveConnectionLimit: limit,
  };
}

/**
 * Whether `replicas × connection_limit` leaves enough room, and what to say if
 * not. Returns `null` when the arithmetic is comfortable.
 *
 * Deliberately a warning rather than a refusal to boot: the assumed ceiling is
 * a guess at someone else's server config, and refusing to start over a guess
 * is a worse failure than the one being prevented.
 */
export function connectionBudgetWarning(
  connectionLimit: number,
  replicaCountRaw: unknown,
  assumedMax: number = ASSUMED_MAX_CONNECTIONS,
): string | null {
  const replicas = parseReplicaCount(replicaCountRaw);
  const total = replicas * connectionLimit;
  const safeCeiling = assumedMax - CONNECTION_HEADROOM;
  if (total <= safeCeiling) return null;
  return (
    `Connection budget: ${replicas} replica(s) × connection_limit=${connectionLimit} = ${total}, ` +
    `which exceeds the safe ceiling of ${safeCeiling} (assuming max_connections=${assumedMax}, ` +
    `reserving ${CONNECTION_HEADROOM} for migrations/psql/superuser). ` +
    `Lower DATABASE_CONNECTION_LIMIT, reduce replicas, or raise max_connections. ` +
    `Verify the real value with: SHOW max_connections;`
  );
}
