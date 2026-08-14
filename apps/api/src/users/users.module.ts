import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AIModule } from '../ai/ai.module';

@Module({
  // C1 — account deletion purges this person's `ReadingCache` rows, which are
  // keyed by a hash the AI service owns (it folds in a per-reading-type cache
  // version). Importing it beats re-implementing the hash here: a copy that
  // drifts by one character silently stops matching, and the deletion would
  // report success while leaving the cached readings in place. No cycle —
  // AIService depends only on Config/Prisma/Redis/Credits.
  imports: [AIModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
