import { Module } from '@nestjs/common';
import { BaziController } from './bazi.controller';
import { BaziService } from './bazi.service';

@Module({
  controllers: [BaziController],
  providers: [BaziService],
  exports: [BaziService],
})
export class BaziModule {}
