import { Module } from '@nestjs/common';
import { ClerkWebhookController } from './clerk-webhook.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { RevenueCatWebhookController } from './revenuecat-webhook.controller';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PaymentsModule, UsersModule],
  controllers: [ClerkWebhookController, StripeWebhookController, RevenueCatWebhookController],
})
export class WebhooksModule {}
