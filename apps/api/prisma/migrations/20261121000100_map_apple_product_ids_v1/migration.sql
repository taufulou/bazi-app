-- 1A-core item 1 — map the seven v1 App Store products to their plans/packs.
--
-- Until this runs every Apple purchase resolves to nothing (apple_product_id is
-- NULL everywhere). The three annual products are deliberately NOT mapped: they
-- are not created in App Store Connect until annual memberships are built
-- (launch todo #28).
--
-- Each statement is guarded twice:
--  * `apple_product_id IS NULL` — never overwrite a value an operator set.
--  * `NOT EXISTS (... = id)` — apple_product_id is UNIQUE. A collision would
--    fail `prisma migrate deploy`, and a failed migration blocks THIS and EVERY
--    later deploy until someone runs `migrate resolve`. Skipping is safe: the
--    row stays NULL, and the purchase that needs it now fails loudly (500 +
--    Sentry `revenuecat.unmapped_product`) instead of silently.
--
-- A slug that differs in production (plans are admin-editable) also leaves its
-- row NULL. There is no admin UI for this column, so verify after deploy:
--   SELECT slug, apple_product_id FROM plans;
--   SELECT slug, apple_product_id FROM credit_packages;
-- and fix any gap with reviewed SQL.
--
-- On a fresh database migrations run before seed, so these match nothing;
-- `prisma/seed.ts` sets the same ids on create.

UPDATE "plans" SET "apple_product_id" = 'com.tianming.app.basic.monthly'
 WHERE "slug" = 'basic' AND "apple_product_id" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "plans" WHERE "apple_product_id" = 'com.tianming.app.basic.monthly');

UPDATE "plans" SET "apple_product_id" = 'com.tianming.app.pro.monthly'
 WHERE "slug" = 'pro' AND "apple_product_id" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "plans" WHERE "apple_product_id" = 'com.tianming.app.pro.monthly');

UPDATE "plans" SET "apple_product_id" = 'com.tianming.app.master.monthly'
 WHERE "slug" = 'master' AND "apple_product_id" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "plans" WHERE "apple_product_id" = 'com.tianming.app.master.monthly');

UPDATE "credit_packages" SET "apple_product_id" = 'com.tianming.app.credits.5'
 WHERE "slug" = 'starter-5' AND "apple_product_id" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "credit_packages" WHERE "apple_product_id" = 'com.tianming.app.credits.5');

UPDATE "credit_packages" SET "apple_product_id" = 'com.tianming.app.credits.12'
 WHERE "slug" = 'value-12' AND "apple_product_id" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "credit_packages" WHERE "apple_product_id" = 'com.tianming.app.credits.12');

UPDATE "credit_packages" SET "apple_product_id" = 'com.tianming.app.credits.30'
 WHERE "slug" = 'popular-30' AND "apple_product_id" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "credit_packages" WHERE "apple_product_id" = 'com.tianming.app.credits.30');

UPDATE "credit_packages" SET "apple_product_id" = 'com.tianming.app.credits.60'
 WHERE "slug" = 'mega-60' AND "apple_product_id" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "credit_packages" WHERE "apple_product_id" = 'com.tianming.app.credits.60');
