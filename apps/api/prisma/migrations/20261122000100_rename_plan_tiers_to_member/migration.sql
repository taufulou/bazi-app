-- Membership names fixed by the owner on 2026-11-21 (App Store plan step 0.10):
-- 基礎會員 / 專業會員 / 大師會員, the same wording as the app, the website and the
-- App Store product names. These rows also name the Stripe checkout product
-- (stripe.service.ts: product_data.name = plan.nameZhTw).
--
-- Data only. Keyed on slug, the stable identifier; the rows are admin-editable,
-- but the owner's decision supersedes the seeded 基礎版 / 專業版 / 大師版.
UPDATE "plans" SET "name_zh_tw" = '基礎會員', "name_zh_cn" = '基础会员', "updated_at" = NOW() WHERE "slug" = 'basic';
UPDATE "plans" SET "name_zh_tw" = '專業會員', "name_zh_cn" = '专业会员', "updated_at" = NOW() WHERE "slug" = 'pro';
UPDATE "plans" SET "name_zh_tw" = '大師會員', "name_zh_cn" = '大师会员', "updated_at" = NOW() WHERE "slug" = 'master';
