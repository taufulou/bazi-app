-- Tier B2 — YEAR (年運) PER-DIMENSION sample-questions seed.
--
-- Supersedes the L3.5c GENERAL-only deferral (20260530070821): the year
-- narrative now has per-dim InlineAskCard slots (renderAfterDimension on
-- YearlyNarrativeCard), so seed per-dim questions for the 4 year dimensions:
--   yearly_career / yearly_finance / yearly_romance / yearly_health
-- NO yearly_travel (travel is DAY-only per 三命通會 神煞篇). MONTH stays
-- general-only (no monthly_* per-dim rows).
--
-- Each row is fortune_scope='YEAR' + a section_key; the GET endpoint filter
-- (chat-sample-questions.service.ts::listActive) matches fortuneScope='YEAR'
-- EXACTLY for YEAR — so these rows are returned only for YEAR-scope per-dim
-- fetches, never for DAY (which uses the null|'DAY' OR-branch). The GET read
-- path queries the DB directly (does NOT consult the section-key whitelist),
-- so these rows return on read regardless. The 4 keys are ALSO added to
-- CHAT_SECTION_KEYS_BY_READING_TYPE_LOCAL.FORTUNE — that whitelist gates ADMIN
-- writes (create/update) + the admin section-key dropdown, NOT reads.
--
-- Idempotent via NOT EXISTS guard (section_key EXACT match, not NULL-safe —
-- these are section-keyed rows).
--
-- ⚠️ OPERATOR DEPLOY NOTE (raw-SQL migration gotcha, same as the GENERAL seeds):
-- This runs raw SQL INSERTs and does NOT trigger the admin-API path that
-- auto-bumps the `chat-sample-questions:version` Redis key (5-min in-process
-- LRU). To force immediate visibility of the new per-dim questions, run AFTER
-- `prisma migrate deploy`:
--
--   redis-cli INCR 'chat-sample-questions:version'

INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'FORTUNE', 'YEAR'::"FortuneScope", q.section_key, q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('yearly_career',  '今年事業有什麼機會或轉折？', 0),
  ('yearly_career',  '今年適合轉職或創業嗎？',     1),
  ('yearly_career',  '今年職場上要特別注意什麼？', 2),
  ('yearly_finance', '今年財運走勢如何？',         0),
  ('yearly_finance', '今年適合投資或大額支出嗎？', 1),
  ('yearly_finance', '今年理財上要避開哪些風險？', 2),
  ('yearly_romance', '今年感情運勢如何？',         0),
  ('yearly_romance', '今年適合結婚、脫單或穩定關係嗎？', 1),
  ('yearly_romance', '今年感情上要留意什麼？',     2),
  ('yearly_health',  '今年健康狀況需要注意嗎？',   0),
  ('yearly_health',  '今年養生上該著重哪方面？',   1),
  ('yearly_health',  '今年哪幾個月健康較需留心？', 2)
) AS q(section_key, text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'FORTUNE'
    AND "fortune_scope" = 'YEAR'::"FortuneScope"
    AND "section_key" = q.section_key
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);
