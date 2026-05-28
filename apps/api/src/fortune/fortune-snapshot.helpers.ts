/**
 * Shared helpers for the daily-fortune pipeline.
 *
 * Phase Fortune Streaming Layer 3 extracts these from `FortuneService` so
 * `FortuneStreamService` (the new SSE path) and `FortuneService` (the
 * existing typed-JSON path) consume identical implementations. Without this
 * module, the two services would inevitably drift on cache invariants (e.g.,
 * the `aiFailureCount` circuit breaker, the I5 malformed-JSON guard, the I1
 * NULL-promptVersion staleness rule). Plan v2 H2 + contract test in
 * `fortune-snapshot.helpers.contract.spec.ts` locks the invariant.
 *
 * Responsibility boundaries:
 *   - This module owns CACHE + PERSIST + ENGINE-FETCH + EXTRACT-JSON +
 *     subscription gate + chart-hash + Anthropic-client init.
 *   - `FortuneService.getDailyFortune` is the orchestrator: profile lookup,
 *     gate check, cache lookup, engine fetch, AI narration, persist, respond.
 *   - `FortuneStreamService.streamDailyFortune` is the streaming orchestrator:
 *     same outer steps, but AI step uses `messages.stream()` + section-by-
 *     section SSE emission with per-section banned-phrase strip.
 *
 * Both orchestrators MUST call helpers via this module — no inline duplicates.
 * The contract test asserts byte-identical snapshots + responses for the
 * same input across both code paths.
 */
import {
  Injectable,
  Logger,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  FortuneScope,
  Prisma,
  SubscriptionTier,
  type DailyFortuneSnapshot,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  FORTUNE_PRE_ANALYSIS_VERSIONS,
  FORTUNE_PROMPT_VERSIONS,
} from '../ai/prompts';
import {
  type DailyEngineOutput,
  type FortuneChartContext,
} from './fortune-prompt-builder';
import {
  type DailyFortuneResponse,
  type DailyFortuneAINarrative,
} from './dto';

// ============================================================
// Constants (re-exported so callers can import here vs. fortune.service.ts)
// ============================================================

/** Free user can see ONLY today's daily fortune. */
export const FREE_USER_WINDOW_DAYS_FUTURE = 0;
export const FREE_USER_WINDOW_DAYS_PAST = 0;

/** Subscriber window per locked plan: yesterday + today + +30 days. */
export const SUBSCRIBER_WINDOW_DAYS_FUTURE = 30;
export const SUBSCRIBER_WINDOW_DAYS_PAST = 1;

export const REDIS_TTL_SECONDS = 24 * 60 * 60; // 24 hours
export const ENGINE_REQUEST_TIMEOUT_MS = 30_000;

/** AI failure circuit breaker (PR review #4 — 2026-05-17).
 *  After MAX_AI_FAILURES consecutive failures on the same chart+date+scope,
 *  stop retrying AI for AI_FAILURE_BACKOFF_HOURS — serve engine-only output
 *  instead. Counter resets on a successful AI call (non-null promptVersion).
 *  Prevents unbounded Anthropic spend during sustained provider outages. */
export const MAX_AI_FAILURES = 3;
export const AI_FAILURE_BACKOFF_HOURS = 24;
export const AI_CALL_TIMEOUT_MS = 90_000;

// ============================================================
// FortuneSnapshotHelpers
// ============================================================

@Injectable()
export class FortuneSnapshotHelpers {
  private readonly logger = new Logger(FortuneSnapshotHelpers.name);
  readonly baziEngineUrl: string;
  private claudeClient: any = null;

  constructor(
    public readonly prisma: PrismaService,
    public readonly redis: RedisService,
    public readonly config: ConfigService,
  ) {
    this.baziEngineUrl = this.config.get<string>('BAZI_ENGINE_URL') || 'http://localhost:5001';
  }

  // ============================================================
  // Subscription gate
  // ============================================================

  enforceSubscriptionGate(tier: SubscriptionTier, targetDateIso: string): void {
    const today = this.todayIsoDate();
    const diffDays = this.daysBetween(today, targetDateIso);

    if (tier === SubscriptionTier.FREE) {
      if (diffDays < -FREE_USER_WINDOW_DAYS_PAST || diffDays > FREE_USER_WINDOW_DAYS_FUTURE) {
        throw new ForbiddenException({
          code: 'SUBSCRIBER_ONLY',
          message: '此功能限訂閱用戶 — 免費用戶僅可查看當日運勢',
        });
      }
      return;
    }

    // Subscriber tiers (BASIC/PRO/MASTER): yesterday + today + +30 days
    if (diffDays < -SUBSCRIBER_WINDOW_DAYS_PAST || diffDays > SUBSCRIBER_WINDOW_DAYS_FUTURE) {
      throw new ForbiddenException({
        code: 'OUT_OF_WINDOW',
        message: `日運可查範圍：昨日至今日後 ${SUBSCRIBER_WINDOW_DAYS_FUTURE} 天`,
      });
    }
  }

  // ============================================================
  // Cache lookup — Redis → DB → null
  // ============================================================

  async tryGetCached(
    chartHash: string,
    targetDateIso: string,
  ): Promise<DailyFortuneSnapshot | null> {
    // Redis hot path
    const redisKey = this.redisKey(chartHash, targetDateIso);
    const cached = await this.redis.get(redisKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as DailyFortuneSnapshot;
        // A5 bug fix: JSON.parse leaves Date columns as ISO strings,
        // but the typed cast lies and pretends they're Date objects.
        // Subsequent calls like `snapshot.generatedAt.toISOString()`
        // would then throw. Restore the proper shape here.
        if (typeof (parsed as unknown as { generatedAt: unknown }).generatedAt === 'string') {
          parsed.generatedAt = new Date(parsed.generatedAt as unknown as string);
        }
        if (typeof (parsed as unknown as { anchorDate: unknown }).anchorDate === 'string') {
          parsed.anchorDate = new Date(parsed.anchorDate as unknown as string);
        }
        if (this.versionsMatch(parsed)) {
          return parsed;
        }
      } catch {
        // Fall through to DB
      }
    }

    // DB warm path
    const dbRow = await this.prisma.dailyFortuneSnapshot.findUnique({
      where: {
        chartHash_scope_anchorDate: {
          chartHash,
          scope: FortuneScope.DAY,
          anchorDate: new Date(`${targetDateIso}T00:00:00Z`),
        },
      },
    });

    if (!dbRow) return null;
    if (!this.versionsMatch(dbRow)) {
      // Stale — fall through to regenerate
      this.logger.debug(
        `DailyFortuneSnapshot ${dbRow.id} stale (versions drifted) — regenerating`,
      );
      return null;
    }
    // Bug A5-3 fix: repopulate Redis from the DB warm path so subsequent
    // reads hit the fast Redis path instead of round-tripping to Postgres.
    // Failure here should NOT block the response — the snapshot is valid,
    // Redis is just a perf optimization.
    try {
      await this.redis.set(redisKey, JSON.stringify(dbRow), REDIS_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(
        `Failed to warm Redis from DB snapshot ${dbRow.id}: ${(err as Error).message}`,
      );
    }
    return dbRow;
  }

  /** Decide if a cached snapshot is fresh enough to serve as-is.
   *
   *  Two layers:
   *  1. Pre-analysis version match (mandatory — output schema contract).
   *  2. AI freshness: prompt version match, OR — when promptVersion is null
   *     (AI previously failed) — circuit-breaker check. If we've failed
   *     `MAX_AI_FAILURES` times in the last `AI_FAILURE_BACKOFF_HOURS`,
   *     treat the engine-only row as cache-valid and stop retrying AI.
   *
   *  PR review #4 (2026-05-17): the circuit breaker prevents an unbounded
   *  retry-loop during Anthropic outages. Without it, every request with a
   *  promptVersion=null row would re-call engine + AI forever.
   *
   *  The `?? 0` and `?? null` guards handle stale Redis entries from
   *  before the migration which deserialize without the new columns.
   */
  versionsMatch(row: {
    preAnalysisVersion: string;
    promptVersion: string | null;
    aiFailureCount?: number | null;
    aiLastFailedAt?: Date | string | null;
  }): boolean {
    if (row.preAnalysisVersion !== FORTUNE_PRE_ANALYSIS_VERSIONS.day) return false;
    // Audit I1: NULL promptVersion is treated as STALE relative to the
    // current prompt version. Previous logic (`null bypasses check`) meant
    // engine-only rows (AI failed once) were served forever even after
    // prompt bumps. Now we retry AI on subsequent fetches; if AI keeps
    // failing the row stays NULL but we attempted.
    if (row.promptVersion === FORTUNE_PROMPT_VERSIONS.day) return true;
    if (row.promptVersion !== null) return false; // mismatched non-null version → stale
    // Circuit breaker: AI previously failed. Only retry if under the
    // failure cap OR backoff window has elapsed.
    const failureCount = row.aiFailureCount ?? 0;
    if (failureCount < MAX_AI_FAILURES) return false; // not at cap yet → retry
    const lastFailedAt = row.aiLastFailedAt
      ? new Date(row.aiLastFailedAt as Date | string)
      : null;
    if (!lastFailedAt) return false; // hit cap but no timestamp — safer to retry
    const backoffMs = AI_FAILURE_BACKOFF_HOURS * 60 * 60 * 1000;
    const stillInBackoff = lastFailedAt.getTime() + backoffMs > Date.now();
    return stillInBackoff; // true = serve engine-only; false = retry AI
  }

  // ============================================================
  // Engine call — POST /daily-fortune
  // ============================================================

  async fetchDailyFromEngine(
    profile: {
      birthDate: Date;
      birthTime: string;
      birthCity: string;
      birthTimezone: string;
      gender: string;
      birthLongitude: number | null;
      birthLatitude: number | null;
    },
    targetDateIso: string,
  ): Promise<DailyEngineOutput> {
    const birthDateIso = profile.birthDate.toISOString().slice(0, 10);

    let response: Response;
    try {
      response = await fetch(`${this.baziEngineUrl}/daily-fortune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          birth_date: birthDateIso,
          birth_time: profile.birthTime,
          birth_city: profile.birthCity,
          birth_timezone: profile.birthTimezone,
          gender: profile.gender.toLowerCase(),
          birth_longitude: profile.birthLongitude,
          birth_latitude: profile.birthLatitude,
          target_date: targetDateIso,
        }),
        signal: AbortSignal.timeout(ENGINE_REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new InternalServerErrorException(
        `Bazi engine unreachable: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Engine /daily-fortune ${response.status}: ${body}`);
      throw new InternalServerErrorException(`Bazi engine returned ${response.status}`);
    }

    const json = await response.json();
    if (!json.data) {
      throw new InternalServerErrorException('Engine response missing data');
    }
    return json.data as DailyEngineOutput;
  }

  /** Minimal fallback for chart context when the engine response is
   *  missing it (shouldn't happen since /daily-fortune now attaches
   *  chartContext, but defensive). Mostly empty strings so the AI prompt
   *  doesn't render literal '?' placeholders.
   */
  buildFallbackChartContext(
    profile: { birthDate: Date; birthTime: string; gender: string },
  ): FortuneChartContext {
    this.logger.warn('Engine response missing chartContext — using fallback');
    return {
      gender: profile.gender,
      birthDate: profile.birthDate.toISOString().slice(0, 10),
      birthTime: profile.birthTime,
      lunarDate: null,
      yearPillar: '',
      monthPillar: '',
      dayPillar: '',
      hourPillar: '',
      yearTenGod: '',
      monthTenGod: '',
      hourTenGod: '',
      dayMaster: '',
      dayMasterElement: '',
      dayMasterYinYang: '',
      strengthV2: '',
      usefulGod: '',
      favorableGod: '',
      tabooGod: '',
      enemyGod: '',
    };
  }

  // ============================================================
  // AI client (Anthropic SDK)
  // ============================================================

  async ensureClaudeClient(): Promise<any> {
    if (this.claudeClient) return this.claudeClient;
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException('ANTHROPIC_API_KEY not configured');
    }
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    this.claudeClient = new Anthropic({ apiKey });
    return this.claudeClient;
  }

  // ============================================================
  // JSON extraction (Anthropic text → narrative object)
  // ============================================================

  /** Extract the `{ sections: {...} }` inner object from raw AI text.
   *
   *  Strips markdown fence wrappers + trailing remarks. Audit C3:
   *  Claude commonly appends a trailing remark («希望對您有幫助») after
   *  the JSON which would make a naïve `JSON.parse` throw and silently
   *  drop the entire narrative. Use first `{` and last `}` to bracket
   *  the JSON region.
   */
  extractJson(text: string): Record<string, unknown> | null {
    const cleaned = text.replace(/```json\s*|\s*```/g, '');
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
      return null;
    }
    try {
      const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      // The prompt asks for `{ sections: {...} }` — return the inner object
      if (parsed && typeof parsed === 'object' && 'sections' in parsed) {
        return parsed.sections as Record<string, unknown>;
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      this.logger.warn(`Fortune AI JSON parse failed: ${(err as Error).message}`);
      return null;
    }
  }

  // ============================================================
  // Persistence
  // ============================================================

  async persistSnapshot(args: {
    chartHash: string;
    birthProfileId: string;
    anchorDate: Date;
    dailyOutput: DailyEngineOutput;
    narrative: DailyFortuneAINarrative | null;
    promptVersion: string | null;
  }): Promise<DailyFortuneSnapshot> {
    return this.prisma.dailyFortuneSnapshot.upsert({
      where: {
        chartHash_scope_anchorDate: {
          chartHash: args.chartHash,
          scope: FortuneScope.DAY,
          anchorDate: args.anchorDate,
        },
      },
      create: {
        chartHash: args.chartHash,
        birthProfileId: args.birthProfileId,
        scope: FortuneScope.DAY,
        anchorDate: args.anchorDate,
        engineOutputJson: args.dailyOutput as unknown as Prisma.InputJsonValue,
        aiNarrativeJson: args.narrative
          ? (args.narrative as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        energyScore: args.dailyOutput.energyScore,
        auspiciousnessLabel: args.dailyOutput.auspiciousness,
        preAnalysisVersion: FORTUNE_PRE_ANALYSIS_VERSIONS.day,
        promptVersion: args.promptVersion,
        // Circuit breaker initial state — first row, AI either succeeded (0/null)
        // or failed (1/now). Subsequent failures use UPDATE block's atomic increment.
        aiFailureCount: args.promptVersion === null ? 1 : 0,
        aiLastFailedAt: args.promptVersion === null ? new Date() : null,
      },
      update: {
        engineOutputJson: args.dailyOutput as unknown as Prisma.InputJsonValue,
        aiNarrativeJson: args.narrative
          ? (args.narrative as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        energyScore: args.dailyOutput.energyScore,
        auspiciousnessLabel: args.dailyOutput.auspiciousness,
        preAnalysisVersion: FORTUNE_PRE_ANALYSIS_VERSIONS.day,
        promptVersion: args.promptVersion,
        generatedAt: new Date(),
        // Circuit breaker: increment atomically on failure (Prisma `{ increment: 1 }`
        // generates `SET ai_failure_count = ai_failure_count + 1` — race-safe vs
        // JS-level math which would need a prior SELECT). Reset on success.
        ...(args.promptVersion === null
          ? { aiFailureCount: { increment: 1 }, aiLastFailedAt: new Date() }
          : { aiFailureCount: 0, aiLastFailedAt: null }),
      },
    });
  }

  /**
   * Phase Fortune+ progressive loading helper: build a snapshot-shaped object
   * in memory WITHOUT writing to DB. Used for the `engineOnly=true` path so
   * the engine output can flow through the existing `buildResponse` pipeline.
   *
   * Why not persist: the subsequent full-fetch (issued in parallel by the
   * frontend) will run the AI and persist normally. Writing a no-AI snapshot
   * here would (a) trip the `aiFailureCount` circuit breaker (which treats
   * `promptVersion=null` as an AI failure for retry-throttling), and (b)
   * pollute Redis with a narrative=null payload that future readers would
   * have to regenerate anyway. Better to keep this purely transient.
   *
   * Returns a Prisma DailyFortuneSnapshot-shaped object — fields not relevant
   * to `buildResponse` (id, createdAt, etc.) are populated with placeholder
   * values that never leak to the wire.
   */
  buildInMemoryEngineSnapshot(args: {
    chartHash: string;
    birthProfileId: string;
    anchorDate: Date;
    dailyOutput: DailyEngineOutput;
  }): DailyFortuneSnapshot {
    return {
      id: 'in-memory-engine-only', // sentinel — never persisted, never read
      chartHash: args.chartHash,
      birthProfileId: args.birthProfileId,
      scope: FortuneScope.DAY,
      anchorDate: args.anchorDate,
      // Audit H2 fix: DAY-scope rows have `yearMonth` + `year` as NULL per
      // schema convention (those denormalized columns are only populated
      // for MONTH/YEAR scope). Matches what `persistSnapshot` writes for
      // a DAY row — keeps the in-memory shape byte-aligned with persisted
      // DAY shape so future consumers (debug endpoints, projections, etc.)
      // can't draw different conclusions from in-memory vs DB rows.
      yearMonth: null,
      year: null,
      engineOutputJson: args.dailyOutput as unknown as Prisma.JsonValue,
      aiNarrativeJson: null, // engine-only — narrative arrives via full fetch
      energyScore: args.dailyOutput.energyScore,
      auspiciousnessLabel: args.dailyOutput.auspiciousness,
      preAnalysisVersion: FORTUNE_PRE_ANALYSIS_VERSIONS.day,
      promptVersion: null,
      generatedAt: new Date(),
      // Audit M2 fix — STRONG WARNING: these are SENTINEL VALUES, NOT real
      // circuit-breaker state. AI never ran on this snapshot, so the values
      // 0/null semantically mean «no data» (NOT «AI succeeded»). Any future
      // helper introspecting snapshot.aiFailureCount for health checks MUST
      // first check `snapshot.id === 'in-memory-engine-only'` to filter
      // these sentinels out. Wire-side `DailyFortuneResponse` does not
      // expose these fields, so no immediate leak risk.
      aiFailureCount: 0,
      aiLastFailedAt: null,
    };
  }

  // ============================================================
  // Response shaping
  // ============================================================

  buildResponse(
    profileId: string,
    profileBirthDate: string,
    profileBirthTime: string,
    targetDateIso: string,
    snapshot: DailyFortuneSnapshot,
    cacheHit: boolean,
  ): DailyFortuneResponse {
    // Audit I5: runtime check the required shape of the engine output —
    // a stale cached row from a pre-v1.0.0 version (or a corrupted Json
    // payload) could lack required fields. We throw rather than silently
    // serve undefined fields.
    const raw = snapshot.engineOutputJson as unknown;
    if (
      raw === null ||
      typeof raw !== 'object' ||
      !('dayGanZhi' in (raw as object)) ||
      !('auspiciousness' in (raw as object)) ||
      !('dimensions' in (raw as object)) ||
      !('energyScore' in (raw as object))
    ) {
      this.logger.error(
        `Snapshot ${snapshot.id} has malformed engineOutputJson — likely stale schema; regenerating`,
      );
      throw new InternalServerErrorException(
        'Daily fortune snapshot data is malformed — please retry',
      );
    }
    const engineOutput = raw as DailyFortuneResponse['engineOutput'];
    const narrative = snapshot.aiNarrativeJson as unknown as DailyFortuneAINarrative | null;
    return {
      date: targetDateIso,
      profileId,
      profileBirthDate,
      profileBirthTime,
      engineOutput,
      narrative,
      cacheHit,
      generatedAt: snapshot.generatedAt.toISOString(),
    };
  }

  // ============================================================
  // Helpers
  // ============================================================

  computeChartHash(profile: {
    birthDate: Date;
    birthTime: string;
    birthCity: string;
    birthTimezone: string;
    gender: string;
  }): string {
    // Audit I4: include birthTimezone in the hash. The engine uses it for
    // 大運/流年 alignment (even with True Solar Time disabled), so two
    // profiles with same date/time/city but different TZ overrides
    // produce different chart contexts and must not share cache entries.
    const inputs = [
      profile.birthDate.toISOString().slice(0, 10),
      profile.birthTime,
      profile.birthCity,
      profile.birthTimezone,
      profile.gender,
    ].join('|');
    return createHash('sha256').update(inputs).digest('hex').slice(0, 32);
  }

  redisKey(chartHash: string, dateIso: string): string {
    return `fortune:daily:${chartHash}:${dateIso}`;
  }

  todayIsoDate(): string {
    // Per Bazi doctrine the day flips at 23:00 子時. The CLIENT is
    // expected to resolve that boundary and send `date` explicitly.
    //
    // When `date` is omitted we default to the current calendar date in
    // the FORTUNE_DEFAULT_TZ timezone (defaults to Asia/Taipei — the
    // platform's primary market: TW/HK/MY). This is NOT UTC: a server
    // running in UTC but serving Taipei users would otherwise report
    // yesterday's date between 16:00-23:59 UTC (= 00:00-07:59 next-day
    // Taipei). See audit Issue C1.
    const tz = this.config.get<string>('FORTUNE_DEFAULT_TZ') || 'Asia/Taipei';
    // 'sv-SE' produces YYYY-MM-DD natively
    return new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(new Date());
  }

  daysBetween(fromIso: string, toIso: string): number {
    const from = new Date(`${fromIso}T00:00:00Z`).getTime();
    const to = new Date(`${toIso}T00:00:00Z`).getTime();
    return Math.round((to - from) / (24 * 60 * 60 * 1000));
  }
}
