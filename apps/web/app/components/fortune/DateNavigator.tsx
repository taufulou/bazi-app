'use client';

/**
 * DateNavigator — prev/next arrows + tappable date label opening a
 * react-datepicker popover. Subscriber-aware: subscribers can browse the
 * [-1, +30] day window; free users see arrows but a click fires
 * `onLockedAttempt` so the parent can pop the upgrade modal.
 *
 * Mount location: between `<header>` and `<subHeader>` of FortuneShell as
 * an opaque ReactNode slot. Shell does NOT know about auth or tier — only
 * this component does.
 *
 * "Today" must be derived from `resolveBaziToday()` (23:00 子時 boundary)
 * and passed in as `todayBaziIso`. Using local `new Date()` would produce
 * off-by-one fetches for users at 23:00-23:59.
 *
 * z-index 60 popper wrapper sits above the sticky header (50) and below
 * any modal (1000).
 */
import * as React from 'react';
import DatePicker from 'react-datepicker';
import { parse, format, isValid } from 'date-fns';
import { ChevronLeft, ChevronRight, Lock, Calendar } from 'lucide-react';
// Shared locale registration (same module DatePickerInput uses).
import '../../lib/date-locale';
import 'react-datepicker/dist/react-datepicker.css';
import {
  addDaysIso,
  diffDaysIso,
  isDateInSubscriberWindow,
  SUBSCRIBER_WINDOW_FUTURE,
  SUBSCRIBER_WINDOW_PAST,
  type UserTier,
} from '../../lib/fortune-api';
import styles from './DateNavigator.module.css';

interface DateNavigatorProps {
  /** Currently displayed date, YYYY-MM-DD */
  value: string;
  /** Today's date per 23:00 子時 boundary (resolveBaziToday()) — YYYY-MM-DD */
  todayBaziIso: string;
  /** User's subscription tier; `undefined` while loading → treat as FREE */
  tier: UserTier | undefined;
  /** True while `useUserTier` fetch is in-flight. When true, arrows render
   *  in a neutral disabled placeholder (no lock icon, no chevron) to avoid
   *  briefly showing locked arrows to actual subscribers (audit Scenario H). */
  isTierLoading?: boolean;
  /** Fires when navigation is allowed and user picks a new date */
  onChange: (nextIso: string) => void;
  /** Fires when a FREE user clicks any nav control — parent opens upgrade modal */
  onLockedAttempt?: () => void;
  /** Disables both arrows while fortune fetch is in-flight */
  isLoading?: boolean;
}

const ISO_FMT = 'yyyy-MM-dd';

function parseIso(iso: string): Date | null {
  const d = parse(iso, ISO_FMT, new Date());
  return isValid(d) ? d : null;
}

/** Format YYYY-MM-DD → 「2026年5月18日 週六」 in zh-TW. */
function formatChinese(iso: string): string {
  const d = parseIso(iso);
  if (!d) return iso;
  const weekdays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
}

export default function DateNavigator({
  value,
  todayBaziIso,
  tier,
  isTierLoading = false,
  onChange,
  onLockedAttempt,
  isLoading = false,
}: DateNavigatorProps) {
  const [isPickerOpen, setIsPickerOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Audit Scenario H fix: while tier is still resolving, render arrows in a
  // neutral disabled placeholder state — no lock icon, no chevron — so
  // subscribers don't briefly see locked arrows during the ~100ms tier fetch.
  // Once tier resolves, transition cleanly to either Lock (FREE) or Chevron
  // (subscriber). For subscribers this is placeholder → chevron (invisible);
  // for free users it's placeholder → lock (one transition, no false promise).
  const isFree = !isTierLoading && (tier === undefined || tier === 'FREE');

  // Compute prev/next eligibility for subscribers
  const prevIso = addDaysIso(value, -1);
  const nextIso = addDaysIso(value, 1);
  const canGoPrev =
    !isTierLoading && !isFree && isDateInSubscriberWindow(prevIso, todayBaziIso, tier);
  const canGoNext =
    !isTierLoading && !isFree && isDateInSubscriberWindow(nextIso, todayBaziIso, tier);

  // Close picker on outside click
  React.useEffect(() => {
    if (!isPickerOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsPickerOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsPickerOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isPickerOpen]);

  const handlePrev = () => {
    if (isTierLoading) return; // placeholder state — no interaction
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
      return;
    }
    setIsPickerOpen((open) => !open);
  };

  const handlePickerChange = (date: Date | null) => {
    setIsPickerOpen(false);
    if (!date || !isValid(date)) return;
    const iso = format(date, ISO_FMT);
    if (!isDateInSubscriberWindow(iso, todayBaziIso, tier)) return;
    if (iso === value) return;
    onChange(iso);
  };

  const minDate = parseIso(addDaysIso(todayBaziIso, -SUBSCRIBER_WINDOW_PAST));
  const maxDate = parseIso(addDaysIso(todayBaziIso, SUBSCRIBER_WINDOW_FUTURE));
  const selectedDate = parseIso(value);

  // Offset from today indicator («今日»/«明日»/«昨日»/«+N 天»)
  const offset = diffDaysIso(value, todayBaziIso);
  let offsetBadge: string | null = null;
  if (offset === 0) offsetBadge = '今日';
  else if (offset === 1) offsetBadge = '明日';
  else if (offset === -1) offsetBadge = '昨日';
  else if (offset > 0) offsetBadge = `+${offset} 天`;
  else offsetBadge = `${offset} 天`;

  // Arrow icon selection: placeholder during tier load, Lock for FREE, Chevron for subscribers
  const prevIcon = isTierLoading ? (
    <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
  ) : isFree ? (
    <Lock size={14} strokeWidth={2} aria-hidden="true" />
  ) : (
    <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
  );
  const nextIcon = isTierLoading ? (
    <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
  ) : isFree ? (
    <Lock size={14} strokeWidth={2} aria-hidden="true" />
  ) : (
    <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
  );

  // data-state drives styling: 'loading' → neutral placeholder; 'locked' → lock UI;
  // 'free' (omitted) → normal interactive
  const arrowState = isTierLoading ? 'loading' : isFree ? 'locked' : 'active';

  return (
    <div
      ref={containerRef}
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
        aria-label="前一天"
        data-state={arrowState}
      >
        {prevIcon}
      </button>

      <button
        type="button"
        className={styles.dateLabel}
        onClick={handleLabelClick}
        aria-haspopup="dialog"
        aria-expanded={isPickerOpen}
        disabled={isTierLoading}
        data-state={arrowState}
      >
        <Calendar size={14} strokeWidth={2} aria-hidden="true" className={styles.calIcon} />
        <span className={styles.dateText}>{formatChinese(value)}</span>
        {offsetBadge && <span className={styles.offsetBadge}>{offsetBadge}</span>}
      </button>

      <button
        type="button"
        className={styles.arrow}
        onClick={handleNext}
        disabled={isTierLoading || (!isFree && (!canGoNext || isLoading))}
        aria-disabled={isTierLoading || (!isFree && !canGoNext)}
        aria-label="後一天"
        data-state={arrowState}
      >
        {nextIcon}
      </button>

      {isPickerOpen && !isFree && !isTierLoading && (
        <div className={styles.pickerWrapper}>
          <DatePicker
            selected={selectedDate}
            onChange={handlePickerChange}
            dateFormat={ISO_FMT}
            locale="zh-TW"
            minDate={minDate ?? undefined}
            maxDate={maxDate ?? undefined}
            inline
            showPopperArrow={false}
          />
        </div>
      )}
    </div>
  );
}
