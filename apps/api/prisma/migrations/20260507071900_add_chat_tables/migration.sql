-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reading_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_message_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "free_quota_consumed" INTEGER NOT NULL DEFAULT 0,
    "credit_extensions" INTEGER NOT NULL DEFAULT 0,
    "paid_messages_used" INTEGER NOT NULL DEFAULT 0,
    "refunded_at" TIMESTAMP(3),
    "refund_reason" TEXT,
    "context_version" TEXT NOT NULL,
    "pre_analysis_version" TEXT NOT NULL,
    "hard_delete_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "section_context_hint" TEXT,
    "tokens_input" INTEGER,
    "tokens_output" INTEGER,
    "cache_read_tokens" INTEGER,
    "cache_creation_tokens" INTEGER,
    "model" TEXT,
    "banned_phrase_stripped" BOOLEAN NOT NULL DEFAULT false,
    "citation_auto_prepended" BOOLEAN NOT NULL DEFAULT false,
    "llm_judge_verdict" TEXT,
    "error_code" TEXT,
    "is_regrounding" BOOLEAN NOT NULL DEFAULT false,
    "payment_method" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_monthly_usage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "chats_used" INTEGER NOT NULL DEFAULT 0,
    "monthly_quota" INTEGER NOT NULL,
    "subscription_tier" "SubscriptionTier" NOT NULL,
    "last_tier_change_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_monthly_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_reading_id_started_at_idx" ON "chat_sessions"("user_id", "reading_id", "started_at");

-- CreateIndex
CREATE INDEX "chat_sessions_reading_id_idx" ON "chat_sessions"("reading_id");

-- CreateIndex
CREATE INDEX "chat_sessions_hard_delete_at_idx" ON "chat_sessions"("hard_delete_at");

-- CreateIndex
CREATE INDEX "chat_messages_session_id_created_at_idx" ON "chat_messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_monthly_usage_period_start_idx" ON "chat_monthly_usage"("period_start");

-- CreateIndex
CREATE UNIQUE INDEX "chat_monthly_usage_user_id_period_start_key" ON "chat_monthly_usage"("user_id", "period_start");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_reading_id_fkey" FOREIGN KEY ("reading_id") REFERENCES "bazi_readings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_monthly_usage" ADD CONSTRAINT "chat_monthly_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
