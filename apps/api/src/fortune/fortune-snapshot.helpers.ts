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
import * as Sentry from '@sentry/nestjs';
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
  type MonthlyEngineOutput,
  type YearlyEngineOutput,
} from './fortune-prompt-builder';
import {
  type DailyFortuneResponse,
  type DailyFortuneAINarrative,
  type MonthlyFortuneResponse,
  type MonthlyFortuneAINarrative,
  type YearlyFortuneResponse,
  type YearlyFortuneAINarrative,
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
// Monthly constants (Phase 2.x — mirror daily pattern)
// ============================================================

/** Free user can see ONLY the current month. */
export const FREE_MONTH_WINDOW_FUTURE = 0;
export const FREE_MONTH_WINDOW_PAST = 0;

/** Subscriber month window per locked plan: -1 month + current + +12 months INCLUSIVE. */
export const SUBSCRIBER_MONTH_WINDOW_FUTURE = 12;
export const SUBSCRIBER_MONTH_WINDOW_PAST = 1;

/** Monthly endpoint timeout — heavier than daily (cross-flow-year compute + L1.b breakdown). */
export const MONTHLY_ENGINE_TIMEOUT_MS = 60_000;

// ============================================================
// Yearly constants (Phase 3 — mirror monthly pattern)
// ============================================================

/** Free user can see ONLY the current year. */
export const FREE_YEAR_WINDOW_FUTURE = 0;
export const FREE_YEAR_WINDOW_PAST = 0;

/** Subscriber year window per locked plan v? (Phase A): -1 year + current + +4 years INCLUSIVE.
 *  Matches Seer's 6-pill year selector. */
export const SUBSCRIBER_YEAR_WINDOW_FUTURE = 4;
export const SUBSCRIBER_YEAR_WINDOW_PAST = 1;

/** Yearly endpoint timeout — heavier than daily (12-month aggregation compute). */
export const YEARLY_ENGINE_TIMEOUT_MS = 60_000;

// ============================================================
// Energy/label divergence canary (L5 post-deploy safeguard)
// ============================================================

/** Label → energy-score midpoint. MIRROR of
 *  packages/bazi-engine/app/fortune_constants.py::LABEL_TO_ENERGY_SCORE.
 *  The engine DERIVES energyScore from the auspiciousness label via
 *  derive_energy_score(), so the two must always agree. A divergence here
 *  means the engine desynced label↔score (or a label fell out of the table)
 *  — surfaced as a Sentry anomaly. KEEP IN SYNC with the Python constant
 *  (the 9-label system is the engine's source of truth and rarely changes). */
export const LABEL_TO_ENERGY_MIDPOINT: Record<string, number> = {
  大吉: 88,
  吉: 72,
  吉中有凶: 58,
  平: 50,
  凶中有吉: 42,
  小凶: 35,
  凶: 25,
  大凶: 15,
  凶上加凶: 8,
};

/** Divergence beyond this (|energyScore − label midpoint|) trips the canary. */
export const ENERGY_LABEL_DIVERGENCE_THRESHOLD = 10;

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
  // Energy/label divergence canary (L5 post-deploy safeguard)
  // ============================================================

  /** L5 safeguard: the engine derives `energyScore` from the auspiciousness
   *  label, so they must agree. If `|energyScore − midpoint(label)| > 10`
   *  (or the label is unknown), something desynced — emit a Sentry anomaly so
   *  ops catches engine/label drift in production. Telemetry-only: never
   *  throws, never blocks the response. Called at the engine-fetch boundary
   *  (covers daily/monthly/yearly × streaming/non-streaming on cache miss;
   *  cache hits were already checked when first fetched). Returns the diff for
   *  unit-test assertions. */
  checkEnergyLabelDivergence(
    scope: 'day' | 'month' | 'year',
    energyScore: number,
    auspiciousnessLabel: string,
  ): { anomaly: boolean; diff: number | null } {
    const midpoint = LABEL_TO_ENERGY_MIDPOINT[auspiciousnessLabel];
    if (midpoint === undefined) {
      this.logger.warn(
        `metric.fortune.energy_label_anomaly scope=${scope} reason=unknown_label label=${auspiciousnessLabel} score=${energyScore}`,
      );
      Sentry.captureMessage(
        `Fortune energy/label anomaly: unknown auspiciousness label «${auspiciousnessLabel}» (${scope})`,
        { level: 'warning', tags: { feature: 'fortune', scope, anomaly: 'unknown_label' } },
      );
      return { anomaly: true, diff: null };
    }
    const diff = Math.abs(energyScore - midpoint);
    if (diff > ENERGY_LABEL_DIVERGENCE_THRESHOLD) {
      this.logger.warn(
        `metric.fortune.energy_label_anomaly scope=${scope} label=${auspiciousnessLabel} score=${energyScore} midpoint=${midpoint} diff=${diff}`,
      );
      Sentry.captureMessage(
        `Fortune energy/label divergence >${ENERGY_LABEL_DIVERGENCE_THRESHOLD}: ${scope} score=${energyScore} label=${auspiciousnessLabel} midpoint=${midpoint} diff=${diff}`,
        { level: 'warning', tags: { feature: 'fortune', scope, anomaly: 'score_divergence' } },
      );
      return { anomaly: true, diff };
    }
    return { anomaly: false, diff };
  }

  // ============================================================
  // Engine call — POST /daily-fortune
  // ============================================================

  async fetchDailyFromEngine(
    profile: {
      birthDate: Date;
      birthTime: string | null;
      birthCity: string;
      birthTimezone: string;
      gender: string;
      birthLongitude: number | null;
      birthLatitude: number | null;
      hourKnown: boolean;
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
          hour_known: profile.hourKnown ?? true,
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
    const data = json.data as DailyEngineOutput;
    this.checkEnergyLabelDivergence('day', data.energyScore, data.auspiciousness);
    return data;
  }

  /** Minimal fallback for chart context when the engine response is
   *  missing it (shouldn't happen since /daily-fortune now attaches
   *  chartContext, but defensive). Mostly empty strings so the AI prompt
   *  doesn't render literal '?' placeholders.
   */
  buildFallbackChartContext(
    profile: { birthDate: Date; birthTime: string | null; gender: string; hourKnown: boolean },
  ): FortuneChartContext {
    this.logger.warn('Engine response missing chartContext — using fallback');
    return {
      gender: profile.gender,
      birthDate: profile.birthDate.toISOString().slice(0, 10),
      birthTime: profile.birthTime ?? '',
      hourKnown: profile.hourKnown ?? true,
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
        // Engine data is deterministic + cheap — always refresh to current.
        engineOutputJson: args.dailyOutput as unknown as Prisma.InputJsonValue,
        energyScore: args.dailyOutput.energyScore,
        auspiciousnessLabel: args.dailyOutput.auspiciousness,
        preAnalysisVersion: FORTUNE_PRE_ANALYSIS_VERSIONS.day,
        generatedAt: new Date(),
        ...(args.narrative
          ? {
              // SUCCESS — store new narrative + its prompt version, reset breaker.
              aiNarrativeJson: args.narrative as unknown as Prisma.InputJsonValue,
              promptVersion: args.promptVersion,
              aiFailureCount: 0,
              aiLastFailedAt: null,
            }
          : {
              // FAILURE — last-known-good preservation. Do NOT overwrite
              // `aiNarrativeJson` with null: a transient AI outage (e.g. credit
              // exhausted) or a prompt-version bump must never DESTROY a
              // previously-rendered reading. Omitting the field leaves the
              // column untouched. promptVersion=null keeps the circuit breaker
              // armed (keyed on null + failureCount); once it opens, the
              // cache-hit path serves the preserved LKG narrative — the page
              // never blanks for a chart that has ever rendered.
              // Atomic `{ increment: 1 }` is race-safe vs a JS read-modify-write.
              promptVersion: null,
              aiFailureCount: { increment: 1 },
              aiLastFailedAt: new Date(),
            }),
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

  // ============================================================
  // Phase 2.x — Monthly helpers (mirror daily helpers above)
  // ============================================================
  //
  // Consumed by BOTH FortuneService.getMonthlyFortune (non-streaming
  // /api/fortune/monthly) AND FortuneStreamService.streamMonthlyFortune
  // (SSE /api/fortune/monthly/stream) so the cache + persist invariants
  // stay identical across paths. Contract test in
  // fortune-snapshot.helpers.monthly.contract.spec.ts asserts byte-identity.

  /** Subscription gate for month scope: -1 / current / +12 INCLUSIVE. */
  enforceMonthlySubscriptionGate(tier: SubscriptionTier, targetMonth: string): void {
    const currentMonth = this.currentMonthIso();
    const diffMonths = this.diffMonthsIso(currentMonth, targetMonth);

    if (tier === SubscriptionTier.FREE) {
      if (
        diffMonths < -FREE_MONTH_WINDOW_PAST ||
        diffMonths > FREE_MONTH_WINDOW_FUTURE
      ) {
        throw new ForbiddenException({
          code: 'SUBSCRIBER_ONLY',
          message: '此功能限訂閱用戶 — 免費用戶僅可查看當月運勢',
        });
      }
      return;
    }

    if (
      diffMonths < -SUBSCRIBER_MONTH_WINDOW_PAST ||
      diffMonths > SUBSCRIBER_MONTH_WINDOW_FUTURE
    ) {
      throw new ForbiddenException({
        code: 'OUT_OF_WINDOW',
        message: `月運可查範圍：上個月 + 本月 + 未來 ${SUBSCRIBER_MONTH_WINDOW_FUTURE} 個月`,
      });
    }
  }

  /** Current month YYYY-MM in FORTUNE_DEFAULT_TZ (Asia/Taipei). */
  currentMonthIso(): string {
    const tz = this.config.get<string>('FORTUNE_DEFAULT_TZ') || 'Asia/Taipei';
    // 'sv-SE' produces YYYY-MM-DD; slice to YYYY-MM
    return new Intl.DateTimeFormat('sv-SE', { timeZone: tz })
      .format(new Date())
      .slice(0, 7);
  }

  /** Whole-months difference (target - reference). Both YYYY-MM. */
  diffMonthsIso(reference: string, target: string): number {
    const [ry, rm] = reference.split('-').map(Number);
    const [ty, tm] = target.split('-').map(Number);
    return (ty! - ry!) * 12 + (tm! - rm!);
  }

  /** Redis key for monthly cache: `fortune:monthly:{chartHash}:{YYYY-MM}`. */
  monthlyRedisKey(chartHash: string, yearMonth: string): string {
    return `fortune:monthly:${chartHash}:${yearMonth}`;
  }

  /** Try Redis → DB lookup for monthly snapshot. Returns null on miss/stale.
   *
   *  Signature mirrors daily `tryGetCached(chartHash, dateIso)`: 2-arg form,
   *  caller passes `anchorDate` (1st of month at 00:00 UTC). Helper derives
   *  `yearMonth = anchorDate.toISOString().slice(0,7)` internally → builds
   *  Redis key via `monthlyRedisKey`. Implementer doesn't pre-build the key.
   */
  async tryGetMonthlyCached(
    chartHash: string,
    anchorDate: Date,
  ): Promise<DailyFortuneSnapshot | null> {
    const yearMonth = anchorDate.toISOString().slice(0, 7);
    const redisKey = this.monthlyRedisKey(chartHash, yearMonth);

    // Redis hot path
    const cached = await this.redis.get(redisKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as DailyFortuneSnapshot;
        // Restore Date columns (matches daily tryGetCached pattern — JSON
        // serialization leaves them as ISO strings).
        if (typeof (parsed as unknown as { generatedAt: unknown }).generatedAt === 'string') {
          parsed.generatedAt = new Date(parsed.generatedAt as unknown as string);
        }
        if (typeof (parsed as unknown as { anchorDate: unknown }).anchorDate === 'string') {
          parsed.anchorDate = new Date(parsed.anchorDate as unknown as string);
        }
        if (this.monthlyVersionsMatch(parsed)) {
          return parsed;
        }
      } catch {
        // fall through to DB
      }
    }

    // DB warm path
    const dbRow = await this.prisma.dailyFortuneSnapshot.findUnique({
      where: {
        chartHash_scope_anchorDate: {
          chartHash,
          scope: FortuneScope.MONTH,
          anchorDate,
        },
      },
    });

    if (!dbRow) return null;
    if (!this.monthlyVersionsMatch(dbRow)) {
      this.logger.debug(
        `MonthlyFortuneSnapshot ${dbRow.id} stale — regenerating`,
      );
      return null;
    }

    // Warm Redis from DB (best-effort — failure doesn't block response)
    try {
      await this.redis.set(redisKey, JSON.stringify(dbRow), REDIS_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(
        `Failed to warm Redis monthly from DB ${dbRow.id}: ${(err as Error).message}`,
      );
    }
    return dbRow;
  }

  /** Check pre-analysis + prompt versions match current month-scope versions.
   *
   *  HIGH H1 audit fix (Phase 2.x — 2026-05-28): mirror daily versionsMatch
   *  circuit-breaker logic. Without this, `persistMonthlySnapshot` writes
   *  `aiFailureCount` / `aiLastFailedAt` columns but `monthlyVersionsMatch`
   *  never reads them → monthly will retry AI on EVERY request indefinitely
   *  during Anthropic outages, blowing the cost ceiling that daily's breaker
   *  protects. Now monthly + daily have invariant parity per the helpers-
   *  extraction rationale.
   */
  monthlyVersionsMatch(row: {
    preAnalysisVersion: string;
    promptVersion: string | null;
    aiFailureCount?: number | null;
    aiLastFailedAt?: Date | string | null;
  }): boolean {
    if (row.preAnalysisVersion !== FORTUNE_PRE_ANALYSIS_VERSIONS.month) return false;
    if (row.promptVersion === FORTUNE_PROMPT_VERSIONS.month) return true;
    if (row.promptVersion !== null) return false;
    // Circuit breaker: AI previously failed (promptVersion=null). Only retry
    // if under failure cap OR backoff window has elapsed.
    const failureCount = row.aiFailureCount ?? 0;
    if (failureCount < MAX_AI_FAILURES) return false;  // not at cap yet → retry
    const lastFailedAt = row.aiLastFailedAt
      ? new Date(row.aiLastFailedAt as Date | string)
      : null;
    if (!lastFailedAt) return false;  // hit cap but no timestamp — safer to retry
    const backoffMs = AI_FAILURE_BACKOFF_HOURS * 60 * 60 * 1000;
    const stillInBackoff = lastFailedAt.getTime() + backoffMs > Date.now();
    return stillInBackoff;  // true = serve engine-only; false = retry AI
  }

  /** Call Python engine /monthly-fortune endpoint. */
  async fetchMonthlyFromEngine(
    profile: {
      birthDate: Date;
      birthTime: string | null;
      birthCity: string;
      birthTimezone: string;
      gender: string;
      birthLongitude: number | null;
      birthLatitude: number | null;
      hourKnown: boolean;
    },
    year: number,
    month: number,
  ): Promise<MonthlyEngineOutput> {
    const birthDateIso = profile.birthDate.toISOString().slice(0, 10);

    let response: Response;
    try {
      response = await fetch(`${this.baziEngineUrl}/monthly-fortune`, {
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
          target_year: year,
          target_month: month,
          hour_known: profile.hourKnown ?? true,
        }),
        signal: AbortSignal.timeout(MONTHLY_ENGINE_TIMEOUT_MS),
      });
    } catch (err) {
      throw new InternalServerErrorException(
        `Bazi engine unreachable: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Engine /monthly-fortune ${response.status}: ${body}`);
      throw new InternalServerErrorException(`Bazi engine returned ${response.status}`);
    }

    const json = (await response.json()) as { data?: MonthlyEngineOutput };
    if (!json.data) {
      throw new InternalServerErrorException('Engine response missing data');
    }
    this.checkEnergyLabelDivergence('month', json.data.energyScore, json.data.auspiciousness);
    return json.data;
  }

  /** Persist monthly snapshot (DB upsert). Anchor = 1st of month at 00:00 UTC. */
  async persistMonthlySnapshot(args: {
    chartHash: string;
    birthProfileId: string;
    anchorDate: Date;
    yearMonth: string;
    monthlyOutput: MonthlyEngineOutput;
    narrative: MonthlyFortuneAINarrative | null;
    promptVersion: string | null;
  }): Promise<DailyFortuneSnapshot> {
    const engineJson = args.monthlyOutput as unknown as Prisma.InputJsonValue;
    const narrativeJson = args.narrative
      ? (args.narrative as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull;

    return this.prisma.dailyFortuneSnapshot.upsert({
      where: {
        chartHash_scope_anchorDate: {
          chartHash: args.chartHash,
          scope: FortuneScope.MONTH,
          anchorDate: args.anchorDate,
        },
      },
      create: {
        chartHash: args.chartHash,
        birthProfileId: args.birthProfileId,
        scope: FortuneScope.MONTH,
        anchorDate: args.anchorDate,
        yearMonth: args.yearMonth,
        engineOutputJson: engineJson,
        aiNarrativeJson: narrativeJson,
        energyScore: args.monthlyOutput.energyScore,
        auspiciousnessLabel: args.monthlyOutput.auspiciousness,
        preAnalysisVersion: FORTUNE_PRE_ANALYSIS_VERSIONS.month,
        promptVersion: args.promptVersion,
        aiFailureCount: args.promptVersion === null ? 1 : 0,
        aiLastFailedAt: args.promptVersion === null ? new Date() : null,
      },
      update: {
        // Engine data is deterministic + cheap — always refresh to current.
        engineOutputJson: engineJson,
        energyScore: args.monthlyOutput.energyScore,
        auspiciousnessLabel: args.monthlyOutput.auspiciousness,
        preAnalysisVersion: FORTUNE_PRE_ANALYSIS_VERSIONS.month,
        generatedAt: new Date(),
        ...(args.narrative
          ? {
              // SUCCESS — store new narrative + its prompt version, reset breaker.
              aiNarrativeJson: narrativeJson,
              promptVersion: args.promptVersion,
              aiFailureCount: 0,
              aiLastFailedAt: null,
            }
          : {
              // FAILURE — last-known-good preservation (see persistSnapshot
              // for the full rationale). Omitting aiNarrativeJson keeps a
              // previously-rendered reading alive across a failed regen.
              promptVersion: null,
              aiFailureCount: { increment: 1 },
              aiLastFailedAt: new Date(),
            }),
      },
    });
  }

  /** Build the wire response from a persisted/cached monthly snapshot.
   *
   *  Phase 2.x glossary lock: `intraMonthBreakdown` is a SIBLING of
   *  `engineOutput` on `MonthlyFortuneResponse` (NOT nested inside).
   *  Engine emits it at top level of `engineOutputJson`; we lift it
   *  to the wire response's top level.
   */
  buildMonthlyResponse(
    profileId: string,
    profileBirthDate: string,
    profileBirthTime: string,
    targetMonth: string,
    snapshot: DailyFortuneSnapshot,
    cacheHit: boolean,
  ): MonthlyFortuneResponse {
    const raw = snapshot.engineOutputJson as unknown;
    if (
      raw === null ||
      typeof raw !== 'object' ||
      !('monthStem' in (raw as object)) ||
      !('auspiciousness' in (raw as object)) ||
      !('dimensions' in (raw as object)) ||
      !('partitionSpec' in (raw as object))
    ) {
      this.logger.error(
        `Monthly snapshot ${snapshot.id} has malformed engineOutputJson — regenerating`,
      );
      throw new InternalServerErrorException(
        'Monthly fortune snapshot data is malformed — please retry',
      );
    }
    // MEDIUM M1 audit fix — extract intraMonthBreakdown BEFORE building
    // engineOutput, then strip it from engineOutput's nested shape so the
    // field appears ONLY at top-level (sibling) per Glossary lock. Without
    // this, the field would leak into BOTH `response.engineOutput.intraMonthBreakdown`
    // (nested, untyped) AND `response.intraMonthBreakdown` (sibling, typed).
    // Glossary lock says sibling-only — strip explicitly to prevent FE drift.
    const rawObj = raw as Record<string, unknown> & {
      intraMonthBreakdown?: MonthlyFortuneResponse['intraMonthBreakdown'];
    };
    const intraMonthBreakdown = rawObj.intraMonthBreakdown;
    // Destructure to omit intraMonthBreakdown from the engineOutput typed object
    const { intraMonthBreakdown: _unused, ...engineOutputBare } = rawObj;
    void _unused;  // silence unused-variable lint
    const engineOutput = engineOutputBare as MonthlyFortuneResponse['engineOutput'];

    const narrative = snapshot.aiNarrativeJson as unknown as MonthlyFortuneAINarrative | null;
    const flowYear = (engineOutput as unknown as { flowYear?: number }).flowYear
      ?? Number(targetMonth.slice(0, 4));

    return {
      month: targetMonth,
      flowYear,
      profileId,
      profileBirthDate,
      profileBirthTime,
      engineOutput,
      narrative,
      intraMonthBreakdown,
      cacheHit,
      generatedAt: snapshot.generatedAt.toISOString(),
    };
  }

  // ============================================================
  // Phase 3 — Yearly helpers (mirror monthly helpers above)
  // ============================================================
  //
  // Consumed by BOTH FortuneService.getYearlyFortune (non-streaming
  // /api/fortune/yearly) AND FortuneStreamService.streamYearlyFortune
  // (SSE /api/fortune/yearly/stream) so the cache + persist invariants
  // stay identical across paths — same rationale as the monthly helpers.
  //
  // Key difference from monthly: the yearly engine output has NO
  // `intraMonthBreakdown` sibling. `coreRiskOpportunity` + `luckMethods`
  // live INSIDE engineOutput (not lifted to a sibling), so buildYearlyResponse
  // passes engineOutput through unmodified — no destructure-strip needed.

  /** Subscription gate for year scope: -1 / current / +4 INCLUSIVE. */
  enforceYearlySubscriptionGate(tier: SubscriptionTier, targetYear: string): void {
    const currentYear = this.currentYearIso();
    const diffYears = this.diffYearsIso(currentYear, targetYear);

    if (tier === SubscriptionTier.FREE) {
      if (
        diffYears < -FREE_YEAR_WINDOW_PAST ||
        diffYears > FREE_YEAR_WINDOW_FUTURE
      ) {
        throw new ForbiddenException({
          code: 'SUBSCRIBER_ONLY',
          message: '此功能限訂閱用戶 — 免費用戶僅可查看當年運勢',
        });
      }
      return;
    }

    if (
      diffYears < -SUBSCRIBER_YEAR_WINDOW_PAST ||
      diffYears > SUBSCRIBER_YEAR_WINDOW_FUTURE
    ) {
      throw new ForbiddenException({
        code: 'OUT_OF_WINDOW',
        message: `年運可查範圍：去年 + 今年 + 未來 ${SUBSCRIBER_YEAR_WINDOW_FUTURE} 年`,
      });
    }
  }

  /** Current year YYYY in FORTUNE_DEFAULT_TZ (Asia/Taipei). */
  currentYearIso(): string {
    const tz = this.config.get<string>('FORTUNE_DEFAULT_TZ') || 'Asia/Taipei';
    // 'sv-SE' produces YYYY-MM-DD; slice to YYYY
    return new Intl.DateTimeFormat('sv-SE', { timeZone: tz })
      .format(new Date())
      .slice(0, 4);
  }

  /** Whole-years difference (target - reference). Both YYYY. */
  diffYearsIso(reference: string, target: string): number {
    return Number(target) - Number(reference);
  }

  /** Redis key for yearly cache: `fortune:yearly:{chartHash}:{YYYY}`. */
  yearlyRedisKey(chartHash: string, year: string): string {
    return `fortune:yearly:${chartHash}:${year}`;
  }

  /** Try Redis → DB lookup for yearly snapshot. Returns null on miss/stale.
   *
   *  Signature mirrors monthly `tryGetMonthlyCached(chartHash, anchorDate)`:
   *  caller passes `anchorDate` (Jan 1 at 00:00 UTC). Helper derives
   *  `year = anchorDate.toISOString().slice(0,4)` internally → builds the
   *  Redis key via `yearlyRedisKey`.
   */
  async tryGetYearlyCached(
    chartHash: string,
    anchorDate: Date,
  ): Promise<DailyFortuneSnapshot | null> {
    const year = anchorDate.toISOString().slice(0, 4);
    const redisKey = this.yearlyRedisKey(chartHash, year);

    // Redis hot path
    const cached = await this.redis.get(redisKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as DailyFortuneSnapshot;
        // Restore Date columns (matches monthly tryGetMonthlyCached — JSON
        // serialization leaves them as ISO strings; daily A5-1 fix pattern).
        if (typeof (parsed as unknown as { generatedAt: unknown }).generatedAt === 'string') {
          parsed.generatedAt = new Date(parsed.generatedAt as unknown as string);
        }
        if (typeof (parsed as unknown as { anchorDate: unknown }).anchorDate === 'string') {
          parsed.anchorDate = new Date(parsed.anchorDate as unknown as string);
        }
        if (this.yearlyVersionsMatch(parsed)) {
          return parsed;
        }
      } catch {
        // fall through to DB
      }
    }

    // DB warm path
    const dbRow = await this.prisma.dailyFortuneSnapshot.findUnique({
      where: {
        chartHash_scope_anchorDate: {
          chartHash,
          scope: FortuneScope.YEAR,
          anchorDate,
        },
      },
    });

    if (!dbRow) return null;
    if (!this.yearlyVersionsMatch(dbRow)) {
      this.logger.debug(
        `YearlyFortuneSnapshot ${dbRow.id} stale — regenerating`,
      );
      return null;
    }

    // Warm Redis from DB (best-effort — failure doesn't block response)
    try {
      await this.redis.set(redisKey, JSON.stringify(dbRow), REDIS_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(
        `Failed to warm Redis yearly from DB ${dbRow.id}: ${(err as Error).message}`,
      );
    }
    return dbRow;
  }

  /** Check pre-analysis + prompt versions match current year-scope versions.
   *  Circuit-breaker logic IDENTICAL to monthlyVersionsMatch (3 failures +
   *  24h backoff; NULL promptVersion treated as stale → AI retried). */
  yearlyVersionsMatch(row: {
    preAnalysisVersion: string;
    promptVersion: string | null;
    aiFailureCount?: number | null;
    aiLastFailedAt?: Date | string | null;
  }): boolean {
    if (row.preAnalysisVersion !== FORTUNE_PRE_ANALYSIS_VERSIONS.year) return false;
    if (row.promptVersion === FORTUNE_PROMPT_VERSIONS.year) return true;
    if (row.promptVersion !== null) return false;
    // Circuit breaker: AI previously failed (promptVersion=null). Only retry
    // if under failure cap OR backoff window has elapsed.
    const failureCount = row.aiFailureCount ?? 0;
    if (failureCount < MAX_AI_FAILURES) return false;  // not at cap yet → retry
    const lastFailedAt = row.aiLastFailedAt
      ? new Date(row.aiLastFailedAt as Date | string)
      : null;
    if (!lastFailedAt) return false;  // hit cap but no timestamp — safer to retry
    const backoffMs = AI_FAILURE_BACKOFF_HOURS * 60 * 60 * 1000;
    const stillInBackoff = lastFailedAt.getTime() + backoffMs > Date.now();
    return stillInBackoff;  // true = serve engine-only; false = retry AI
  }

  /** Call Python engine /yearly-fortune endpoint. */
  async fetchYearlyFromEngine(
    profile: {
      birthDate: Date;
      birthTime: string | null;
      birthCity: string;
      birthTimezone: string;
      gender: string;
      birthLongitude: number | null;
      birthLatitude: number | null;
      hourKnown: boolean;
    },
    year: number,
  ): Promise<YearlyEngineOutput> {
    const birthDateIso = profile.birthDate.toISOString().slice(0, 10);

    let response: Response;
    try {
      response = await fetch(`${this.baziEngineUrl}/yearly-fortune`, {
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
          target_year: year,
          hour_known: profile.hourKnown ?? true,
        }),
        signal: AbortSignal.timeout(YEARLY_ENGINE_TIMEOUT_MS),
      });
    } catch (err) {
      throw new InternalServerErrorException(
        `Bazi engine unreachable: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Engine /yearly-fortune ${response.status}: ${body}`);
      throw new InternalServerErrorException(`Bazi engine returned ${response.status}`);
    }

    const json = (await response.json()) as { data?: YearlyEngineOutput };
    if (!json.data) {
      throw new InternalServerErrorException('Engine response missing data');
    }
    this.checkEnergyLabelDivergence('year', json.data.energyScore, json.data.auspiciousness);
    return json.data;
  }

  /** Persist yearly snapshot (DB upsert). Anchor = Jan 1 at 00:00 UTC. */
  async persistYearlySnapshot(args: {
    chartHash: string;
    birthProfileId: string;
    anchorDate: Date;
    year: number;
    yearlyOutput: YearlyEngineOutput;
    narrative: YearlyFortuneAINarrative | null;
    promptVersion: string | null;
  }): Promise<DailyFortuneSnapshot> {
    const engineJson = args.yearlyOutput as unknown as Prisma.InputJsonValue;
    const narrativeJson = args.narrative
      ? (args.narrative as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull;

    return this.prisma.dailyFortuneSnapshot.upsert({
      where: {
        chartHash_scope_anchorDate: {
          chartHash: args.chartHash,
          scope: FortuneScope.YEAR,
          anchorDate: args.anchorDate,
        },
      },
      create: {
        chartHash: args.chartHash,
        birthProfileId: args.birthProfileId,
        scope: FortuneScope.YEAR,
        anchorDate: args.anchorDate,
        year: args.year,
        engineOutputJson: engineJson,
        aiNarrativeJson: narrativeJson,
        energyScore: args.yearlyOutput.energyScore,
        auspiciousnessLabel: args.yearlyOutput.auspiciousness,
        preAnalysisVersion: FORTUNE_PRE_ANALYSIS_VERSIONS.year,
        promptVersion: args.promptVersion,
        aiFailureCount: args.promptVersion === null ? 1 : 0,
        aiLastFailedAt: args.promptVersion === null ? new Date() : null,
      },
      update: {
        // Engine data is deterministic + cheap — always refresh to current.
        engineOutputJson: engineJson,
        energyScore: args.yearlyOutput.energyScore,
        auspiciousnessLabel: args.yearlyOutput.auspiciousness,
        preAnalysisVersion: FORTUNE_PRE_ANALYSIS_VERSIONS.year,
        generatedAt: new Date(),
        ...(args.narrative
          ? {
              // SUCCESS — store new narrative + its prompt version, reset breaker.
              aiNarrativeJson: narrativeJson,
              promptVersion: args.promptVersion,
              aiFailureCount: 0,
              aiLastFailedAt: null,
            }
          : {
              // FAILURE — last-known-good preservation (see persistSnapshot
              // for the full rationale). Omitting aiNarrativeJson keeps a
              // previously-rendered reading alive across a failed regen.
              promptVersion: null,
              aiFailureCount: { increment: 1 },
              aiLastFailedAt: new Date(),
            }),
      },
    });
  }

  /** Build the wire response from a persisted/cached yearly snapshot.
   *
   *  Unlike monthly, yearly has NO `intraMonthBreakdown` sibling —
   *  `coreRiskOpportunity` + `luckMethods` live INSIDE engineOutput. So we
   *  pass engineOutput through unmodified (no destructure-strip / sibling lift).
   */
  buildYearlyResponse(
    profileId: string,
    profileBirthDate: string,
    profileBirthTime: string,
    year: number,
    snapshot: DailyFortuneSnapshot,
    cacheHit: boolean,
  ): YearlyFortuneResponse {
    const raw = snapshot.engineOutputJson as unknown;
    if (
      raw === null ||
      typeof raw !== 'object' ||
      !('yearGanZhi' in (raw as object)) ||
      !('auspiciousness' in (raw as object)) ||
      !('dimensions' in (raw as object)) ||
      !('energyScore' in (raw as object)) ||
      !('coreRiskOpportunity' in (raw as object)) ||
      !('luckMethods' in (raw as object))
    ) {
      this.logger.error(
        `Yearly snapshot ${snapshot.id} has malformed engineOutputJson — regenerating`,
      );
      throw new InternalServerErrorException(
        'Yearly fortune snapshot data is malformed — please retry',
      );
    }
    const engineOutput = raw as YearlyFortuneResponse['engineOutput'];
    const narrative = snapshot.aiNarrativeJson as unknown as YearlyFortuneAINarrative | null;

    return {
      year,
      profileId,
      profileBirthDate,
      profileBirthTime,
      engineOutput,
      narrative,
      cacheHit,
      generatedAt: snapshot.generatedAt.toISOString(),
    };
  }
}
