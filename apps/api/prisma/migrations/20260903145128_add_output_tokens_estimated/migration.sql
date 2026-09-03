-- #20 / PR#71 F4 — mark a usage row whose output tokens were ESTIMATED.
--
-- `message_delta` carries the cumulative output_tokens and arrives once, near
-- the end of a stream. An abort before it leaves no measured output, so #20
-- estimates from the characters already streamed. The AI-CALL log line marks
-- that as `outEst`; this column is the same fact in the table
-- `/admin/ai-costs` reads, so measured and inferred spend can be told apart.
--
-- Additive and backfill-free. DEFAULT false is correct for every historical
-- row because before #20 an aborted stream recorded ZERO output rather than an
-- estimate -- so no existing row is mislabelled by the default.
--
-- Rollback: revert the code; the column can stay (nothing requires it).
ALTER TABLE "ai_usage_log"
  ADD COLUMN "output_tokens_estimated" BOOLEAN NOT NULL DEFAULT false;
