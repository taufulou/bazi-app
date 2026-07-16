import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';
import { SectionUnlockService } from './section-unlock.service';
import { EntitlementsService } from './entitlements.service';
import { RevenueCatService } from './revenuecat.service';
import { CreditsModule } from '../credits/credits.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [CreditsModule, ChatModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    StripeService,
    SectionUnlockService,
    EntitlementsService,
    RevenueCatService,
  ],
  exports: [
    PaymentsService,
    StripeService,
    SectionUnlockService,
    EntitlementsService,
    RevenueCatService,
  ],
})
export class PaymentsModule {}
