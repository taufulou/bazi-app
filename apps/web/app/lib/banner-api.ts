/**
 * Public banner client — fetches active dashboard banner slides for the
 * HeroBanner carousel. No auth token (public `@Public()` endpoint).
 */

import { apiFetch } from './api';
import { devWarnServiceDown } from './dev-warn';

export interface BannerSlide {
  id: string;
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
 * Returns [] on any failure so the HeroBanner can fall back to its
 * built-in gradient slides (never throws to the caller).
 */
export async function getActiveBanners(): Promise<BannerSlide[]> {
  try {
    const res = await apiFetch<{ slides: BannerSlide[] }>('/api/banners');
    return res.slides ?? [];
  } catch (err) {
    devWarnServiceDown(
      'Dashboard banners',
      'is the API on :4000 running? (falling back to gradient slides)',
      err,
    );
    return [];
  }
}
