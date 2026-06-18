'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLanguage } from '../../components/LanguageContext';
import type { LanguagePref } from '../../lib/api';
import styles from './page.module.css';

/**
 * Account settings. Currently holds the 繁/簡 language toggle (reached from the
 * UserButton menu's 設定 item and the home 設定 quick-link). Switching persists to the
 * DB and applies in place (zh-CN) or reloads (revert to zh-TW) via the LanguageProvider.
 */
export default function SettingsPage() {
  const { lang, changeLanguage } = useLanguage();
  const [submitting, setSubmitting] = useState<LanguagePref | null>(null);

  const select = async (next: LanguagePref) => {
    if (submitting || next === lang) return;
    setSubmitting(next);
    try {
      await changeLanguage(next);
    } finally {
      // For zh-CN it applies in place; for the zh-TW revert it reloads (this line
      // won't be reached). Reset so a no-op/error doesn't leave a stuck spinner.
      setSubmitting(null);
    }
  };

  const OPTIONS: { value: LanguagePref; main: string; sub: string }[] = [
    { value: 'zh-TW', main: '繁體中文', sub: 'Traditional' },
    { value: 'zh-CN', main: '简体中文', sub: 'Simplified' },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <Link href="/" className={styles.back} aria-label="返回首頁">
            ← 返回
          </Link>
          <h1 className={styles.title}>設定</h1>
        </header>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>顯示語言</h2>
          <p className={styles.sectionDesc}>選擇命盤與介面的中文顯示方式。</p>

          <div className={styles.options} data-no-zh="">
            {OPTIONS.map((opt) => {
              const active = lang === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`${styles.option} ${active ? styles.optionActive : ''}`}
                  onClick={() => select(opt.value)}
                  disabled={submitting !== null}
                  aria-pressed={active}
                >
                  <span className={styles.optionMain}>{opt.main}</span>
                  <span className={styles.optionSub}>{opt.sub}</span>
                  {active && <span className={styles.check} aria-hidden="true">✓</span>}
                  {submitting === opt.value && (
                    <span className={styles.spinner} aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
