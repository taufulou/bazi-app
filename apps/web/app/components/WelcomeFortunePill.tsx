'use client';

/**
 * WelcomeFortunePill — compact daily-fortune glance beside the greeting.
 *
 * Richer than a bare chip: shows 能量 <score> + 今日運勢：<label>, so a returning
 * user sees today's status the moment the dashboard loads. Tap →
 * `/reading/fortune?tab=day`. The full 方案 A strip (HomeDailyFortuneCard) still
 * renders below the readings grid, so first-timers scrolling the product also
 * land on it.
 *
 * Renders nothing when signed out, when there's no primary profile, or on
 * service failure — the greeting row must never break because fortune is down.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import {
  fetchDailyFortune,
  resolveBaziToday,
  tierOf,
  FortuneApiError,
  type DailyFortuneResponse,
} from '../lib/fortune-api';
import { devWarnServiceDown } from '../lib/dev-warn';
import styles from './WelcomeFortunePill.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: DailyFortuneResponse }
  | { kind: 'hidden' };

export default function WelcomeFortunePill() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) setState({ kind: 'hidden' });
          return;
        }
        // engineOnly=true — the pill only needs score + label, never the AI
        // narrative (skips the ~3-5s Anthropic call on cold cache).
        const data = await fetchDailyFortune({
          token,
          date: resolveBaziToday(),
          engineOnly: true,
        });
        if (!cancelled) setState({ kind: 'ready', data });
      } catch (err) {
        if (cancelled) return;
        if (
          !(
            err instanceof FortuneApiError &&
            (err.status === 404 || err.code === 'NO_PRIMARY_PROFILE')
          )
        ) {
          devWarnServiceDown(
            'Daily fortune (welcome)',
            'is the API (:4000) + Bazi engine (:5001) running?',
            err,
          );
        }
        setState({ kind: 'hidden' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken]);

  if (!isLoaded || !isSignedIn) return null;
  if (state.kind === 'loading') {
    return <span className={styles.skeleton} aria-hidden="true" />;
  }
  if (state.kind === 'hidden') return null;

  const { engineOutput } = state.data;
  const tier = tierOf(engineOutput.auspiciousness);

  return (
    <Link
      href="/reading/fortune?tab=day"
      className={styles.pill}
      data-tier={tier}
      aria-label={`今日運勢 ${engineOutput.auspiciousness}，能量 ${engineOutput.energyScore}。查看完整日運`}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.energyWord}>能量</span>
      <span className={styles.score}>{engineOutput.energyScore}</span>
      <span className={styles.sep} aria-hidden="true">·</span>
      <span className={styles.statusWord}>今日運勢：</span>
      <span className={styles.label}>{engineOutput.auspiciousness}</span>
    </Link>
  );
}
