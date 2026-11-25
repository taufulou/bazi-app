import styles from "./AuthLegalFooter.module.css";

/**
 * Privacy · Terms · Support under the Clerk sign-in / sign-up widgets (1B item 6).
 *
 * These are the only public pages of the site, and the website otherwise links
 * to its legal pages nowhere. Relative links: the three pages are served by this
 * same host as public route handlers (see `app/privacy/route.ts`).
 *
 * Plain anchors, NOT next/link: these are route handlers returning HTML, not
 * pages. A Link would prefetch an RSC payload from them on every sign-in page
 * view (each one a proxied API fetch) and then fall back to a full load anyway.
 */
export default function AuthLegalFooter() {
  return (
    <nav className={styles.footer} aria-label="法律資訊">
      <a href="/privacy">隱私權政策</a>
      <span aria-hidden="true">·</span>
      <a href="/terms">服務條款</a>
      <span aria-hidden="true">·</span>
      <a href="/support">客服支援</a>
    </nav>
  );
}
