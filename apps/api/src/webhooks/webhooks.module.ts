import { Module } from '@nestjs/common';
import { ClerkWebhookController } from './clerk-webhook.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [ClerkWebhookController, StripeWebhookController],
})
export class WebhooksModule {}
