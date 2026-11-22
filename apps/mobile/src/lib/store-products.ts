/**
 * What a membership row shows beyond the store's own title and price (1C item 8).
 *
 * Credits per month mirror the plans' `monthlyCredits` (Basic 5 / Pro 15 /
 * Master 50 — `apps/api/prisma/seed.ts`), keyed by the App Store product IDs
 * mapped in migration `20261121000100_map_apple_product_ids_v1`. iOS IDs only:
 * Android is not part of this submission, so an Android product shows no credits
 * line rather than a guess.
 */
export const MONTHLY_CREDITS_BY_PRODUCT: Readonly<Record<string, number>> = {
  'com.tianming.app.basic.monthly': 5,
  'com.tianming.app.pro.monthly': 15,
  'com.tianming.app.master.monthly': 50,
};

export function monthlyCreditsFor(productId: string): number | null {
  return MONTHLY_CREDITS_BY_PRODUCT[productId] ?? null;
}

/** ISO-8601 subscription period → the label shown after the price. */
export function periodSuffix(isoPeriod: string | null | undefined): string {
  switch (isoPeriod) {
    case 'P1M':
      return '／月';
    case 'P1Y':
      return '／年';
    case 'P1W':
      return '／週';
    case 'P3M':
      return '／季';
    case 'P6M':
      return '／半年';
    default:
      return '';
  }
}

export function periodLabel(isoPeriod: string | null | undefined): string {
  switch (isoPeriod) {
    case 'P1M':
      return '每月自動續訂';
    case 'P1Y':
      return '每年自動續訂';
    case 'P1W':
      return '每週自動續訂';
    case 'P3M':
      return '每季自動續訂';
    case 'P6M':
      return '每半年自動續訂';
    default:
      return '自動續訂';
  }
}
