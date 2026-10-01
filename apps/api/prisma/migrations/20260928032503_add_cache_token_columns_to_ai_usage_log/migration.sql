-- #6 — prompt caching on the reading paths.
--
-- The streaming reading path now caches its system prompt at the 5-minute TTL,
-- so `input_tokens` on a reading row becomes the UNCACHED remainder. The cache
-- counters are priced into `cost_usd`, and are persisted so that `cost_usd`
-- stays recomputable from the row (the D2 repair tool re-prices from it).
--
-- Additive, NOT NULL DEFAULT 0: metadata-only on PostgreSQL 11+, safe under a
-- rolling deploy (an old replica's Prisma client omits the columns and gets the
-- defaults). 0 is a truthful backfill: no reading path had ever sent
-- cache_control, and chat/fortune never write this table.
--
-- Hand-written from `prisma migrate diff`: the diff also proposed an unrelated
-- index rename (pre-existing local drift on chat_sample_questions), deliberately
-- left out of this migration.

-- AlterTable
ALTER TABLE "ai_usage_log" ADD COLUMN     "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cache_write_5m_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cache_write_tokens" INTEGER NOT NULL DEFAULT 0;
