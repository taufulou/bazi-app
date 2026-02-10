import { Module } from '@nestjs/common';
import { ZwdsController } from './zwds.controller';
import { ZwdsService } from './zwds.service';
import { AIModule } from '../ai/ai.module';

@Module({
  imports: [AIModule],
  controllers: [ZwdsController],
  providers: [ZwdsService],
  exports: [ZwdsService],
})
export class ZwdsModule {}
