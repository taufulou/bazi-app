-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReadingType" ADD VALUE 'ZWDS_MONTHLY';
ALTER TYPE "ReadingType" ADD VALUE 'ZWDS_DAILY';
ALTER TYPE "ReadingType" ADD VALUE 'ZWDS_MAJOR_PERIOD';
ALTER TYPE "ReadingType" ADD VALUE 'ZWDS_QA';

-- AlterTable
ALTER TABLE "bazi_readings" ADD COLUMN     "question_text" TEXT,
ADD COLUMN     "target_day" TEXT,
ADD COLUMN     "target_month" INTEGER;
