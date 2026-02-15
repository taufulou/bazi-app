import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';
import { SectionUnlockService } from './section-unlock.service';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeService, SectionUnlockService],
  exports: [PaymentsService, StripeService, SectionUnlockService],
})
export class PaymentsModule {}
