-- CreateEnum
CREATE TYPE "AdRewardType" AS ENUM ('CREDIT', 'SECTION_UNLOCK', 'DAILY_HOROSCOPE');

-- CreateEnum
CREATE TYPE "UnlockMethod" AS ENUM ('CREDIT', 'AD_REWARD', 'SUBSCRIPTION');

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "monthly_credits" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "section_unlock_credit_cost" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "credit_packages" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name_zh_tw" TEXT NOT NULL,
    "name_zh_cn" TEXT NOT NULL,
    "credit_amount" INTEGER NOT NULL,
    "price_usd" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_reward_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reward_type" "AdRewardType" NOT NULL,
    "ad_network_id" TEXT,
    "credits_granted" INTEGER NOT NULL DEFAULT 0,
    "section_key" TEXT,
    "reading_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_reward_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_unlocks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reading_id" TEXT NOT NULL,
    "reading_type" TEXT NOT NULL DEFAULT 'bazi',
    "section_key" TEXT NOT NULL,
    "unlock_method" "UnlockMethod" NOT NULL,
    "credits_used" INTEGER NOT NULL DEFAULT 0,
    "is_refunded" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "section_unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_credits_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credit_amount" INTEGER NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_credits_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_packages_slug_key" ON "credit_packages"("slug");

-- CreateIndex
CREATE INDEX "ad_reward_logs_user_id_created_at_idx" ON "ad_reward_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "section_unlocks_reading_id_idx" ON "section_unlocks"("reading_id");

-- CreateIndex
CREATE UNIQUE INDEX "section_unlocks_user_id_reading_id_section_key_key" ON "section_unlocks"("user_id", "reading_id", "section_key");

-- CreateIndex
CREATE INDEX "monthly_credits_logs_user_id_idx" ON "monthly_credits_logs"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_credits_logs_user_id_period_start_key" ON "monthly_credits_logs"("user_id", "period_start");

-- AddForeignKey
ALTER TABLE "ad_reward_logs" ADD CONSTRAINT "ad_reward_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_unlocks" ADD CONSTRAINT "section_unlocks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_credits_logs" ADD CONSTRAINT "monthly_credits_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
