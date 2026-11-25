/**
 * Every outbound URL the app opens (1C item 3). One module so the domain cannot
 * drift: the share cards, the store and the store compliance links used to point
 * at a domain we do not own. Guarded by `__tests__/site-domain.test.ts`.
 */

export const SITE_URL = 'https://tianmingapp.com';
/** Printed on share cards. */
export const SITE_HOST = 'tianmingapp.com';

export const PRIVACY_URL = `${SITE_URL}/privacy`;
export const TERMS_URL = `${SITE_URL}/terms`;

/**
 * Mirrors `CONTACT_EMAIL` in `apps/api/src/legal/legal-constants.ts` (pinned by
 * `apps/api/test/ai-disclosure-mobile-parity.spec.ts`). The support PAGE is not
 * opened in-app: it links onward to the website's purchase pages (guideline
 * 3.1.1). Its URL goes into App Store Connect instead.
 */
export const SUPPORT_EMAIL = 'TAPPER.FUN@gmail.com';
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;
