-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'BASIC', 'PRO', 'MASTER');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'EXPIRED', 'PAST_DUE');

-- CreateEnum
CREATE TYPE "ReadingType" AS ENUM ('LIFETIME', 'ANNUAL', 'CAREER', 'LOVE', 'HEALTH', 'COMPATIBILITY');

-- CreateEnum
CREATE TYPE "ComparisonType" AS ENUM ('ROMANCE', 'BUSINESS', 'FRIENDSHIP');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('ZH_TW', 'ZH_CN');

-- CreateEnum
CREATE TYPE "AIProvider" AS ENUM ('CLAUDE', 'GPT', 'GEMINI');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('SUBSCRIPTION', 'ONE_TIME', 'CREDIT_PURCHASE', 'REFUND');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "RelationshipTag" AS ENUM ('SELF', 'FAMILY', 'FRIEND');

-- CreateEnum
CREATE TYPE "PaymentPlatform" AS ENUM ('STRIPE', 'APPLE_IAP', 'GOOGLE_PLAY');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "clerk_user_id" TEXT NOT NULL,
    "name" TEXT,
    "avatar_url" TEXT,
    "subscription_tier" "SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "credits" INTEGER NOT NULL DEFAULT 0,
    "language_pref" "Language" NOT NULL DEFAULT 'ZH_TW',
    "free_reading_used" BOOLEAN NOT NULL DEFAULT false,
    "device_fingerprint" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "birth_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birth_date" DATE NOT NULL,
    "birth_time" TEXT NOT NULL,
    "birth_city" TEXT NOT NULL,
    "birth_timezone" TEXT NOT NULL,
    "birth_longitude" DOUBLE PRECISION,
    "birth_latitude" DOUBLE PRECISION,
    "gender" "Gender" NOT NULL,
    "relationship_tag" "RelationshipTag" NOT NULL DEFAULT 'SELF',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "birth_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bazi_readings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "birth_profile_id" TEXT NOT NULL,
    "reading_type" "ReadingType" NOT NULL,
    "calculation_data" JSONB NOT NULL,
    "ai_interpretation" JSONB,
    "ai_provider" "AIProvider",
    "ai_model" TEXT,
    "token_usage" JSONB,
    "credits_used" INTEGER NOT NULL DEFAULT 0,
    "target_year" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bazi_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bazi_comparisons" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "profile_a_id" TEXT NOT NULL,
    "profile_b_id" TEXT NOT NULL,
    "comparison_type" "ComparisonType" NOT NULL,
    "calculation_data" JSONB NOT NULL,
    "ai_interpretation" JSONB,
    "ai_provider" "AIProvider",
    "ai_model" TEXT,
    "token_usage" JSONB,
    "credits_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bazi_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT,
    "apple_original_tx_id" TEXT,
    "google_purchase_token" TEXT,
    "plan_tier" "SubscriptionTier" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "platform" "PaymentPlatform" NOT NULL DEFAULT 'STRIPE',
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stripe_payment_id" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "type" "TransactionType" NOT NULL,
    "description" TEXT,
    "platform" "PaymentPlatform" NOT NULL DEFAULT 'STRIPE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_cache" (
    "id" TEXT NOT NULL,
    "birth_data_hash" TEXT NOT NULL,
    "reading_type" "ReadingType" NOT NULL,
    "calculation_json" JSONB NOT NULL,
    "interpretation_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reading_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "reading_id" TEXT,
    "ai_provider" "AIProvider" NOT NULL,
    "ai_model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cost_usd" DECIMAL(10,6) NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "is_cache_hit" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name_zh_tw" TEXT NOT NULL,
    "name_zh_cn" TEXT NOT NULL,
    "description_zh_tw" TEXT NOT NULL,
    "description_zh_cn" TEXT NOT NULL,
    "type" "ReadingType" NOT NULL,
    "credit_cost" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name_zh_tw" TEXT NOT NULL,
    "name_zh_cn" TEXT NOT NULL,
    "price_monthly" DECIMAL(10,2) NOT NULL,
    "price_annual" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "features" JSONB NOT NULL,
    "readings_per_month" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discount_type" "DiscountType" NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "max_uses" INTEGER NOT NULL,
    "current_uses" INTEGER NOT NULL DEFAULT 0,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_gateways" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_gateways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "reading_type" "ReadingType" NOT NULL,
    "ai_provider" "AIProvider" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "system_prompt" TEXT NOT NULL,
    "user_prompt_template" TEXT NOT NULL,
    "output_format_instructions" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_clerk_user_id_key" ON "users"("clerk_user_id");

-- CreateIndex
CREATE INDEX "bazi_readings_user_id_idx" ON "bazi_readings"("user_id");

-- CreateIndex
CREATE INDEX "bazi_readings_birth_profile_id_idx" ON "bazi_readings"("birth_profile_id");

-- CreateIndex
CREATE INDEX "bazi_comparisons_user_id_idx" ON "bazi_comparisons"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_apple_original_tx_id_key" ON "subscriptions"("apple_original_tx_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_google_purchase_token_key" ON "subscriptions"("google_purchase_token");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_stripe_payment_id_key" ON "transactions"("stripe_payment_id");

-- CreateIndex
CREATE INDEX "transactions_user_id_idx" ON "transactions"("user_id");

-- CreateIndex
CREATE INDEX "reading_cache_expires_at_idx" ON "reading_cache"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "reading_cache_birth_data_hash_reading_type_key" ON "reading_cache"("birth_data_hash", "reading_type");

-- CreateIndex
CREATE INDEX "ai_usage_log_created_at_idx" ON "ai_usage_log"("created_at");

-- CreateIndex
CREATE INDEX "ai_usage_log_ai_provider_idx" ON "ai_usage_log"("ai_provider");

-- CreateIndex
CREATE UNIQUE INDEX "services_slug_key" ON "services"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "plans_slug_key" ON "plans"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "payment_gateways_provider_region_key" ON "payment_gateways"("provider", "region");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_reading_type_ai_provider_version_key" ON "prompt_templates"("reading_type", "ai_provider", "version");

-- CreateIndex
CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log"("created_at");

-- CreateIndex
CREATE INDEX "admin_audit_log_admin_user_id_idx" ON "admin_audit_log"("admin_user_id");

-- AddForeignKey
ALTER TABLE "birth_profiles" ADD CONSTRAINT "birth_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bazi_readings" ADD CONSTRAINT "bazi_readings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bazi_readings" ADD CONSTRAINT "bazi_readings_birth_profile_id_fkey" FOREIGN KEY ("birth_profile_id") REFERENCES "birth_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bazi_comparisons" ADD CONSTRAINT "bazi_comparisons_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bazi_comparisons" ADD CONSTRAINT "bazi_comparisons_profile_a_id_fkey" FOREIGN KEY ("profile_a_id") REFERENCES "birth_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bazi_comparisons" ADD CONSTRAINT "bazi_comparisons_profile_b_id_fkey" FOREIGN KEY ("profile_b_id") REFERENCES "birth_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_reading_id_fkey" FOREIGN KEY ("reading_id") REFERENCES "bazi_readings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
