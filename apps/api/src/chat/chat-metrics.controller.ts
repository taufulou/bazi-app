/**
 * ChatMetricsAdminController — Phase 3.1d
 *
 * Admin-only endpoint for chat observability:
 *   GET /api/admin/chat/metrics?days=7
 *
 * Returns per-reading-type cost (P50/P95/avg per session) + refuseRate +
 * session/message counts over the last N days. See ChatMetricsService for
 * data shape + cost computation.
 *
 * On-demand only (no scheduled persistence). Phase 3.2 candidate: cron
 * snapshot to a `chat_metrics` table for time-series analysis.
 */
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { ChatMetricsService } from './chat-metrics.service';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('api/admin/chat/metrics')
export class ChatMetricsAdminController {
  constructor(private readonly service: ChatMetricsService) {}

  @Get()
  @ApiOperation({
    summary: 'Chat observability metrics per reading type (Phase 3.1d)',
    description:
      'Cost P50/P95/avg per session + refuseRate + session/message counts. ' +
      'Healthy refuseRate band 5-25%; > 25% = topic scope too aggressive, ' +
      '< 5% = AI leaking past topic boundary.',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    type: Number,
    description: 'Rolling window in days (default 7, max 90)',
  })
  async getMetrics(@Query('days') days?: string) {
    const parsed = days ? parseInt(days, 10) : 7;
    const windowDays = Math.min(90, Math.max(1, Number.isFinite(parsed) ? parsed : 7));
    return this.service.getMetrics(windowDays);
  }
}
