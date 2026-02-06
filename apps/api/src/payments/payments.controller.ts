import {
  Controller,
  Get,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CurrentUser, AuthPayload } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';

@ApiTags('Payments')
@Controller('api/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Get('gateways')
  @ApiOperation({ summary: 'List available payment gateways' })
  @ApiQuery({ name: 'region', required: false, example: 'taiwan' })
  async getGateways(@Query('region') region?: string) {
    return this.paymentsService.getAvailableGateways(region);
  }

  @Get('subscription')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user subscription status' })
  async getSubscriptionStatus(@CurrentUser() auth: AuthPayload) {
    return this.paymentsService.getSubscriptionStatus(auth.userId);
  }

  @Get('transactions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get transaction history' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  async getTransactionHistory(
    @CurrentUser() auth: AuthPayload,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.paymentsService.getTransactionHistory(auth.userId, page, limit);
  }
}
