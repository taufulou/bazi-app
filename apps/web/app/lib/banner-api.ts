/**
 * Public banner client — fetches active dashboard banner slides for the
 * HeroBanner carousel. No auth token (public `@Public()` endpoint).
 */

import { apiFetch } from './api';

export interface BannerSlide {
  id: string;
  imageUrlDesktop: string;
  imageUrlMobile: string;
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
  } catch {
    return [];
  }
}
