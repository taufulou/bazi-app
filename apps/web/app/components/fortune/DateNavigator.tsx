'use client';

/**
 * DateNavigator — tappable date chip opening a react-datepicker popover.
 *
 * Phase 3.1: prev/next ARROWS REMOVED. Each arrow click used to fire a fresh
 * AI generation (real Anthropic cost, no debounce); users who didn't realize
 * the chip was clickable hammered arrows. Now the date chip is the SOLE
 * interaction — a chevron-down ▾ + «點擊選擇日期» hint signal it opens a picker.
 * Picker selection fires exactly ONE deliberate fetch.
 *
 * Subscriber-aware: subscribers browse the [-1, +30] day window; free users'
 * chip click fires `onLockedAttempt` (upgrade modal).
 *
 * "Today" must be derived from `resolveBaziToday()` (23:00 子時 boundary) and
 * passed in as `todayBaziIso`.
 */
import * as React from 'react';
import DatePicker from 'react-datepicker';
import { parse, format, isValid } from 'date-fns';
import { ChevronDown, Lock, Calendar } from 'lucide-react';
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
  /** True while `useUserTier` fetch is in-flight — neutral placeholder. */
  isTierLoading?: boolean;
  /** Fires when navigation is allowed and user picks a new date */
  onChange: (nextIso: string) => void;
  /** Fires when a FREE user clicks the chip — parent opens upgrade modal */
  onLockedAttempt?: () => void;
  /** Disables the chip while fortune fetch is in-flight */
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

  const labelState = isTierLoading ? 'loading' : isFree ? 'locked' : 'active';
  const hint = isFree ? '訂閱後可選擇其他日期' : '點擊選擇日期';

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
        <Calendar size={14} strokeWidth={2} aria-hidden="true" className={styles.calIcon} />
        <span className={styles.dateText}>{formatChinese(value)}</span>
        {offsetBadge && <span className={styles.offsetBadge}>{offsetBadge}</span>}
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
