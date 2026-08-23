import type { MetadataRoute } from 'next';
import { SITE_URL } from './lib/site-url';

/**
 * M9 — replaces `public/robots.txt`, which hardcoded
 * `Sitemap: https://bazi-platform.com/sitemap.xml`: a domain we do not own,
 * handed to every crawler that read the file. Generated now, from the same
 * `SITE_URL` as `sitemap.ts` and `layout.tsx`, so the three cannot disagree.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api/', '/dashboard'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
