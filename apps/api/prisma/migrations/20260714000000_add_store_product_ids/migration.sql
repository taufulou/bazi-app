-- M6 (IAP): map RevenueCat / App Store / Play product ids onto our catalog.
-- Nullable + unique so Stripe-only plans/packages leave them NULL (Postgres
-- permits many NULLs under a UNIQUE index). A purchased IAP product id resolves
-- back to a Plan (tier + monthlyCredits) or CreditPackage (creditAmount).

ALTER TABLE "plans" ADD COLUMN "apple_product_id" TEXT;
ALTER TABLE "plans" ADD COLUMN "google_product_id" TEXT;
ALTER TABLE "credit_packages" ADD COLUMN "apple_product_id" TEXT;
ALTER TABLE "credit_packages" ADD COLUMN "google_product_id" TEXT;

CREATE UNIQUE INDEX "plans_apple_product_id_key" ON "plans"("apple_product_id");
CREATE UNIQUE INDEX "plans_google_product_id_key" ON "plans"("google_product_id");
CREATE UNIQUE INDEX "credit_packages_apple_product_id_key" ON "credit_packages"("apple_product_id");
CREATE UNIQUE INDEX "credit_packages_google_product_id_key" ON "credit_packages"("google_product_id");
