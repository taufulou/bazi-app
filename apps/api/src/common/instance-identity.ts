import { hostname } from 'node:os';

/**
 * #24 — WHICH process answered this request?
 *
 * Several `GET /api/admin/ops` sections are per-PROCESS observations — `pools`,
 * `rateLimit`, `aiBaseUrlEffective`, `alerting` — and production runs more than
 * one replica behind a load balancer. Without an identity on the response, a
 * `null` rate-limit gauge cannot be told apart from "the OTHER replica served
 * the reading", and repeating the request cannot settle it either: you cannot
 * tell whether you reached a different replica or the same one twice.
 *
 * `replicaId` comes from Railway's `RAILWAY_REPLICA_ID` (verified against
 * docs.railway.com/reference/variables, 2026-10-01), falling back to the
 * container hostname, which also differs per container. Env is read at call
 * time — cheap, and immune to load-order surprises.
 *
 * No `pid`: `docker/Dockerfile.api` `exec`s node, so it is 1 on every replica.
 *
 * `commitSha` answers "is the code I think is deployed actually what is
 * running?" from the same endpoint — the CLAUDE.md lesson about config that
 * seemed inert because the code reading it was never deployed. It is only set
 * for GitHub-triggered Railway deploys; a CLI deploy reports `null`.
 */
export interface InstanceIdentity {
  replicaId: string;
  replicaIdSource: 'railway' | 'hostname';
  deploymentId: string | null;
  commitSha: string | null;
  /** When this process started, ISO. Computed once, so it is stable. */
  startedAt: string;
}

/**
 * Computed ONCE at module load from the process uptime, so it is the process
 * start time (not the module's) and identical on every request.
 */
const STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

function nonEmpty(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

export function resolveInstanceIdentity(env: NodeJS.ProcessEnv = process.env): InstanceIdentity {
  const railwayReplica = nonEmpty(env.RAILWAY_REPLICA_ID);
  return {
    replicaId: railwayReplica ?? hostname(),
    replicaIdSource: railwayReplica ? 'railway' : 'hostname',
    deploymentId: nonEmpty(env.RAILWAY_DEPLOYMENT_ID),
    commitSha: nonEmpty(env.RAILWAY_GIT_COMMIT_SHA),
    startedAt: STARTED_AT,
  };
}
