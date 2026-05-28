import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { FortuneController } from './fortune.controller';
import { FortuneService } from './fortune.service';
import { FortuneStreamService } from './fortune-stream.service';
import { FortuneValidatorsService } from './fortune-validators.service';
import { FortuneSnapshotHelpers } from './fortune-snapshot.helpers';

@Module({
  imports: [ConfigModule, PrismaModule, RedisModule],
  controllers: [FortuneController],
  providers: [
    FortuneService,
    FortuneStreamService,
    FortuneValidatorsService,
    FortuneSnapshotHelpers,
  ],
  exports: [FortuneService, FortuneStreamService, FortuneSnapshotHelpers],
})
export class FortuneModule {}
