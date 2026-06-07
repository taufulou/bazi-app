-- Phase 2.x.1 — Task 5: COMPATIBILITY chat sample-questions seed.
--
-- Background:
-- COMPATIBILITY chat (Phase 3 of AI Chat feature, shipped earlier) had ZERO
-- seeded sample-question pills, leaving the drawer composer empty for users.
-- This migration seeds 37 rows (5 general + 4 per section × 8 sections).
--
-- COMPATIBILITY does NOT use the `fortune_scope` discriminator column added
-- by Phase 2 月運 migration (20260528082123) — fortune_scope STAYS NULL for
-- all COMPATIBILITY rows. Per plan v3 Task 5 NULL-safe UPSERT pattern, the
-- NOT EXISTS guards use `fortune_scope IS NULL` (NOT `= NULL`).
--
-- ============================================================
-- Section-key reachability matrix (per plan v3 Issue #5)
-- ============================================================
-- Verified at `apps/web/app/reading/compatibility/page.tsx:655-668`
-- (COMPAT_SECTION_TO_CHAT_QUESTION_KEY mapping):
--
--   Backend section key      | Reachability                | Framing guidance
--   -------------------------|-----------------------------|------------------
--   compat_overview          | Inline (compatibility_basis)| contextual OK
--   partner_personality      | Inline (love_personality_b) | contextual OK
--   partner_appearance       | Inline (spouse_enrichment_b)| contextual OK
--   interaction_dynamics     | Inline (combined_crisis_analysis) | contextual OK
--   conflict_warning         | Inline (marriage_crisis_b)  | contextual OK
--   compatibility_advice     | Inline (marriage_advice)    | contextual OK
--   wedding_timing           | Inline (annual_love_b)      | self-contained (per plan conservative)
--   dimension_breakdown      | Drawer-only                 | self-contained + broader-followup
--
-- ============================================================
-- Question framing principle
-- ============================================================
-- All questions use «我們...» (dual framing — two charts merged) NOT «我...»
-- (single chart). COMPATIBILITY chat-context merges 2 charts (user + partner).
-- Topic scope per `apps/api/src/ai/prompts.ts:3845-3884`: dual-chart totals,
-- per-dimension scores, spouse-palace interactions, marriage/conflict years.
-- Out-of-topic (individual career/health/lifespan, pure flow-year/大運) gets
-- refused with cross-sell to LOVE/CAREER/LIFETIME/ANNUAL — so all seeded
-- questions stay strictly in-topic.
--
-- ⚠️ OPERATOR DEPLOY NOTE (raw-SQL migration gotcha — same as Phase 2 MONTH
-- migration `20260528082123` per Phase 1.5.z browser-test §E finding):
-- This migration runs raw SQL INSERTs and does NOT trigger the admin-API path
-- that auto-bumps the `chat-sample-questions:version` Redis key. The
-- ChatSampleQuestionService has an in-process LRU cache (5-min TTL) keyed
-- against that version. Without bumping the version manually, the API will
-- continue serving the previous result set (likely empty for COMPATIBILITY)
-- for up to 5 minutes after this migration applies. To force immediate
-- visibility of the new 37 COMPATIBILITY questions, run AFTER
-- `prisma migrate deploy`:
--
--   redis-cli INCR 'chat-sample-questions:version'
--
-- (or `redis-cli FLUSHALL` if invalidating broader cache is acceptable.)

-- ============================================================
-- 1. 5 GENERAL questions (sectionKey=NULL)
-- Appears in ChatFloatingButton drawer empty-state pill row when no section
-- context is active. Broad dual-chart framing.
-- ============================================================
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'COMPATIBILITY', NULL, NULL, q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('我們整體的緣分如何？', 0),
  ('我們的相處模式有什麼特色？', 1),
  ('我們適合走入婚姻嗎？', 2),
  ('我們之間最大的挑戰是什麼？', 3),
  ('我們未來幾年有哪些值得把握的時機？', 4)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'COMPATIBILITY'
    AND "fortune_scope" IS NULL
    AND "section_key" IS NULL
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);

-- ============================================================
-- 2a. compat_overview (Inline: compatibility_basis section)
-- Top-level overview of dual-chart compatibility score + verbal label
-- ============================================================
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'COMPATIBILITY', NULL, 'compat_overview', q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('我們的合婚總分代表什麼意思？', 0),
  ('剛才提到的相配層級在實務上是高還是低？', 1),
  ('如果我們想提升合婚分數，可以怎麼調整？', 2),
  ('五個合婚維度中哪一個對我們最重要？', 3)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'COMPATIBILITY'
    AND "fortune_scope" IS NULL
    AND "section_key" = 'compat_overview'
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);

-- ============================================================
-- 2b. wedding_timing (Inline: annual_love_b section — partner-side)
-- Self-contained framing (annual section may differ in render between charts)
-- ============================================================
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'COMPATIBILITY', NULL, 'wedding_timing', q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('我們適合什麼時候結婚？', 0),
  ('未來三年裡哪一年最適合我們論及婚嫁？', 1),
  ('我們有哪幾年是感情關鍵的觸發年？', 2),
  ('婚期推算是怎麼判斷出來的？', 3)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'COMPATIBILITY'
    AND "fortune_scope" IS NULL
    AND "section_key" = 'wedding_timing'
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);

-- ============================================================
-- 2c. partner_appearance (Inline: spouse_enrichment_b section)
-- About partner's physical/style characteristics from chart
-- ============================================================
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'COMPATIBILITY', NULL, 'partner_appearance', q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('對方的外型特質從命盤上看是怎樣？', 0),
  ('我們在外型氣場上是相配的嗎？', 1),
  ('剛才提到對方的長相描繪，準確度是怎麼判斷的？', 2),
  ('對方的命盤五行對我們的相處有什麼影響？', 3)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'COMPATIBILITY'
    AND "fortune_scope" IS NULL
    AND "section_key" = 'partner_appearance'
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);

-- ============================================================
-- 2d. partner_personality (Inline: love_personality_b section)
-- Partner's personality dimensions from polarity-aware library
-- ============================================================
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'COMPATIBILITY', NULL, 'partner_personality', q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('對方的個性傾向跟剛才描述的吻合嗎？', 0),
  ('我們在性格上的互補與衝突分別有哪些？', 1),
  ('對方在感情中的核心需求是什麼？', 2),
  ('我們相處時對方的反應模式可以怎麼理解？', 3)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'COMPATIBILITY'
    AND "fortune_scope" IS NULL
    AND "section_key" = 'partner_personality'
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);

-- ============================================================
-- 2e. interaction_dynamics (Inline: combined_crisis_analysis section)
-- Cross-chart dynamics + dual-chart interactions
-- ============================================================
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'COMPATIBILITY', NULL, 'interaction_dynamics', q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('我們的相處動態整體偏向甜蜜還是磨合？', 0),
  ('剛才提到的合化關係實際上會怎麼影響我們？', 1),
  ('我們的相處節奏在不同時期會有什麼變化？', 2),
  ('我們吵架時通常會卡在哪些核心議題？', 3)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'COMPATIBILITY'
    AND "fortune_scope" IS NULL
    AND "section_key" = 'interaction_dynamics'
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);

-- ============================================================
-- 2f. conflict_warning (Inline: marriage_crisis_b section — partner-side)
-- Marriage friction signals + warning years
-- ============================================================
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'COMPATIBILITY', NULL, 'conflict_warning', q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('我們有哪些容易引發衝突的關鍵年份？', 0),
  ('剛才的婚變預警是怎麼判斷出來的？', 1),
  ('我們需要特別留意的相處紅線是什麼？', 2),
  ('遇到危機年份我們可以怎麼預防或調整？', 3)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'COMPATIBILITY'
    AND "fortune_scope" IS NULL
    AND "section_key" = 'conflict_warning'
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);

-- ============================================================
-- 2g. dimension_breakdown (DRAWER-ONLY — NOT inline-reachable)
-- Self-contained + broader-followup framing per reachability matrix.
-- Per plan v3 Issue #5: omitted from COMPAT_SECTION_TO_CHAT_QUESTION_KEY
-- because compatibility_summary lands in `aiData.summary.text` not sections.
-- Questions must NOT assume user just saw inline context.
-- ============================================================
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'COMPATIBILITY', NULL, 'dimension_breakdown', q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('五個合婚維度中哪個對我們最關鍵？', 0),
  ('我們在哪些維度上得分較弱可以加強？', 1),
  ('哪個維度的高分最能反映我們關係的優勢？', 2),
  ('合婚維度之間是否會互相影響或抵消？', 3)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'COMPATIBILITY'
    AND "fortune_scope" IS NULL
    AND "section_key" = 'dimension_breakdown'
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);

-- ============================================================
-- 2h. compatibility_advice (Inline: marriage_advice section)
-- Actionable advice for the couple
-- ============================================================
INSERT INTO "chat_sample_questions"
  ("id", "reading_type", "fortune_scope", "section_key", "question_text", "display_order", "is_active", "locale", "created_at", "updated_at")
SELECT gen_random_uuid(), 'COMPATIBILITY', NULL, 'compatibility_advice', q.text, q.ord, true, 'zh-TW', NOW(), NOW()
FROM (VALUES
  ('剛才提到的建議我們具體可以怎麼落實？', 0),
  ('我們應該怎麼經營關係才能長久？', 1),
  ('日常相處中我們各自需要調整哪些習慣？', 2),
  ('如果想化解我們命盤中的衝突點，有什麼建議？', 3)
) AS q(text, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "chat_sample_questions"
  WHERE "reading_type" = 'COMPATIBILITY'
    AND "fortune_scope" IS NULL
    AND "section_key" = 'compatibility_advice'
    AND "question_text" = q.text
    AND "locale" = 'zh-TW'
);

-- ============================================================
-- Verification (operator runs after migration applies)
-- ============================================================
--
-- SELECT section_key, COUNT(*) FROM chat_sample_questions
-- WHERE reading_type='COMPATIBILITY' AND locale='zh-TW'
-- GROUP BY section_key ORDER BY section_key NULLS FIRST;
--
-- Expected:
--   NULL                  | 5  (general)
--   compat_overview       | 4
--   compatibility_advice  | 4
--   conflict_warning      | 4
--   dimension_breakdown   | 4
--   interaction_dynamics  | 4
--   partner_appearance    | 4
--   partner_personality   | 4
--   wedding_timing        | 4
--   TOTAL                 | 37
