'use client';

/**
 * /reading/fortune — 八字日運/月運/年運 page (Phase 1: 日運 active;
 * 月運/年運 = partial preview placeholders per locked plan).
 *
 * Query params:
 *   - tab=day|month|year   (default day)
 *   - date=YYYY-MM-DD      (client resolves 23:00 子時 boundary before sending)
 *   - profileId=<uuid>     (falls back to user primary)
 *
 * Auth: protected by `middleware.ts` Clerk gate; this client component
 *       uses `useAuth().getToken()` to obtain a JWT for the API call.
 *
 * Audit #1: the inner `FortuneView` calls `useSearchParams()` and must
 * be wrapped in a `<Suspense>` boundary at the page-level default export
 * (Next.js App Router requirement for static prerendering).
 */

import { Suspense, useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { Share2 } from 'lucide-react';
import { ENTERTAINMENT_DISCLAIMER } from '@repo/shared';
import FortuneShell from '../../components/fortune/FortuneShell';
import EnergyScoreRing from '../../components/fortune/EnergyScoreRing';
import DimensionBars from '../../components/fortune/DimensionBars';
import NarrativeCard from '../../components/fortune/NarrativeCard';
import SectionDivider from '../../components/fortune/SectionDivider';
import {
  fetchDailyFortune,
  resolveBaziToday,
  FortuneApiError,
  type DailyFortuneResponse,
} from '../../lib/fortune-api';
import styles from './page.module.css';

type Tab = 'day' | 'month' | 'year';

// Top-level default export wraps the inner view in <Suspense> for the
// useSearchParams() prerender requirement.
export default function FortunePage() {
  return (
    <Suspense fallback={<div className={styles.skeletonWrap} aria-label="載入中" />}>
      <FortuneView />
    </Suspense>
  );
}

function FortuneView() {
  const search = useSearchParams();
  const router = useRouter();
  const { getToken, isSignedIn, isLoaded } = useAuth();

  const tab: Tab = (search.get('tab') as Tab) || 'day';
  const dateParam = search.get('date') ?? undefined;
  const profileId = search.get('profileId') ?? undefined;

  const handleSwitchTab = useCallback(
    (next: Tab) => {
      const params = new URLSearchParams(search.toString());
      params.set('tab', next);
      router.push(`/reading/fortune?${params.toString()}`);
    },
    [router, search],
  );

  const targetDate = useMemo(() => dateParam ?? resolveBaziToday(), [dateParam]);

  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'success'; data: DailyFortuneResponse }
    | { status: 'error'; code: string; message: string; statusCode: number }
  >({ status: 'idle' });

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (tab !== 'day') return;     // Phase 1: only daily fetches data

    let cancelled = false;
    setState({ status: 'loading' });

    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          setState({
            status: 'error',
            code: 'NO_TOKEN',
            statusCode: 401,
            message: '請重新登入',
          });
          return;
        }
        const data = await fetchDailyFortune({ token, profileId, date: targetDate });
        if (!cancelled) setState({ status: 'success', data });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof FortuneApiError) {
          setState({
            status: 'error',
            statusCode: err.status,
            code: err.code,
            message: err.message,
          });
        } else {
          setState({
            status: 'error',
            statusCode: 0,
            code: 'NETWORK',
            message: (err as Error).message ?? '網路錯誤',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken, profileId, targetDate, tab]);

  // Note: Date moved INTO EnergyScoreRing (UX Sprint 1 R1.2 / S1.1).
  // The subheader no longer renders a date — kept just for profile chip.

  return (
    <FortuneShell
      activeTab={tab}
      onSwitchTab={handleSwitchTab}
      profileName={state.status === 'success' ? '我' : undefined}
      birthDate={state.status === 'success' ? state.data.profileBirthDate : undefined}
      birthTime={state.status === 'success' ? state.data.profileBirthTime : undefined}
    >
      {tab !== 'day' && <PartialPreview tab={tab} />}

      {tab === 'day' && state.status === 'loading' && <LoadingSkeleton />}

      {tab === 'day' && state.status === 'error' && (
        <ErrorPanel
          code={state.code}
          statusCode={state.statusCode}
          message={state.message}
        />
      )}

      {tab === 'day' && state.status === 'success' && (
        <SuccessView data={state.data} />
      )}
    </FortuneShell>
  );
}

// ============================================================
// Sub-views
// ============================================================

function SuccessView({ data }: { data: DailyFortuneResponse }) {
  const { engineOutput, narrative } = data;

  return (
    <>
      <EnergyScoreRing
        label={engineOutput.auspiciousness}
        score={engineOutput.energyScore}
        date={data.date}
        dayGanZhi={engineOutput.dayGanZhi}
        dayTenGod={engineOutput.dayTenGod}
      />

      <SectionDivider />

      <DimensionBars dimensions={engineOutput.dimensions} />

      <SectionDivider />

      <NarrativeCard
        narrative={narrative}
        dimensions={engineOutput.dimensions}
        headlinerSignals={engineOutput.headlinerSignals}
      />

      <SectionDivider />

      <FolkContentCard wealthDirection={engineOutput.folkContent.wealthDirection} />

      <SectionDivider />

      <ChatCTA />

      {/* Sprint 4: disabled share placeholder — wires up when Phase 1.5
          html2canvas sharing session ships */}
      <SharePlaceholder />

      {/* Entertainment disclaimer (PR review #1 — CLAUDE.md compliance:
          all reading pages must render this. Pattern mirrors AIReadingDisplay
          + compatibility/page.tsx) */}
      <div className={styles.disclaimer}>
        <span className={styles.disclaimerIcon} aria-hidden="true">⚠️</span>
        <span className={styles.disclaimerText}>
          {ENTERTAINMENT_DISCLAIMER['zh-TW']}
        </span>
      </div>
    </>
  );
}

function FolkContentCard({
  wealthDirection,
}: {
  wealthDirection: DailyFortuneResponse['engineOutput']['folkContent']['wealthDirection'];
}) {
  return (
    <section className={styles.folkSection}>
      <h3 className={styles.folkTitle}>命局層級參考</h3>
      <div className={styles.folkGrid}>
        <div className={styles.folkCard}>
          <div className={styles.folkIcon}>🧭</div>
          <div className={styles.folkLabel}>財運位</div>
          <div className={styles.folkValue}>{wealthDirection.direction}</div>
          {/* Sprint 3.G — frontend override of engine `wealthDirection.note`
              («命格層級，每日不變») to a more positive UX framing. */}
          <div className={styles.folkNote}>您命格適合常用的方位</div>
        </div>
        <div className={styles.folkCardPlaceholder}>
          <div className={styles.folkPlaceholderText}>
            🌈 吉祥色 / 🔢 幸運數字 / 🕘 吉時
          </div>
          <div className={styles.folkPlaceholderSub}>
            研究後推出（Phase 1.5）
          </div>
        </div>
      </div>
    </section>
  );
}

/** Sprint 4 — disabled share placeholder at end of page.
 *  Wires up when Phase 1.5 sharing session ships (html2canvas PNG export). */
function SharePlaceholder() {
  return (
    <button
      type="button"
      className={styles.sharePlaceholder}
      disabled
      aria-disabled="true"
      aria-label="分享日運卡片（即將推出）"
    >
      <Share2 size={16} strokeWidth={2} aria-hidden="true" />
      <span>分享日運卡片</span>
      <span className={styles.sharePlaceholderBadge}>即將推出</span>
    </button>
  );
}

function ChatCTA() {
  return (
    <div className={styles.chatCta}>
      <div className={styles.chatCtaIcon}>💬</div>
      <div className={styles.chatCtaBody}>
        <div className={styles.chatCtaTitle}>想深入了解今日的特定面向？</div>
        <div className={styles.chatCtaSub}>AI 命理師 1:1 對話 · 訂閱用戶免費</div>
      </div>
      <span className={styles.chatCtaArrow}>→</span>
      {/* Wire to ChatDrawer with readingType=FORTUNE in Phase 1.5 */}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className={styles.skeletonWrap}>
      <div className={styles.skeletonRing} />
      <div className={styles.skeletonBars} />
      <div className={styles.skeletonText} />
      <div className={styles.skeletonText} />
      <div className={styles.skeletonText} style={{ width: '70%' }} />
    </div>
  );
}

function PartialPreview({ tab }: { tab: 'month' | 'year' }) {
  const labels = { month: '月運', year: '年運' } as const;
  return (
    <div className={styles.previewWrap}>
      <div className={styles.previewIcon}>📅</div>
      <h2 className={styles.previewTitle}>{labels[tab]}完整 AI 解讀即將推出</h2>
      <p className={styles.previewBody}>
        Phase 1 已上線「日運」深度解讀。{labels[tab]}的完整 AI 解讀正在開發中。
      </p>
      <p className={styles.previewBody}>
        ※ 您仍可在以下處查看完整月份/年度分析：
      </p>
      {/* Both 月運 + 年運 cross-sell to the existing 八字流年運勢 paid
          reading. Different deep links possible in Phase 2 once the
          ANNUAL reading has month-anchored sections. */}
      <Link href="/reading/annual" className={styles.previewLink}>
        前往《八字流年運勢》 →
      </Link>
    </div>
  );
}

function ErrorPanel({
  code,
  statusCode,
  message,
}: {
  code: string;
  statusCode: number;
  message: string;
}) {
  // Audit #2: branch SUBSCRIBER_ONLY (free user) vs OUT_OF_WINDOW
  // (subscriber asking for date outside +30/−1 day window). The latter
  // user IS a subscriber — telling them to "subscribe" is wrong.
  if (code === 'SUBSCRIBER_ONLY') {
    return (
      <div className={styles.errorWrap}>
        <div className={styles.errorIcon}>🔒</div>
        <h2 className={styles.errorTitle}>限訂閱用戶查看</h2>
        <p className={styles.errorBody}>
          免費用戶僅可查看「今日」的日運。訂閱後即可查看「昨日 + 未來 30 天」範圍。
        </p>
        <Link href="/pricing" className={styles.errorAction}>
          查看訂閱方案 →
        </Link>
      </div>
    );
  }

  if (code === 'OUT_OF_WINDOW') {
    return (
      <div className={styles.errorWrap}>
        <div className={styles.errorIcon}>📅</div>
        <h2 className={styles.errorTitle}>超出查詢範圍</h2>
        <p className={styles.errorBody}>
          日運可查範圍為「昨日 + 今日 + 未來 30 天」。請選擇此範圍內的日期。
        </p>
        <Link href="/reading/fortune?tab=day" className={styles.errorAction}>
          回到今日 →
        </Link>
      </div>
    );
  }

  if (code === 'NO_PRIMARY_PROFILE' || code === 'PROFILE_NOT_FOUND' || statusCode === 404) {
    return (
      <div className={styles.errorWrap}>
        <div className={styles.errorIcon}>📝</div>
        <h2 className={styles.errorTitle}>找不到出生資料</h2>
        <p className={styles.errorBody}>請先建立您的出生資料後再使用日運功能。</p>
        <Link href="/dashboard/profiles" className={styles.errorAction}>
          前往建立出生資料 →
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.errorWrap}>
      <div className={styles.errorIcon}>⚠️</div>
      <h2 className={styles.errorTitle}>暫時無法載入日運</h2>
      <p className={styles.errorBody}>{message}</p>
      <p className={styles.errorMeta}>
        錯誤碼：{code} ({statusCode})
      </p>
    </div>
  );
}

// formatShortDate helper removed (R1.10) — date now formatted inside
// EnergyScoreRing via labels.ts::formatFortuneDate. Subheader no longer
// shows a date.
