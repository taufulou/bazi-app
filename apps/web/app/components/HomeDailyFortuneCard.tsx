'use client';

/**
 * HomeDailyFortuneCard — compact daily-fortune widget for the homepage.
 *
 * Shows today's energy score (large), label, 1-line mood keyword, and a
 * 5-bar mini sparkline for the 5 dimensions. Tap → `/reading/fortune`.
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
  moodKeywordFromLabel,
  FortuneApiError,
  type DailyFortuneResponse,
} from '../lib/fortune-api';
import styles from './HomeDailyFortuneCard.module.css';

const DIM_META: Array<{
  key: 'romance' | 'career' | 'finance' | 'travel' | 'health';
  zh: string;
}> = [
  { key: 'romance', zh: '感情' },
  { key: 'career', zh: '事業' },
  { key: 'finance', zh: '財運' },
  { key: 'travel', zh: '出行' },
  { key: 'health', zh: '健康' },
];

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

  return (
    <Link href="/reading/fortune?tab=day" className={styles.card} data-tier={tier}>
      <div className={styles.scoreRing}>
        <span className={styles.scoreNumber}>{engineOutput.energyScore}</span>
        <span className={styles.scoreUnit}>能量</span>
      </div>

      <div className={styles.body}>
        <div className={styles.headerRow}>
          <span className={styles.label}>{engineOutput.auspiciousness}</span>
          <span className={styles.dot}>·</span>
          <span className={styles.mood}>{moodKeyword}</span>
        </div>
        <div className={styles.meta}>
          {formatDateZH(state.data.date)} · {engineOutput.dayGanZhi}日 · {engineOutput.dayTenGod}
        </div>
        <div className={styles.bars} aria-hidden="true">
          {DIM_META.map((m) => {
            const score = engineOutput.dimensions[m.key]?.score ?? 50;
            return (
              <div key={m.key} className={styles.barCol}>
                <span className={styles.barName}>{m.zh}</span>
                <div className={styles.barTrack}>
                  <div
                    className={styles.barFill}
                    style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <span className={styles.arrow}>→</span>
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
