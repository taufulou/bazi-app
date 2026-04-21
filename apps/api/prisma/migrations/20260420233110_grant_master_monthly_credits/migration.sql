-- Backfill monthly credits for existing MASTER subscribers.
--
-- Context: PR #34 removed the `isMaster` bypass that made MASTER users skip
-- all credit deduction. After the bypass is removed, MASTER users consume their
-- credit balance like every other tier. This migration grants them the 50-credit
-- monthly allowance retroactively so they don't immediately hit "insufficient
-- credits" after deploy.
--
-- Race-safety:
--  * UPDATE uses PostgreSQL row-level locking. A concurrent Stripe webhook
--    running `grantMonthlyCredits` will either commit first (this UPDATE then
--    re-evaluates `credits < 50` and skips) or wait (and see the same).
--  * INSERT uses `ON CONFLICT (user_id, period_start) DO NOTHING` against the
--    existing unique constraint on `monthly_credits_logs`, so a concurrent
--    webhook insert is silently no-op'd.
-- No maintenance window required.

UPDATE users
SET credits = credits + 50
FROM subscriptions s
WHERE users.subscription_tier = 'MASTER'
  AND users.credits < 50
  AND s.user_id = users.id
  AND s.status = 'ACTIVE';

INSERT INTO monthly_credits_logs (id, user_id, credit_amount, period_start, period_end, granted_at)
SELECT
  gen_random_uuid(),
  u.id,
  50,
  s.current_period_start,
  s.current_period_end,
  NOW()
FROM users u
JOIN subscriptions s ON s.user_id = u.id
WHERE u.subscription_tier = 'MASTER'
  AND s.status = 'ACTIVE'
ON CONFLICT (user_id, period_start) DO NOTHING;
