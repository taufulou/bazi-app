import { Global, Module } from '@nestjs/common';
import { AiSpendService } from './ai-spend.service';

/**
 * S2 — global, like `RedisModule` and `PrismaModule`, and for the same reason.
 *
 * Every provider call in the application has to be metered, and those calls live
 * in `ai`, `chat` and `fortune`. Exporting this from `AIModule` instead would
 * mean each of those modules importing the whole AI service to get a counter,
 * and — more to the point — a NEW module that starts calling a provider would
 * have to remember to add the import. Cross-cutting infrastructure that must be
 * impossible to miss belongs in the global scope, next to Redis.
 *
 * It deliberately depends on nothing but the (global) Redis and Config
 * providers, so it can be injected anywhere without creating a cycle.
 */
@Global()
@Module({
  providers: [AiSpendService],
  exports: [AiSpendService],
})
export class AiSpendModule {}
