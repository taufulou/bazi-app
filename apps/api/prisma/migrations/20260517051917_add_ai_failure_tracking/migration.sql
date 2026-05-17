-- AlterTable
ALTER TABLE "daily_fortune_snapshots" ADD COLUMN     "ai_failure_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ai_last_failed_at" TIMESTAMP(3);
