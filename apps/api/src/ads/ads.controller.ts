/**
 * Ads Controller — REST endpoints for rewarded video ads.
 *
 * Public:
 *   GET  /api/ads/config  — Ad configuration (unit IDs, reward types, daily limits)
 *
 * Authenticated:
 *   GET  /api/ads/status  — Remaining daily views for current user
 *   POST /api/ads/claim   — Claim reward after ad completion
 */
import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { IsString, IsIn, IsOptional } from 'class-validator';
import { AdsService } from './ads.service';
import { CurrentUser, AuthPayload } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';

// ============================================================
// DTOs
// ============================================================

class ClaimAdRewardDto {
  @IsIn(['CREDIT', 'SECTION_UNLOCK', 'DAILY_HOROSCOPE'])
  rewardType!: 'CREDIT' | 'SECTION_UNLOCK' | 'DAILY_HOROSCOPE';

  @IsOptional()
  @IsString()
  adPlacementId?: string;

  @IsOptional()
  @IsString()
  readingId?: string;

  @IsOptional()
  @IsString()
  sectionKey?: string;
}

// ============================================================
// Controller
// ============================================================

@ApiTags('Ads')
@Controller('api/ads')
export class AdsController {
  constructor(private readonly adsService: AdsService) {}

  // ============ Public Endpoints ============

  @Public()
  @Get('config')
  @ApiOperation({ summary: 'Get ad configuration (unit IDs, reward types, daily limits)' })
  getAdConfig() {
    return this.adsService.getAdConfig();
  }

  // ============ Authenticated Endpoints ============

  @Get('status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get remaining daily ad views for current user' })
  async getAdStatus(@CurrentUser() auth: AuthPayload) {
    return this.adsService.getRemainingViews(auth.userId);
  }

  @Post('claim')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Claim reward after watching an ad' })
  @ApiBody({ type: ClaimAdRewardDto })
  async claimReward(
    @CurrentUser() auth: AuthPayload,
    @Body() dto: ClaimAdRewardDto,
  ) {
    return this.adsService.claimReward(
      auth.userId,
      dto.rewardType,
      dto.adPlacementId,
      dto.readingId,
      dto.sectionKey,
    );
  }
}
