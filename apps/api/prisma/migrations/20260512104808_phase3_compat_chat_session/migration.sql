-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "comparison_id" TEXT,
ALTER COLUMN "reading_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_comparison_id_started_at_idx" ON "chat_sessions"("user_id", "comparison_id", "started_at");

-- CreateIndex
CREATE INDEX "chat_sessions_comparison_id_idx" ON "chat_sessions"("comparison_id");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_comparison_id_fkey" FOREIGN KEY ("comparison_id") REFERENCES "bazi_comparisons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 3 — CHECK constraint: exactly one of (reading_id, comparison_id) must
-- be set per session. Prisma can't express this in the schema DSL.
-- Use explicit arithmetic instead of «<>» on (NULL IS NOT NULL) — that pattern
-- returns NULL (not FALSE) for the both-NULL case, which Postgres CHECK treats
-- as «not failing» → would silently allow sessions with no subject.
ALTER TABLE "chat_sessions"
  ADD CONSTRAINT "chat_sessions_subject_check"
  CHECK (
    (CASE WHEN reading_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN comparison_id IS NULL THEN 0 ELSE 1 END) = 1
  );
