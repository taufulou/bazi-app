/**
 * Payments Controller — REST endpoints for payment operations.
 *
 * Public:
 *   GET  /api/payments/gateways — List available payment gateways
 *   GET  /api/payments/plans    — List active subscription plans
 *
 * Authenticated:
 *   GET  /api/payments/subscription — Current subscription status
 *   GET  /api/payments/transactions — Transaction history
 *   POST /api/payments/checkout/subscription — Create subscription checkout
 *   POST /api/payments/checkout/one-time     — Create one-time checkout
 *   POST /api/payments/portal                — Create customer portal session
 *   POST /api/payments/cancel                — Cancel subscription
 *   POST /api/payments/reactivate            — Reactivate cancelled subscription
 *   GET  /api/payments/free-reading           — Check free reading availability
 *   POST /api/payments/free-reading/use       — Mark free reading as used
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { IsString, IsIn, IsOptional, IsUrl, Matches } from 'class-validator';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';
import { CurrentUser, AuthPayload } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';

// ============================================================
// DTOs — validated to prevent open redirect via successUrl/cancelUrl
// Only allow URLs that start with our own site origin (relative or absolute).
// ============================================================

const SAFE_URL_REGEX = /^(https?:\/\/(localhost(:\d+)?|[a-z0-9-]+\.bazi-platform\.com)\/|\/)/;

class CreateSubscriptionCheckoutDto {
  @IsString()
  planSlug!: string;

  @IsIn(['monthly', 'annual'])
  billingCycle!: 'monthly' | 'annual';

  @IsOptional()
  @IsString()
  promoCode?: string;

  @IsString()
  @Matches(SAFE_URL_REGEX, { message: 'successUrl must be a relative path or point to our domain' })
  successUrl!: string;

  @IsString()
  @Matches(SAFE_URL_REGEX, { message: 'cancelUrl must be a relative path or point to our domain' })
  cancelUrl!: string;
}

class CreateOneTimeCheckoutDto {
  @IsString()
  serviceSlug!: string;

  @IsOptional()
  @IsString()
  promoCode?: string;

  @IsString()
  @Matches(SAFE_URL_REGEX, { message: 'successUrl must be a relative path or point to our domain' })
  successUrl!: string;

  @IsString()
  @Matches(SAFE_URL_REGEX, { message: 'cancelUrl must be a relative path or point to our domain' })
  cancelUrl!: string;
}

class CreatePortalSessionDto {
  @IsString()
  @Matches(SAFE_URL_REGEX, { message: 'returnUrl must be a relative path or point to our domain' })
  returnUrl!: string;
}

// ============================================================
// Controller
// ============================================================

@ApiTags('Payments')
@Controller('api/payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly stripeService: StripeService,
  ) {}

  // ============ Public Endpoints ============

  @Public()
  @Get('gateways')
  @ApiOperation({ summary: 'List available payment gateways' })
  @ApiQuery({ name: 'region', required: false, example: 'taiwan' })
  async getGateways(@Query('region') region?: string) {
    return this.paymentsService.getAvailableGateways(region);
  }

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'List active subscription plans' })
  async getPlans() {
    return this.paymentsService.getActivePlans();
  }

  // ============ Subscription Status ============

  @Get('subscription')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user subscription status' })
  async getSubscriptionStatus(@CurrentUser() auth: AuthPayload) {
    return this.paymentsService.getSubscriptionStatus(auth.userId);
  }

  // ============ Transaction History ============

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

  // ============ Checkout Sessions ============

  @Post('checkout/subscription')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Stripe checkout session for subscription' })
  @ApiBody({ type: CreateSubscriptionCheckoutDto })
  async createSubscriptionCheckout(
    @CurrentUser() auth: AuthPayload,
    @Body() dto: CreateSubscriptionCheckoutDto,
  ) {
    return this.stripeService.createSubscriptionCheckout({
      clerkUserId: auth.userId,
      planSlug: dto.planSlug,
      billingCycle: dto.billingCycle,
      promoCode: dto.promoCode,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });
  }

  @Post('checkout/one-time')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Stripe checkout session for one-time purchase' })
  @ApiBody({ type: CreateOneTimeCheckoutDto })
  async createOneTimeCheckout(
    @CurrentUser() auth: AuthPayload,
    @Body() dto: CreateOneTimeCheckoutDto,
  ) {
    return this.stripeService.createOneTimeCheckout({
      clerkUserId: auth.userId,
      serviceSlug: dto.serviceSlug,
      promoCode: dto.promoCode,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });
  }

  // ============ Customer Portal ============

  @Post('portal')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Stripe customer portal session' })
  @ApiBody({ type: CreatePortalSessionDto })
  async createPortalSession(
    @CurrentUser() auth: AuthPayload,
    @Body() dto: CreatePortalSessionDto,
  ) {
    return this.stripeService.createPortalSession(auth.userId, dto.returnUrl);
  }

  // ============ Subscription Management ============

  @Post('cancel')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel active subscription (at period end)' })
  async cancelSubscription(@CurrentUser() auth: AuthPayload) {
    return this.stripeService.cancelSubscription(auth.userId);
  }

  @Post('reactivate')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reactivate a cancelled subscription' })
  async reactivateSubscription(@CurrentUser() auth: AuthPayload) {
    return this.stripeService.reactivateSubscription(auth.userId);
  }

  // ============ Free Reading ============

  @Get('free-reading')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check if user can use free reading' })
  async checkFreeReading(@CurrentUser() auth: AuthPayload) {
    const canUse = await this.stripeService.canUseFreeReading(auth.userId);
    return { available: canUse };
  }

  @Post('free-reading/use')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark free reading as used' })
  async useFreeReading(@CurrentUser() auth: AuthPayload) {
    await this.stripeService.markFreeReadingUsed(auth.userId);
    return { success: true };
  }
}
