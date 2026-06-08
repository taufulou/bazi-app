import styles from './SignedOutInterstitial.module.css';

/**
 * Brief «正在前往登入…» placeholder shown on the (middleware-public) /reading/*
 * pages while the Global Signed-Out Handler (Layer A: SignedOutRedirect) performs
 * the client-side redirect to /sign-in. Pure presentational — no hooks, no
 * browser APIs, no 'use client' — so it can render in either an early-return
 * (fortune, [type]) or a JSX-conditional (compatibility) without a flash.
 */
export default function SignedOutInterstitial() {
  return <div className={styles.interstitial}>正在前往登入…</div>;
}
