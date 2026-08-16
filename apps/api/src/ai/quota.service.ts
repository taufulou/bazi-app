import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

/**
 * S4 — per-user daily quotas.
 *
 * The third of the three spend controls, and the only one that is per-USER.
 * S2 caps total spend and S1 caps concurrency, but neither stops one account
 * consuming the whole budget: a single user looping readings can trip the global
 * cap and take the app down for everyone else. That is a denial-of-service on
 * the other users bought with our own money, and neither of the other two
 * controls can distinguish it from genuine demand.
 *
 * ## Keys
 *
 * `quota:{kind}:{userId}:{YYYYMMDD}` in **Asia/Taipei**, matching S2. A UTC day
 * would roll at 08:00 local, so a user's "daily" allowance would reset in the
 * middle of their morning.
 *
 * ## Counted on ATTEMPT, not on success
 *
 * `consume` increments before the work runs. Refunding on failure would make the
 * quota gameable by inducing errors, and the resource being rationed is the
 * attempt — a failed generation still costs us tokens. The exception is a
 * request we refuse ourselves before spending anything, which never reaches
 * `consume` at all.
 *
 * ## Fails OPEN
 *
 * Same reasoning as S2's breaker: if Redis is unreachable we cannot know the
 * count, and refusing everyone on a cache blip converts a monitoring outage into
 * a full outage. S1 and S2 remain in force in that window.
 */

export type QuotaKind = 'reading' | 'chat' | 'fortune';

export const QUOTA_EXCEEDED_CODE = 'QUOTA_EXCEEDED';

/** Per A4's spec. Well above genuine use — these bound abuse, not behaviour. */
const DEFAULT_LIMITS: Record<QuotaKind, number> = {
  reading: 20,
  chat: 200,
  fortune: 30,
};

const ENV_KEY: Record<QuotaKind, string> = {
  reading: 'QUOTA_READINGS_PER_DAY',
  chat: 'QUOTA_CHAT_MESSAGES_PER_DAY',
  fortune: 'QUOTA_FORTUNE_PER_DAY',
};

/** Comfortably past any Taipei day, so a counter never expires mid-day. */
const KEY_TTL_SECONDS = 60 * 60 * 36;

const FRIENDLY: Record<QuotaKind, string> = {
  reading: '今日的解讀次數已達上限，請明天再試。',
  chat: '今日的對話次數已達上限，請明天再試。',
  fortune: '今日的運勢查詢次數已達上限，請明天再試。',
};

@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** `0` disables that quota — the documented rollback. */
  limitFor(kind: QuotaKind): number {
    const raw = this.config.get<string | number>(ENV_KEY[kind]);
    const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
    // A malformed value must not silently become 0 (blocks everyone) or
    // Infinity (disables the control). Fall back to the documented default.
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_LIMITS[kind];
    return parsed;
  }

  /** `YYYYMMDD` in Asia/Taipei — same day boundary as the S2 spend ledger. */
  dayKey(now: Date = new Date()): string {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(now)
      .replace(/-/g, '');
  }

  private key(kind: QuotaKind, userId: string, now?: Date): string {
    return `quota:${kind}:${userId}:${this.dayKey(now)}`;
  }

  /**
   * Count one attempt and throw a typed 429 if it puts the user over.
   *
   * ⚠️ Call BEFORE the credit deduction. The plan is explicit that where the
   * flow allows it, quota is checked first — a user who is over quota should be
   * told so, not charged and then refused. Where a deduction has already
   * happened, the throw rides the existing refund path like every other typed
   * refusal.
   *
   * Increment-then-compare, not read-then-increment: `INCR` is atomic, so N
   * concurrent requests get N distinct values and exactly the ones past the
   * limit are refused. A read-then-increment would let a burst all observe the
   * same under-limit count and all pass.
   */
  async consume(kind: QuotaKind, userId: string, count = 1): Promise<void> {
    const limit = this.limitFor(kind);
    if (limit === 0) return;

    let used: number;
    try {
      used = await this.redis.incrementRateLimit(this.key(kind, userId), KEY_TTL_SECONDS);
      // A multi-unit consume still needs to land atomically per unit; callers
      // only ever take 1 today, so the loop below stays a guard rather than a
      // hot path.
      for (let i = 1; i < count; i++) {
        used = await this.redis.incrementRateLimit(this.key(kind, userId), KEY_TTL_SECONDS);
      }
    } catch (err) {
      // Fail OPEN — see the class docblock. S1 and S2 still apply.
      this.logger.error(
        `Quota check unavailable for ${kind}/${userId} — ALLOWING. ${err}`,
      );
      return;
    }

    if (used > limit) {
      this.logger.warn(`Quota exceeded: ${kind} ${used}/${limit} for user ${userId}`);
      throw new HttpException(
        { code: QUOTA_EXCEEDED_CODE, message: FRIENDLY[kind], kind, limit },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Read-only, for an ops endpoint or a "N left today" hint. */
  async peek(kind: QuotaKind, userId: string): Promise<{ used: number; limit: number }> {
    const limit = this.limitFor(kind);
    try {
      const used = await this.redis.getRateLimit(this.key(kind, userId));
      return { used, limit };
    } catch {
      return { used: 0, limit };
    }
  }
}
