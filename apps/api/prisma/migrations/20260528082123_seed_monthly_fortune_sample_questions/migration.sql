-- Phase 2 月運 — L6 sample-questions migration.
--
-- Two parts:
-- 1. Add `fortune_scope` column to chat_sample_questions (FortuneScope enum,
--    nullable). Existing rows get NULL (treated as DAY for back-compat).
-- 2. Seed 25 MONTH rows (5 general + 5x4 per-dim) per Phase A research-results
--    doc section 3 (Sub-Agent C spliced with Sub-Agent A/B verdicts).
--
-- All MONTH questions use sectionKey prefix `monthly_*` to disambiguate from
-- DAY-scope `daily_*` (per plan v3 M-new-1 column-based discriminator).
-- General questions use sectionKey=NULL (homepage strip pattern).
--
-- Idempotent via NOT EXISTS guard. Re-running adds nothing on duplicate.
--
-- Research artifacts: /Users/roger/.claude/plans/phase-2-yueyun-phase-a-research-results.md
-- Phase A Sub-Agent C verdict: PARTIAL convergence resolved 2026-05-28 (placeholder splices applied).
--
-- ⚠️ OPERATOR DEPLOY NOTE (per Phase 1.5.z browser-test §E finding 2026-05-24):
-- This migration runs raw SQL INSERTs and does NOT trigger the admin-API path
-- that auto-bumps the `chat-sample-questions:version` Redis key. The
-- ChatSampleQuestionService has an in-process LRU cache (5-min TTL) keyed
-- against that version. Without bumping the version manually, the API will
-- continue serving the previous result set for up to 5 minutes after this
-- migration applies. To force immediate visibility of the new 25 MONTH
-- questions, run AFTER `prisma migrate deploy`:
--
--   redis-cli INCR 'chat-sample-questions:version'
--
-- (or `redis-cli FLUSHALL` if invalidating broader cache is acceptable).

-- ============================================================
-- PART 1 — Schema change: add fortune_scope column
-- ============================================================
ALTER TABLE "chat_sample_questions"
  ADD COLUMN IF NOT EXISTS "fortune_scope" "FortuneScope";

-- Phase 2 月運 index (Prisma will generate this from schema but we add it
-- here for migrations-only deploys that don't run `prisma generate`).
CREATE INDEX IF NOT EXISTS "chat_sample_questions_reading_type_fortune_scope_section_key_is_active_locale_idx"
  ON "chat_sample_questions" ("reading_type", "fortune_scope", "section_key", "is_active", "locale");

-- ============================================================
-- PART 2 — Seed 25 MONTH sample questions
-- ============================================================

-- 2a. 5 GENERAL questions (sectionKey=NULL) — appear in MonthlyFortuneCard
-- horizontal pill strip + ChatFloatingButton drawer general list when scope=MONTH.
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'FORTUNE', 'MONTH'::"FortuneScope", NULL, q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('這個月整體運勢趨向如何？', 0),
  ('本月最值得把握的契機是什麼？', 1),
  ('本月需要特別留意哪些方面？', 2),
  ('本月適合啟動新計畫嗎？', 3),
  ('本月上半月與下半月，哪段能量較順？', 4)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'FORTUNE'
    AND "fortune_scope" = 'MONTH'::"FortuneScope"
    AND "section_key" IS NULL
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);

-- 2b. 5 questions × 4 dims (career/finance/romance/health) = 20 per-dim questions.
-- Each dim uses sectionKey = 'monthly_<dim>' to disambiguate from DAY-scope
-- 'daily_<dim>'. Per Sub-Agent B locked dim count: NO 出行 (travel) — DAY-only
-- per 三命通會 神煞篇.

-- 2b.i — career (事業)
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'FORTUNE', 'MONTH'::"FortuneScope", 'monthly_career', q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('本月事業上有什麼機會可以把握？', 0),
  ('本月適合談升遷或加薪嗎？', 1),
  ('本月適合跳槽或轉換跑道嗎？', 2),
  ('本月工作上可能遇到什麼挑戰？', 3),
  ('本月與主管／同事相處要注意什麼？', 4)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'FORTUNE'
    AND "fortune_scope" = 'MONTH'::"FortuneScope"
    AND "section_key" = 'monthly_career'
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);

-- 2b.ii — finance (財運)
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'FORTUNE', 'MONTH'::"FortuneScope", 'monthly_finance', q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('本月財運趨勢如何？', 0),
  ('本月適合做投資決策嗎？', 1),
  ('本月有哪些進財的契機？', 2),
  ('本月需要避免哪類大額支出？', 3),
  ('本月適合與人合夥或分潤談判嗎？', 4)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'FORTUNE'
    AND "fortune_scope" = 'MONTH'::"FortuneScope"
    AND "section_key" = 'monthly_finance'
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);

-- 2b.iii — romance (感情)
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'FORTUNE', 'MONTH'::"FortuneScope", 'monthly_romance', q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('本月感情運勢趨向如何？', 0),
  ('單身的我本月易於遇到正緣嗎？', 1),
  ('本月適合告白或推進關係嗎？', 2),
  ('本月與伴侶相處需要注意什麼？', 3),
  ('本月有哪些感情層面的善意觸發？', 4)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'FORTUNE'
    AND "fortune_scope" = 'MONTH'::"FortuneScope"
    AND "section_key" = 'monthly_romance'
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);

-- 2b.iv — health (健康)
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'FORTUNE', 'MONTH'::"FortuneScope", 'monthly_health', q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('本月健康面需要留意哪些訊號？', 0),
  ('本月適合啟動運動／健身計畫嗎？', 1),
  ('本月哪些生活習慣值得調整？', 2),
  ('本月情緒壓力可能來自哪些方面？', 3),
  ('本月飲食起居有什麼養生建議？', 4)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'FORTUNE'
    AND "fortune_scope" = 'MONTH'::"FortuneScope"
    AND "section_key" = 'monthly_health'
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);
