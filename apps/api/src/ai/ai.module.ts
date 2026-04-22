import { Module } from '@nestjs/common';
import { AIService } from './ai.service';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [CreditsModule],
  providers: [AIService],
  exports: [AIService],
})
export class AIModule {}
