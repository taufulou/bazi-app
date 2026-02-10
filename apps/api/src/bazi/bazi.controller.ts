import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BaziService } from './bazi.service';
import { CreateReadingDto, CreateComparisonDto } from './dto/create-reading.dto';
import { CurrentUser, AuthPayload } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';

@ApiTags('Bazi')
@Controller('api/bazi')
export class BaziController {
  constructor(private readonly baziService: BaziService) {}

  // ============ Public Endpoints ============

  @Public()
  @Get('services')
  @ApiOperation({ summary: 'List available Bazi reading services' })
  async getServices() {
    return this.baziService.getServices();
  }

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'List available subscription plans' })
  async getPlans() {
    return this.baziService.getPlans();
  }

  // ============ Authenticated Endpoints ============

  @Post('readings')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Create a new Bazi reading with AI interpretation' })
  async createReading(
    @CurrentUser() auth: AuthPayload,
    @Body() dto: CreateReadingDto,
  ) {
    return this.baziService.createReading(auth.userId, dto);
  }

  @Get('readings/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a specific Bazi reading' })
  async getReading(
    @CurrentUser() auth: AuthPayload,
    @Param('id') id: string,
  ) {
    return this.baziService.getReading(auth.userId, id);
  }

  @Post('comparisons')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Create a Bazi compatibility comparison with AI interpretation' })
  async createComparison(
    @CurrentUser() auth: AuthPayload,
    @Body() dto: CreateComparisonDto,
  ) {
    return this.baziService.createComparison(auth.userId, dto);
  }
}
