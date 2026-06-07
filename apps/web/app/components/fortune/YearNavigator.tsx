'use client';

/**
 * YearNavigator — Phase 3 年運 year switcher.
 *
 * Phase 3.1: prev/next ARROWS REMOVED + react-datepicker YEAR-picker ADDED
 * (it previously had no picker — the center label was a no-op). Each arrow
 * click used to fire a fresh AI generation (real Anthropic cost, no debounce).
 * Now the date chip is the SOLE interaction — clicking it opens a year picker;
 * a chevron-down ▾ + «點擊選擇年份» hint signal it. Picker selection = ONE fetch.
 *
 * Subscriber window: -1 year / current / +4 years (matches Seer's 6 pills).
 * Free users' chip click → onLockedAttempt (upgrade modal).
 */
import * as React from 'react';
import DatePicker from 'react-datepicker';
import { isValid } from 'date-fns';
import { ChevronDown, Lock, Calendar } from 'lucide-react';
import '../../lib/date-locale';
import 'react-datepicker/dist/react-datepicker.css';
import {
  isYearInSubscriberWindow,
  SUBSCRIBER_WINDOW_FUTURE_YEAR,
  SUBSCRIBER_WINDOW_PAST_YEAR,
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
  /** True while `useUserTier` fetch is in-flight — neutral placeholder. */
  isTierLoading?: boolean;
  /** Fires when navigation is allowed and user picks a new year */
  onChange: (nextIso: string) => void;
  /** Fires when a FREE user clicks the chip — parent opens upgrade modal */
  onLockedAttempt?: () => void;
  /** Disables the chip while fortune fetch is in-flight */
  isLoading?: boolean;
}

/** YYYY string → Jan-1 Date for react-datepicker (year-picker granularity). */
function parseIsoYear(iso: string): Date | null {
  const y = parseInt(iso, 10);
  if (Number.isNaN(y)) return null;
  return new Date(y, 0, 1);
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
  const [isPickerOpen, setIsPickerOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const isFree = !isTierLoading && (tier === undefined || tier === 'FREE');

  // Close picker on outside click + Escape
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

  const handleLabelClick = () => {
    if (isTierLoading || isLoading) return;
    if (isFree) {
      onLockedAttempt?.();
      return;
    }
    setIsPickerOpen((open) => !open);
  };

  const handlePickerChange = (date: Date | null) => {
    setIsPickerOpen(false);
    if (!date || !isValid(date)) return;
    const iso = String(date.getFullYear());
    if (!isYearInSubscriberWindow(iso, currentYearIso, tier)) return;
    if (iso === value) return;
    onChange(iso);
  };

  const curYear = parseInt(currentYearIso, 10);
  const minDate = Number.isNaN(curYear)
    ? undefined
    : new Date(curYear - SUBSCRIBER_WINDOW_PAST_YEAR, 0, 1);
  const maxDate = Number.isNaN(curYear)
    ? undefined
    : new Date(curYear + SUBSCRIBER_WINDOW_FUTURE_YEAR, 0, 1);
  const selectedDate = parseIsoYear(value);

  // Offset from current year indicator («今年»/«明年»/«去年»/«+N 年»)
  const offset = diffYears(value, currentYearIso);
  let offsetBadge: string;
  if (offset === 0) offsetBadge = '今年';
  else if (offset === 1) offsetBadge = '明年';
  else if (offset === -1) offsetBadge = '去年';
  else if (offset > 0) offsetBadge = `+${offset} 年`;
  else offsetBadge = `${offset} 年`;

  const labelState = isTierLoading ? 'loading' : isFree ? 'locked' : 'active';
  const hint = isFree ? '訂閱後可選擇其他年份' : '點擊選擇年份';

  return (
    <div
      ref={containerRef}
      className={styles.container}
      data-locked={isFree ? 'true' : 'false'}
      data-state={labelState}
    >
      <button
        type="button"
        className={styles.dateLabel}
        onClick={handleLabelClick}
        aria-haspopup="dialog"
        aria-expanded={isPickerOpen}
        disabled={isTierLoading}
        data-state={labelState}
      >
        <Calendar
          size={14}
          strokeWidth={2}
          aria-hidden="true"
          className={styles.calIcon}
        />
        <span className={styles.dateText}>{value}年</span>
        <span className={styles.offsetBadge}>{offsetBadge}</span>
        {isFree && !isTierLoading ? (
          <Lock size={13} strokeWidth={2} aria-hidden="true" className={styles.chevron} />
        ) : (
          <ChevronDown
            size={14}
            strokeWidth={2.5}
            aria-hidden="true"
            className={styles.chevron}
            data-open={isPickerOpen ? 'true' : 'false'}
          />
        )}
      </button>

      {!isTierLoading && <span className={styles.hint}>{hint}</span>}

      {isPickerOpen && !isFree && !isTierLoading && (
        <div className={styles.pickerWrapper}>
          <DatePicker
            selected={selectedDate}
            onChange={handlePickerChange}
            dateFormat="yyyy"
            locale="zh-TW"
            minDate={minDate}
            maxDate={maxDate}
            inline
            showPopperArrow={false}
            showYearPicker
          />
        </div>
      )}
    </div>
  );
}
