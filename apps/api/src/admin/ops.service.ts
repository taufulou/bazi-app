import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiGovernorService, type AiPool } from '../ai/ai-governor.service';
import { AiSpendService } from '../ai/ai-spend.service';
import { QuotaService, type QuotaKind } from '../ai/quota.service';
import { RedisService } from '../redis/redis.service';
import { getRateLimitSnapshot, type RateLimitSnapshot } from '../ai/anthropic-rate-limit';
import { parseReplicaCount } from '../common/replica-count';

/**
 * Ob2 — one read-only view of every AI spend control at once.
 *
 * ## Why an endpoint and not four dashboards
 *
 * The three controls interact, and the interaction is what you need during an
 * incident. "AI is slow" has four different answers — the pool is saturated
 * (S1), the breaker has tripped (S2), one account is being rationed (S4), or
 * Anthropic is rate-limiting us (Ob1's gauge) — and they are indistinguishable
 * from the outside. Each lives in different storage: pools are in-process,
 * spend and quota are Redis, rate limits are response headers. Assembling them
 * by hand under pressure is how the wrong lever gets pulled.
 *
 * ## Everything here is a READ
 *
 * No method mutates. That is deliberate: the endpoint is reachable by any
 * admin, and an ops view that can also reset a counter is a way to lose the
 * evidence you opened it to look at.
 *
 * ## What the numbers do and do not mean across replicas
 *
 * | Section | Scope | Read it as |
 * |---|---|---|
 * | `pools` | THIS process | one replica's share. `replicas` is included precisely so it can be multiplied. |
 * | `spend` | fleet | Redis-backed, authoritative. |
 * | `quota` | fleet | Redis-backed, authoritative. |
 * | `rateLimit` | account | the same underlying budget every replica sees. |
 *
 * Getting this wrong in the other direction is the trap: `pools.reading.limit`
 * of 12 on a 2-replica fleet is a fleet ceiling of 25, not of 12.
 */

const QUOTA_KINDS: QuotaKind[] = ['reading', 'chat', 'fortune'];

/** How many accounts the top-consumers list returns. */
const TOP_CONSUMERS = 10;

/**
 * Ceiling on the quota scan. Above this we report `truncated` and rank what we
 * saw — a partial ranking labelled as partial beats an ops page that hangs.
 */
const QUOTA_SCAN_LIMIT = 2_000;

export interface QuotaConsumer {
  userId: string;
  kind: QuotaKind;
  used: number;
  limit: number;
  /** `used / limit`, or `null` when that quota is disabled (`limit === 0`). */
  pctOfLimit: number | null;
}

export interface OpsSnapshot {
  generatedAt: string;
  /** M8 — the divisor the in-process pool limits were derived with. */
  replicas: number;
  pools: Record<AiPool, ReturnType<AiGovernorService['snapshot']>[AiPool]>;
  spend: {
    dayUsd: number;
    monthUsd: number;
    dayLimitUsd: number;
    monthLimitUsd: number;
    dayPct: number;
    monthPct: number;
    dayKey: string;
    monthKey: string;
  };
  breaker: {
    enabled: boolean;
    /** `null` when under both caps; otherwise which one tripped. */
    trippedOn: 'daily' | 'monthly' | null;
  };
  quota: {
    dayKey: string;
    limits: Record<QuotaKind, number>;
    topConsumers: QuotaConsumer[];
    /** True when the scan hit its ceiling — the ranking is of a sample. */
    truncated: boolean;
    /** Null when Redis was unreachable, which is NOT the same as "nobody used any". */
    available: boolean;
  };
  rateLimit: RateLimitSnapshot;
}

@Injectable()
export class OpsService {
  private readonly logger = new Logger(OpsService.name);

  constructor(
    private readonly governor: AiGovernorService,
    private readonly aiSpend: AiSpendService,
    private readonly quota: QuotaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async snapshot(): Promise<OpsSnapshot> {
    const spend = await this.aiSpend.getSnapshot();
    const quota = await this.topQuotaConsumers();

    const pct = (used: number, limit: number) =>
      limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0;

    return {
      generatedAt: new Date().toISOString(),
      replicas: parseReplicaCount(this.config.get<string | number>('REPLICA_COUNT')),
      pools: this.governor.snapshot(),
      spend: {
        dayUsd: round6(spend.dayUsd),
        monthUsd: round6(spend.monthUsd),
        dayLimitUsd: spend.dayLimitUsd,
        monthLimitUsd: spend.monthLimitUsd,
        dayPct: pct(spend.dayUsd, spend.dayLimitUsd),
        monthPct: pct(spend.monthUsd, spend.monthLimitUsd),
        dayKey: spend.dayKey,
        monthKey: spend.monthKey,
      },
      breaker: {
        enabled: spend.enabled,
        // Mirrors `assertUnderCap`'s own precedence — daily is checked first,
        // so a day that has tripped reports daily even if the month also has.
        // Deriving it here rather than duplicating a threshold keeps the ops
        // view and the enforcement from disagreeing.
        trippedOn: !spend.enabled
          ? null
          : spend.dayUsd >= spend.dayLimitUsd
            ? 'daily'
            : spend.monthUsd >= spend.monthLimitUsd
              ? 'monthly'
              : null,
      },
      quota,
      rateLimit: getRateLimitSnapshot(),
    };
  }

  /**
   * Rank today's heaviest accounts.
   *
   * ⚠️ Returns the RAW user id, unlike Ob1's log which hashes it. The two
   * destinations have different trust properties: a log line goes to a
   * third-party store and only ever needs to answer "are these the same
   * account", whereas an admin answering "who do I contact about this" needs
   * the id, is authenticated, and can already list users at
   * `GET /api/admin/users`. Hashing here would remove the only thing that makes
   * the list actionable while protecting nothing.
   *
   * Fails SOFT. An ops page is what you open when things are broken, so a Redis
   * outage must degrade this section rather than 500 the whole view — the pool
   * and rate-limit numbers come from memory and are still worth seeing.
   */
  private async topQuotaConsumers(): Promise<OpsSnapshot['quota']> {
    const dayKey = this.quota.dayKey();
    const limits = {
      reading: this.quota.limitFor('reading'),
      chat: this.quota.limitFor('chat'),
      fortune: this.quota.limitFor('fortune'),
    } as Record<QuotaKind, number>;

    try {
      const { keys, truncated } = await this.redis.scanKeys(`quota:*:*:${dayKey}`, {
        limit: QUOTA_SCAN_LIMIT,
      });
      const values = await this.redis.mget(keys);

      const consumers: QuotaConsumer[] = [];
      keys.forEach((key, i) => {
        const parsed = parseQuotaKey(key);
        if (!parsed) return;
        const used = Number.parseInt(values[i] ?? '', 10);
        if (!Number.isFinite(used)) return;
        const limit = limits[parsed.kind];
        consumers.push({
          userId: parsed.userId,
          kind: parsed.kind,
          used,
          limit,
          // A disabled quota has no meaningful percentage, and reporting 0%
          // would rank an unlimited heavy user below a light limited one.
          pctOfLimit: limit > 0 ? Math.round((used / limit) * 1000) / 10 : null,
        });
      });

      // Rank by ABSOLUTE usage, not by percentage. The question is "who is
      // spending our money", and the three quotas differ by an order of
      // magnitude (chat 200/day vs reading 20/day) — so a percentage ranking
      // would put a user at 100% of a cheap quota above one at 50% of the
      // expensive one.
      consumers.sort((a, b) => b.used - a.used);

      return {
        dayKey,
        limits,
        topConsumers: consumers.slice(0, TOP_CONSUMERS),
        truncated,
        available: true,
      };
    } catch (err) {
      this.logger.error(`Ops quota scan failed — reporting the section unavailable: ${err}`);
      return { dayKey, limits, topConsumers: [], truncated: false, available: false };
    }
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * `quota:{kind}:{userId}:{YYYYMMDD}` — split from BOTH ends, not by index.
 *
 * A user id containing a colon would shift every positional field and silently
 * attribute usage to a mangled id. Ids are UUIDs today, so this cannot happen;
 * it is one line to make it unable to happen later, and the failure it prevents
 * is wrong data rather than an error.
 */
function parseQuotaKey(key: string): { kind: QuotaKind; userId: string } | null {
  const parts = key.split(':');
  if (parts.length < 4 || parts[0] !== 'quota') return null;
  const kind = parts[1] as QuotaKind;
  if (!QUOTA_KINDS.includes(kind)) return null;
  const userId = parts.slice(2, -1).join(':');
  return userId ? { kind, userId } : null;
}

export const __testables = { parseQuotaKey };
