-- Phase 3.5c L3.5c — YEAR (年運) sample-questions seed.
--
-- Seeds 5 GENERAL (sectionKey=NULL) YEAR-scope questions for the 年運 chat
-- drawer. Per L3.5c plan locked decision #2: GENERAL-only for v1 (no per-dim
-- `yearly_*` rows — the year narrative has no per-dim InlineAskCard slots, so
-- per-dim questions would be drawer-only; deferred to a polish pass). General
-- rows use sectionKey=NULL so the section-key whitelist is irrelevant.
--
-- The `fortune_scope` column already exists (added by the MONTH migration
-- 20260528082123_seed_monthly_fortune_sample_questions). No schema change here.
--
-- Texts from L3.5c Phase A (Bazi-master sub-agent) — grounded ONLY in what the
-- YEAR chat knows (overall 吉凶, 4-dim ★ trends, named 核心風險&機會 months,
-- 改運建議). Idempotent via NOT EXISTS guard (NULL-safe: section_key IS NULL).
--
-- ⚠️ OPERATOR DEPLOY NOTE (raw-SQL migration gotcha, same as MONTH migration):
-- This runs raw SQL INSERTs and does NOT trigger the admin-API path that
-- auto-bumps the `chat-sample-questions:version` Redis key. The
-- ChatSampleQuestionService has an in-process LRU cache (5-min TTL) keyed
-- against that version. To force immediate visibility of the new 5 YEAR
-- questions, run AFTER `prisma migrate deploy`:
--
--   redis-cli INCR 'chat-sample-questions:version'

-- ============================================================
-- Seed 5 GENERAL YEAR sample questions (sectionKey=NULL)
-- ============================================================
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'FORTUNE', 'YEAR'::"FortuneScope", NULL, q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('今年整體運勢趨向如何？', 0),
  ('今年哪幾個月最值得把握？', 1),
  ('今年需要特別留意哪些月份或面向？', 2),
  ('今年事業、財運、感情、健康，哪一面最順遂？', 3),
  ('今年有哪些改運開運的方法可以參考？', 4)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'FORTUNE'
    AND "fortune_scope" = 'YEAR'::"FortuneScope"
    AND "section_key" IS NULL
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);
