'use client';

/**
 * HomeDailyFortuneCard — compact daily-fortune teaser for the homepage.
 *
 * Sits just below the hero banner as a slim strip. Shows only the essentials:
 * energy score (gold ring), auspiciousness label (吉/…), a 1-line friendly
 * mood keyword, and today's date. Tap → `/reading/fortune?tab=day` for the
 * full breakdown (dimensions, AI narrative, folk content, chat).
 *
 * The 干支/十神 jargon meta line and the 5 dimension bars were intentionally
 * removed from this glance-level card — they live on the full 日運 page.
 *
 * Phase 1: shows for the user's primary birth profile. Falls back to a
 * setup-prompt card when no primary profile exists.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import {
  fetchDailyFortune,
  resolveBaziToday,
  civilTodayTaipei,
  moodKeywordFromLabel,
  FortuneApiError,
  type DailyFortuneResponse,
} from '../lib/fortune-api';
import { devWarnServiceDown } from '../lib/dev-warn';
import styles from './HomeDailyFortuneCard.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: DailyFortuneResponse }
  | { kind: 'no_profile' }
  | { kind: 'error' };

export default function HomeDailyFortuneCard() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) setState({ kind: 'error' });
          return;
        }
        // Phase Fortune+ progressive loading: homepage widget only renders
        // engine output (score, dimensions, ganzhi labels) — no AI narrative
        // shown here. Use engineOnly=true to skip the ~3-5s Anthropic call
        // on cold cache. Warm cache returns full payload (narrative bonus
        // unused but harmless). Net effect: ~500ms cold load vs ~3-5s before.
        const data = await fetchDailyFortune({
          token,
          date: resolveBaziToday(),
          engineOnly: true,
        });
        if (!cancelled) setState({ kind: 'ready', data });
      } catch (err) {
        if (cancelled) return;
        if (
          err instanceof FortuneApiError &&
          (err.status === 404 || err.code === 'NO_PRIMARY_PROFILE')
        ) {
          setState({ kind: 'no_profile' });
        } else {
          // Genuine service failure (not the "no birth profile" 404 above).
          devWarnServiceDown(
            'Daily fortune',
            'is the API (:4000) + Bazi engine (:5001) running?',
            err,
          );
          setState({ kind: 'error' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken]);

  if (!isLoaded || !isSignedIn) return null;

  if (state.kind === 'loading') {
    return (
      <Link href="/reading/fortune" className={styles.card}>
        <div className={styles.skeleton} aria-label="今日運勢載入中" />
      </Link>
    );
  }

  if (state.kind === 'no_profile') {
    return (
      <Link href="/dashboard/profiles" className={styles.setupCard}>
        <div className={styles.setupIcon}>🌅</div>
        <div className={styles.setupBody}>
          <div className={styles.setupTitle}>建立出生資料以查看每日運勢</div>
          <div className={styles.setupSub}>完成後即可解鎖「今日能量」儀表板</div>
        </div>
        <span className={styles.setupArrow}>→</span>
      </Link>
    );
  }

  if (state.kind === 'error') {
    // Silent failure — homepage is graceful when fortune unavailable
    return null;
  }

  const { engineOutput } = state.data;
  const tier = tierOf(engineOutput.auspiciousness);
  const moodKeyword = moodKeywordFromLabel(engineOutput.auspiciousness);
  // The Bazi day rolls at 23:00 (子時), so during 23:00–midnight the shown date
  // is one civil day ahead. Detect it to swap the label + surface a plain-language
  // note so users don't read the future date as a bug.
  const civilDate = civilTodayTaipei();
  const isZiShiRollover = state.data.date !== civilDate;

  return (
    <Link href="/reading/fortune?tab=day" className={styles.card} data-tier={tier}>
      <div className={styles.scoreRing}>
        <span className={styles.scoreNumber}>{engineOutput.energyScore}</span>
        <span className={styles.scoreUnit}>能量</span>
      </div>

      <div className={styles.body}>
        <div className={styles.headerRow}>
          <span className={styles.label}>{engineOutput.auspiciousness}</span>
          <span className={styles.mood}>{moodKeyword}</span>
        </div>
        <div className={styles.meta}>
          {isZiShiRollover ? '命理日' : '今天'} · {formatDateZH(state.data.date)}
        </div>
        {isZiShiRollover && (
          <div className={styles.ziShiNote}>
            八字晚上 11 點換日，現在已進入 {formatDateZH(state.data.date)} 的運勢（國曆仍是 {formatDateZH(civilDate)}）
          </div>
        )}
      </div>

      <span className={styles.cta}>
        查看<span className={styles.ctaArrow} aria-hidden="true">→</span>
      </span>
    </Link>
  );
}

function tierOf(label: string): 'positive' | 'neutral' | 'negative' {
  if (['大吉', '吉', '吉中有凶'].includes(label)) return 'positive';
  if (['凶中有吉', '平'].includes(label)) return 'neutral';
  return 'negative';
}

function formatDateZH(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[2])}月${Number(m[3])}日`;
}
