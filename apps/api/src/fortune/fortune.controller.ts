/**
 * Fortune controller — REST endpoints for 八字日運/月運/年運.
 *
 * Plan: `.claude/plans/ok-next-big-feature-merry-cake.md`
 * Phase 1: GET /api/fortune/daily only. Monthly + yearly endpoints
 *          deferred to Phase 2/3.
 */
import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type AuthPayload } from '../auth/current-user.decorator';
import { FortuneService } from './fortune.service';
import { FortuneStreamService } from './fortune-stream.service';
import {
  GetDailyFortuneQueryDto,
  type DailyFortuneResponse,
} from './dto';

@Controller('api/fortune')
export class FortuneController {
  constructor(
    private readonly fortuneService: FortuneService,
    private readonly streamService: FortuneStreamService,
  ) {}

  /**
   * GET /api/fortune/daily?profileId=<uuid>&date=YYYY-MM-DD
   *
   * Returns the daily fortune for the given chart on the given date.
   * Subscription gate per locked plan:
   *   - Free: today only
   *   - Subscriber: yesterday + today + +30 days
   *
   * 23:00 子時 boundary: CLIENT is responsible for resolving the Bazi
   * day from local clock time BEFORE sending `date`. Server-side default
   * (when date omitted) = current calendar date in server TZ.
   *
   * ClerkAuthGuard is registered globally via AuthModule (APP_GUARD), so
   * no explicit `@UseGuards` here.
   *
   * Rate limit: 10 req/min — matches `bazi.controller.ts::createReading`
   * (same risk profile: AI-intensive + cacheable). Protects Anthropic
   * spend from authenticated abuse — a subscriber hitting different dates
   * within the +30d window would otherwise bypass cache and trigger ~100
   * AI calls/min at the global default. Per `4c5d89c` (Phase 7A
   * production hardening) — established pattern for AI-intensive endpoints.
   *
   * Known limitation: ThrottlerGuard is IP-scoped by NestJS default. An
   * attacker on rotating IPs (VPN/mobile NAT) can multiply effective
   * rate by IP count. User-scoped throttling requires a custom throttle-key
   * resolver — deferred to Phase 2 when traffic warrants it.
   */
  @Get('daily')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async getDaily(
    @CurrentUser() auth: AuthPayload,
    @Query() query: GetDailyFortuneQueryDto,
  ): Promise<DailyFortuneResponse> {
    // Phase Fortune+ progressive loading: when engineOnly=true, return engine
    // output without running AI (saves ~3-5s on cold cache). See DTO for
    // full cache-behavior contract.
    //
    // Audit H1 fix: class-validator's `IsBooleanString` accepts {'true',
    // 'false', 'True', 'TRUE', '1', '0'} per validator.js, but a strict
    // `=== 'true'` check would silently fall through to the slow path for
    // ANY non-lowercase truthy value. Normalize across the canonical truthy
    // set so client variation doesn't silently miss the optimization.
    const engineOnly = isTruthyQueryParam(query.engineOnly);
    return this.fortuneService.getDailyFortune(auth.userId, {
      profileId: query.profileId,
      date: query.date,
      engineOnly,
    });
  }

  /**
   * GET /api/fortune/daily/stream?profileId=<uuid>&date=YYYY-MM-DD
   *
   * Phase Fortune Streaming — SSE variant of GET /daily. Emits events as
   * the AI completes each `sections.<key>`:
   *   - engine_ready (immediate, ~500ms cold cache) — score/dims/folk
   *   - section_complete × N (one per section, ~each ~500ms-3s) — provisional
   *     prose, banned-phrase stripped
   *   - done — full sanitized narrative (validator override)
   *   - error — failure (engine / AI / validation)
   *
   * Same subscription gate + cache + persist semantics as GET /daily.
   * Cache hit: emits engine_ready + done immediately (NO section_complete).
   *
   * Rate limit: 10/min (matches GET /daily). The streaming endpoint costs
   * the SAME Anthropic tokens as non-streaming — only the wire delivery
   * differs.
   */
  @Get('daily/stream')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async streamDaily(
    @CurrentUser() auth: AuthPayload,
    @Query() query: GetDailyFortuneQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    await this.streamService.streamDailyFortune(
      auth.userId,
      { profileId: query.profileId, date: query.date },
      response,
    );
  }
}

/**
 * Normalize an Express query param to boolean. Express params arrive as
 * strings (or undefined). Accept the canonical truthy set: 'true', 'TRUE',
 * 'True', '1'. Everything else (including undefined, 'false', '0', '') is
 * false. Mirrors validator.js::isBoolean's accepted truthy set so the
 * `IsBooleanString` DTO validator and this normalizer agree.
 *
 * Exported for unit testability (Audit L1 follow-up).
 */
export function isTruthyQueryParam(v: string | undefined): boolean {
  if (!v) return false;
  return v === 'true' || v === 'TRUE' || v === 'True' || v === '1';
}
