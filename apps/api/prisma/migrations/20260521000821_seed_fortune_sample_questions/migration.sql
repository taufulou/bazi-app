-- Phase Fortune chat — seed FORTUNE sample questions for the homepage pill
-- strip + 5 per-dim InlineAskCards. Idempotent via UNIQUE-aware UPSERT
-- pattern (uses gen_random_uuid for new rows; existing rows by exact-text
-- match are skipped). Re-running the migration adds NEW questions but
-- never duplicates existing ones.
--
-- Avoid folk-content topics (色 / 數字 / 食物 / 吉時) per CLAUDE.md «folk
-- content research × 4 topics deferred» — engine doesn't compute these
-- deterministically yet.
--
-- Section keys mirror chat-sample-questions.service.ts::
-- CHAT_SECTION_KEYS_BY_READING_TYPE_LOCAL.FORTUNE:
--   daily_romance / daily_career / daily_finance / daily_travel / daily_health
-- General questions use section_key = NULL (homepage pill strip).
--
-- Cache invalidation: this migration also bumps the
-- `chat-sample-questions:version` Redis key on next admin API call. To
-- force immediate refresh, run `redis-cli FLUSHALL` post-deploy.

-- ============================================================
-- General questions (sectionKey = NULL) — homepage strip
-- ============================================================
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'FORTUNE', NULL, q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('今天能量為什麼這麼{低/高}？', 1),
  ('今天適合做什麼？', 2),
  ('今天我要小心什麼？', 3),
  ('今日有什麼好兆頭嗎？', 4),
  ('今天宜往哪個方向？', 5),
  ('今天最重要的提醒是什麼？', 6)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'FORTUNE'
    AND "section_key" IS NULL
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);

-- ============================================================
-- Per-dim questions (感情 / 事業 / 財運 / 出行 / 健康)
-- ============================================================
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'FORTUNE', q.section_key, q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  -- 感情 (daily_romance)
  ('daily_romance', '今天適合告白嗎？', 1),
  ('daily_romance', '今天適合約會嗎？', 2),
  ('daily_romance', '今天感情會有變化嗎？', 3),
  ('daily_romance', '今天該怎麼與另一半相處？', 4),
  -- 事業 (daily_career)
  ('daily_career', '今天適合跟老闆談加薪嗎？', 1),
  ('daily_career', '今天適合面試嗎？', 2),
  ('daily_career', '今天工作該注意什麼？', 3),
  ('daily_career', '今天適合做重要決策嗎？', 4),
  -- 財運 (daily_finance)
  ('daily_finance', '今天適合做投資決定嗎？', 1),
  ('daily_finance', '今天會破財嗎？要小心什麼？', 2),
  ('daily_finance', '今天適合簽合約嗎？', 3),
  ('daily_finance', '今天偏財運如何？', 4),
  -- 出行 (daily_travel)
  ('daily_travel', '今天適合出遠門嗎？', 1),
  ('daily_travel', '今天往哪個方向走比較順？', 2),
  ('daily_travel', '今天搭車要注意什麼？', 3),
  -- 健康 (daily_health)
  ('daily_health', '今天身體要注意什麼？', 1),
  ('daily_health', '今天適合運動嗎？', 2),
  ('daily_health', '今天有什麼養生建議？', 3)
) AS q(section_key, text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'FORTUNE'
    AND "section_key" = q.section_key
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);
