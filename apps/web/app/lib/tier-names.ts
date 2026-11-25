/**
 * The paid membership names, fixed by the owner on 2026-11-21 (App Store plan
 * step 0.10). One wording everywhere — the badge, the account panel, the pricing
 * and subscription pages, the mobile app, the `plans` table (which also names the
 * Stripe checkout product) and the App Store product names.
 *
 * They used to disagree across five places (English names, 「…方案」, 「…版」 and
 * a two-character short form), and App Store product names are hard to change
 * once reviewed.
 * `apps/api/test/tier-names-parity.spec.ts` keeps every copy in step.
 */
export const PAID_TIER_NAMES = {
  BASIC: "基礎會員",
  PRO: "專業會員",
  MASTER: "大師會員",
} as const;
