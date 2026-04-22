-- AlterTable
ALTER TABLE "bazi_comparisons" ADD COLUMN     "failed_reason" TEXT,
ADD COLUMN     "is_degraded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "refunded_at" TIMESTAMP(3),
ADD COLUMN     "regeneration_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "regeneration_exhausted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "bazi_readings" ADD COLUMN     "failed_reason" TEXT,
ADD COLUMN     "is_degraded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "refunded_at" TIMESTAMP(3),
ADD COLUMN     "regeneration_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "regeneration_exhausted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reading_id" TEXT,
    "comparison_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_ledger_user_id_created_at_idx" ON "credit_ledger"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "credit_ledger_reading_id_idx" ON "credit_ledger"("reading_id");

-- CreateIndex
CREATE INDEX "credit_ledger_comparison_id_idx" ON "credit_ledger"("comparison_id");

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_reading_id_fkey" FOREIGN KEY ("reading_id") REFERENCES "bazi_readings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_comparison_id_fkey" FOREIGN KEY ("comparison_id") REFERENCES "bazi_comparisons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
