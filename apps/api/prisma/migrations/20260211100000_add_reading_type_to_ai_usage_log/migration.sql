-- AlterTable: Add reading_type column to ai_usage_log
ALTER TABLE "ai_usage_log" ADD COLUMN "reading_type" "ReadingType";

-- CreateIndex: Composite index for date-range queries grouped by reading type
CREATE INDEX "ai_usage_log_created_at_reading_type_idx" ON "ai_usage_log"("created_at", "reading_type");

-- Backfill: Populate reading_type from existing bazi_readings where possible
UPDATE "ai_usage_log" SET "reading_type" = br."reading_type"
FROM "bazi_readings" br
WHERE "ai_usage_log"."reading_id" = br."id"
  AND "ai_usage_log"."reading_type" IS NULL;
