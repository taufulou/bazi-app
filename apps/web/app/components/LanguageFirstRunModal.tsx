'use client';

import { useState } from 'react';
import { useLanguage } from './LanguageContext';
import type { LanguagePref } from '../lib/api';
import styles from './LanguageFirstRunModal.module.css';

/**
 * One-time 繁/簡 chooser. Mounted globally (beside SignedOutRedirect). Shows once, for
 * ALL signed-in users (incl. existing ones whose `language_chosen` is still false — the
 * ZH_TW default is just a default, not a choice). On pick it persists + applies in place
 * (no reload) and never re-fires (`languageChosen` flips true).
 *
 * The root carries `data-no-zh` so the picker's own labels are shown verbatim — each
 * button must display its own script (繁體中文 vs 简体中文), never auto-converted.
 */
export default function LanguageFirstRunModal() {
  const { languageChosen, profileLoaded, changeLanguage } = useLanguage();
  const [submitting, setSubmitting] = useState<LanguagePref | null>(null);

  // Only after we've fetched the authoritative profile (signed-in) AND it's unchosen.
  if (!profileLoaded || languageChosen) return null;

  const choose = async (next: LanguagePref) => {
    if (submitting) return;
    setSubmitting(next);
    try {
      await changeLanguage(next);
    } catch {
      setSubmitting(null);
    }
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="選擇顯示語言" data-no-zh="">
      <div className={styles.card}>
        <div className={styles.ornament}>◆</div>
        <h2 className={styles.title}>選擇顯示語言</h2>
        <p className={styles.subtitle}>请选择您偏好的中文显示方式</p>
        <div className={styles.options}>
          <button
            type="button"
            className={styles.option}
            onClick={() => choose('zh-TW')}
            disabled={submitting !== null}
          >
            <span className={styles.optionMain}>繁體中文</span>
            <span className={styles.optionSub}>Traditional</span>
            {submitting === 'zh-TW' && <span className={styles.spinner} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className={styles.option}
            onClick={() => choose('zh-CN')}
            disabled={submitting !== null}
          >
            <span className={styles.optionMain}>简体中文</span>
            <span className={styles.optionSub}>Simplified</span>
            {submitting === 'zh-CN' && <span className={styles.spinner} aria-hidden="true" />}
          </button>
        </div>
        <p className={styles.note}>可隨時在「設定」中變更 · 可随时在「设置」中变更</p>
      </div>
    </div>
  );
}
