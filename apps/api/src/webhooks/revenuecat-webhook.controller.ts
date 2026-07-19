/**
 * RevenueCat Webhook Controller — incoming mobile-IAP (Apple/Google) events.
 *
 * Auth: RevenueCat sends a static `Authorization: Bearer <RC_WEBHOOK_SECRET>`
 * header (configured in the RC dashboard) — there is no per-request signature,
 * so we compare the bearer against our secret (fail-closed).
 *
 * Events: INITIAL_PURCHASE / RENEWAL / PRODUCT_CHANGE / UNCANCELLATION /
 * NON_RENEWING_PURCHASE / CANCELLATION / EXPIRATION / BILLING_ISSUE /
 * SUBSCRIPTION_PAUSED / TRANSFER (see RevenueCatService).
 */
import { Controller, Post, Req, Res, Headers, Logger, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { RevenueCatService, RevenueCatWebhookBody } from '../payments/revenuecat.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('Webhooks')
@Controller('api/webhooks')
export class RevenueCatWebhookController {
  private readonly logger = new Logger(RevenueCatWebhookController.name);

  constructor(
    private readonly revenueCatService: RevenueCatService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Post('revenuecat')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'RevenueCat webhook endpoint' })
  async handleRevenueCatWebhook(
    @Req() _req: Request,
    @Res() res: Response,
    @Headers('authorization') authHeader: string,
    // Typed as a plain interface (not a class) so the global ValidationPipe does
    // NOT strip unknown RC fields — mirrors the M1 passthrough routes.
    @Body() body: RevenueCatWebhookBody,
  ) {
    if (!this.revenueCatService.verifyAuthHeader(authHeader)) {
      this.logger.warn('RevenueCat webhook rejected — bad/missing Authorization');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const event = body?.event;
    if (!event || !event.id || !event.type) {
      this.logger.warn('RevenueCat webhook missing event payload');
      return res.status(400).json({ error: 'Missing event' });
    }

    this.logger.log(`RevenueCat webhook received: ${event.type} (${event.id})`);

    // Idempotency: skip already-processed events (TTL 48h to cover RC retries).
    const idempotencyKey = `rc:event:${event.id}`;
    const alreadyProcessed = await this.redis.get(idempotencyKey);
    if (alreadyProcessed) {
      this.logger.log(`RevenueCat event ${event.id} already processed, skipping`);
      return res.status(200).json({ received: true });
    }

    try {
      await this.revenueCatService.handleEvent(event);
    } catch (err) {
      this.logger.error(`Error processing RevenueCat webhook ${event.type}: ${err}`);
      // 500 → RevenueCat retries with backoff.
      return res.status(500).json({ error: 'Webhook processing failed' });
    }

    await this.redis.set(idempotencyKey, '1', 172800);
    return res.status(200).json({ received: true });
  }
}
