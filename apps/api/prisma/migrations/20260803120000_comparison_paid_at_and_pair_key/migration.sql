-- Bundle A — move the 合盤 charge from create to reveal.
--
-- ⚠️ The backfill MUST stay in this file, not run as a post-deploy step. Between
-- the ALTER and the UPDATE, every row has paid_at = NULL — and the new code reads
-- paid_at as "is this unlocked". A gap there would paywall every paid report,
-- re-charge every reveal, reject every comparison chat session, and block
-- recalculate. Deploy order is: migrate → THEN ship code. Never concurrent.

-- 1. paid_at — the single source of truth for "unlocked".
ALTER TABLE "bazi_comparisons" ADD COLUMN "paid_at" TIMESTAMP(3);

-- 2. pair_key — canonical dedupe key, ordered (not sorted).
ALTER TABLE "bazi_comparisons" ADD COLUMN "pair_key" TEXT;

-- 3. Backfill paid_at for every row that represents a report the user can
--    legitimately read today.
--
--    ⚠️ The predicate is deliberately WIDER than `credits_used > 0`. The
--    cache-hit leak that Bundle A0 fixed produced rows with credits_used = 0 AND
--    a full interpretation attached — reports their owners can open right now. A
--    narrow predicate would retroactively paywall exactly that cohort.
--
--    refunded_at IS NULL: a refunded comparison must NOT be re-unlocked. Its
--    credits were returned, so it is genuinely unpaid again.
UPDATE "bazi_comparisons"
   SET "paid_at" = "created_at"
 WHERE ("credits_used" > 0 OR "ai_interpretation" IS NOT NULL)
   AND "refunded_at" IS NULL;

-- 4. Unique index for create-time dedupe.
--
--    ⚠️ pair_key is left NULL on ALL pre-existing rows and is populated only on
--    insert. This is load-bearing, not laziness: duplicate pairs already exist
--    (4 groups on dev, which is the very bug this bundle fixes), and backfilling
--    would abort CREATE UNIQUE INDEX and take the deploy down with it. Postgres
--    treats NULLs as distinct, so legacy rows coexist. They stop deduping until
--    re-created once, after which they dedupe normally — self-correcting.
CREATE UNIQUE INDEX "bazi_comparisons_user_id_pair_key_key"
    ON "bazi_comparisons" ("user_id", "pair_key");
