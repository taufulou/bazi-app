-- Add `language_chosen` flag to `users`.
-- Drives the one-time 繁/簡 (Traditional/Simplified) first-run modal:
--   false (default) = user has never EXPLICITLY chosen a script (the existing
--   `language_pref` default of ZH_TW is just a default, not a choice) → show the
--   modal once. Set to true the first time the user picks a script (modal or
--   /dashboard/settings). Mirrors the immutable-state boolean precedent used by
--   `birth_profiles.hour_known`.
ALTER TABLE "users" ADD COLUMN "language_chosen" BOOLEAN NOT NULL DEFAULT false;
