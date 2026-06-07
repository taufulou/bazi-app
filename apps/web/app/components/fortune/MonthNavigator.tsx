'use client';

/**
 * MonthNavigator — Phase 2 月運 month switcher.
 *
 * Per plan v4 M3 / locked decision #11: SIBLING component to DateNavigator
 * (NOT mode-prop extension of DateNavigator). Cleaner architecture; -1
 * risky shared-state refactor. ~80% pattern copy with month-mode
 * adjustments.
 *
 * 5 boundary states (per plan v4 L5 / C2):
 *   1. At -1 month: prev arrow disabled («已達訂閱可查最早月份»)
 *   2. At +12 months: next arrow disabled («已達訂閱可查最遠月份»)
 *   3. Out-of-window URL hit: parent renders ErrorPanel (this component
 *      just shows the picker pinned to currentMonthIso for navigation)
 *   4. Profile switch: parent re-anchors to caller's local-TZ current
 *      month (handled at page level via useEffect on profileId)
 *   5. Free user: prev/next/label clicks → onLockedAttempt callback
 *
 * Subscriber window math via fortune-api.ts helpers (addMonthsIso /
 * diffMonthsIso / isMonthInSubscriberWindow). Resolved-current-month
 * computed in Asia/Taipei via resolveCurrentMonthIso.
 *
 * Mount location: inside FortuneShell content area for tab=month,
 * mirrors DateNavigator's mount for tab=day.
 */
import * as React from 'react';
import DatePicker from 'react-datepicker';
import { parse, format, isValid } from 'date-fns';
import { ChevronDown, Lock, Calendar } from 'lucide-react';
import '../../lib/date-locale';
import 'react-datepicker/dist/react-datepicker.css';
import {
  addMonthsIso,
  isMonthInSubscriberWindow,
  SUBSCRIBER_WINDOW_FUTURE_MONTH,
  SUBSCRIBER_WINDOW_PAST_MONTH,
  diffMonthsIso,
  type UserTier,
} from '../../lib/fortune-api';
import styles from './DateNavigator.module.css';

interface MonthNavigatorProps {
  /** Currently displayed month, YYYY-MM */
  value: string;
  /** This month per Asia/Taipei (`resolveCurrentMonthIso()`) — YYYY-MM */
  currentMonthIso: string;
  /** User's subscription tier; `undefined` while loading → treat as FREE */
  tier: UserTier | undefined;
  /** True while `useUserTier` fetch is in-flight. Mirrors DateNavigator
   *  Scenario H placeholder pattern to avoid showing locked arrows to
   *  actual subscribers during the ~100ms tier fetch. */
  isTierLoading?: boolean;
  /** Fires when navigation is allowed and user picks a new month */
  onChange: (nextIso: string) => void;
  /** Fires when a FREE user clicks any nav control — parent opens upgrade modal */
  onLockedAttempt?: () => void;
  /** Disables both arrows while fortune fetch is in-flight */
  isLoading?: boolean;
}

const ISO_MONTH_FMT = 'yyyy-MM';

function parseIsoMonth(iso: string): Date | null {
  // Parse YYYY-MM as 1st-of-month for react-datepicker
  const d = parse(`${iso}-01`, 'yyyy-MM-dd', new Date());
  return isValid(d) ? d : null;
}

/** Format YYYY-MM → 「2026年5月」 in zh-TW. */
function formatChineseMonth(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[1]!)}年${Number(m[2]!)}月`;
}

export default function MonthNavigator({
  value,
  currentMonthIso,
  tier,
  isTierLoading = false,
  onChange,
  onLockedAttempt,
  isLoading = false,
}: MonthNavigatorProps) {
  const [isPickerOpen, setIsPickerOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Mirror DateNavigator Scenario H tier-loading placeholder pattern
  const isFree = !isTierLoading && (tier === undefined || tier === 'FREE');

  // Close picker on outside click + Escape
  React.useEffect(() => {
    if (!isPickerOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
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
    const iso = format(date, ISO_MONTH_FMT);
    if (!isMonthInSubscriberWindow(iso, currentMonthIso, tier)) return;
    if (iso === value) return;
    onChange(iso);
  };

  const minDate = parseIsoMonth(
    addMonthsIso(currentMonthIso, -SUBSCRIBER_WINDOW_PAST_MONTH),
  );
  const maxDate = parseIsoMonth(
    addMonthsIso(currentMonthIso, SUBSCRIBER_WINDOW_FUTURE_MONTH),
  );
  const selectedDate = parseIsoMonth(value);

  // Offset from current month indicator («本月»/«下個月»/«上個月»/«+N 月»)
  const offset = diffMonthsIso(value, currentMonthIso);
  let offsetBadge: string | null = null;
  if (offset === 0) offsetBadge = '本月';
  else if (offset === 1) offsetBadge = '下個月';
  else if (offset === -1) offsetBadge = '上個月';
  else if (offset > 0) offsetBadge = `+${offset} 月`;
  else offsetBadge = `${offset} 月`;

  const labelState = isTierLoading ? 'loading' : isFree ? 'locked' : 'active';
  const hint = isFree ? '訂閱後可選擇其他月份' : '點擊選擇月份';

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
        <span className={styles.dateText}>{formatChineseMonth(value)}</span>
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
            dateFormat={ISO_MONTH_FMT}
            locale="zh-TW"
            minDate={minDate ?? undefined}
            maxDate={maxDate ?? undefined}
            inline
            showPopperArrow={false}
            showMonthYearPicker
          />
        </div>
      )}
    </div>
  );
}
