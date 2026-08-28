import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { AIProvider } from '@prisma/client';
import { RedisService } from '../redis/redis.service';
import { getRateLimitSnapshot } from './anthropic-rate-limit';
import { AI_CALL_LOG_PREFIX, formatAiCallLog, hashUserId } from './ai-call-log';

/**
 * S2 — AI spend ledger + circuit breaker.
 *
 * ⚠️ THIS IS THE ONLY MEANINGFUL CEILING ON AI SPEND IN THE APPLICATION.
 *
 * The account carries a self-imposed $500/month limit, which is a real external
 * backstop — but it is an ACCOUNT-level cliff: when it trips, everything stops
 * at once, mid-month, with no per-day smoothing and no warning we control. This
 * service is the ceiling that fails gracefully: a typed 503 on new generation
 * while cached reads keep working.
 *
 * ## What it counts
 *
 * Spend is accumulated in Redis under **Asia/Taipei** day keys, not UTC. A UTC
 * day boundary lands at 08:00 Taipei, so a UTC-keyed daily cap would reset in
 * the middle of the local morning — the busiest hours would straddle two
 * buckets and neither would read as high.
 *
 * ## Why Redis and not the `AIUsageLog` table
 *
 * The breaker is consulted before *every* generation. A `SUM(cost_usd)` over a
 * growing table on each call is a cost that scales with success. Redis
 * `INCRBYFLOAT` is O(1) and survives an API restart, which is what the
 * acceptance asks for. `AIUsageLog` remains the durable audit record; this is
 * the hot counter. They are allowed to disagree slightly (see `record`).
 *
 * ## The completeness problem this service exists inside
 *
 * ⚠️ Before S2 there were **15 provider call sites and only 6 were metered** —
 * all of chat (including the LLM judge) and all of fortune called Anthropic
 * directly and wrote no usage row at all. Any spend figure taken from
 * `AIUsageLog` was therefore blind to both interactive surfaces. A breaker
 * wired to the same 6 sites would have been worse than none: it would have
 * reported a comfortable number while the unmetered half ran free.
 *
 * `scripts/check-ai-spend-metering.mjs` fails CI if a provider call appears in a
 * file that does not record spend. Completeness here is a property of the
 * source, so it is checked against the source.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Cached prompt reads — billed at a discount, and large for chat. */
  cacheReadTokens?: number;
  /** Cache WRITES are billed at a premium, not a discount. */
  cacheWriteTokens?: number;
}

export interface SpendSnapshot {
  dayUsd: number;
  monthUsd: number;
  dayLimitUsd: number;
  monthLimitUsd: number;
  dayKey: string;
  monthKey: string;
  enabled: boolean;
}

/** USD per 1M tokens. */
interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Price table. USD per 1M tokens, matched by longest-prefix on the model id so
 * a dated snapshot (`claude-sonnet-4-5-20250929`) resolves without a new entry.
 *
 * ⚠️ Prices are a SAFETY input, not an accounting one. When a model is unknown
 * we bill it at {@link FALLBACK_PRICE} — deliberately the most expensive row —
 * because the failure we care about is under-counting spend and sailing past a
 * cap. Over-counting an unrecognised model trips the breaker early, which is
 * visible and recoverable; under-counting is neither.
 */
// ⚠️ `cacheWrite` is the ONE-HOUR rate (2x base input), not the 5-minute one
// (1.25x). Chat sends its system block with `ttl: '1h'` on every turn
// (`chat.service.ts` / `chat-stream.service.ts`), so the 5-minute rate
// under-reported every session's first turn by 37.5% — the single
// under-counting direction this table is built to avoid.
const PRICE_TABLE: Record<string, ModelPrice> = {
  // Anthropic — https://docs.anthropic.com/en/docs/about-claude/pricing
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 30 },
  'claude-opus': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 30 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 6 },
  'claude-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 6 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1.6 },
  'claude-haiku': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 2 },
  // OpenAI fallback
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
  // Google fallback
  'gemini-2.0-flash': { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 },
  'gemini-1.5-pro': { input: 1.25, output: 5, cacheRead: 0.3125, cacheWrite: 1.25 },
  'gemini': { input: 2, output: 12, cacheRead: 0.5, cacheWrite: 2 },
};

/** Unknown model ⇒ charge the most expensive rate we know. See PRICE_TABLE. */
const FALLBACK_PRICE: ModelPrice = { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 30 };

const DEFAULT_DAILY_LIMIT_USD = 50;
const DEFAULT_MONTHLY_LIMIT_USD = 400;
/** Warn once per key per crossing, not per request. */
const WARN_THRESHOLD = 0.8;

const DAY_KEY_TTL_SECONDS = 60 * 60 * 48; // 2 days — outlives any timezone skew
const MONTH_KEY_TTL_SECONDS = 60 * 60 * 24 * 45; // 45 days — outlives the month

export const AI_SPEND_CAP_CODE = 'AI_SPEND_CAP';

@Injectable()
export class AiSpendService {
  private readonly logger = new Logger(AiSpendService.name);
  /** Suppresses repeat Sentry warnings within a process for the same key. */
  private readonly warned = new Set<string>();

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  // ============================================================
  // Configuration
  // ============================================================

  /** Default ON. `AI_SPEND_BREAKER_ENABLED=0` is the documented rollback. */
  get enabled(): boolean {
    return (this.config.get<string>('AI_SPEND_BREAKER_ENABLED') ?? '1') !== '0';
  }

  get dailyLimitUsd(): number {
    return this.numeric('AI_DAILY_SPEND_LIMIT_USD', DEFAULT_DAILY_LIMIT_USD);
  }

  get monthlyLimitUsd(): number {
    return this.numeric('AI_MONTHLY_SPEND_LIMIT_USD', DEFAULT_MONTHLY_LIMIT_USD);
  }

  private numeric(key: string, fallback: number): number {
    const raw = this.config.get<string | number>(key);
    const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
    // A malformed limit must not silently become Infinity or 0 — the first
    // disables the breaker, the second blocks everything.
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  // ============================================================
  // Keys — Asia/Taipei, per the plan's locked timezone decision
  // ============================================================

  /** `YYYY-MM-DD` in Asia/Taipei. `sv-SE` yields ISO order without manual padding. */
  dayKey(now: Date = new Date()): string {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }

  monthKey(now: Date = new Date()): string {
    return this.dayKey(now).slice(0, 7);
  }

  private redisDayKey(day: string): string {
    return `ai:spend:day:${day}`;
  }

  private redisMonthKey(month: string): string {
    return `ai:spend:month:${month}`;
  }

  // ============================================================
  // Pricing
  // ============================================================

  /**
   * Longest-prefix match, so `claude-sonnet-4-5-20250929` resolves via
   * `claude-sonnet-4-5` rather than needing a row per dated snapshot.
   */
  priceFor(model: string): ModelPrice {
    const id = (model || '').toLowerCase();
    let best: { key: string; price: ModelPrice } | null = null;
    for (const [key, price] of Object.entries(PRICE_TABLE)) {
      if (id.startsWith(key) && (!best || key.length > best.key.length)) {
        best = { key, price };
      }
    }
    if (!best) {
      this.logger.warn(
        `No price entry for model "${model}" — billing at the most expensive known ` +
          `rate so the breaker errs toward tripping early. Add it to PRICE_TABLE.`,
      );
      return FALLBACK_PRICE;
    }
    return best.price;
  }

  estimateCostUsd(model: string, usage: TokenUsage): number {
    const p = this.priceFor(model);
    const per = (tokens: number | undefined, rate: number) => ((tokens ?? 0) * rate) / 1_000_000;
    return (
      per(usage.inputTokens, p.input) +
      per(usage.outputTokens, p.output) +
      per(usage.cacheReadTokens, p.cacheRead) +
      per(usage.cacheWriteTokens, p.cacheWrite)
    );
  }

  // ============================================================
  // The breaker
  // ============================================================

  /**
   * Throws a typed 503 when either cap is reached.
   *
   * Call BEFORE spending a credit where the flow allows it. Where the deduction
   * already happened, the rejection rides the existing refund path — that is why
   * this throws an `HttpException` subclass rather than returning a boolean:
   * every caller already maps thrown errors onto refund + a client-visible code.
   *
   * ⚠️ Fails OPEN. If Redis is unreachable we cannot know the spend, and the
   * alternative — refusing all AI on a cache blip — converts a monitoring
   * outage into a full outage. The external $500 account limit is the backstop
   * for exactly this window, and the failure is logged loudly.
   */
  async assertUnderCap(context?: string): Promise<void> {
    if (!this.enabled) return;

    let snapshot: SpendSnapshot;
    try {
      snapshot = await this.getSnapshot();
    } catch (err) {
      this.logger.error(
        `Spend breaker could not read Redis — ALLOWING the call. The only remaining ` +
          `ceiling is the account limit. ${context ? `context=${context} ` : ''}${err}`,
      );
      Sentry.captureMessage('ai.spend.breaker_unavailable', { level: 'error' });
      return;
    }

    const over =
      snapshot.dayUsd >= snapshot.dayLimitUsd
        ? { scope: 'daily', spent: snapshot.dayUsd, limit: snapshot.dayLimitUsd }
        : snapshot.monthUsd >= snapshot.monthLimitUsd
          ? { scope: 'monthly', spent: snapshot.monthUsd, limit: snapshot.monthLimitUsd }
          : null;

    if (!over) return;

    this.logger.error(
      `AI SPEND CAP reached (${over.scope}): $${over.spent.toFixed(2)} of ` +
        `$${over.limit.toFixed(2)}. Refusing new generation${context ? ` [${context}]` : ''}. ` +
        `Cached reads are unaffected.`,
    );
    Sentry.captureMessage('ai.spend.cap_tripped', {
      level: 'error',
      extra: { scope: over.scope, spentUsd: over.spent, limitUsd: over.limit, context },
    });

    throw new ServiceUnavailableException({
      code: AI_SPEND_CAP_CODE,
      message: '系統今日的 AI 用量已達上限，請稍後再試。已生成的內容仍可查看。',
    });
  }

  /**
   * Add one call's cost to the day and month counters.
   *
   * Never throws: a metering failure must not fail a request the user has
   * already paid for. It degrades to a log line, and the resulting undercount is
   * bounded by the external account limit.
   */
  async record(args: {
    provider: AIProvider | string;
    model: string;
    usage: TokenUsage;
    /** Surface + operation, e.g. `chat:stream`. Doubles as Ob1's `route`. */
    context?: string;
    /** Ob1 — wall-clock duration of the provider call, when the site can time it. */
    durationMs?: number;
    /** Ob1 — hashed before it reaches the log; never written raw. */
    userId?: string | null;
  }): Promise<number> {
    let costUsd: number;
    try {
      // ⚠️ Inside the try, not above it.
      //
      // `estimateCostUsd` dereferences `args.usage`, so it throws on a caller
      // that passes a spread resolving to undefined — outside the try, that
      // rejection escaped a method whose docblock promises it never throws. All
      // ten call sites invoke it as a bare `void this.aiSpend.record(...)` on
      // the strength of that promise, with no `.catch()`, so the rejection is
      // unhandled and takes the API process down. No caller does this today;
      // the guarantee is what licenses the bare `void`, so the guarantee has to
      // hold at the first line as well as the rest.
      costUsd = this.estimateCostUsd(args.model, args.usage);
    } catch (err) {
      this.logger.error(
        `Failed to price AI spend (${args.provider}/${args.model}) — not counted: ${err}`,
      );
      return 0;
    }
    this.logCall(args, costUsd);

    if (!(costUsd > 0)) return 0;

    try {
      const now = new Date();
      const day = this.dayKey(now);
      const month = this.monthKey(now);
      const [dayTotal, monthTotal] = await Promise.all([
        this.redis.incrByFloat(this.redisDayKey(day), costUsd, DAY_KEY_TTL_SECONDS),
        this.redis.incrByFloat(this.redisMonthKey(month), costUsd, MONTH_KEY_TTL_SECONDS),
      ]);
      this.maybeWarn('daily', day, dayTotal, this.dailyLimitUsd);
      this.maybeWarn('monthly', month, monthTotal, this.monthlyLimitUsd);
    } catch (err) {
      // Undercount, not a failed request. See the docblock.
      this.logger.error(
        `Failed to record AI spend ($${costUsd.toFixed(6)}, ${args.provider}/${args.model}) — ` +
          `the day/month counters now UNDERSTATE actual spend: ${err}`,
      );
    }
    return costUsd;
  }

  /**
   * Ob1 — emit the per-call line.
   *
   * ## Why it lives here and not at the eleven call sites
   *
   * `scripts/check-ai-spend-metering.mjs` already fails CI when a provider call
   * appears in a file that does not reach `record()`. That guard was built for
   * S2's completeness problem, and hanging the log off the same choke point
   * inherits it wholesale: a new AI surface cannot be added without a log line,
   * because it cannot be added without metering. A `logger.log` sprinkled at
   * each site would have had no such property and would have drifted the first
   * time someone added a twelfth.
   *
   * ## Coverage boundary, stated honestly
   *
   * This fires for every call that reaches `record()` with well-formed usage.
   * It does NOT fire for a call that failed before producing any tokens — those
   * sites guard on `hasUsage(...)` and never call in. That is the right
   * boundary for a usage line (there is nothing to report), and those paths are
   * not dark: the governor logs its refusals, the breaker logs its trips, and
   * provider errors reach Sentry.
   *
   * Never throws — `record()`'s docblock promises it, and all ten callers use a
   * bare `void` on the strength of that promise.
   */
  private logCall(
    args: { provider: AIProvider | string; model: string; usage: TokenUsage; context?: string; durationMs?: number; userId?: string | null },
    costUsd: number,
  ): void {
    try {
      const rl = getRateLimitSnapshot();
      this.logger.log(
        formatAiCallLog({
          route: args.context ?? 'unknown',
          provider: String(args.provider),
          model: args.model,
          ms: typeof args.durationMs === 'number' ? Math.round(args.durationMs) : null,
          inTok: args.usage.inputTokens ?? 0,
          outTok: args.usage.outputTokens ?? 0,
          cacheReadTok: args.usage.cacheReadTokens ?? 0,
          cacheWriteTok: args.usage.cacheWriteTokens ?? 0,
          costUsd,
          userIdHash: hashUserId(args.userId),
          rlOutRemaining: rl.outputTokensRemaining,
          rlOutReset: rl.outputTokensReset,
        }),
      );
    } catch (err) {
      this.logger.warn(`Failed to emit ${AI_CALL_LOG_PREFIX} line: ${err}`);
    }
  }

  private maybeWarn(scope: string, key: string, total: number, limit: number): void {
    if (total < limit * WARN_THRESHOLD || total >= limit) return; // 100% is its own alert
    const marker = `${scope}:${key}`;
    if (this.warned.has(marker)) return;
    this.warned.add(marker);
    const pct = Math.round((total / limit) * 100);
    this.logger.warn(`AI spend at ${pct}% of the ${scope} cap ($${total.toFixed(2)}/$${limit})`);
    Sentry.captureMessage('ai.spend.threshold_80', {
      level: 'warning',
      extra: { scope, key, spentUsd: total, limitUsd: limit, pct },
    });
  }

  async getSnapshot(now: Date = new Date()): Promise<SpendSnapshot> {
    const day = this.dayKey(now);
    const month = this.monthKey(now);
    const [dayRaw, monthRaw] = await Promise.all([
      this.redis.get(this.redisDayKey(day)),
      this.redis.get(this.redisMonthKey(month)),
    ]);
    return {
      dayUsd: Number.parseFloat(dayRaw ?? '0') || 0,
      monthUsd: Number.parseFloat(monthRaw ?? '0') || 0,
      dayLimitUsd: this.dailyLimitUsd,
      monthLimitUsd: this.monthlyLimitUsd,
      dayKey: day,
      monthKey: month,
      enabled: this.enabled,
    };
  }
}
