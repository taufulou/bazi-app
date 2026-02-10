import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/public.decorator';
import { AdminGuard } from '../auth/admin.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Simple health check for load balancers' })
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'bazi-api',
      version: '0.1.0',
    };
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
      const res = await fetch(`${baziUrl}/health`, {
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
