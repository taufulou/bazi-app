/**
 * Public banner client — active carousel slides for the home HeroBanner.
 * RN port of apps/web/app/lib/banner-api.ts.
 *
 * NO auth: `GET /api/banners` is `@Public()` on the API (ClerkAuthGuard is a
 * global APP_GUARD, so the `@Public()` decorator there is load-bearing). We
 * deliberately pass no token — the banner renders before/without a session.
 */

import { apiFetch } from './api';

export interface BannerSlide {
  id: string;
  /** Wire shape includes the desktop crops; mobile renders the `*Mobile` ones. */
  imageUrlDesktop: string;
  imageUrlMobile: string;
  /** Optional 簡體 crops — shown to zh-CN users; null → fall back to the TC crops. */
  imageUrlDesktopSimplified: string | null;
  imageUrlMobileSimplified: string | null;
  linkHref: string;
  altText: string | null;
}

/**
 * GET /api/banners — active slides ordered by displayOrder.
 * Returns [] on any failure so HeroBanner falls back to its built-in gradient
 * slides (never throws to the caller — the home screen must not blank out).
 */
export async function getActiveBanners(): Promise<BannerSlide[]> {
  try {
    const res = await apiFetch<{ slides: BannerSlide[] }>('/api/banners');
    return res.slides ?? [];
  } catch (err) {
    if (__DEV__) {
      console.warn(
        '[banners] fetch failed — is the API on :4000 running? (falling back to gradient slides)',
        err,
      );
    }
    return [];
  }
}
