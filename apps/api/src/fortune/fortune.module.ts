import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { FortuneController } from './fortune.controller';
import { FortuneService } from './fortune.service';
import { FortuneValidatorsService } from './fortune-validators.service';

@Module({
  imports: [ConfigModule, PrismaModule, RedisModule],
  controllers: [FortuneController],
  providers: [FortuneService, FortuneValidatorsService],
  exports: [FortuneService],
})
export class FortuneModule {}
