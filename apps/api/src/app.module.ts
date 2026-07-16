import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import * as Joi from 'joi';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { UsersModule } from './users/users.module';
import { BaziModule } from './bazi/bazi.module';
import { ZwdsModule } from './zwds/zwds.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';
import { AdsModule } from './ads/ads.module';
import { AIModule } from './ai/ai.module';
import { CreditsModule } from './credits/credits.module';
import { ChatModule } from './chat/chat.module';
import { FortuneModule } from './fortune/fortune.module';
import { BannerModule } from './banner/banner.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validationSchema: Joi.object({
        // Required — app fails to start without these
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string().default('redis://localhost:6379'),
        CLERK_SECRET_KEY: Joi.string().required(),
        CLERK_WEBHOOK_SECRET: Joi.string().required(),
        // Optional — features degrade gracefully without these
        ANTHROPIC_API_KEY: Joi.string().allow('').optional().default(''),
        OPENAI_API_KEY: Joi.string().allow('').optional().default(''),
        GOOGLE_AI_API_KEY: Joi.string().allow('').optional().default(''),
        STRIPE_SECRET_KEY: Joi.string().allow('').optional().default(''),
        STRIPE_WEBHOOK_SECRET: Joi.string().allow('').optional().default(''),
        // RevenueCat (mobile IAP) — optional so the app boots without it; the
        // RC webhook fails-closed (401) and account-deletion skips the RC delete
        // when unset. RC_WEBHOOK_SECRET = the "Authorization: Bearer" the RC
        // dashboard sends; RC_API_KEY = a RC REST secret key (subscriber delete).
        RC_WEBHOOK_SECRET: Joi.string().allow('').optional().default(''),
        RC_API_KEY: Joi.string().allow('').optional().default(''),
        BAZI_ENGINE_URL: Joi.string().default('http://localhost:5001'),
        // Cloudflare R2 (banner image uploads) — optional so the app boots
        // without R2; the admin /upload endpoint fails loudly when unset.
        R2_ACCOUNT_ID: Joi.string().allow('').optional().default(''),
        R2_ACCESS_KEY_ID: Joi.string().allow('').optional().default(''),
        R2_SECRET_ACCESS_KEY: Joi.string().allow('').optional().default(''),
        R2_BUCKET: Joi.string().allow('').optional().default(''),
        R2_PUBLIC_BASE_URL: Joi.string().allow('').optional().default(''),
        CORS_ORIGINS: Joi.string().optional().default('http://localhost:3000'),
        PORT: Joi.number().default(4000),
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
      }),
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),

    // Rate limiting — 100 requests per 60 seconds per IP
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 100,
      },
    ]),

    // Infrastructure
    PrismaModule,
    RedisModule,

    // Auth
    AuthModule,

    // AI
    AIModule,

    // Credits (used by Bazi + Payments + AI for refunds)
    CreditsModule,

    // Chat (Phase 1 — billing only; full module in later phases)
    ChatModule,

    // Fortune (八字日運/月運/年運)
    FortuneModule,

    // Dashboard banner (admin-managed homepage carousel)
    BannerModule,

    // Feature modules
    UsersModule,
    BaziModule,
    ZwdsModule,
    PaymentsModule,
    AdminModule,
    AdsModule,

    // Webhooks
    WebhooksModule,
  ],
  controllers: [HealthController],
  providers: [
    // Apply rate limiting globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
