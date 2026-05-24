-- Phase Fortune chat scope — relax CHECK constraint to allow FORTUNE sessions
-- (which reference a BirthProfile + fortuneScope + fortuneAnchorDate instead
-- of a BaziReading or BaziComparison). Also add `profile_id` column for
-- denormalized hot-path lookup, and a partial index for the FORTUNE session
-- resume query.
--
-- Plan reference: §"Layer B" of /Users/roger/.claude/plans/ok-next-big-feature-merry-cake.md
--   - Issue 12: pre-flight safety check + partial index
--   - Issue 13: ChatSubject discriminator routing requires (NULL, NULL) for FORTUNE
--   - NEW-C: profile_id column locked for hot-path lookup + FK integrity + analytics

-- ============================================================
-- 1. Pre-flight safety check (Issue 12)
-- ============================================================
-- Defensive against operator flipping CHAT_ENABLED_READING_TYPES env to include
-- FORTUNE before this migration deploys (the current constraint forbids
-- (NULL, NULL) so any pre-existing FORTUNE rows must have been inserted with
-- one of (reading_id, comparison_id) set — that would be the bug, not this).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "chat_sessions"
    WHERE "reading_type" = 'FORTUNE'
      AND "reading_id" IS NULL
      AND "comparison_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'FORTUNE chat sessions with neither reading_id nor comparison_id already exist — '
                    'manual reconciliation required before applying the new CHECK constraint';
  END IF;
END $$;

-- ============================================================
-- 2. Add profile_id column (NEW-C — locked storage decision)
-- ============================================================
-- Denormalized at session create — avoids the round-trip to derive profileId
-- from snapshot on every sendMessage. Nullable because non-FORTUNE sessions
-- don't have a profile reference (they reference reading_id / comparison_id).
ALTER TABLE "chat_sessions" ADD COLUMN "profile_id" TEXT;

-- FK with ON DELETE SET NULL — if the BirthProfile is deleted, the session
-- becomes orphaned (history preserved) rather than cascade-deleted.
ALTER TABLE "chat_sessions"
  ADD CONSTRAINT "chat_sessions_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "birth_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 3. Relax CHECK constraint (Issue 13 — admit FORTUNE sessions)
-- ============================================================
-- Reading_type=FORTUNE rows have neither reading_id nor comparison_id, BUT
-- must have BOTH fortune_scope AND fortune_anchor_date populated. The
-- existing arithmetic guard (one-of reading/comparison) stays as the rule
-- for non-FORTUNE rows.
ALTER TABLE "chat_sessions" DROP CONSTRAINT "chat_sessions_subject_check";

ALTER TABLE "chat_sessions"
  ADD CONSTRAINT "chat_sessions_subject_check"
  CHECK (
    -- Non-FORTUNE: exactly one of (reading_id, comparison_id) is set
    (
      (CASE WHEN reading_id IS NULL THEN 0 ELSE 1 END) +
      (CASE WHEN comparison_id IS NULL THEN 0 ELSE 1 END) = 1
    )
    OR
    -- FORTUNE: neither reading_id nor comparison_id, BUT profile_id +
    -- fortune_scope + fortune_anchor_date required
    (
      reading_type = 'FORTUNE'
      AND reading_id IS NULL
      AND comparison_id IS NULL
      AND profile_id IS NOT NULL
      AND fortune_scope IS NOT NULL
      AND fortune_anchor_date IS NOT NULL
    )
  );

-- ============================================================
-- 4. Hot-path index for FORTUNE session resume (Issue 12)
-- ============================================================
-- Partial index — only indexes FORTUNE rows so it stays compact. Serves the
-- session-resume query at chat.service.ts::_listSessionsByWhere(fortune):
--   WHERE user_id=$1 AND reading_type='FORTUNE' AND fortune_anchor_date=$2
--   ORDER BY started_at DESC
-- The existing (user_id, reading_id, started_at) index doesn't cover the
-- (NULL reading_id) FORTUNE path.
CREATE INDEX "chat_sessions_fortune_lookup_idx"
  ON "chat_sessions" ("user_id", "reading_type", "fortune_anchor_date", "started_at")
  WHERE "reading_type" = 'FORTUNE';

-- ============================================================
-- 5. Profile_id general lookup index (analytics / admin)
-- ============================================================
CREATE INDEX "chat_sessions_profile_id_idx" ON "chat_sessions"("profile_id");
