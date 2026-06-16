import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AdminGuard } from '../auth/admin.guard';
import { BannerService } from './banner.service';
import { R2Service } from './r2.service';
import {
  BannerPublicController,
  BannerAdminController,
} from './banner.controller';

/**
 * Admin-managed dashboard banner (image + internal link, R2-backed).
 * See plan `.claude/plans/1-how-the-image-mutable-anchor.md`.
 *
 * AdminGuard is provided LOCALLY (Nest provider scope is per-module — same
 * pattern as ChatModule). RedisModule is @Global so RedisService resolves
 * without an explicit import, but we import it for parity with ChatModule.
 */
@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [BannerPublicController, BannerAdminController],
  providers: [BannerService, R2Service, AdminGuard],
})
export class BannerModule {}
