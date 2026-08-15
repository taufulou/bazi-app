import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import * as Joi from 'joi';
import { HealthController } from './health/health.controller';
import { LegalController } from './legal/legal.controller';
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
import { AiSpendModule } from './ai/ai-spend.module';
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
    ZwdsModule,
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
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
