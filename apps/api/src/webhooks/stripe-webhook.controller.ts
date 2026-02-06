/**
 * Stripe Webhook Controller — Handles incoming Stripe webhook events.
 *
 * Events handled:
 * - checkout.session.completed — New subscription or one-time payment
 * - customer.subscription.updated — Subscription changes (upgrade, downgrade, renewal)
 * - customer.subscription.deleted — Subscription cancelled or expired
 * - invoice.payment_succeeded — Successful payment (record transaction)
 * - invoice.payment_failed — Failed payment (mark past due)
 */
import {
  Controller,
  Post,
  Req,
  Res,
  Headers,
  Logger,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { StripeService } from '../payments/stripe.service';
import Stripe from 'stripe';

@ApiTags('Webhooks')
@Controller('api/webhooks')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private readonly stripeService: StripeService) {}

  @Public()
  @Post('stripe')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Stripe webhook endpoint' })
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      this.logger.warn('Stripe webhook received without signature');
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    let event: Stripe.Event;

    try {
      const rawBody = req.rawBody;
      if (!rawBody) {
        this.logger.warn('Stripe webhook received without raw body');
        return res.status(400).json({ error: 'Missing request body' });
      }
      event = this.stripeService.verifyWebhookSignature(rawBody, signature);
    } catch (err) {
      this.logger.error(`Stripe webhook signature verification failed: ${err}`);
      return res.status(400).json({ error: 'Invalid signature' });
    }

    this.logger.log(`Stripe webhook received: ${event.type} (${event.id})`);

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          await this.stripeService.handleCheckoutCompleted(session);
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as Stripe.Subscription;
          await this.stripeService.handleSubscriptionUpdated(subscription);
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          await this.stripeService.handleSubscriptionDeleted(subscription);
          break;
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as Stripe.Invoice;
          await this.stripeService.handleInvoicePaid(invoice);
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          await this.stripeService.handleInvoiceFailed(invoice);
          break;
        }

        default:
          this.logger.log(`Unhandled Stripe event type: ${event.type}`);
      }
    } catch (err) {
      this.logger.error(`Error processing Stripe webhook ${event.type}: ${err}`);
      // Return 200 even on processing errors to prevent Stripe retries
      // We log the error for investigation
    }

    return res.status(200).json({ received: true });
  }
}
