import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisService } from './redis/redis.service';
import { RedisThrottlerStorage } from './throttler/redis-throttler.storage';
import { UserAwareThrottlerGuard } from './throttler/user-aware-throttler.guard';
import { APP_GUARD } from '@nestjs/core';
import * as Joi from 'joi';
import { HealthController } from './health/health.controller';
import { ReadinessService } from './health/readiness.service';
import { LegalController } from './legal/legal.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { UsersModule } from './users/users.module';
import { BaziModule } from './bazi/bazi.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';
import { AdsModule } from './ads/ads.module';
import { AIModule } from './ai/ai.module';
import { AiSpendModule } from './ai/ai-spend.module';
import { CreditsModule } from './credits/credits.module';
import { ChatModule } from './chat/chat.module';
import { FortuneModule } from './fortune/fortune.module';
import { BannerModule } from './banner/banner.module';
import { ShutdownModule } from './common/shutdown.module';

@Module({
  imports: [
    // M6 — @Global; must be present before any streaming module registers.
    ShutdownModule,
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
        // B3-a — the shared secret this API presents to the Python engine.
        // Optional on purpose: the engine ships in OBSERVE mode and rejects
        // nobody, so requiring it here would break every local dev boot to
        // enforce a control that is not yet enforcing. `engine-client.ts` warns
        // once when it is unset. It becomes load-bearing at the B3-b flip.
        ENGINE_KEY: Joi.string().allow('').optional().default(''),
        // Cloudflare R2 (banner image uploads) — optional so the app boots
        // without R2; the admin /upload endpoint fails loudly when unset.
        R2_ACCOUNT_ID: Joi.string().allow('').optional().default(''),
        R2_ACCESS_KEY_ID: Joi.string().allow('').optional().default(''),
        R2_SECRET_ACCESS_KEY: Joi.string().allow('').optional().default(''),
        R2_BUCKET: Joi.string().allow('').optional().default(''),
        R2_PUBLIC_BASE_URL: Joi.string().allow('').optional().default(''),
        CORS_ORIGINS: Joi.string().optional().default('http://localhost:3000'),
        // M9 — comma-separated origins Stripe may redirect a paying customer
        // back to (successUrl / cancelUrl / returnUrl). SEPARATE from
        // CORS_ORIGINS by design: CORS lists every client that may READ a
        // response, and includes dev tooling (the Expo dev server on :8081).
        // Adding a dev origin there must not silently widen where we can bounce
        // a customer after payment. Empty is allowed and falls back to
        // localhost — see DEFAULT_WEB_ORIGIN, which fails closed in prod.
        WEB_ORIGINS: Joi.string().allow('').optional().default(''),
        // B5 — comma-separated `azp` allowlist for Clerk JWTs (the frontend
        // origins allowed to mint tokens this API accepts). Kept SEPARATE from
        // CORS_ORIGINS on purpose: CORS is a browser-enforced hint about who may
        // read a response, azp is a server-enforced claim about who the token was
        // issued to. They also diverge in practice — a token-minting origin that
        // never makes a browser fetch needs azp but not CORS, and vice versa.
        // Empty = the claim is NOT checked (the guard warns at boot). Must be set
        // to the web origin before launch; native clients send no azp and are
        // unaffected either way.
        CLERK_AUTHORIZED_PARTIES: Joi.string().allow('').optional().default(''),
        // Rewarded-ad kill switch. Default '0' (OFF) — V1 does NO ad-completion
        // verification, so claiming would mint credits / free section unlocks to
        // any authenticated caller. Do NOT set to '1' until AdMob SSV is wired
        // (see the docblocks in ads.service.ts and section-unlock.service.ts).
        ADS_REWARDS_ENABLED: Joi.string().valid('0', '1').optional().default('0'),
        // Per-section unlock (F3). Default '0' (OFF) — unlock rows are read by
        // nothing on the content-delivery path, so the feature charged credits
        // for an inert row. Do NOT set to '1' until SectionUnlock is joined in
        // getReading + emitStaticSections and the dead owner-check at
        // bazi.service.ts:554 is fixed (F2). See section-unlock.service.ts.
        SECTION_UNLOCK_ENABLED: Joi.string().valid('0', '1').optional().default('0'),
        // A4 — max birth profiles per user. Profiles multiply free AI
        // generation (the fortune free tier is per-profile-per-day), so an
        // uncapped account is a denial-of-wallet vector. 10 is well above
        // genuine use; raise only with the AI spend controls (S1/S2) in place.
        BIRTH_PROFILE_MAX_PER_USER: Joi.number().integer().min(1).optional().default(10),
        // S2 — AI spend ledger + circuit breaker. This is the only ceiling on
        // AI spend that WE control; the $500/mo account limit is a real backstop
        // but an all-at-once cliff. Defaults sit deliberately below it so the
        // graceful ceiling is always reached first.
        // `AI_SPEND_BREAKER_ENABLED=0` is the documented rollback.
        AI_SPEND_BREAKER_ENABLED: Joi.string().valid('0', '1').optional().default('1'),
        AI_DAILY_SPEND_LIMIT_USD: Joi.number().positive().optional().default(50),
        AI_MONTHLY_SPEND_LIMIT_USD: Joi.number().positive().optional().default(400),
        // S1 — concurrency governor. Two pools so a burst of chat cannot starve
        // reading generation, and vice versa. Sizes are budget-derived, not
        // rate-limit-derived. `0` disables a pool (the rollback) — spend is
        // still capped by S2, but the blind window between check and record
        // becomes unbounded again.
        AI_MAX_CONCURRENT_READING: Joi.number().integer().min(0).optional().default(25),
        AI_MAX_CONCURRENT_INTERACTIVE: Joi.number().integer().min(0).optional().default(40),
        // S4 — per-user daily quotas. S1 and S2 are global: neither stops ONE
        // account consuming the whole budget and denying everyone else. Limits
        // are well above genuine use — they bound abuse, not behaviour. `0`
        // disables an individual quota (the rollback).
        QUOTA_READINGS_PER_DAY: Joi.number().integer().min(0).optional().default(20),
        QUOTA_CHAT_MESSAGES_PER_DAY: Joi.number().integer().min(0).optional().default(200),
        QUOTA_FORTUNE_PER_DAY: Joi.number().integer().min(0).optional().default(30),
        PORT: Joi.number().default(4000),
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
      }),
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),

    // Rate limiting — 100 requests per 60 seconds per IP
    // M1(a) — counters in Redis, not per-process memory. With M8's two
    // replicas an in-memory Map makes the real limit 2× the configured one,
    // because each replica counts only its own share.
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60000,
            limit: 100,
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),

    // Infrastructure
    PrismaModule,
    RedisModule,
    // S2 — global so every provider call site can meter, and so a NEW
    // caller cannot forget to wire it up. See ai-spend.module.ts.
    AiSpendModule,

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
    PaymentsModule,
    AdminModule,
    AdsModule,

    // Webhooks
    WebhooksModule,
  ],
  controllers: [HealthController, LegalController],
  providers: [
    // Apply rate limiting globally
    {
      // M1(c) — keys per VERIFIED userId, falling back to IP. See the guard.
      provide: APP_GUARD,
      useClass: UserAwareThrottlerGuard,
    },
    // M7 — backs GET /health/ready. Registered here because HealthController is
    // declared on the root module rather than in a feature module of its own.
    ReadinessService,
  ],
})
export class AppModule {}
