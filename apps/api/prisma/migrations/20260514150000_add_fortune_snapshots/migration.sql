-- Phase Fortune — 八字日運/月運/年運 (Daily/Monthly/Yearly Fortune)
-- Plan: .claude/plans/ok-next-big-feature-merry-cake.md
--
-- Adds:
--   1. ReadingType.FORTUNE enum value (unified chat type — scope tag via ChatSession.fortuneScope)
--   2. FortuneScope enum (DAY | MONTH | YEAR)
--   3. chat_sessions.fortune_scope + chat_sessions.fortune_anchor_date columns
--   4. daily_fortune_snapshots table (hybrid cached AI narrative storage)

-- ============================================================
-- 1. Extend ReadingType enum
-- ============================================================
ALTER TYPE "ReadingType" ADD VALUE IF NOT EXISTS 'FORTUNE';

-- ============================================================
-- 2. Create FortuneScope enum
-- ============================================================
CREATE TYPE "FortuneScope" AS ENUM ('DAY', 'MONTH', 'YEAR');

-- ============================================================
-- 3. Add fortune-scope columns to chat_sessions
--    (NULL for non-FORTUNE sessions — denormalized at session create)
-- ============================================================
ALTER TABLE "chat_sessions"
  ADD COLUMN "fortune_scope" "FortuneScope",
  ADD COLUMN "fortune_anchor_date" DATE;

-- ============================================================
-- 4. daily_fortune_snapshots — cache table for engine + AI narrative
-- ============================================================
CREATE TABLE "daily_fortune_snapshots" (
  "id"                        TEXT NOT NULL,
  "chart_hash"                TEXT NOT NULL,
  "birth_profile_id"          TEXT,
  "scope"                     "FortuneScope" NOT NULL,
  "anchor_date"               DATE NOT NULL,
  "year_month"                TEXT,
  "year"                      INTEGER,
  "engine_output_json"        JSONB NOT NULL,
  "ai_narrative_json"         JSONB,
  "energy_score"              INTEGER,
  "auspiciousness_label"      TEXT,
  "pre_analysis_version"      TEXT NOT NULL,
  "prompt_version"            TEXT,
  "generated_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "daily_fortune_snapshots_pkey" PRIMARY KEY ("id")
);

-- Composite-unique cache key — one snapshot per (chart, scope, anchor_date)
CREATE UNIQUE INDEX "daily_fortune_snapshots_chart_hash_scope_anchor_date_key"
  ON "daily_fortune_snapshots"("chart_hash", "scope", "anchor_date");

-- Lookup indexes
CREATE INDEX "daily_fortune_snapshots_birth_profile_id_scope_anchor_date_idx"
  ON "daily_fortune_snapshots"("birth_profile_id", "scope", "anchor_date");

CREATE INDEX "daily_fortune_snapshots_generated_at_idx"
  ON "daily_fortune_snapshots"("generated_at");

-- Foreign key — orphan rows allowed (SetNull) so deleting a birth profile
-- doesn't cascade-wipe its cached fortune history (cache, not user data)
ALTER TABLE "daily_fortune_snapshots"
  ADD CONSTRAINT "daily_fortune_snapshots_birth_profile_id_fkey"
  FOREIGN KEY ("birth_profile_id") REFERENCES "birth_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 5. Service-layer-enforced invariants documented here:
--
--   For MONTH scope: anchor_date MUST be 1st-of-month
--                    (year_month denormalized as 'YYYY-MM')
--   For YEAR scope:  anchor_date MUST be 1st-of-year (jan 1)
--                    (year denormalized as YYYY integer)
--   For DAY scope:   anchor_date is the Bazi-day (post-23:00 boundary
--                    resolution, computed in caller)
--
-- These cannot be enforced via CHECK at the DB level cleanly (cross-column
-- conditional). Per audit Issue 5: fortune.service.ts ::createSnapshot
-- MUST normalize before upsert; Jest test asserts the invariant.
-- ============================================================
