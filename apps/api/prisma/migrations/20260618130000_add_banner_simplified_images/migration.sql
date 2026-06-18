-- Optional Simplified-Chinese (簡體) banner image variants.
-- Shown to zh-CN users; null = fall back to the Traditional crops. Nullable +
-- no default keeps existing slides untouched (backward-compatible).
ALTER TABLE "banner_slides" ADD COLUMN "image_url_desktop_simplified" TEXT;
ALTER TABLE "banner_slides" ADD COLUMN "image_url_mobile_simplified" TEXT;
