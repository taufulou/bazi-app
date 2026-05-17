/**
 * Fortune controller — REST endpoints for 八字日運/月運/年運.
 *
 * Plan: `.claude/plans/ok-next-big-feature-merry-cake.md`
 * Phase 1: GET /api/fortune/daily only. Monthly + yearly endpoints
 *          deferred to Phase 2/3.
 */
import { Controller, Get, Query } from '@nestjs/common';
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
   */
  @Get('daily')
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
