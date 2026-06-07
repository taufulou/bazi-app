/**
 * FortuneStreamService — Phase Fortune Streaming Layer 2.
 *
 * SSE streaming variant of `FortuneService.getDailyFortune`. Mirrors
 * `chat-stream.service.ts` patterns (Express SSE + Anthropic
 * `messages.stream()` + watchdog + client-disconnect handling).
 *
 * Plan: `.claude/plans/ok-next-big-feature-merry-cake.md` § "Section-by-Section
 * AI Streaming for 日運 — Implementation Plan (Option A)".
 *
 * SSE event sequence (cache miss):
 *   engine_ready    — engine output + chart anchors (frontend renders score/dims/folk)
 *   section_complete (×N) — one per `sections.<key>` as detected by clarinet
 *   done            — full sanitized narrative + cacheHit flag
 *
 * SSE event sequence (cache hit):
 *   engine_ready    — engine output (immediate)
 *   done            — full cached narrative (immediate; NO section_complete events)
 *
 * On error: error event + (when applicable) persist with promptVersion=null
 * to increment the `aiFailureCount` circuit breaker, matching non-streaming
 * semantics exactly (plan v2 M4).
 *
 * On client disconnect mid-stream: if the accumulated buffer parses to a
 * complete valid JSON object via `extractJson`, run validator + persist so
 * we cache the work. Else discard (plan v2 M5).
 *
 * Cache + persist + engine-fetch helpers come from `FortuneSnapshotHelpers`
 * (extracted Layer 3). The contract test
 * `fortune-snapshot.helpers.contract.spec.ts` asserts both paths produce
 * byte-identical snapshots + responses for the same input.
 */
import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import {
  FORTUNE_PROMPT_VERSIONS,
  FORTUNE_V1_PROMPTS,
} from '../ai/prompts';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildFortuneDailyMessages,
  buildFortuneMonthlyMessages,
  buildFortuneYearlyMessages,
  type DailyEngineOutput,
  type FortuneChartContext,
  type MonthlyEngineOutput,
  type YearlyEngineOutput,
} from './fortune-prompt-builder';
import {
  FortuneValidatorsService,
  type FortuneValidationResult,
} from './fortune-validators.service';
import {
  type DailyFortuneAINarrative,
  type DailyFortuneResponse,
  type MonthlyFortuneAINarrative,
  type MonthlyFortuneResponse,
  type YearlyFortuneAINarrative,
  type YearlyFortuneResponse,
  type IntraMonthBreakdown,
} from './dto';
import {
  FortuneSnapshotHelpers,
  AI_CALL_TIMEOUT_MS,
  REDIS_TTL_SECONDS,
} from './fortune-snapshot.helpers';
import { createSectionDetector } from './fortune-section-detector';

// ============================================================
// SSE event types
// ============================================================

/** Wire-shape engine output (mirrors `DailyFortuneResponse.engineOutput`).
 *  Same shape the non-streaming GET /daily emits — frontend can reuse the
 *  existing DTO type. NOT the same as `DailyEngineOutput` from the prompt
 *  builder (which carries extra builder-internal fields like dateIso /
 *  baseAuspiciousness / chartContext). */
export type FortuneStreamEngineOutput = DailyFortuneResponse['engineOutput'];

/** Wire-shape monthly engine output (mirrors `MonthlyFortuneResponse.engineOutput`).
 *  Same shape the non-streaming GET /monthly emits — frontend reuses the
 *  existing DTO type. Distinguished from `MonthlyEngineOutput` (prompt builder
 *  internal type that carries extra builder fields). */
export type FortuneMonthlyStreamEngineOutput = MonthlyFortuneResponse['engineOutput'];

/** Wire-shape yearly engine output (mirrors `YearlyFortuneResponse.engineOutput`).
 *  Same shape the non-streaming GET /yearly emits. Distinguished from
 *  `YearlyEngineOutput` (prompt builder internal type). */
export type FortuneYearlyStreamEngineOutput = YearlyFortuneResponse['engineOutput'];

/** Phase Fortune Streaming — DAY scope event union. */
export type FortuneDailyStreamEvent =
  | {
      type: 'engine_ready';
      engineOutput: FortuneStreamEngineOutput;
      profileId: string;
      profileBirthDate: string;
      profileBirthTime: string;
      date: string;
    }
  | { type: 'section_complete'; key: string; value: unknown }
  | {
      type: 'done';
      narrative: DailyFortuneAINarrative | null;
      cacheHit: boolean;
    }
  | { type: 'error'; code: string; message: string };

/** Phase 2.x Monthly Streaming — MONTH scope event union.
 *
 *  Glossary lock: `intraMonthBreakdown` is a SIBLING of `engineOutput` (NOT nested)
 *  per the engine-side camelCase convention. `cacheHit` is on `engine_ready` (plan v3
 *  NEW-M1 fix) so warm-cache UI surfaces read the correct value during the
 *  engine→success gap. `done` does NOT carry `intraMonthBreakdown` (plan v3 NEW-H1
 *  fix — single canonical source eliminates drift; L5 handler spreads prev.data).
 */
export type FortuneMonthlyStreamEvent =
  | {
      type: 'engine_ready';
      engineOutput: FortuneMonthlyStreamEngineOutput;
      intraMonthBreakdown?: IntraMonthBreakdown;
      profileId: string;
      profileBirthDate: string;
      profileBirthTime: string;
      month: string;     // 'YYYY-MM' input verbatim
      flowYear: number;
      cacheHit: boolean;
    }
  | { type: 'section_complete'; key: string; value: unknown }
  | {
      type: 'done';
      narrative: MonthlyFortuneAINarrative | null;
      cacheHit: boolean;
    }
  | { type: 'error'; code: string; message: string };

/** Phase 3 Yearly Streaming — YEAR scope event union.
 *
 *  Unlike monthly, yearly's `engine_ready` carries NO `intraMonthBreakdown`
 *  sibling — `coreRiskOpportunity` + `luckMethods` live inside `engineOutput`.
 *  `cacheHit` is on `engine_ready` (matches monthly NEW-M1) so warm-cache UI
 *  surfaces read the correct value during the engine→success gap.
 */
export type FortuneYearlyStreamEvent =
  | {
      type: 'engine_ready';
      engineOutput: FortuneYearlyStreamEngineOutput;
      profileId: string;
      profileBirthDate: string;
      profileBirthTime: string;
      year: number;
      cacheHit: boolean;
    }
  | { type: 'section_complete'; key: string; value: unknown }
  | {
      type: 'done';
      narrative: YearlyFortuneAINarrative | null;
      cacheHit: boolean;
    }
  | { type: 'error'; code: string; message: string };

/** Umbrella discriminated union for all scopes (R3 polish — implementer-friendly).
 *  Hook signature uses this; runtime branches on scope context + ev.type.
 *  Existing daily-only callers can use the narrower `FortuneDailyStreamEvent`. */
export type FortuneStreamEvent =
  | FortuneDailyStreamEvent
  | FortuneMonthlyStreamEvent
  | FortuneYearlyStreamEvent;

// ============================================================
// Constants
// ============================================================

/** Watchdog: if no text_delta event for this many ms, abort the stream. */
const STREAM_WATCHDOG_MS = 60_000;

/** Mirrors the non-streaming call at `FortuneService.runDailyAINarration`
 *  (line ~479). NOT chat-stream's 800-token default — daily fortune narratives
 *  routinely run 1500-2100 tokens; truncating mid-stream would silently drop
 *  the daily_advice section + leave broken JSON. */
const STREAM_MAX_TOKENS = 2048;

/** Same as non-streaming AI call. */
const STREAM_TEMPERATURE = 0.6;

/** Same as `AI_CALL_TIMEOUT_MS` — the outer Anthropic SDK timeout. */
const STREAM_TIMEOUT_MS = AI_CALL_TIMEOUT_MS;

/** Shape returned by the persist-failure wrappers — the upserted snapshot row
 *  (or null if even the persist failed). Used by `_serveLkg` to recover a
 *  preserved last-known-good narrative after an AI regen failure. We only read
 *  `aiNarrativeJson`, so a structural subset is enough. */
type LkgRow = { aiNarrativeJson: unknown; chartHash: string } | null;

// ============================================================
// Service
// ============================================================

@Injectable()
export class FortuneStreamService {
  private readonly logger = new Logger(FortuneStreamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly helpers: FortuneSnapshotHelpers,
    private readonly validators: FortuneValidatorsService,
  ) {}

  /**
   * Stream a daily fortune via SSE.
   *
   * Setup mirrors `chat-stream.service.ts::streamMessage`: caller (controller)
   * passes the Express Response; this method owns header flush + event writes
   * + `response.end()`.
   */
  async streamDailyFortune(
    clerkUserId: string,
    args: { profileId?: string; date?: string },
    response: Response,
  ): Promise<void> {
    // ============================================================
    // SSE headers (mirror chat-stream pattern)
    // ============================================================
    if (!response.headersSent) {
      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
      response.flushHeaders();
    }

    // ============================================================
    // Pre-flight: auth + profile + date + subscription gate
    // ============================================================

    try {
      const { user, profile, targetDate, targetDateObj } = await this._preflight(
        clerkUserId,
        args,
      );

      const profileBirthDate = profile.birthDate.toISOString().slice(0, 10);
      const profileBirthTime = profile.birthTime;
      const chartHash = this.helpers.computeChartHash(profile);

      // ============================================================
      // Cache lookup — Redis then DB
      // ============================================================
      const cached = await this.helpers.tryGetCached(chartHash, targetDate);
      if (cached) {
        // Cache HIT: emit engine_ready + done in one batch. NO section_complete
        // events per plan v2 M6 (cache means instant — inter-section delays
        // would defeat the mental model + React 18 batches updates anyway).
        const wireResponse: DailyFortuneResponse = this.helpers.buildResponse(
          profile.id,
          profileBirthDate,
          profileBirthTime,
          targetDate,
          cached,
          true,
        );
        this._emit(response, {
          type: 'engine_ready',
          engineOutput: wireResponse.engineOutput,
          profileId: profile.id,
          profileBirthDate,
          profileBirthTime,
          date: targetDate,
        });
        this._emit(response, {
          type: 'done',
          narrative: wireResponse.narrative,
          cacheHit: true,
        });
        response.end();
        return;
      }

      // ============================================================
      // Cache miss — fetch engine output + emit engine_ready
      // ============================================================
      let dailyOutput: DailyEngineOutput;
      try {
        dailyOutput = await this.helpers.fetchDailyFromEngine(profile, targetDate);
      } catch (err) {
        this._emitError(response, 'ENGINE_FAILED',
          err instanceof Error ? err.message : 'Bazi engine unreachable');
        return;
      }

      const chartContext =
        dailyOutput.chartContext ?? this.helpers.buildFallbackChartContext(profile);

      // Emit engine_ready BEFORE opening Anthropic so the frontend can paint
      // score/dims/folk in parallel with AI generation (~500ms vs ~3-5s).
      // Cast: `DailyEngineOutput` is a superset of the wire shape (carries
      // extra builder-internal fields like dateIso / baseAuspiciousness /
      // chartContext that the frontend doesn't need). Structural assignment
      // would TS-error on missing required wire fields if dailyOutput shape
      // shifts; cast through unknown to keep the contract loose at this
      // boundary. The wire-shape contract is asserted by the contract test
      // in fortune-snapshot.helpers.contract.spec.ts.
      this._emit(response, {
        type: 'engine_ready',
        engineOutput: dailyOutput as unknown as FortuneStreamEngineOutput,
        profileId: profile.id,
        profileBirthDate,
        profileBirthTime,
        date: targetDate,
      });

      // ============================================================
      // Open Anthropic stream + run section detector
      // ============================================================
      await this._streamWithSectionDetector({
        response,
        dailyOutput,
        chartContext,
        chartHash,
        birthProfileId: profile.id,
        anchorDate: targetDateObj,
        targetDate,
      });
    } catch (err) {
      // Pre-flight errors (NotFound / Forbidden / etc.) — map to SSE error
      if (err instanceof HttpException) {
        const resObj = err.getResponse();
        const code =
          typeof resObj === 'object' && resObj !== null && 'code' in resObj
            ? (resObj as { code: string }).code
            : 'PREFLIGHT_FAILED';
        const message = err.message || 'Pre-flight check failed';
        this._emitError(response, code, message);
        return;
      }
      this.logger.error(`Unexpected stream pre-flight error: ${(err as Error).message}`);
      this._emitError(response, 'INTERNAL_ERROR', 'Unexpected error');
    }
  }

  // ============================================================
  // Pre-flight — shared with non-streaming path's logic (auth + profile + gate)
  // ============================================================

  private async _preflight(
    clerkUserId: string,
    args: { profileId?: string; date?: string },
  ): Promise<{
    user: { id: string; subscriptionTier: any };
    profile: {
      id: string;
      birthDate: Date;
      birthTime: string;
      birthCity: string;
      birthTimezone: string;
      gender: string;
      birthLongitude: number | null;
      birthLatitude: number | null;
    };
    targetDate: string;
    targetDateObj: Date;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
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

    const targetDate = args.date ?? this.helpers.todayIsoDate();
    const targetDateObj = new Date(`${targetDate}T00:00:00Z`);
    if (Number.isNaN(targetDateObj.getTime())) {
      throw new NotFoundException({
        code: 'INVALID_DATE',
        message: `Invalid date: ${targetDate}`,
      });
    }

    this.helpers.enforceSubscriptionGate(user.subscriptionTier, targetDate);

    return { user, profile, targetDate, targetDateObj };
  }

  // ============================================================
  // Anthropic streaming + clarinet section detector + per-section strip
  // ============================================================

  private async _streamWithSectionDetector(ctx: {
    response: Response;
    dailyOutput: DailyEngineOutput;
    chartContext: FortuneChartContext;
    chartHash: string;
    birthProfileId: string;
    anchorDate: Date;
    targetDate: string;
  }): Promise<void> {
    const { response, dailyOutput, chartContext, chartHash, birthProfileId, anchorDate } = ctx;

    if (!FORTUNE_V1_PROMPTS.daily) {
      this._emitError(response, 'PROMPT_NOT_CONFIGURED',
        'FORTUNE_V1_PROMPTS.daily not configured');
      return;
    }

    const { systemPrompt, userPrompt } = buildFortuneDailyMessages(
      dailyOutput,
      chartContext,
    );

    let client: any;
    try {
      client = await this.helpers.ensureClaudeClient();
    } catch (err) {
      this._emitError(response, 'AI_NOT_CONFIGURED',
        err instanceof Error ? err.message : 'AI client unavailable');
      await this._persistAIFailure({ chartHash, birthProfileId, anchorDate, dailyOutput });
      return;
    }
    const model =
      this.helpers.config.get<string>('CLAUDE_MODEL') || 'claude-sonnet-4-5-20250929';

    // Plan v2 H5: section_complete may arrive out of canonical order; FE
    // re-orders. Detector emits in AI arrival order. Track which sections
    // we've seen, plus accumulated diff for the sanitize_diff breadcrumb.
    const seenSectionKeys: string[] = [];
    const sanitizeDiffSections: string[] = [];
    let totalDiffPhraseCount = 0;

    const detector = createSectionDetector((key, value) => {
      seenSectionKeys.push(key);
      // Plan v2 H1: per-section banned-phrase strip BEFORE emit. Preserves
      // the «no absolute language ever reaches the user» contract per
      // CLAUDE.md. Only applies to string section values; compound values
      // (daily_advice with canTry/shouldHold arrays) pass through — those
      // get the strip in the end-of-stream full validator.
      let outValue: unknown = value;
      if (typeof value === 'string') {
        const { text, strippedPhrases } =
          this.validators.stripBannedAbsolutePhrasesFromText(value);
        if (strippedPhrases.length > 0) {
          sanitizeDiffSections.push(key);
          totalDiffPhraseCount += strippedPhrases.length;
        }
        outValue = text;
      }
      this._emit(response, { type: 'section_complete', key, value: outValue });
    });

    // ============================================================
    // Watchdog + client-disconnect (mirror chat-stream pattern)
    // ============================================================
    const abortController = new AbortController();
    let lastDeltaAt = Date.now();
    let watchdogTriggered = false;
    const watchdogTimer = setInterval(() => {
      if (Date.now() - lastDeltaAt > STREAM_WATCHDOG_MS) {
        this.logger.warn(`Fortune stream watchdog timeout`);
        watchdogTriggered = true;
        abortController.abort();
      }
    }, 5_000);

    let clientDisconnected = false;
    const onClientClose = () => {
      this.logger.log(`Fortune stream — client disconnected mid-stream`);
      clientDisconnected = true;
      abortController.abort();
    };
    response.on('close', onClientClose);

    let assistantBuffer = '';
    let finalStopReason: string | null = null;

    try {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: STREAM_MAX_TOKENS,
          temperature: STREAM_TEMPERATURE,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        },
        {
          timeout: STREAM_TIMEOUT_MS,
          signal: abortController.signal,
        },
      );

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          const text = event.delta.text as string;
          assistantBuffer += text;
          lastDeltaAt = Date.now();
          detector.write(text);
        }
      }

      const finalMessage = await stream.finalMessage();
      finalStopReason = (finalMessage as { stop_reason?: string }).stop_reason ?? null;
    } catch (err) {
      clearInterval(watchdogTimer);
      response.off('close', onClientClose);

      // Client disconnect handling per plan v2 M5: if buffer parses to
      // valid JSON, persist + warm cache (cache the work). Else discard.
      if (clientDisconnected) {
        await this._handleClientDisconnect({
          chartHash,
          birthProfileId,
          anchorDate,
          dailyOutput,
          assistantBuffer,
        });
        // Audit LOW fix — defensive close of response to make the per-path
        // contract uniform («every code path either emits done or closes
        // the response»). response.end() is a no-op when the socket is
        // already destroyed (the normal case after client disconnect), but
        // makes the next reader of this code reliably trust that the
        // response is closed regardless of disconnect race.
        if (!response.writableEnded) {
          response.end();
        }
        return;
      }

      const reason = watchdogTriggered
        ? 'watchdog-timeout-no-delta-60s'
        : `ai-stream-failed: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(`Fortune stream Anthropic failure: ${reason}`);
      detector.close();
      {
        const failRow = await this._persistAIFailure({ chartHash, birthProfileId, anchorDate, dailyOutput });
        if (this._serveLkg(response, failRow, 'day')) return;
      }
      this._emitError(response, 'AI_FAILED', reason);
      return;
    } finally {
      clearInterval(watchdogTimer);
      response.off('close', onClientClose);
    }

    detector.close();

    // ============================================================
    // Stop-reason explicit branch (plan v2 follow-up #2)
    // ============================================================
    if (finalStopReason === 'max_tokens') {
      this.logger.warn(
        `Fortune stream truncated at max_tokens (${STREAM_MAX_TOKENS}) for chart=${chartHash.slice(0, 8)}…`,
      );
      {
        const failRow = await this._persistAIFailure({ chartHash, birthProfileId, anchorDate, dailyOutput });
        if (this._serveLkg(response, failRow, 'day')) return;
      }
      this._emitError(response, 'TRUNCATED',
        `AI response exceeded ${STREAM_MAX_TOKENS} tokens — narrative may be incomplete`);
      return;
    }
    if (finalStopReason === 'refusal') {
      // Forward-compat hook — Anthropic's current Messages API stop_reason
      // enum does NOT emit 'refusal' (real Claude refusals come through as
      // 'end_turn' with refusal text in the content body and reach the
      // PARSE_FAILED branch below). Kept explicit for future API additions
      // + symmetric handling with max_tokens. Audit MEDIUM finding.
      this.logger.warn(`Fortune stream — AI refused to generate`);
      {
        const failRow = await this._persistAIFailure({ chartHash, birthProfileId, anchorDate, dailyOutput });
        if (this._serveLkg(response, failRow, 'day')) return;
      }
      this._emitError(response, 'AI_REFUSED', 'AI declined to generate this narrative');
      return;
    }

    // ============================================================
    // End-of-stream — full validator + persist + done
    // ============================================================
    const parsedNarrative = this.helpers.extractJson(assistantBuffer);
    if (!parsedNarrative) {
      this.logger.warn(`Fortune stream — extractJson returned null on buffer length ${assistantBuffer.length}`);
      {
        const failRow = await this._persistAIFailure({ chartHash, birthProfileId, anchorDate, dailyOutput });
        if (this._serveLkg(response, failRow, 'day')) return;
      }
      this._emitError(response, 'PARSE_FAILED', 'AI response was not valid JSON');
      return;
    }

    let validation: FortuneValidationResult;
    try {
      validation = this.validators.validate(parsedNarrative, {
        metaFraming: dailyOutput.metaFraming,
        folkContent: dailyOutput.folkContent,
      });
    } catch (err) {
      this.logger.error(`Fortune validator threw on stream output: ${(err as Error).message}`);
      {
        const failRow = await this._persistAIFailure({ chartHash, birthProfileId, anchorDate, dailyOutput });
        if (this._serveLkg(response, failRow, 'day')) return;
      }
      this._emitError(response, 'VALIDATION_FAILED',
        'Validator failed unexpectedly — narrative discarded');
      return;
    }

    const sanitizedNarrative =
      validation.sanitized as unknown as DailyFortuneAINarrative;

    // Plan v2 H1 follow-up — Sentry breadcrumb on sanitize-diff (telemetry
    // only, content NOT captured). Lets ops measure per-section provisional→
    // sanitized swap rate post-ship without scraping logs.
    if (sanitizeDiffSections.length > 0) {
      Sentry.addBreadcrumb({
        category: 'fortune.stream.sanitize_diff',
        level: 'info',
        message: 'Per-section banned-phrase strip fired during streaming',
        data: {
          sectionKeys: sanitizeDiffSections,
          totalDiffPhraseCount,
        },
      });
    }

    const snapshot = await this.helpers.persistSnapshot({
      chartHash,
      birthProfileId,
      anchorDate,
      dailyOutput,
      narrative: sanitizedNarrative,
      promptVersion: FORTUNE_PROMPT_VERSIONS.day,
    });

    // Warm Redis (same TTL as non-streaming path)
    try {
      await this.helpers.redis.set(
        this.helpers.redisKey(chartHash, ctx.targetDate),
        JSON.stringify(snapshot),
        REDIS_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(`Failed to warm Redis after stream: ${(err as Error).message}`);
    }

    this._emit(response, {
      type: 'done',
      narrative: sanitizedNarrative,
      cacheHit: false,
    });
    response.end();
  }

  // ============================================================
  // Error-path persistence (mirrors non-streaming circuit-breaker)
  // ============================================================

  /** Persist a snapshot with `promptVersion=null` so the
   *  `aiFailureCount` circuit breaker (per `FortuneSnapshotHelpers
   *  .persistSnapshot`) increments correctly. Without this, the breaker is
   *  uneven across streaming vs non-streaming paths — repeated stream failures
   *  on the same chart would never trip the cap. Plan v2 M4. */
  private async _persistAIFailure(args: {
    chartHash: string;
    birthProfileId: string;
    anchorDate: Date;
    dailyOutput: DailyEngineOutput;
  }): Promise<LkgRow> {
    try {
      // Returns the upserted row so the caller can serve a preserved
      // last-known-good narrative. persistSnapshot no longer nulls an existing
      // narrative on failure (LKG preservation) — so this row may still carry
      // a previously-rendered reading.
      return await this.helpers.persistSnapshot({
        ...args,
        narrative: null,
        promptVersion: null,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist AI-failure snapshot for stream: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Client disconnect mid-stream: if buffer is parseable JSON, run validator
   *  + persist as a success (cache the work — user disconnected after AI
   *  completed). Else persist as failure so circuit breaker counts it.
   *  Plan v2 M5. */
  private async _handleClientDisconnect(args: {
    chartHash: string;
    birthProfileId: string;
    anchorDate: Date;
    dailyOutput: DailyEngineOutput;
    assistantBuffer: string;
  }): Promise<void> {
    const parsed = this.helpers.extractJson(args.assistantBuffer);
    if (!parsed) {
      // Incomplete buffer — count as failure for the circuit breaker
      await this._persistAIFailure({
        chartHash: args.chartHash,
        birthProfileId: args.birthProfileId,
        anchorDate: args.anchorDate,
        dailyOutput: args.dailyOutput,
      });
      return;
    }
    let validation: FortuneValidationResult;
    try {
      validation = this.validators.validate(parsed, {
        metaFraming: args.dailyOutput.metaFraming,
        folkContent: args.dailyOutput.folkContent,
      });
    } catch {
      await this._persistAIFailure({
        chartHash: args.chartHash,
        birthProfileId: args.birthProfileId,
        anchorDate: args.anchorDate,
        dailyOutput: args.dailyOutput,
      });
      return;
    }
    const sanitized =
      validation.sanitized as unknown as DailyFortuneAINarrative;
    try {
      await this.helpers.persistSnapshot({
        chartHash: args.chartHash,
        birthProfileId: args.birthProfileId,
        anchorDate: args.anchorDate,
        dailyOutput: args.dailyOutput,
        narrative: sanitized,
        promptVersion: FORTUNE_PROMPT_VERSIONS.day,
      });
      this.logger.log(
        `Fortune stream — client disconnected but full narrative cached for chart=${args.chartHash.slice(0, 8)}…`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to persist disconnect-recovered narrative: ${(err as Error).message}`,
      );
    }
    // Audit LOW fix — response.end() is called by the caller (at line ~457
    // in `_streamWithSectionDetector` after `_handleClientDisconnect`
    // returns) to make the service-side contract uniform: every code path
    // either emits 'done' (success) or closes the response (failure /
    // disconnect). No-op when socket already destroyed.
  }

  // ============================================================
  // Last-known-good (LKG) recovery
  // ============================================================

  /** When an AI regeneration fails but the persisted snapshot still carries a
   *  previously-generated narrative (persistSnapshot no longer nulls it on
   *  failure — LKG preservation), serve that narrative via a `done` event
   *  instead of blanking the page with AI_FAILED. Scope-agnostic: the `done`
   *  event shape is identical across day/month/year ({type, narrative,
   *  cacheHit}); the narrative IS `row.aiNarrativeJson`. `engine_ready` (with
   *  the profile fields) was already emitted upstream, so nothing else is
   *  needed here.
   *
   *  Returns true if it served (emitted done + ended response) — caller then
   *  returns. Returns false (no LKG to serve) → caller emits the honest
   *  AI_FAILED error so the FE shows the «AI 文字解讀暫時無法產生」 fallback. */
  private _serveLkg(response: Response, row: LkgRow, scope: 'day' | 'month' | 'year'): boolean {
    if (!row) return false;
    const lkg = row.aiNarrativeJson;
    // A valid LKG narrative is a non-empty plain object. Reject JS null AND the
    // Prisma.JsonNull write-sentinel (which is a keyless object, NOT == null) —
    // on the real DB read path a NULL column comes back as JS null, but a
    // freshly-failed CREATE row carries the sentinel until re-read.
    if (lkg == null || typeof lkg !== 'object' || Object.keys(lkg).length === 0) {
      return false;
    }
    if (response.writableEnded) {
      // Review fix (defensive): cannot occur today, but if the socket is already
      // ended, log + still report "served" so the caller suppresses the duplicate
      // _emitError — guards against a silent hang in a future refactor.
      this.logger.warn(
        `_serveLkg: response already ended before LKG emit (scope=${scope}, chart=${row.chartHash.slice(0, 8)}…)`,
      );
      return true;
    }
    this._emit(response, {
      type: 'done',
      // The persisted narrative is the scope's AI narrative shape; the `done`
      // union is structurally identical across scopes, so a single cast is safe.
      narrative: row.aiNarrativeJson as DailyFortuneAINarrative,
      cacheHit: true,
    });
    response.end();
    this.logger.log(
      `LKG narrative served after ${scope} AI failure (chart=${row.chartHash.slice(0, 8)}…) — page preserved`,
    );
    return true;
  }

  // ============================================================
  // SSE helpers
  // ============================================================

  private _emit(response: Response, event: FortuneStreamEvent): void {
    if (response.writableEnded) return;
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  private _emitError(response: Response, code: string, message: string): void {
    this._emit(response, { type: 'error', code, message });
    if (!response.writableEnded) {
      response.end();
    }
  }

  // ============================================================
  // Phase 2.x — Monthly streaming (mirrors streamDailyFortune)
  // ============================================================
  //
  // Differences from daily:
  //   - Cache key: monthly via helpers.monthlyRedisKey
  //   - Pre-flight: month YYYY-MM + enforceMonthlySubscriptionGate
  //   - Engine: helpers.fetchMonthlyFromEngine (carries intraMonthBreakdown
  //     per Phase 2.x L1 — emitted as sibling on engine_ready event)
  //   - Prompts: buildFortuneMonthlyMessages
  //   - Validator: this.validators.validateMonthly
  //   - Persist: helpers.persistMonthlySnapshot
  //
  // Same machinery: clarinet section detector, watchdog, client-disconnect
  // rescue, stop-reason explicit branches, Sentry sanitize-diff breadcrumb.

  async streamMonthlyFortune(
    clerkUserId: string,
    args: { profileId?: string; month?: string },
    response: Response,
  ): Promise<void> {
    if (!response.headersSent) {
      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();
    }

    try {
      const { user, profile, targetMonth, anchorDate } =
        await this._preflightMonthly(clerkUserId, args);

      const profileBirthDate = profile.birthDate.toISOString().slice(0, 10);
      const profileBirthTime = profile.birthTime;
      const chartHash = this.helpers.computeChartHash(profile);

      // Cache lookup (Redis → DB via helpers; key derived internally)
      const cached = await this.helpers.tryGetMonthlyCached(chartHash, anchorDate);
      if (cached) {
        // Cache HIT — emit engine_ready (with intraMonthBreakdown sibling +
        // cacheHit=true) + done (cacheHit=true) only. NO section_complete.
        const wireResponse = this.helpers.buildMonthlyResponse(
          profile.id,
          profileBirthDate,
          profileBirthTime,
          targetMonth,
          cached,
          true,
        );
        this._emit(response, {
          type: 'engine_ready',
          engineOutput: wireResponse.engineOutput,
          intraMonthBreakdown: wireResponse.intraMonthBreakdown,
          profileId: profile.id,
          profileBirthDate,
          profileBirthTime,
          month: targetMonth,
          flowYear: wireResponse.flowYear,
          cacheHit: true,
        });
        this._emit(response, {
          type: 'done',
          narrative: wireResponse.narrative,
          cacheHit: true,
        });
        response.end();
        return;
      }

      // Cache miss → fetch engine output
      const [year, month] = targetMonth.split('-').map(Number) as [number, number];
      let monthlyOutput: MonthlyEngineOutput;
      try {
        monthlyOutput = await this.helpers.fetchMonthlyFromEngine(
          profile,
          year,
          month,
        );
      } catch (err) {
        this._emitError(
          response,
          'ENGINE_FAILED',
          err instanceof Error ? err.message : 'Bazi engine unreachable',
        );
        return;
      }

      const chartContext =
        monthlyOutput.chartContext ?? this.helpers.buildFallbackChartContext(profile);
      const flowYear =
        (monthlyOutput as unknown as { flowYear?: number }).flowYear ?? year;
      // L1 lift — engine emits intraMonthBreakdown at top level of monthly_result
      // (camelCase per glossary). Surface as sibling on engine_ready event.
      const intraMonthBreakdown = (monthlyOutput as unknown as {
        intraMonthBreakdown?: IntraMonthBreakdown;
      }).intraMonthBreakdown;

      // MEDIUM M1 audit fix — strip intraMonthBreakdown + chartContext from
      // engineOutput before emit so the field appears ONLY at top-level
      // (sibling) per Glossary lock. Without this, `engine_ready.engineOutput`
      // would carry the breakdown nested AND chartContext leaks ~2KB of
      // birth-pillar metadata in every cold-cache stream open. Mirrors the
      // helpers.buildMonthlyResponse strip.
      const {
        intraMonthBreakdown: _stripIMB,
        chartContext: _stripCC,
        ...engineOutputBare
      } = monthlyOutput as unknown as Record<string, unknown> & {
        intraMonthBreakdown?: IntraMonthBreakdown;
        chartContext?: unknown;
      };
      void _stripIMB;
      void _stripCC;

      // Emit engine_ready BEFORE Anthropic so frontend can paint
      // Ring/Bars/TimeGrid immediately (~600-1000ms vs ~5-15s for AI).
      this._emit(response, {
        type: 'engine_ready',
        engineOutput: engineOutputBare as FortuneMonthlyStreamEngineOutput,
        intraMonthBreakdown,
        profileId: profile.id,
        profileBirthDate,
        profileBirthTime,
        month: targetMonth,
        flowYear,
        cacheHit: false,
      });

      // Open Anthropic stream + section detector
      await this._streamMonthlyWithSectionDetector({
        response,
        monthlyOutput,
        chartContext,
        chartHash,
        birthProfileId: profile.id,
        anchorDate,
        targetMonth,
      });
    } catch (err) {
      if (err instanceof HttpException) {
        const resObj = err.getResponse();
        const code =
          typeof resObj === 'object' && resObj !== null && 'code' in resObj
            ? (resObj as { code: string }).code
            : 'PREFLIGHT_FAILED';
        const message = err.message || 'Pre-flight check failed';
        this._emitError(response, code, message);
        return;
      }
      this.logger.error(
        `Unexpected monthly stream pre-flight error: ${(err as Error).message}`,
      );
      this._emitError(response, 'INTERNAL_ERROR', 'Unexpected error');
    }
  }

  /** Monthly pre-flight: auth + profile + targetMonth + subscription gate. */
  private async _preflightMonthly(
    clerkUserId: string,
    args: { profileId?: string; month?: string },
  ): Promise<{
    user: { id: string; subscriptionTier: any };
    profile: {
      id: string;
      birthDate: Date;
      birthTime: string;
      birthCity: string;
      birthTimezone: string;
      gender: string;
      birthLongitude: number | null;
      birthLatitude: number | null;
    };
    targetMonth: string;
    anchorDate: Date;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
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

    const targetMonth = args.month ?? this.helpers.currentMonthIso();
    if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      throw new NotFoundException({
        code: 'INVALID_MONTH',
        message: `Invalid month format: ${targetMonth} (expected YYYY-MM)`,
      });
    }

    this.helpers.enforceMonthlySubscriptionGate(user.subscriptionTier, targetMonth);

    const anchorDate = new Date(`${targetMonth}-01T00:00:00Z`);

    return { user, profile, targetMonth, anchorDate };
  }

  /** Run Anthropic monthly stream + clarinet section detector + per-section
   *  banned-phrase strip + end-of-stream validate + persist. */
  private async _streamMonthlyWithSectionDetector(ctx: {
    response: Response;
    monthlyOutput: MonthlyEngineOutput;
    chartContext: FortuneChartContext;
    chartHash: string;
    birthProfileId: string;
    anchorDate: Date;
    targetMonth: string;
  }): Promise<void> {
    const { response, monthlyOutput, chartContext, chartHash, birthProfileId, anchorDate, targetMonth } = ctx;

    if (!FORTUNE_V1_PROMPTS.monthly) {
      this._emitError(response, 'PROMPT_NOT_CONFIGURED', 'FORTUNE_V1_PROMPTS.monthly not configured');
      return;
    }

    const flowYear =
      (monthlyOutput as unknown as { flowYear?: number }).flowYear ??
      Number(targetMonth.slice(0, 4));

    const { systemPrompt, userPrompt } = buildFortuneMonthlyMessages(
      monthlyOutput,
      chartContext,
      { targetMonth, flowYear },
    );

    let client: any;
    try {
      client = await this.helpers.ensureClaudeClient();
    } catch (err) {
      this._emitError(
        response,
        'AI_NOT_CONFIGURED',
        err instanceof Error ? err.message : 'AI client unavailable',
      );
      await this._persistMonthlyAIFailure({
        chartHash,
        birthProfileId,
        anchorDate,
        yearMonth: targetMonth,
        monthlyOutput,
      });
      return;
    }
    const model =
      this.helpers.config.get<string>('CLAUDE_MODEL') || 'claude-sonnet-4-5-20250929';

    const seenSectionKeys: string[] = [];
    const sanitizeDiffSections: string[] = [];
    let totalDiffPhraseCount = 0;

    const detector = createSectionDetector((key, value) => {
      seenSectionKeys.push(key);
      let outValue: unknown = value;
      if (typeof value === 'string') {
        const { text, strippedPhrases } =
          this.validators.stripBannedAbsolutePhrasesFromText(value);
        if (strippedPhrases.length > 0) {
          sanitizeDiffSections.push(key);
          totalDiffPhraseCount += strippedPhrases.length;
        }
        outValue = text;
      }
      this._emit(response, { type: 'section_complete', key, value: outValue });
    });

    const abortController = new AbortController();
    let lastDeltaAt = Date.now();
    let watchdogTriggered = false;
    const watchdogTimer = setInterval(() => {
      if (Date.now() - lastDeltaAt > STREAM_WATCHDOG_MS) {
        this.logger.warn(`Monthly fortune stream watchdog timeout`);
        watchdogTriggered = true;
        abortController.abort();
      }
    }, 5_000);

    let clientDisconnected = false;
    const onClientClose = () => {
      this.logger.log(`Monthly fortune stream — client disconnected mid-stream`);
      clientDisconnected = true;
      abortController.abort();
    };
    response.on('close', onClientClose);

    let assistantBuffer = '';
    let finalStopReason: string | null = null;

    try {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: STREAM_MAX_TOKENS,
          temperature: STREAM_TEMPERATURE,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        },
        {
          timeout: STREAM_TIMEOUT_MS,
          signal: abortController.signal,
        },
      );

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          const text = event.delta.text as string;
          assistantBuffer += text;
          lastDeltaAt = Date.now();
          detector.write(text);
        }
      }

      const finalMessage = await stream.finalMessage();
      finalStopReason = (finalMessage as { stop_reason?: string }).stop_reason ?? null;
    } catch (err) {
      clearInterval(watchdogTimer);
      response.off('close', onClientClose);

      if (clientDisconnected) {
        await this._handleMonthlyClientDisconnect({
          chartHash,
          birthProfileId,
          anchorDate,
          yearMonth: targetMonth,
          monthlyOutput,
          assistantBuffer,
        });
        if (!response.writableEnded) {
          response.end();
        }
        return;
      }

      const reason = watchdogTriggered
        ? 'watchdog-timeout-no-delta-60s'
        : `ai-stream-failed: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(`Monthly fortune stream Anthropic failure: ${reason}`);
      detector.close();
      {
        const failRow = await this._persistMonthlyAIFailure({
          chartHash,
          birthProfileId,
          anchorDate,
          yearMonth: targetMonth,
          monthlyOutput,
        });
        if (this._serveLkg(response, failRow, 'month')) return;
      }
      this._emitError(response, 'AI_FAILED', reason);
      return;
    } finally {
      clearInterval(watchdogTimer);
      response.off('close', onClientClose);
    }

    detector.close();

    if (finalStopReason === 'max_tokens') {
      this.logger.warn(
        `Monthly fortune stream truncated at max_tokens (${STREAM_MAX_TOKENS}) for chart=${chartHash.slice(0, 8)}…`,
      );
      {
        const failRow = await this._persistMonthlyAIFailure({
          chartHash,
          birthProfileId,
          anchorDate,
          yearMonth: targetMonth,
          monthlyOutput,
        });
        if (this._serveLkg(response, failRow, 'month')) return;
      }
      this._emitError(
        response,
        'TRUNCATED',
        `AI response exceeded ${STREAM_MAX_TOKENS} tokens — narrative may be incomplete`,
      );
      return;
    }
    if (finalStopReason === 'refusal') {
      this.logger.warn(`Monthly fortune stream — AI refused to generate`);
      {
        const failRow = await this._persistMonthlyAIFailure({
          chartHash,
          birthProfileId,
          anchorDate,
          yearMonth: targetMonth,
          monthlyOutput,
        });
        if (this._serveLkg(response, failRow, 'month')) return;
      }
      this._emitError(response, 'AI_REFUSED', 'AI declined to generate this narrative');
      return;
    }

    // End-of-stream — full validator + persist + done
    const parsedNarrative = this.helpers.extractJson(assistantBuffer);
    if (!parsedNarrative) {
      this.logger.warn(
        `Monthly fortune stream — extractJson returned null on buffer length ${assistantBuffer.length}`,
      );
      {
        const failRow = await this._persistMonthlyAIFailure({
          chartHash,
          birthProfileId,
          anchorDate,
          yearMonth: targetMonth,
          monthlyOutput,
        });
        if (this._serveLkg(response, failRow, 'month')) return;
      }
      this._emitError(response, 'PARSE_FAILED', 'AI response was not valid JSON');
      return;
    }

    let validation: FortuneValidationResult;
    try {
      validation = this.validators.validateMonthly(parsedNarrative, {
        sessionAnchorMonth: targetMonth,
      });
    } catch (err) {
      this.logger.error(
        `Monthly fortune validator threw on stream output: ${(err as Error).message}`,
      );
      {
        const failRow = await this._persistMonthlyAIFailure({
          chartHash,
          birthProfileId,
          anchorDate,
          yearMonth: targetMonth,
          monthlyOutput,
        });
        if (this._serveLkg(response, failRow, 'month')) return;
      }
      this._emitError(
        response,
        'VALIDATION_FAILED',
        'Validator failed unexpectedly — narrative discarded',
      );
      return;
    }

    const sanitizedNarrative =
      validation.sanitized as unknown as MonthlyFortuneAINarrative;

    if (sanitizeDiffSections.length > 0) {
      Sentry.addBreadcrumb({
        category: 'fortune.stream.sanitize_diff',
        level: 'info',
        message: 'Per-section banned-phrase strip fired during monthly streaming',
        data: {
          scope: 'month',
          sectionKeys: sanitizeDiffSections,
          totalDiffPhraseCount,
        },
      });
    }

    const snapshot = await this.helpers.persistMonthlySnapshot({
      chartHash,
      birthProfileId,
      anchorDate,
      yearMonth: targetMonth,
      monthlyOutput,
      narrative: sanitizedNarrative,
      promptVersion: FORTUNE_PROMPT_VERSIONS.month,
    });

    try {
      await this.helpers.redis.set(
        this.helpers.monthlyRedisKey(chartHash, targetMonth),
        JSON.stringify(snapshot),
        REDIS_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to warm Redis after monthly stream: ${(err as Error).message}`,
      );
    }

    this._emit(response, {
      type: 'done',
      narrative: sanitizedNarrative,
      cacheHit: false,
    });
    response.end();
  }

  /** Monthly AI-failure persistence (mirror daily _persistAIFailure). */
  private async _persistMonthlyAIFailure(args: {
    chartHash: string;
    birthProfileId: string;
    anchorDate: Date;
    yearMonth: string;
    monthlyOutput: MonthlyEngineOutput;
  }): Promise<LkgRow> {
    try {
      return await this.helpers.persistMonthlySnapshot({
        ...args,
        narrative: null,
        promptVersion: null,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist monthly AI-failure snapshot: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Monthly client-disconnect handler (mirror daily _handleClientDisconnect). */
  private async _handleMonthlyClientDisconnect(args: {
    chartHash: string;
    birthProfileId: string;
    anchorDate: Date;
    yearMonth: string;
    monthlyOutput: MonthlyEngineOutput;
    assistantBuffer: string;
  }): Promise<void> {
    const parsed = this.helpers.extractJson(args.assistantBuffer);
    if (!parsed) {
      await this._persistMonthlyAIFailure({
        chartHash: args.chartHash,
        birthProfileId: args.birthProfileId,
        anchorDate: args.anchorDate,
        yearMonth: args.yearMonth,
        monthlyOutput: args.monthlyOutput,
      });
      return;
    }
    let validation: FortuneValidationResult;
    try {
      validation = this.validators.validateMonthly(parsed, {
        sessionAnchorMonth: args.yearMonth,
      });
    } catch {
      await this._persistMonthlyAIFailure({
        chartHash: args.chartHash,
        birthProfileId: args.birthProfileId,
        anchorDate: args.anchorDate,
        yearMonth: args.yearMonth,
        monthlyOutput: args.monthlyOutput,
      });
      return;
    }
    const sanitized =
      validation.sanitized as unknown as MonthlyFortuneAINarrative;
    try {
      await this.helpers.persistMonthlySnapshot({
        chartHash: args.chartHash,
        birthProfileId: args.birthProfileId,
        anchorDate: args.anchorDate,
        yearMonth: args.yearMonth,
        monthlyOutput: args.monthlyOutput,
        narrative: sanitized,
        promptVersion: FORTUNE_PROMPT_VERSIONS.month,
      });
      this.logger.log(
        `Monthly fortune stream — client disconnected but full narrative cached for chart=${args.chartHash.slice(0, 8)}…`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to persist monthly disconnect-recovered narrative: ${(err as Error).message}`,
      );
    }
  }

  // ============================================================
  // Phase 3 — Yearly streaming (mirrors streamMonthlyFortune)
  // ============================================================
  //
  // Differences from monthly:
  //   - Cache key: yearly via helpers.yearlyRedisKey
  //   - Pre-flight: year YYYY + enforceYearlySubscriptionGate
  //   - Engine: helpers.fetchYearlyFromEngine (NO intraMonthBreakdown sibling —
  //     coreRiskOpportunity + luckMethods live inside engineOutput)
  //   - Prompts: buildFortuneYearlyMessages
  //   - Validator: this.validators.validateYearly (single-arg signature)
  //   - Persist: helpers.persistYearlySnapshot
  //
  // Same machinery: clarinet section detector, watchdog, client-disconnect
  // rescue, stop-reason explicit branches, Sentry sanitize-diff breadcrumb.

  async streamYearlyFortune(
    clerkUserId: string,
    args: { profileId?: string; year?: string },
    response: Response,
  ): Promise<void> {
    if (!response.headersSent) {
      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();
    }

    try {
      const { user, profile, targetYear, anchorDate } =
        await this._preflightYearly(clerkUserId, args);

      const profileBirthDate = profile.birthDate.toISOString().slice(0, 10);
      const profileBirthTime = profile.birthTime;
      const chartHash = this.helpers.computeChartHash(profile);

      // Cache lookup (Redis → DB via helpers; key derived internally)
      const cached = await this.helpers.tryGetYearlyCached(chartHash, anchorDate);
      if (cached) {
        // Cache HIT — emit engine_ready (cacheHit=true) + done (cacheHit=true)
        // only. NO section_complete.
        const wireResponse = this.helpers.buildYearlyResponse(
          profile.id,
          profileBirthDate,
          profileBirthTime,
          Number(targetYear),
          cached,
          true,
        );
        this._emit(response, {
          type: 'engine_ready',
          engineOutput: wireResponse.engineOutput,
          profileId: profile.id,
          profileBirthDate,
          profileBirthTime,
          year: wireResponse.year,
          cacheHit: true,
        });
        this._emit(response, {
          type: 'done',
          narrative: wireResponse.narrative,
          cacheHit: true,
        });
        response.end();
        return;
      }

      // Cache miss → fetch engine output
      const year = Number(targetYear);
      let yearlyOutput: YearlyEngineOutput;
      try {
        yearlyOutput = await this.helpers.fetchYearlyFromEngine(profile, year);
      } catch (err) {
        this._emitError(
          response,
          'ENGINE_FAILED',
          err instanceof Error ? err.message : 'Bazi engine unreachable',
        );
        return;
      }

      const chartContext =
        (yearlyOutput as unknown as { chartContext?: FortuneChartContext }).chartContext ??
        this.helpers.buildFallbackChartContext(profile);

      // MEDIUM audit fix — strip chartContext from engineOutput before emit so
      // we don't leak ~2KB of birth-pillar metadata in every cold-cache stream
      // open. Mirrors the monthly engine_ready strip. Yearly has NO
      // intraMonthBreakdown sibling, so only chartContext is stripped.
      const { chartContext: _stripCC, ...engineOutputBare } =
        yearlyOutput as unknown as Record<string, unknown> & { chartContext?: unknown };
      void _stripCC;

      // Emit engine_ready BEFORE Anthropic so frontend can paint
      // Ring/Bars/risk-opp/luck-cards immediately (~600-1000ms vs ~5-15s for AI).
      this._emit(response, {
        type: 'engine_ready',
        engineOutput: engineOutputBare as FortuneYearlyStreamEngineOutput,
        profileId: profile.id,
        profileBirthDate,
        profileBirthTime,
        year,
        cacheHit: false,
      });

      // Open Anthropic stream + section detector
      await this._streamYearlyWithSectionDetector({
        response,
        yearlyOutput,
        chartContext,
        chartHash,
        birthProfileId: profile.id,
        anchorDate,
        year,
      });
    } catch (err) {
      if (err instanceof HttpException) {
        const resObj = err.getResponse();
        const code =
          typeof resObj === 'object' && resObj !== null && 'code' in resObj
            ? (resObj as { code: string }).code
            : 'PREFLIGHT_FAILED';
        const message = err.message || 'Pre-flight check failed';
        this._emitError(response, code, message);
        return;
      }
      this.logger.error(
        `Unexpected yearly stream pre-flight error: ${(err as Error).message}`,
      );
      this._emitError(response, 'INTERNAL_ERROR', 'Unexpected error');
    }
  }

  /** Yearly pre-flight: auth + profile + targetYear + subscription gate. */
  private async _preflightYearly(
    clerkUserId: string,
    args: { profileId?: string; year?: string },
  ): Promise<{
    user: { id: string; subscriptionTier: any };
    profile: {
      id: string;
      birthDate: Date;
      birthTime: string;
      birthCity: string;
      birthTimezone: string;
      gender: string;
      birthLongitude: number | null;
      birthLatitude: number | null;
    };
    targetYear: string;
    anchorDate: Date;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
    });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
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

    const targetYear = args.year ?? this.helpers.currentYearIso();
    if (!/^\d{4}$/.test(targetYear)) {
      throw new NotFoundException({
        code: 'INVALID_YEAR',
        message: `Invalid year format: ${targetYear} (expected YYYY)`,
      });
    }

    this.helpers.enforceYearlySubscriptionGate(user.subscriptionTier, targetYear);

    const anchorDate = new Date(`${targetYear}-01-01T00:00:00Z`);

    return { user, profile, targetYear, anchorDate };
  }

  /** Run Anthropic yearly stream + clarinet section detector + per-section
   *  banned-phrase strip + end-of-stream validate + persist. */
  private async _streamYearlyWithSectionDetector(ctx: {
    response: Response;
    yearlyOutput: YearlyEngineOutput;
    chartContext: FortuneChartContext;
    chartHash: string;
    birthProfileId: string;
    anchorDate: Date;
    year: number;
  }): Promise<void> {
    const { response, yearlyOutput, chartContext, chartHash, birthProfileId, anchorDate, year } = ctx;

    if (!FORTUNE_V1_PROMPTS.yearly) {
      this._emitError(response, 'PROMPT_NOT_CONFIGURED', 'FORTUNE_V1_PROMPTS.yearly not configured');
      return;
    }

    const { systemPrompt, userPrompt } = buildFortuneYearlyMessages(
      yearlyOutput,
      chartContext,
      { year },
    );

    let client: any;
    try {
      client = await this.helpers.ensureClaudeClient();
    } catch (err) {
      this._emitError(
        response,
        'AI_NOT_CONFIGURED',
        err instanceof Error ? err.message : 'AI client unavailable',
      );
      await this._persistYearlyAIFailure({
        chartHash,
        birthProfileId,
        anchorDate,
        year,
        yearlyOutput,
      });
      return;
    }
    const model =
      this.helpers.config.get<string>('CLAUDE_MODEL') || 'claude-sonnet-4-5-20250929';

    const seenSectionKeys: string[] = [];
    const sanitizeDiffSections: string[] = [];
    let totalDiffPhraseCount = 0;

    const detector = createSectionDetector((key, value) => {
      seenSectionKeys.push(key);
      let outValue: unknown = value;
      if (typeof value === 'string') {
        const { text, strippedPhrases } =
          this.validators.stripBannedAbsolutePhrasesFromText(value);
        if (strippedPhrases.length > 0) {
          sanitizeDiffSections.push(key);
          totalDiffPhraseCount += strippedPhrases.length;
        }
        outValue = text;
      }
      this._emit(response, { type: 'section_complete', key, value: outValue });
    });

    const abortController = new AbortController();
    let lastDeltaAt = Date.now();
    let watchdogTriggered = false;
    const watchdogTimer = setInterval(() => {
      if (Date.now() - lastDeltaAt > STREAM_WATCHDOG_MS) {
        this.logger.warn(`Yearly fortune stream watchdog timeout`);
        watchdogTriggered = true;
        abortController.abort();
      }
    }, 5_000);

    let clientDisconnected = false;
    const onClientClose = () => {
      this.logger.log(`Yearly fortune stream — client disconnected mid-stream`);
      clientDisconnected = true;
      abortController.abort();
    };
    response.on('close', onClientClose);

    let assistantBuffer = '';
    let finalStopReason: string | null = null;

    try {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: STREAM_MAX_TOKENS,
          temperature: STREAM_TEMPERATURE,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        },
        {
          timeout: STREAM_TIMEOUT_MS,
          signal: abortController.signal,
        },
      );

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          const text = event.delta.text as string;
          assistantBuffer += text;
          lastDeltaAt = Date.now();
          detector.write(text);
        }
      }

      const finalMessage = await stream.finalMessage();
      finalStopReason = (finalMessage as { stop_reason?: string }).stop_reason ?? null;
    } catch (err) {
      clearInterval(watchdogTimer);
      response.off('close', onClientClose);

      if (clientDisconnected) {
        await this._handleYearlyClientDisconnect({
          chartHash,
          birthProfileId,
          anchorDate,
          year,
          yearlyOutput,
          assistantBuffer,
        });
        if (!response.writableEnded) {
          response.end();
        }
        return;
      }

      const reason = watchdogTriggered
        ? 'watchdog-timeout-no-delta-60s'
        : `ai-stream-failed: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(`Yearly fortune stream Anthropic failure: ${reason}`);
      detector.close();
      {
        const failRow = await this._persistYearlyAIFailure({
          chartHash,
          birthProfileId,
          anchorDate,
          year,
          yearlyOutput,
        });
        if (this._serveLkg(response, failRow, 'year')) return;
      }
      this._emitError(response, 'AI_FAILED', reason);
      return;
    } finally {
      clearInterval(watchdogTimer);
      response.off('close', onClientClose);
    }

    detector.close();

    if (finalStopReason === 'max_tokens') {
      this.logger.warn(
        `Yearly fortune stream truncated at max_tokens (${STREAM_MAX_TOKENS}) for chart=${chartHash.slice(0, 8)}…`,
      );
      {
        const failRow = await this._persistYearlyAIFailure({
          chartHash,
          birthProfileId,
          anchorDate,
          year,
          yearlyOutput,
        });
        if (this._serveLkg(response, failRow, 'year')) return;
      }
      this._emitError(
        response,
        'TRUNCATED',
        `AI response exceeded ${STREAM_MAX_TOKENS} tokens — narrative may be incomplete`,
      );
      return;
    }
    if (finalStopReason === 'refusal') {
      this.logger.warn(`Yearly fortune stream — AI refused to generate`);
      {
        const failRow = await this._persistYearlyAIFailure({
          chartHash,
          birthProfileId,
          anchorDate,
          year,
          yearlyOutput,
        });
        if (this._serveLkg(response, failRow, 'year')) return;
      }
      this._emitError(response, 'AI_REFUSED', 'AI declined to generate this narrative');
      return;
    }

    // End-of-stream — full validator + persist + done
    const parsedNarrative = this.helpers.extractJson(assistantBuffer);
    if (!parsedNarrative) {
      this.logger.warn(
        `Yearly fortune stream — extractJson returned null on buffer length ${assistantBuffer.length}`,
      );
      {
        const failRow = await this._persistYearlyAIFailure({
          chartHash,
          birthProfileId,
          anchorDate,
          year,
          yearlyOutput,
        });
        if (this._serveLkg(response, failRow, 'year')) return;
      }
      this._emitError(response, 'PARSE_FAILED', 'AI response was not valid JSON');
      return;
    }

    let validation: FortuneValidationResult;
    try {
      validation = this.validators.validateYearly(parsedNarrative);
    } catch (err) {
      this.logger.error(
        `Yearly fortune validator threw on stream output: ${(err as Error).message}`,
      );
      {
        const failRow = await this._persistYearlyAIFailure({
          chartHash,
          birthProfileId,
          anchorDate,
          year,
          yearlyOutput,
        });
        if (this._serveLkg(response, failRow, 'year')) return;
      }
      this._emitError(
        response,
        'VALIDATION_FAILED',
        'Validator failed unexpectedly — narrative discarded',
      );
      return;
    }

    const sanitizedNarrative =
      validation.sanitized as unknown as YearlyFortuneAINarrative;

    if (sanitizeDiffSections.length > 0) {
      Sentry.addBreadcrumb({
        category: 'fortune.stream.sanitize_diff',
        level: 'info',
        message: 'Per-section banned-phrase strip fired during yearly streaming',
        data: {
          scope: 'year',
          sectionKeys: sanitizeDiffSections,
          totalDiffPhraseCount,
        },
      });
    }

    const snapshot = await this.helpers.persistYearlySnapshot({
      chartHash,
      birthProfileId,
      anchorDate,
      year,
      yearlyOutput,
      narrative: sanitizedNarrative,
      promptVersion: FORTUNE_PROMPT_VERSIONS.year,
    });

    try {
      await this.helpers.redis.set(
        this.helpers.yearlyRedisKey(chartHash, String(year)),
        JSON.stringify(snapshot),
        REDIS_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to warm Redis after yearly stream: ${(err as Error).message}`,
      );
    }

    this._emit(response, {
      type: 'done',
      narrative: sanitizedNarrative,
      cacheHit: false,
    });
    response.end();
  }

  /** Yearly AI-failure persistence (mirror monthly _persistMonthlyAIFailure). */
  private async _persistYearlyAIFailure(args: {
    chartHash: string;
    birthProfileId: string;
    anchorDate: Date;
    year: number;
    yearlyOutput: YearlyEngineOutput;
  }): Promise<LkgRow> {
    try {
      return await this.helpers.persistYearlySnapshot({
        ...args,
        narrative: null,
        promptVersion: null,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist yearly AI-failure snapshot: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Yearly client-disconnect handler (mirror monthly _handleMonthlyClientDisconnect). */
  private async _handleYearlyClientDisconnect(args: {
    chartHash: string;
    birthProfileId: string;
    anchorDate: Date;
    year: number;
    yearlyOutput: YearlyEngineOutput;
    assistantBuffer: string;
  }): Promise<void> {
    const parsed = this.helpers.extractJson(args.assistantBuffer);
    if (!parsed) {
      await this._persistYearlyAIFailure({
        chartHash: args.chartHash,
        birthProfileId: args.birthProfileId,
        anchorDate: args.anchorDate,
        year: args.year,
        yearlyOutput: args.yearlyOutput,
      });
      return;
    }
    let validation: FortuneValidationResult;
    try {
      validation = this.validators.validateYearly(parsed);
    } catch {
      await this._persistYearlyAIFailure({
        chartHash: args.chartHash,
        birthProfileId: args.birthProfileId,
        anchorDate: args.anchorDate,
        year: args.year,
        yearlyOutput: args.yearlyOutput,
      });
      return;
    }
    const sanitized =
      validation.sanitized as unknown as YearlyFortuneAINarrative;
    try {
      await this.helpers.persistYearlySnapshot({
        chartHash: args.chartHash,
        birthProfileId: args.birthProfileId,
        anchorDate: args.anchorDate,
        year: args.year,
        yearlyOutput: args.yearlyOutput,
        narrative: sanitized,
        promptVersion: FORTUNE_PROMPT_VERSIONS.year,
      });
      this.logger.log(
        `Yearly fortune stream — client disconnected but full narrative cached for chart=${args.chartHash.slice(0, 8)}…`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to persist yearly disconnect-recovered narrative: ${(err as Error).message}`,
      );
    }
  }
}
