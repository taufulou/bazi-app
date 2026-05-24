-- Phase 1.5.z folk content — seed 5 new sample questions covering the 4 new
-- folk fields (吉色 / 吉數 / 吉食 / 吉時) + 1 general «整體民俗建議» question.
--
-- Supersedes the «folk content × 4 topics deferred» note in
-- 20260521000821_seed_fortune_sample_questions/migration.sql:7-9 (Phase 1
-- limitation — engine now computes these deterministically per
-- packages/bazi-engine/app/folk_content.py).
--
-- All questions are GENERAL (section_key = NULL — homepage strip). Idempotent
-- via NOT EXISTS guard. Re-running adds new questions but never duplicates.
--
-- Research artifacts: /Users/roger/.claude/plans/fortune-folk-content-research-results.md
-- Phase A Sub-Agent C verdict: SHIP-READY 2026-05-22.
--
-- Cache invalidation: bumps `chat-sample-questions:version` Redis key on next
-- admin API call. To force immediate refresh: `redis-cli FLUSHALL` post-deploy.
--
-- ⚠️ OPERATOR DEPLOY NOTE (Phase 1.5.z browser-test §E finding 2026-05-24):
-- This migration runs raw SQL INSERTs and does NOT trigger the admin-API path
-- that auto-bumps the `chat-sample-questions:version` Redis key. The
-- ChatSampleQuestionService has an in-process LRU cache (5-min TTL) keyed
-- against that version. Without bumping the version manually, the API will
-- continue serving the 6-question Phase-1 result for up to 5 minutes after
-- this migration applies. To force immediate visibility of the new 5
-- questions, run AFTER `prisma migrate deploy`:
--
--   redis-cli INCR 'chat-sample-questions:version'
--
-- (or `redis-cli FLUSHALL` if invalidating broader cache is acceptable).

INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'FORTUNE', NULL, q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('今日吉色是什麼？我該穿什麼顏色？', 7),
  ('今日幸運數字？', 8),
  ('今日適合吃什麼？避免吃什麼？', 9),
  ('今日吉時是哪幾個？什麼時候做事最順？', 10),
  ('今日整體民俗建議？', 11)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'FORTUNE'
    AND "section_key" IS NULL
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);
