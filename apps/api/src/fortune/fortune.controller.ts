/**
 * Fortune controller — REST endpoints for 八字日運/月運/年運.
 *
 * Plan: `.claude/plans/ok-next-big-feature-merry-cake.md`
 * Phase 1: GET /api/fortune/daily only. Monthly + yearly endpoints
 *          deferred to Phase 2/3.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type AuthPayload } from '../auth/current-user.decorator';
import { FortuneService } from './fortune.service';
import {
  GetDailyFortuneQueryDto,
  type DailyFortuneResponse,
} from './dto';

@Controller('api/fortune')
export class FortuneController {
  constructor(private readonly fortuneService: FortuneService) {}

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
    return this.fortuneService.getDailyFortune(auth.userId, {
      profileId: query.profileId,
      date: query.date,
    });
  }
}
