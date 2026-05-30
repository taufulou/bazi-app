'use client';

/**
 * YearNavigator — Phase 3 年運 year switcher.
 *
 * Sibling component to MonthNavigator / DateNavigator (NOT a mode-prop
 * extension). ~80% pattern copy with year-mode adjustments.
 *
 * 5 boundary states (mirror MonthNavigator):
 *   1. At -1 year: prev arrow disabled («已達訂閱可查最早年份»)
 *   2. At +4 years: next arrow disabled («已達訂閱可查最遠年份»)
 *   3. Out-of-window URL hit: parent renders ErrorPanel (this component
 *      just shows the picker pinned to currentYearIso for navigation)
 *   4. Profile switch: parent re-anchors to caller's local-TZ current year
 *   5. Free user: prev/next/label clicks → onLockedAttempt callback
 *
 * Subscriber window math via fortune-api.ts helpers (isYearInSubscriberWindow
 * + SUBSCRIBER_WINDOW_PAST_YEAR / FUTURE_YEAR). Resolved-current-year computed
 * in Asia/Taipei via resolveCurrentYearIso.
 *
 * No react-datepicker month/day picker — year navigation uses simple
 * prev/next arrows + a static year label (no popover calendar; year picking
 * via arrows is sufficient and avoids a heavier picker).
 */
import * as React from 'react';
import { ChevronLeft, ChevronRight, Lock, Calendar } from 'lucide-react';
import {
  isYearInSubscriberWindow,
  SUBSCRIBER_WINDOW_FUTURE_YEAR,
  type UserTier,
} from '../../lib/fortune-api';
import styles from './DateNavigator.module.css';

interface YearNavigatorProps {
  /** Currently displayed year, YYYY (string) */
  value: string;
  /** This year per Asia/Taipei (`resolveCurrentYearIso()`) — YYYY */
  currentYearIso: string;
  /** User's subscription tier; `undefined` while loading → treat as FREE */
  tier: UserTier | undefined;
  /** True while `useUserTier` fetch is in-flight — mirror Scenario H. */
  isTierLoading?: boolean;
  /** Fires when navigation is allowed and user picks a new year */
  onChange: (nextIso: string) => void;
  /** Fires when a FREE user clicks any nav control — parent opens upgrade modal */
  onLockedAttempt?: () => void;
  /** Disables both arrows while fortune fetch is in-flight */
  isLoading?: boolean;
}

/** Add `n` years to a YYYY string. Negative subtracts. */
function addYears(iso: string, n: number): string {
  const y = parseInt(iso, 10);
  if (Number.isNaN(y)) return iso;
  return String(y + n);
}

/** Diff (target - reference) in whole years. Both YYYY strings. */
function diffYears(target: string, reference: string): number {
  const t = parseInt(target, 10);
  const r = parseInt(reference, 10);
  if (Number.isNaN(t) || Number.isNaN(r)) return 0;
  return t - r;
}

export default function YearNavigator({
  value,
  currentYearIso,
  tier,
  isTierLoading = false,
  onChange,
  onLockedAttempt,
  isLoading = false,
}: YearNavigatorProps) {
  const isFree = !isTierLoading && (tier === undefined || tier === 'FREE');

  const prevIso = addYears(value, -1);
  const nextIso = addYears(value, 1);
  const canGoPrev =
    !isTierLoading &&
    !isFree &&
    isYearInSubscriberWindow(prevIso, currentYearIso, tier);
  const canGoNext =
    !isTierLoading &&
    !isFree &&
    isYearInSubscriberWindow(nextIso, currentYearIso, tier);

  const handlePrev = () => {
    if (isTierLoading) return;
    if (isFree) {
      onLockedAttempt?.();
      return;
    }
    if (!canGoPrev || isLoading) return;
    onChange(prevIso);
  };

  const handleNext = () => {
    if (isTierLoading) return;
    if (isFree) {
      onLockedAttempt?.();
      return;
    }
    if (!canGoNext || isLoading) return;
    onChange(nextIso);
  };

  const handleLabelClick = () => {
    if (isTierLoading) return;
    if (isFree) {
      onLockedAttempt?.();
    }
    // Subscribers: label is a no-op (no popover picker for years — arrows
    // are sufficient for the -1/+4 window).
  };

  // Offset from current year indicator («今年»/«明年»/«去年»/«+N 年»)
  const offset = diffYears(value, currentYearIso);
  let offsetBadge: string;
  if (offset === 0) offsetBadge = '今年';
  else if (offset === 1) offsetBadge = '明年';
  else if (offset === -1) offsetBadge = '去年';
  else if (offset > 0) offsetBadge = `+${offset} 年`;
  else offsetBadge = `${offset} 年`;

  const prevIcon = isFree && !isTierLoading ? (
    <Lock size={14} strokeWidth={2} aria-hidden="true" />
  ) : (
    <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
  );
  const nextIcon = isFree && !isTierLoading ? (
    <Lock size={14} strokeWidth={2} aria-hidden="true" />
  ) : (
    <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
  );

  const arrowState = isTierLoading ? 'loading' : isFree ? 'locked' : 'active';

  const prevTooltip =
    !isFree && !isTierLoading && !canGoPrev
      ? '已達訂閱可查最早年份（去年）'
      : undefined;
  const nextTooltip =
    !isFree && !isTierLoading && !canGoNext
      ? `已達訂閱可查最遠年份（+${SUBSCRIBER_WINDOW_FUTURE_YEAR} 年）`
      : undefined;

  return (
    <div
      className={styles.container}
      data-locked={isFree ? 'true' : 'false'}
      data-state={arrowState}
    >
      <button
        type="button"
        className={styles.arrow}
        onClick={handlePrev}
        disabled={isTierLoading || (!isFree && (!canGoPrev || isLoading))}
        aria-disabled={isTierLoading || (!isFree && !canGoPrev)}
        aria-label="前一年"
        title={prevTooltip}
        data-state={arrowState}
      >
        {prevIcon}
      </button>

      <button
        type="button"
        className={styles.dateLabel}
        onClick={handleLabelClick}
        disabled={isTierLoading}
        data-state={arrowState}
      >
        <Calendar
          size={14}
          strokeWidth={2}
          aria-hidden="true"
          className={styles.calIcon}
        />
        <span className={styles.dateText}>{value}年</span>
        <span className={styles.offsetBadge}>{offsetBadge}</span>
      </button>

      <button
        type="button"
        className={styles.arrow}
        onClick={handleNext}
        disabled={isTierLoading || (!isFree && (!canGoNext || isLoading))}
        aria-disabled={isTierLoading || (!isFree && !canGoNext)}
        aria-label="後一年"
        title={nextTooltip}
        data-state={arrowState}
      >
        {nextIcon}
      </button>
    </div>
  );
}
