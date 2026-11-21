-- 1B item 3 — store the user's AI-data consent (App Store guideline 5.1.2(i)).
--
-- The consent sheet is in the mobile app; the decision is stored here so it
-- survives a reinstall. NULL = never consented, or withdrawn.
--
-- Additive and nullable: safe under a rolling deploy (the old replica's Prisma
-- client selects named columns and never sees these).

-- AlterTable
ALTER TABLE "users" ADD COLUMN "ai_consent_at" TIMESTAMP(3),
ADD COLUMN "ai_consent_version" TEXT;
