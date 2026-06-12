-- 八字時辰未知 (Unknown Birth Hour) support — Phase 1
-- birth_time becomes nullable (null when the 時辰 is unknown) and a hour_known flag is added.
-- Additive + backfill-safe: existing rows default to hour_known=true (they have a known time).
ALTER TABLE "birth_profiles" ALTER COLUMN "birth_time" DROP NOT NULL;
ALTER TABLE "birth_profiles" ADD COLUMN "hour_known" BOOLEAN NOT NULL DEFAULT true;
