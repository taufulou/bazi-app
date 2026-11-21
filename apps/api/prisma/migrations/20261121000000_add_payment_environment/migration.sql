-- 1A-core item 4 — record whether a payment moved real money.
--
-- RevenueCat sends `environment` (SANDBOX | PRODUCTION) and Stripe sends
-- `livemode`; neither was stored, so sandbox/test-mode rows were
-- indistinguishable from revenue.
--
-- Additive and nullable, no default, no backfill: NULL means "recorded before
-- this column existed". Safe under a rolling deploy — the old replica's Prisma
-- client selects named columns and never sees this one. Existing Stripe rows
-- are all test-mode today; backfilling them is an operator step before Stripe
-- goes live, deliberately NOT encoded here (it would mislabel live rows if that
-- order ever changed).

-- CreateEnum
CREATE TYPE "PaymentEnvironment" AS ENUM ('PRODUCTION', 'SANDBOX');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "environment" "PaymentEnvironment";

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "environment" "PaymentEnvironment";
