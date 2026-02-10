import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZwdsService } from './zwds.service';
import {
  CreateZwdsReadingDto,
  CreateZwdsComparisonDto,
  ZwdsChartPreviewDto,
  ZwdsHoroscopeDto,
} from './dto/create-zwds-reading.dto';
import { CurrentUser, AuthPayload } from '../auth/current-user.decorator';

@ApiTags('ZWDS')
@Controller('api/zwds')
export class ZwdsController {
  constructor(private readonly zwdsService: ZwdsService) {}

  // ============ Chart Preview (free hook) ============

  @Post('chart-preview')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Get ZWDS chart preview (no AI interpretation)' })
  async getChartPreview(
    @CurrentUser() auth: AuthPayload,
    @Body() dto: ZwdsChartPreviewDto,
  ) {
    return this.zwdsService.getChartPreview(auth.userId, dto);
  }

  // ============ Readings (Chart + AI) ============

  @Post('readings')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Create a new ZWDS reading with AI interpretation' })
  async createReading(
    @CurrentUser() auth: AuthPayload,
    @Body() dto: CreateZwdsReadingDto,
  ) {
    return this.zwdsService.createReading(auth.userId, dto);
  }

  @Get('readings/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a specific ZWDS reading' })
  async getReading(
    @CurrentUser() auth: AuthPayload,
    @Param('id') id: string,
  ) {
    return this.zwdsService.getReading(auth.userId, id);
  }

  // ============ Horoscope (大限/流年/流月) ============

  @Post('horoscope')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Get ZWDS horoscope (大限/流年/流月) for a specific date' })
  async getHoroscope(
    @CurrentUser() auth: AuthPayload,
    @Body() dto: ZwdsHoroscopeDto,
  ) {
    return this.zwdsService.getHoroscope(auth.userId, dto);
  }

  // ============ Compatibility ============

  @Post('comparisons')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Create a ZWDS compatibility comparison with AI interpretation' })
  async createComparison(
    @CurrentUser() auth: AuthPayload,
    @Body() dto: CreateZwdsComparisonDto,
  ) {
    return this.zwdsService.createComparison(auth.userId, dto);
  }
}
