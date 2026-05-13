import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AdminGuard } from '../auth/admin.guard';
import { ChatPaymentService } from './chat-payment.service';
import { ChatContextService } from './chat-context.service';
import { ChatValidatorsService } from './chat-validators.service';
import { ChatStreamService } from './chat-stream.service';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatSampleQuestionService } from './chat-sample-questions.service';
import {
  ChatSampleQuestionsPublicController,
  ChatSampleQuestionsAdminController,
} from './chat-sample-questions.controller';
// Phase 3.1d — observability
import { ChatMetricsService } from './chat-metrics.service';
import { ChatMetricsAdminController } from './chat-metrics.controller';

/**
 * AI chat feature (per next-the-big-feature-proud-manatee plan).
 *
 * Phase 1 ships:
 * - Phase 1.1 (DONE): ChatPaymentService — per-message free-quota → paid-allowance →
 *   reject; extension purchase (1 credit = 10 more messages); refund; 12-month PDPA
 *   retention helper.
 * - Phase 1.2 (DONE): ChatContextService → Python `/build-chat-context` engine call,
 *   24h Redis cache, version snapshotting for mid-session drift detection.
 * - Phase 1.3 (THIS): ChatService + ChatController — session lifecycle + non-streaming
 *   message handling. Anthropic SDK call returns full reply at once.
 * - Phase 1.4: Replaces placeholder system prompt with verbatim port of prompts.ts
 *   anti-hallucination rules + 10 written few-shots + 3-stage post-validator.
 * - Phase 1.5: Doctrine eval corpus + CI gate.
 * - Phase 1.6: Switch sendMessage to SSE streaming.
 *
 * Other modules import this module to call ChatPaymentService (e.g.,
 * StripeService.handleSubscriptionUpdated re-snapshots the chat quota on
 * tier change).
 */
@Module({
  imports: [
    PrismaModule,
    CreditsModule,
    RedisModule,
  ],
  controllers: [
    ChatController,
    // Phase 2 — sample-question CRUD
    ChatSampleQuestionsPublicController,
    ChatSampleQuestionsAdminController,
    // Phase 3.1d — observability
    ChatMetricsAdminController,
  ],
  providers: [
    ChatPaymentService,
    ChatContextService,
    ChatValidatorsService,
    ChatStreamService,
    ChatService,
    ChatSampleQuestionService,
    ChatMetricsService,
    // AdminGuard re-registered locally for the admin chat-questions controller.
    // (AdminGuard is also registered in AdminModule, but Nest provider scope
    // is per-module — we need a local instance.)
    AdminGuard,
  ],
  exports: [
    ChatPaymentService,
    ChatContextService,
    ChatValidatorsService,
    ChatStreamService,
    ChatSampleQuestionService,
  ],
})
export class ChatModule {}
