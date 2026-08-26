/**
 * How many copies of this API are running.
 *
 * Two unrelated subsystems need this same fact, which is why it is not a
 * private method on either of them:
 *
 *   • `AiGovernorService` — its concurrency pools are in-memory (per process)
 *     but their sizes are derived from SPEND (per fleet), so each instance
 *     takes `limit / replicas`.
 *   • `PrismaService` — the connection pool is per process, and
 *     `replicas × connection_limit` has to stay under Postgres'
 *     `max_connections`.
 *
 * ⚠️ This must be updated IN LOCKSTEP with the platform's replica count. It
 * cannot be detected: a container has no reliable way to know how many
 * siblings it has, and guessing from CPU count or hostname would be worse than
 * a stated number.
 */

/**
 * Unset, non-numeric, or < 1 all mean **1**.
 *
 * That fallback direction is deliberate. For the AI governor, 1 means "do not
 * divide" — the pre-M8 behaviour, i.e. a ceiling that is too generous rather
 * than a fleet that has silently throttled itself to a standstill. Failing the
 * other way would turn a typo in an env var into an outage.
 */
export function parseReplicaCount(raw: unknown): number {
  const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

/** Reads `REPLICA_COUNT` from the process environment. */
export function replicaCountFromEnv(): number {
  return parseReplicaCount(process.env.REPLICA_COUNT);
}
