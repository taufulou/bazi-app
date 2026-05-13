-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "is_refuse" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "consecutive_refuses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reading_type" "ReadingType" NOT NULL DEFAULT 'LIFETIME';

-- CreateTable
CREATE TABLE "chat_sample_questions" (
    "id" TEXT NOT NULL,
    "reading_type" "ReadingType" NOT NULL,
    "section_key" TEXT,
    "question_text" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "locale" TEXT NOT NULL DEFAULT 'zh-TW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sample_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_sample_questions_reading_type_section_key_is_active_lo_idx" ON "chat_sample_questions"("reading_type", "section_key", "is_active", "locale");

-- CreateIndex
CREATE INDEX "chat_sample_questions_reading_type_locale_idx" ON "chat_sample_questions"("reading_type", "locale");

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_reading_type_started_at_idx" ON "chat_sessions"("user_id", "reading_type", "started_at");
