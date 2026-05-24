/**
 * Fortune service — 八字日運/月運/年運 orchestration.
 *
 * Plan: `.claude/plans/ok-next-big-feature-merry-cake.md`
 *
 * Phase 1: daily only. Monthly + yearly = Phase 2/3.
 *
 * Responsibilities:
 *   1. Resolve birth profile → chart hash
 *   2. Subscription gate for past/future dates
 *   3. Cache lookup (Redis + DB DailyFortuneSnapshot)
 *   4. Engine call → /daily-fortune
 *   5. AI narration via Anthropic SDK (mirrors AIService pattern)
 *   6. Validator sweep (banned phrases + folk-fabrication + soft-trigger framing)
 *   7. Persist + return
 *
 * Subscription window (per locked plan):
 *   - Free: today only (1 day window)
 *   - Subscriber (BASIC/PRO/MASTER): yesterday + today + +30 days
 *   - Past beyond 1 day = 403 even for subscribers (intentional)
 */
import {
  Injectable,
  Logger,
  NotFoundException,
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
  FORTUNE_V1_PROMPTS,
} from '../ai/prompts';
import {
  type DailyEngineOutput,
  type FortuneChartContext,
  buildFortuneDailyMessages,
} from './fortune-prompt-builder';
import {
  FortuneValidatorsService,
  type FortuneValidationResult,
} from './fortune-validators.service';
import {
  type DailyFortuneResponse,
  type DailyFortuneAINarrative,
} from './dto';

// ============================================================
// Constants
// ============================================================

/** Free user can see ONLY today's daily fortune. */
const FREE_USER_WINDOW_DAYS_FUTURE = 0;
const FREE_USER_WINDOW_DAYS_PAST = 0;

/** Subscriber window per locked plan: yesterday + today + +30 days. */
const SUBSCRIBER_WINDOW_DAYS_FUTURE = 30;
const SUBSCRIBER_WINDOW_DAYS_PAST = 1;

const REDIS_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const ENGINE_REQUEST_TIMEOUT_MS = 30_000;

/** AI failure circuit breaker (PR review #4 — 2026-05-17).
 *  After MAX_AI_FAILURES consecutive failures on the same chart+date+scope,
 *  stop retrying AI for AI_FAILURE_BACKOFF_HOURS — serve engine-only output
 *  instead. Counter resets on a successful AI call (non-null promptVersion).
 *  Prevents unbounded Anthropic spend during sustained provider outages. */
const MAX_AI_FAILURES = 3;
const AI_FAILURE_BACKOFF_HOURS = 24;
const AI_CALL_TIMEOUT_MS = 90_000;

// ============================================================
// Service
// ============================================================

@Injectable()
export class FortuneService {
  private readonly logger = new Logger(FortuneService.name);
  private readonly baziEngineUrl: string;
  private claudeClient: any = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly validators: FortuneValidatorsService,
  ) {
    this.baziEngineUrl = this.config.get<string>('BAZI_ENGINE_URL') || 'http://localhost:5001';
  }

  // ============================================================
  // Public API — getDailyFortune
  // ============================================================

  async getDailyFortune(
    clerkUserId: string,
    args: { profileId?: string; date?: string },
  ): Promise<DailyFortuneResponse> {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const profile = args.profileId
      ? await this.prisma.birthProfile.findFirst({
          where: { id: args.profileId, userId: user.id },
        })
      : await this.prisma.birthProfile.findFirst({
          where: { userId: user.id, isPrimary: true },
        });

    if (!profile) {
      throw new NotFoundException({
        code: args.profileId ? 'PROFILE_NOT_FOUND' : 'NO_PRIMARY_PROFILE',
        message: args.profileId
          ? 'Birth profile not found'
          : 'No primary birth profile configured for this user',
      });
    }

    // Resolve target date (default = today, server local TZ)
    const targetDate = args.date ?? this.todayIsoDate();
    const targetDateObj = new Date(`${targetDate}T00:00:00Z`);
    if (Number.isNaN(targetDateObj.getTime())) {
      throw new NotFoundException(`Invalid date: ${targetDate}`);
    }

    // Subscription gate
    this.enforceSubscriptionGate(user.subscriptionTier, targetDate);

    // Compute chart hash (stable per chart — used as cache key)
    const chartHash = this.computeChartHash(profile);

    // Birth-date + birth-time ISO strings for UI display (subheader chip —
    // UX iteration 2026-05-17). Schema guarantees both are present.
    const profileBirthDate = profile.birthDate.toISOString().slice(0, 10);
    const profileBirthTime = profile.birthTime; // HH:MM

    // Try cache (Redis first, then DB)
    const cached = await this.tryGetCached(chartHash, targetDate);
    if (cached) {
      return this.buildResponse(profile.id, profileBirthDate, profileBirthTime, targetDate, cached, true);
    }

    // Cache miss → compute fresh
    const dailyOutput = await this.fetchDailyFromEngine(profile, targetDate);
    const chartContext = dailyOutput.chartContext ?? this.buildFallbackChartContext(profile);

    let narrative: DailyFortuneAINarrative | null = null;
    let validationResult: FortuneValidationResult | null = null;
    let promptVersion: string | null = null;

    try {
      const aiResult = await this.runDailyAINarration(dailyOutput, chartContext);
      narrative = aiResult.narrative;
      validationResult = aiResult.validation;
      promptVersion = aiResult.promptVersion;
    } catch (err) {
      // AI failure should not block the engine output — degrade gracefully
      this.logger.error(`Daily fortune AI failure: ${(err as Error).message}`);
      narrative = null;
      promptVersion = null;
    }

    // Persist (sanitized narrative if validator ran; else null)
    const sanitizedNarrative = validationResult
      ? (validationResult.sanitized as unknown as DailyFortuneAINarrative)
      : narrative;
    const snapshot = await this.persistSnapshot({
      chartHash,
      birthProfileId: profile.id,
      anchorDate: targetDateObj,
      dailyOutput,
      narrative: sanitizedNarrative,
      promptVersion,
    });

    // Warm Redis
    await this.redis.set(
      this.redisKey(chartHash, targetDate),
      JSON.stringify(snapshot),
      REDIS_TTL_SECONDS,
    );

    return this.buildResponse(profile.id, profileBirthDate, profileBirthTime, targetDate, snapshot, false);
  }

  // ============================================================
  // Subscription gate
  // ============================================================

  private enforceSubscriptionGate(tier: SubscriptionTier, targetDateIso: string) {
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

  private async tryGetCached(
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
  private versionsMatch(row: {
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
    if (row.promptVersion !== null) return false;  // mismatched non-null version → stale
    // Circuit breaker: AI previously failed. Only retry if under the
    // failure cap OR backoff window has elapsed.
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

  // ============================================================
  // Engine call — POST /daily-fortune
  // ============================================================

  private async fetchDailyFromEngine(
    profile: { birthDate: Date; birthTime: string; birthCity: string; birthTimezone: string; gender: string; birthLongitude: number | null; birthLatitude: number | null },
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
  private buildFallbackChartContext(
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
  // AI narration via Anthropic SDK
  // ============================================================

  private async ensureClaudeClient() {
    if (this.claudeClient) return this.claudeClient;
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException('ANTHROPIC_API_KEY not configured');
    }
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    this.claudeClient = new Anthropic({ apiKey });
    return this.claudeClient;
  }

  private async runDailyAINarration(
    daily: DailyEngineOutput,
    chart: FortuneChartContext,
  ): Promise<{
    narrative: DailyFortuneAINarrative | null;
    validation: FortuneValidationResult;
    promptVersion: string;
  }> {
    const dailyPrompts = FORTUNE_V1_PROMPTS.daily;
    if (!dailyPrompts) {
      throw new Error('FORTUNE_V1_PROMPTS.daily not configured');
    }

    const { systemPrompt, userPrompt } = buildFortuneDailyMessages(daily, chart);
    const client = await this.ensureClaudeClient();
    const model = this.config.get<string>('CLAUDE_MODEL') || 'claude-sonnet-4-5-20250929';

    const response = await client.messages.create(
      {
        model,
        max_tokens: 2048,
        temperature: 0.6,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      },
      { timeout: AI_CALL_TIMEOUT_MS },
    );

    const text = response.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { type: string; text: string }) => b.text)
      .join('');

    const narrative = this.extractJson(text);
    // Phase 1.5.z: pass folkContent so Tier 1 conditional gate can distinguish
    // engine-grounded mentions (allowed) from fabrications (stripped).
    const validation = this.validators.validate(narrative, {
      metaFraming: daily.metaFraming,
      folkContent: daily.folkContent,
    });

    return {
      narrative: validation.sanitized as unknown as DailyFortuneAINarrative,
      validation,
      promptVersion: FORTUNE_PROMPT_VERSIONS.day,
    };
  }

  private extractJson(text: string): Record<string, unknown> | null {
    // Audit C3: trim BOTH ends. Claude commonly appends a trailing
    // remark («希望對您有幫助») after the JSON which makes JSON.parse
    // throw and silently drops the entire narrative. Use first `{`
    // and last `}` to bracket the JSON region.
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

  private async persistSnapshot(args: {
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

  // ============================================================
  // Response shaping
  // ============================================================

  private buildResponse(
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

  private computeChartHash(profile: {
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

  private redisKey(chartHash: string, dateIso: string): string {
    return `fortune:daily:${chartHash}:${dateIso}`;
  }

  private todayIsoDate(): string {
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

  private daysBetween(fromIso: string, toIso: string): number {
    const from = new Date(`${fromIso}T00:00:00Z`).getTime();
    const to = new Date(`${toIso}T00:00:00Z`).getTime();
    return Math.round((to - from) / (24 * 60 * 60 * 1000));
  }
}
