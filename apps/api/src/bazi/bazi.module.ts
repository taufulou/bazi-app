import { Module } from '@nestjs/common';
import { BaziController } from './bazi.controller';
import { BaziService } from './bazi.service';
import { AIModule } from '../ai/ai.module';

@Module({
  imports: [AIModule],
  controllers: [BaziController],
  providers: [BaziService],
  exports: [BaziService],
})
export class BaziModule {}
