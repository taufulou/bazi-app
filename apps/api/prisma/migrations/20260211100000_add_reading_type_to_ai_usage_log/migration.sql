-- AlterTable: Add reading_type column to ai_usage_log
ALTER TABLE "ai_usage_log" ADD COLUMN "reading_type" "ReadingType";

-- CreateIndex: Composite index for efficient date+type admin analytics queries
CREATE INDEX "ai_usage_log_created_at_reading_type_idx" ON "ai_usage_log"("created_at", "reading_type");

-- Backfill: Populate reading_type from linked bazi_readings where reading_id exists
UPDATE "ai_usage_log" AS a
SET "reading_type" = r."reading_type"
FROM "bazi_readings" AS r
WHERE a."reading_id" = r."id"
  AND a."reading_type" IS NULL;
