'use client';

/**
 * YearlyCrossSellCard — Phase 3 年運 cross-sell to the paid 八字流年運勢.
 *
 * The 年運 tab gives a free annual snapshot; this card invites the user to
 * the existing paid 《八字流年運勢》 reading for the full deep dive (大運+流年
 * matrix, all 12 months, nuanced timing). Mirrors the PartialPreview link
 * pattern but presented as a richer card after the yearly content.
 */
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import styles from './YearlyCrossSellCard.module.css';

export default function YearlyCrossSellCard() {
  return (
    <Link href="/reading/annual" className={styles.card}>
      <span className={styles.icon} aria-hidden="true">
        📜
      </span>
      <span className={styles.body}>
        <span className={styles.title}>想要完整的流年深度解讀？</span>
        <span className={styles.sub}>
          《八字流年運勢》提供大運 + 流年完整矩陣、逐月吉凶與關鍵時機分析
        </span>
      </span>
      <span className={styles.arrow} aria-hidden="true">
        <ArrowUpRight size={18} strokeWidth={2} />
      </span>
    </Link>
  );
}
