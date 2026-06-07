'use client';

/**
 * FortuneShell — header + tabbed pills (日運/月運/年運) wrapper for the
 * Fortune reading page. Phase 1: only 日運 tab is active; 月運/年運 show
 * partial-preview placeholders per locked plan.
 *
 * Audit #5: this shell does NOT call `useSearchParams()` itself — that
 * would compound the Suspense-boundary issue. The parent page owns the
 * URL state and passes `onSwitchTab` down as a callback.
 */
import { useRouter } from 'next/navigation';
// Value namespace import (NOT `import type`) to force `children: React.ReactNode`
// to resolve through the same React namespace that JSX intrinsics use. Fixes
// the dual-`@types/react` type-identity mismatch that surfaces in CI's npm-ci
// dep tree (but not local worktree symlink). Per plan staff-review R1 #2 +
// canonical Next.js + monorepo workaround.
import * as React from 'react';
import { ArrowLeft, ArrowUpRight, User } from 'lucide-react';
import styles from './FortuneShell.module.css';

type Tab = 'day' | 'month' | 'year';

const TAB_META: Array<{ key: Tab; zh: string; ready: boolean }> = [
  { key: 'day',   zh: '日運', ready: true },
  { key: 'month', zh: '月運', ready: true },
  { key: 'year',  zh: '年運', ready: true },
];

interface Props {
  activeTab: Tab;
  /** Callback invoked when the user picks a different tab. Parent owns
   *  the URL state; the shell only fires the intent. */
  onSwitchTab: (next: Tab) => void;
  profileName?: string;
  /** Birth profile's ISO birth date (YYYY-MM-DD). Rendered as a chip
   *  next to the profile name — replaces the old «我的» tag (2026-05-17
   *  UX iteration; chip carries useful context instead of redundant marker). */
  birthDate?: string;
  /** Birth profile's birth time (HH:MM). Appended to the chip if provided. */
  birthTime?: string;
  /** Show share icon — wires to ShareFortuneButton when ready (Phase 1.5). */
  onShareClick?: () => void;
  /** Phase 1.5 slot: subscriber-aware DateNavigator row. Renders between
   *  the header and subHeader when provided. Shell stays presentation-only —
   *  the navigator is owned by the parent page along with URL state. */
  dateNavigator?: React.ReactNode;
  /** Phase 1.5 slot: ProfileSwitcher popover. When provided, REPLACES the
   *  default static «RefreshCw → /dashboard/profiles» link on the right
   *  side of the subHeader. */
  profileSwitcher?: React.ReactNode;
  /** Phase 1.5.x slot: AuthExpiredBanner (or any top-of-content banner).
   *  Renders between header and dateNavigator row. Optional; backward-compat. */
  topBanner?: React.ReactNode;
  children: React.ReactNode;
}

/** Format ISO YYYY-MM-DD + optional HH:MM → «1987.09.06 16:11» for chip display.
 *  Returns just the date when birthTime is absent or empty. */
function formatBirthChip(iso: string, time?: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  // Non-null assertions: the regex pattern guarantees 3 capture groups when
  // match succeeds; ternary already gates on `m` being non-null. Needed
  // because tsconfig sets `noUncheckedIndexedAccess: true`.
  const datePart = m ? `${m[1]!}.${m[2]!}.${m[3]!}` : iso;
  const t = (time ?? '').trim();
  if (!t) return datePart;
  return `${datePart} ${t}`;
}

export default function FortuneShell({
  activeTab,
  onSwitchTab,
  profileName,
  birthDate,
  birthTime,
  onShareClick,
  dateNavigator,
  profileSwitcher,
  topBanner,
  children,
}: Props) {
  const router = useRouter();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <button
          type="button"
          onClick={() => router.push('/')}
          className={styles.backBtn}
          aria-label="返回首頁"
        >
          <ArrowLeft size={20} strokeWidth={2} aria-hidden="true" />
        </button>

        <div className={styles.tabs} role="tablist" aria-label="運勢時段">
          {TAB_META.map((t) => {
            const isActive = t.key === activeTab;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-disabled={!t.ready}
                disabled={!t.ready}
                className={styles.tab}
                data-active={isActive}
                data-ready={t.ready}
                onClick={() => t.ready && onSwitchTab(t.key)}
                title={t.ready ? '' : '即將推出'}
              >
                {t.zh}
                {!t.ready && <span className={styles.tabBadge}>即將推出</span>}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className={styles.shareBtn}
          aria-label="分享運勢"
          onClick={onShareClick}
          disabled={!onShareClick}
        >
          <ArrowUpRight size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      {/* Phase 1.5.x slot — topBanner (e.g., AuthExpiredBanner) sits between
          header and DateNavigator row. In normal flow; sticky header overlaps
          on scroll (intentional). */}
      {topBanner && <div className={styles.topBannerRow}>{topBanner}</div>}

      {/* Phase 1.5 slot — DateNavigator row sits between header and subHeader */}
      {dateNavigator && (
        <div className={styles.dateNavigatorRow}>{dateNavigator}</div>
      )}

      {profileName && (
        <div className={styles.subHeader}>
          {/* Profile chip — left side */}
          <span className={styles.profileChip}>
            <span className={styles.profileAvatar} aria-hidden="true">
              <User size={14} strokeWidth={2} />
            </span>
            <span className={styles.profileName}>{profileName}</span>
            {birthDate && (
              <span className={styles.birthDateTag} title="出生日期 · 時辰">
                {formatBirthChip(birthDate, birthTime)}
              </span>
            )}
          </span>
          {/* Switcher — right side. Phase 1.5: prefer the rich popover
              ProfileSwitcher when provided; fall back to nothing if the
              parent didn't supply one (single-profile users won't see one
              even if passed — the switcher renders null when profiles.length <= 1). */}
          <div className={styles.switcherSlot}>{profileSwitcher}</div>
        </div>
      )}

      <main className={styles.main}>{children}</main>
    </div>
  );
}
