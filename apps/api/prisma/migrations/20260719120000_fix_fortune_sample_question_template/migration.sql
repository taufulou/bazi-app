-- Fixes a seeded sample question that shipped with an UNSUBSTITUTED template
-- placeholder. `20260521000821_seed_fortune_sample_questions` inserted the literal
-- string 「今天能量為什麼這麼{低/高}？」 — the {低/高} was an authoring note meaning
-- "pick one depending on the score", but nothing ever resolved it, so users saw the
-- braces verbatim in the 想問 AI 命理師什麼？ pill strip.
--
-- Reworded rather than resolved at render time: the pill strip is served from a
-- cached, score-independent query (general questions, sectionKey = NULL, shared
-- across DAY/MONTH/YEAR), so it has no score in scope to branch on. A neutral
-- phrasing asks the same thing and works whether the day is 大吉 or 大凶.
UPDATE "chat_sample_questions"
SET "question_text" = '今天的能量分數是怎麼來的？',
    "updated_at" = NOW()
WHERE "reading_type" = 'FORTUNE'
  AND "question_text" = '今天能量為什麼這麼{低/高}？';

-- Guard against the same class shipping again unnoticed.
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM "chat_sample_questions" WHERE "question_text" LIKE '%{%}%';
  IF n > 0 THEN
    RAISE WARNING 'chat_sample_questions still has % row(s) containing {...} template placeholders', n;
  END IF;
END $$;

-- ⚠️ OPERATOR: raw-SQL seed/update migrations do NOT bump the in-process LRU used by
-- ChatSampleQuestionService (5-min TTL, invalidated via a Redis version key). Run:
--     redis-cli INCR 'chat-sample-questions:version'
-- otherwise the old text keeps being served for up to 5 minutes after deploy.
