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
 *
 * Cache + persist + engine-fetch + AI-client helpers live in
 * `FortuneSnapshotHelpers` (extracted per Phase Fortune Streaming L3 so
 * `FortuneStreamService` shares the same invariants — locked by
 * `fortune-snapshot.helpers.contract.spec.ts`).
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  FORTUNE_PROMPT_VERSIONS,
  FORTUNE_V1_PROMPTS,
} from '../ai/prompts';
import {
  type DailyEngineOutput,
  type FortuneChartContext,
  type MonthlyEngineOutput,
  type YearlyEngineOutput,
  buildFortuneDailyMessages,
  buildFortuneMonthlyMessages,
  buildFortuneYearlyMessages,
} from './fortune-prompt-builder';
import {
  FortuneValidatorsService,
  type FortuneValidationResult,
} from './fortune-validators.service';
import {
  type DailyFortuneResponse,
  type DailyFortuneAINarrative,
  type MonthlyFortuneResponse,
  type MonthlyFortuneAINarrative,
  type YearlyFortuneResponse,
  type YearlyFortuneAINarrative,
} from './dto';
import {
  FortuneSnapshotHelpers,
  AI_CALL_TIMEOUT_MS,
  REDIS_TTL_SECONDS,
} from './fortune-snapshot.helpers';

// ============================================================
// Service
// ============================================================

@Injectable()
export class FortuneService {
  private readonly logger = new Logger(FortuneService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly helpers: FortuneSnapshotHelpers,
    private readonly validators: FortuneValidatorsService,
  ) {}

  // ============================================================
  // Public API — getDailyFortune
  // ============================================================

  async getDailyFortune(
    clerkUserId: string,
    args: { profileId?: string; date?: string; engineOnly?: boolean },
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
    const targetDate = args.date ?? this.helpers.todayIsoDate();
    const targetDateObj = new Date(`${targetDate}T00:00:00Z`);
    if (Number.isNaN(targetDateObj.getTime())) {
      throw new NotFoundException(`Invalid date: ${targetDate}`);
    }

    // Subscription gate
    this.helpers.enforceSubscriptionGate(user.subscriptionTier, targetDate);

    // Compute chart hash (stable per chart — used as cache key)
    const chartHash = this.helpers.computeChartHash(profile);

    // Birth-date + birth-time ISO strings for UI display (subheader chip —
    // UX iteration 2026-05-17). Schema guarantees both are present.
    const profileBirthDate = profile.birthDate.toISOString().slice(0, 10);
    const profileBirthTime = profile.birthTime; // HH:MM

    // Try cache (Redis first, then DB)
    const cached = await this.helpers.tryGetCached(chartHash, targetDate);
    if (cached) {
      return this.helpers.buildResponse(profile.id, profileBirthDate, profileBirthTime, targetDate, cached, true);
    }

    // Cache miss → compute fresh
    const dailyOutput = await this.helpers.fetchDailyFromEngine(profile, targetDate);
    const chartContext = dailyOutput.chartContext ?? this.helpers.buildFallbackChartContext(profile);

    // Phase Fortune+ progressive loading: when engineOnly=true, skip the AI
    // narration step entirely and return an in-memory engine-only snapshot.
    // We deliberately DO NOT persist this to DB or Redis — the subsequent
    // full fetch (issued in parallel by the frontend) will persist with the
    // AI narrative. This avoids both:
    //   (a) AI circuit breaker (`aiFailureCount`) misfiring on null-narrative rows
    //   (b) Cache being polluted with narrative=null that future requests would have to refresh
    if (args.engineOnly) {
      // Audit M3 fix — log tag so ops can distinguish engineOnly traffic
      // from full traffic during outages / cost analysis. Engine fetch
      // failures are logged generically; this debug breadcrumb lets log
      // queries correlate them with the progressive-loading path.
      this.logger.debug(
        `engineOnly fetch served: profile=${profile.id} date=${targetDate} chartHash=${chartHash.slice(0, 8)}…`,
      );
      const engineOnlySnapshot = this.helpers.buildInMemoryEngineSnapshot({
        chartHash,
        birthProfileId: profile.id,
        anchorDate: targetDateObj,
        dailyOutput,
      });
      return this.helpers.buildResponse(
        profile.id,
        profileBirthDate,
        profileBirthTime,
        targetDate,
        engineOnlySnapshot,
        false,
      );
    }

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
    const snapshot = await this.helpers.persistSnapshot({
      chartHash,
      birthProfileId: profile.id,
      anchorDate: targetDateObj,
      dailyOutput,
      narrative: sanitizedNarrative,
      promptVersion,
    });

    // Warm Redis (best-effort — a Redis flap must not 500 a successful AI+persist;
    // mirrors the monthly/yearly try/catch).
    try {
      await this.helpers.redis.set(
        this.helpers.redisKey(chartHash, targetDate),
        JSON.stringify(snapshot),
        REDIS_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(`Failed to warm Redis (daily): ${(err as Error).message}`);
    }

    return this.helpers.buildResponse(profile.id, profileBirthDate, profileBirthTime, targetDate, snapshot, false);
  }

  // ============================================================
  // AI narration via Anthropic SDK
  // ============================================================

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
    const client = await this.helpers.ensureClaudeClient();
    const model = this.helpers.config.get<string>('CLAUDE_MODEL') || 'claude-sonnet-4-5-20250929';

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

    const narrative = this.helpers.extractJson(text);
    // Review fix: treat unparseable AI output as a FAILURE, not an empty-{} success.
    // validate(null) returns sanitized={}; without this guard the caller persists a
    // blank narrative as success — clobbering LKG + resetting the circuit breaker.
    if (!narrative) {
      throw new Error('Daily AI response could not be parsed as JSON');
    }
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

  // ============================================================
  // Public API — getMonthlyFortune (Phase 2 月運 L2.5 + Phase 2.x L2 refactor)
  // ============================================================
  //
  // Mirrors getDailyFortune shape (subscription gate → cache → engine
  // → AI → validate → persist → respond) scaled to MONTH scope.
  //
  // Phase 2.x L2 refactor: cache/persist/engine-fetch/build-response helpers
  // moved to FortuneSnapshotHelpers so the new streamMonthlyFortune (L3) can
  // share invariants. Contract test at
  // `fortune-snapshot.helpers.monthly.contract.spec.ts` asserts byte-identity.
  //
  // Key differences from daily:
  //   - Subscription window: -1 month / current / +12 months INCLUSIVE
  //   - Cache key: `fortune:monthly:{chartHash}:{YYYY-MM}` (anchor = 1st of month)
  //   - AI prompt: FORTUNE_V1_PROMPTS.monthly + buildFortuneMonthlyMessages
  //   - Validator: validateMonthly (4 dims, no folk)
  //   - DB row: scope=MONTH, anchorDate=1st of month (YYYY-MM-01), yearMonth denormalized
  //   - L1.b intraMonthBreakdown: wired in Phase 2.x — engine /monthly-fortune
  //     includes it in response; helpers.buildMonthlyResponse lifts it to top-level.

  async getMonthlyFortune(
    clerkUserId: string,
    args: { profileId?: string; month?: string },
  ): Promise<MonthlyFortuneResponse> {
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

    // Resolve target month (default = current month in FORTUNE_DEFAULT_TZ)
    const targetMonth = args.month ?? this.helpers.currentMonthIso();
    if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      throw new NotFoundException(`Invalid month format: ${targetMonth} (expected YYYY-MM)`);
    }

    // Subscription gate (month-scope) — throws ForbiddenException on violation
    this.helpers.enforceMonthlySubscriptionGate(user.subscriptionTier, targetMonth);

    // Chart hash (shared with daily — same chart)
    const chartHash = this.helpers.computeChartHash(profile);

    // Profile metadata for response
    const profileBirthDate = profile.birthDate.toISOString().slice(0, 10);
    const profileBirthTime = profile.birthTime;

    // Anchor for cache key + DB row: 1st of month
    const anchorDate = new Date(`${targetMonth}-01T00:00:00Z`);

    // Try cache (Redis → DB) via helpers — derives redisKey internally
    const cached = await this.helpers.tryGetMonthlyCached(chartHash, anchorDate);
    if (cached) {
      return this.helpers.buildMonthlyResponse(
        profile.id,
        profileBirthDate,
        profileBirthTime,
        targetMonth,
        cached,
        true,
      );
    }

    // Cache miss → compute fresh
    const [year, month] = targetMonth.split('-').map(Number) as [number, number];
    const monthlyOutput = await this.helpers.fetchMonthlyFromEngine(profile, year, month);
    const chartContext = (monthlyOutput.chartContext ??
      this.helpers.buildFallbackChartContext(profile)) as FortuneChartContext;
    const flowYear = (monthlyOutput as unknown as { flowYear?: number }).flowYear ?? year;

    let narrative: MonthlyFortuneAINarrative | null = null;
    let promptVersion: string | null = null;

    try {
      const aiResult = await this.runMonthlyAINarration(
        monthlyOutput,
        chartContext,
        targetMonth,
        flowYear,
      );
      narrative = aiResult.narrative;
      promptVersion = aiResult.promptVersion;
    } catch (err) {
      this.logger.error(
        `Monthly fortune AI failure (month=${targetMonth} profile=${profile.id}): ${(err as Error).message}`,
      );
      narrative = null;
      promptVersion = null;
    }

    // Persist + warm Redis via helpers
    const snapshot = await this.helpers.persistMonthlySnapshot({
      chartHash,
      birthProfileId: profile.id,
      anchorDate,
      yearMonth: targetMonth,
      monthlyOutput,
      narrative,
      promptVersion,
    });

    try {
      const redisKey = this.helpers.monthlyRedisKey(chartHash, targetMonth);
      await this.helpers.redis.set(redisKey, JSON.stringify(snapshot), REDIS_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Failed to warm Redis monthly snapshot: ${(err as Error).message}`);
    }

    return this.helpers.buildMonthlyResponse(
      profile.id,
      profileBirthDate,
      profileBirthTime,
      targetMonth,
      snapshot,
      false,
    );
  }

  /** AI narration via Anthropic SDK (mirrors runDailyAINarration pattern). */
  private async runMonthlyAINarration(
    monthly: MonthlyEngineOutput,
    chart: FortuneChartContext,
    targetMonth: string,
    flowYear: number,
  ): Promise<{
    narrative: MonthlyFortuneAINarrative | null;
    validation: FortuneValidationResult;
    promptVersion: string;
  }> {
    const monthlyPrompts = FORTUNE_V1_PROMPTS.monthly;
    if (!monthlyPrompts) {
      throw new Error('FORTUNE_V1_PROMPTS.monthly not configured');
    }

    const { systemPrompt, userPrompt } = buildFortuneMonthlyMessages(monthly, chart, {
      targetMonth,
      flowYear,
    });
    const client = await this.helpers.ensureClaudeClient();
    const model = this.helpers.config.get<string>('CLAUDE_MODEL') || 'claude-sonnet-4-5-20250929';

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

    const parsed = this.helpers.extractJson(text);
    // Review fix: unparseable AI output is a FAILURE (else validate(null)→sanitized={}
    // persists a blank narrative as success, clobbering LKG + resetting the breaker).
    if (!parsed) {
      throw new Error('Monthly AI response could not be parsed as JSON');
    }
    const validation = this.validators.validateMonthly(parsed, {
      sessionAnchorMonth: targetMonth,
    });

    return {
      narrative: validation.sanitized as unknown as MonthlyFortuneAINarrative,
      validation,
      promptVersion: FORTUNE_PROMPT_VERSIONS.month,
    };
  }

  // ============================================================
  // Public API — getYearlyFortune (Phase 3 年運)
  // ============================================================
  //
  // Mirrors getMonthlyFortune shape (subscription gate → cache → engine
  // → AI → validate → persist → respond) scaled to YEAR scope.
  //
  // Key differences from monthly:
  //   - Subscription window: -1 year / current / +4 years INCLUSIVE
  //   - Cache key: `fortune:yearly:{chartHash}:{YYYY}` (anchor = Jan 1)
  //   - AI prompt: FORTUNE_V1_PROMPTS.yearly + buildFortuneYearlyMessages
  //   - Validator: validateYearly (4 dims, no folk, single-arg signature)
  //   - DB row: scope=YEAR, anchorDate=Jan 1 (YYYY-01-01), year denormalized
  //   - NO intraMonthBreakdown sibling — coreRiskOpportunity + luckMethods
  //     live INSIDE engineOutput; buildYearlyResponse passes it through verbatim.

  async getYearlyFortune(
    clerkUserId: string,
    args: { profileId?: string; year?: string },
  ): Promise<YearlyFortuneResponse> {
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

    // Resolve target year (default = current year in FORTUNE_DEFAULT_TZ)
    const targetYear = args.year ?? this.helpers.currentYearIso();
    if (!/^\d{4}$/.test(targetYear)) {
      throw new NotFoundException(`Invalid year format: ${targetYear} (expected YYYY)`);
    }

    // Subscription gate (year-scope) — throws ForbiddenException on violation
    this.helpers.enforceYearlySubscriptionGate(user.subscriptionTier, targetYear);

    // Chart hash (shared with daily/monthly — same chart)
    const chartHash = this.helpers.computeChartHash(profile);

    // Profile metadata for response
    const profileBirthDate = profile.birthDate.toISOString().slice(0, 10);
    const profileBirthTime = profile.birthTime;

    // Anchor for cache key + DB row: Jan 1 of year
    const anchorDate = new Date(`${targetYear}-01-01T00:00:00Z`);

    // Try cache (Redis → DB) via helpers — derives redisKey internally
    const cached = await this.helpers.tryGetYearlyCached(chartHash, anchorDate);
    if (cached) {
      return this.helpers.buildYearlyResponse(
        profile.id,
        profileBirthDate,
        profileBirthTime,
        Number(targetYear),
        cached,
        true,
      );
    }

    // Cache miss → compute fresh
    const year = Number(targetYear);
    const yearlyOutput = await this.helpers.fetchYearlyFromEngine(profile, year);
    const chartContext = ((yearlyOutput as unknown as { chartContext?: FortuneChartContext })
      .chartContext ?? this.helpers.buildFallbackChartContext(profile)) as FortuneChartContext;

    let narrative: YearlyFortuneAINarrative | null = null;
    let promptVersion: string | null = null;

    try {
      const aiResult = await this.runYearlyAINarration(yearlyOutput, chartContext, year);
      narrative = aiResult.narrative;
      promptVersion = aiResult.promptVersion;
    } catch (err) {
      this.logger.error(
        `Yearly fortune AI failure (year=${targetYear} profile=${profile.id}): ${(err as Error).message}`,
      );
      narrative = null;
      promptVersion = null;
    }

    // Persist + warm Redis via helpers
    const snapshot = await this.helpers.persistYearlySnapshot({
      chartHash,
      birthProfileId: profile.id,
      anchorDate,
      year,
      yearlyOutput,
      narrative,
      promptVersion,
    });

    try {
      const redisKey = this.helpers.yearlyRedisKey(chartHash, targetYear);
      await this.helpers.redis.set(redisKey, JSON.stringify(snapshot), REDIS_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Failed to warm Redis yearly snapshot: ${(err as Error).message}`);
    }

    return this.helpers.buildYearlyResponse(
      profile.id,
      profileBirthDate,
      profileBirthTime,
      year,
      snapshot,
      false,
    );
  }

  /** AI narration via Anthropic SDK (mirrors runMonthlyAINarration pattern). */
  private async runYearlyAINarration(
    yearly: YearlyEngineOutput,
    chart: FortuneChartContext,
    year: number,
  ): Promise<{
    narrative: YearlyFortuneAINarrative | null;
    validation: FortuneValidationResult;
    promptVersion: string;
  }> {
    const yearlyPrompts = FORTUNE_V1_PROMPTS.yearly;
    if (!yearlyPrompts) {
      throw new Error('FORTUNE_V1_PROMPTS.yearly not configured');
    }

    const { systemPrompt, userPrompt } = buildFortuneYearlyMessages(yearly, chart, { year });
    const client = await this.helpers.ensureClaudeClient();
    const model = this.helpers.config.get<string>('CLAUDE_MODEL') || 'claude-sonnet-4-5-20250929';

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

    const parsed = this.helpers.extractJson(text);
    // Review fix: unparseable AI output is a FAILURE (else validate(null)→sanitized={}
    // persists a blank narrative as success, clobbering LKG + resetting the breaker).
    if (!parsed) {
      throw new Error('Yearly AI response could not be parsed as JSON');
    }
    const validation = this.validators.validateYearly(parsed);

    return {
      narrative: validation.sanitized as unknown as YearlyFortuneAINarrative,
      validation,
      promptVersion: FORTUNE_PROMPT_VERSIONS.year,
    };
  }
}
