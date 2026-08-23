import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/public.decorator';
import { AdminGuard } from '../auth/admin.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { engineFetch } from '../common/engine-client';
import { ReadinessService, ReadinessReport } from './readiness.service';

@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly readiness: ReadinessService,
  ) {}

  /**
   * LIVENESS. Deliberately static and dependency-free.
   *
   * M7 added readiness as a SEPARATE route rather than teaching this one to
   * check things. This is the documented production health path and what uptime
   * monitors poll, so a database query here would put one round-trip behind
   * every external ping — and a liveness probe that fails during a dependency
   * outage asks the platform to restart a process that is working, which cannot
   * possibly reach Postgres. Point platform healthchecks at `/health/ready`.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness — is the process up? No dependency checks.' })
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'bazi-api',
      version: '0.1.0',
    };
  }

  /**
   * READINESS — is this instance fit to take traffic?
   *
   * Public and unauthenticated because a platform healthcheck cannot carry a
   * token, and `@SkipThrottle()` (class-level) because it must be pollable.
   * `ReadinessService` memoises for a second so that combination is not a free
   * database amplifier.
   *
   * 200 when ready (including `degraded`, where only an advisory dependency is
   * down), 503 otherwise. The status CODE is the contract — platforms read it,
   * not the body.
   *
   * `passthrough: true` + `res.status()` rather than throwing
   * `ServiceUnavailableException`: `AllExceptionsFilter` flattens a thrown
   * body to `{message, error, code}`, which would discard the per-dependency
   * report — the only part a human debugging an outage wants.
   */
  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness — DB + Redis required, engine advisory' })
  @ApiResponse({ status: 200, description: 'Ready (or degraded: advisory dependency down)' })
  @ApiResponse({ status: 503, description: 'Not ready — a required dependency is unhealthy' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    const report = await this.readiness.check();
    res.status(report.ready ? 200 : 503);
    return report;
  }

  @Get('detailed')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Detailed health check with dependency status (admin only)' })
  async checkDetailed() {
    const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

    // Database check
    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'healthy', latencyMs: Date.now() - dbStart };
    } catch (err) {
      checks.database = {
        status: 'unhealthy',
        latencyMs: Date.now() - dbStart,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    // Redis check
    const redisStart = Date.now();
    try {
      await this.redis.set('health:ping', 'pong', 10);
      const val = await this.redis.get('health:ping');
      checks.redis = {
        status: val === 'pong' ? 'healthy' : 'degraded',
        latencyMs: Date.now() - redisStart,
      };
    } catch (err) {
      checks.redis = {
        status: 'unhealthy',
        latencyMs: Date.now() - redisStart,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    // Bazi engine check
    const baziUrl = this.config.get<string>('BAZI_ENGINE_URL') || 'http://localhost:5001';
    const baziStart = Date.now();
    try {
      // Goes through the shared helper even though `/health` is exempt from the
      // engine's key check in BOTH modes. Two reasons: the CI guard has one rule
      // ("no raw fetch at the engine") and exceptions to it are how call sites
      // get missed, and M7 moves this hop onto Railway's continuous probe — at
      // which point an unkeyed caller here would hold B3-b's gate open forever
      // if `/health` ever stopped being exempt.
      const res = await engineFetch(`${baziUrl}/health`, {
        caller: 'health.probe',
        signal: AbortSignal.timeout(5000),
      });
      checks.baziEngine = {
        status: res.ok ? 'healthy' : 'degraded',
        latencyMs: Date.now() - baziStart,
      };
    } catch (err) {
      checks.baziEngine = {
        status: 'unhealthy',
        latencyMs: Date.now() - baziStart,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    const overallStatus = Object.values(checks).every((c) => c.status === 'healthy')
      ? 'healthy'
      : Object.values(checks).some((c) => c.status === 'unhealthy')
        ? 'unhealthy'
        : 'degraded';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      service: 'bazi-api',
      version: '0.1.0',
      checks,
    };
  }
}
