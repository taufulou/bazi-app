/**
 * Curated list of internal link destinations for the banner admin dropdown.
 * Derived from READING_TYPE_META (the slug is the object KEY — there is no
 * `slug` field) plus special reading routes and general pages.
 *
 * Only the LIVE Bazi reading types the homepage actually surfaces are
 * included (hidden ZWDS + `health` are excluded so a banner can't link to a
 * page the user can't reach).
 */
import { READING_TYPE_META } from '@repo/shared';

export interface BannerLinkOption {
  label: string;
  href: string;
  group: string;
}

const LIVE_READING_SLUGS = new Set<string>([
  'lifetime',
  'annual',
  'career',
  'love',
  'compatibility',
]);

const readingOptions: BannerLinkOption[] = (
  Object.entries(READING_TYPE_META) as [
    string,
    (typeof READING_TYPE_META)[keyof typeof READING_TYPE_META],
  ][]
)
  .filter(([slug]) => LIVE_READING_SLUGS.has(slug))
  .map(([slug, meta]) => ({
    label: meta.nameZhTw,
    href: `/reading/${slug}`,
    group: '八字解讀',
  }));

const specialOptions: BannerLinkOption[] = [
  { label: '八字日運／月運／年運', href: '/reading/fortune', group: '運勢' },
];

const generalOptions: BannerLinkOption[] = [
  { label: '首頁', href: '/', group: '一般頁面' },
  { label: '訂閱方案', href: '/pricing', group: '一般頁面' },
  { label: '購買點數', href: '/store', group: '一般頁面' },
  { label: '出生資料', href: '/dashboard/profiles', group: '一般頁面' },
  { label: '歷史記錄', href: '/dashboard/readings', group: '一般頁面' },
];

export const BANNER_LINK_OPTIONS: BannerLinkOption[] = [
  ...readingOptions,
  ...specialOptions,
  ...generalOptions,
];

/** Recommended upload sizes shown as helper text in the admin form. */
export const BANNER_IMAGE_GUIDANCE = {
  desktop: { width: 1920, height: 384, ratio: '5:1', maxKb: 300 },
  mobile: { width: 1200, height: 420, ratio: '≈2.86:1', maxKb: 200 },
} as const;
