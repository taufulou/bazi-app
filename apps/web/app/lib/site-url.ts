/**
 * The site's own public base URL — one definition, three consumers.
 *
 * M9: this used to be a `process.env.NEXT_PUBLIC_SITE_URL || 'https://bazi-platform.com'`
 * expression copy-pasted into `layout.tsx` and `sitemap.ts`, with the same
 * hostname hardcoded a third time in `public/robots.txt`. **We do not own
 * `bazi-platform.com`** — the domain is `tianmingapp.com` — so the fallback
 * pointed canonical tags, OpenGraph URLs and the `Sitemap:` line at a host under
 * someone else's control. That is worse than a broken link: it hands a
 * third-party domain our canonical signals, and it only becomes visible once
 * the site is actually deployed and crawled, which is now.
 *
 * The fallback is localhost on purpose. If `NEXT_PUBLIC_SITE_URL` is missing in
 * production the URLs are obviously, locally wrong — which someone notices —
 * rather than plausibly wrong and pointed somewhere real.
 *
 * ⚠️ `NEXT_PUBLIC_*` is inlined at BUILD time, so this must be present as a
 * build argument to the image, not only as a runtime variable.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
).replace(/\/+$/, '');
