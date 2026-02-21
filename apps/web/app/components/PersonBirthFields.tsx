"use client";

import { useEffect } from "react";
import {
  CITIES,
  TIMEZONES,
  REGIONS,
  getTimezoneForCity,
  getRegionForCity,
  type TimezoneEntry,
  type CityRegion,
} from "@repo/shared";
import {
  lunarToSolar,
  getLunarDaysInMonth,
  getLeapMonthInYear,
} from "../lib/lunar-utils";
import {
  getDaysInMonth,
  YEAR_OPTIONS,
  MONTH_OPTIONS,
  HOUR_12_OPTIONS,
  MINUTE_OPTIONS,
  type PersonFieldValues,
} from "../lib/date-time-utils";
import styles from "./PersonBirthFields.module.css";

// ============================================================
// Props
// ============================================================

interface PersonBirthFieldsProps {
  value: PersonFieldValues;
  onChange: (field: keyof PersonFieldValues, val: string | boolean) => void;
  label: string; // "本人" or "對方"
  disabled?: boolean;
}

/** Group items by region for timezone/city dropdowns */
function groupByRegion<T extends { region: CityRegion }>(items: T[]) {
  return REGIONS
    .map((r) => ({ region: r, items: items.filter((i) => i.region === r.key) }))
    .filter((g) => g.items.length > 0);
}

// ============================================================
// Component
// ============================================================

export default function PersonBirthFields({
  value,
  onChange,
  label,
  disabled = false,
}: PersonBirthFieldsProps) {
  const selectedRegion = (value.regionCode || "taiwan") as CityRegion;
  const filteredCities = CITIES.filter((c) => c.region === selectedRegion);
  const isLunar = value.calendarType === "lunar";

  // Clamp day when month/year changes
  useEffect(() => {
    if (value.day && value.year && value.month) {
      const maxDays = isLunar
        ? getLunarDaysInMonth(parseInt(value.year), parseInt(value.month), value.isLeapMonth)
        : getDaysInMonth(value.year, value.month);
      if (parseInt(value.day) > maxDays) {
        onChange("day", String(maxDays));
      }
    }
  }, [value.year, value.month, isLunar, value.isLeapMonth]);

  // Auto-reset leap month when year/month changes and leap month no longer applies
  useEffect(() => {
    if (!isLunar) return;
    const y = parseInt(value.year);
    const m = parseInt(value.month);
    if (!y || !m) return;
    const leapMonth = getLeapMonthInYear(y);
    if (!leapMonth || m !== leapMonth) {
      if (value.isLeapMonth) onChange("isLeapMonth", false);
    }
  }, [value.year, value.month, isLunar]);

  const handleRegionChange = (region: string) => {
    onChange("regionCode", region);
    const citiesInRegion = CITIES.filter((c) => c.region === region);
    const firstCity = citiesInRegion[0];
    if (firstCity) {
      onChange("cityCode", firstCity.name);
      const tz = getTimezoneForCity(firstCity.name);
      if (tz) onChange("timezone", tz);
    }
  };

  const handleCityChange = (cityName: string) => {
    onChange("cityCode", cityName);
    const tz = getTimezoneForCity(cityName);
    if (tz) onChange("timezone", tz);
  };

  const dayCount = isLunar && value.year && value.month
    ? getLunarDaysInMonth(parseInt(value.year), parseInt(value.month), value.isLeapMonth)
    : getDaysInMonth(value.year, value.month);
  const dayOptions = Array.from({ length: dayCount }, (_, i) => i + 1);

  const tzGroups = groupByRegion<TimezoneEntry>(TIMEZONES);

  // Check if this month is a leap month candidate
  const showLeapMonth = isLunar && value.year && value.month && (() => {
    const leapMonth = getLeapMonthInYear(parseInt(value.year));
    return leapMonth && parseInt(value.month) === leapMonth;
  })();

  return (
    <div className={`${styles.fieldsContainer} ${disabled ? styles.disabled : ""}`}>
      <div className={styles.panelLabel}>{label}</div>

      {/* Name */}
      <div className={styles.fieldGroup}>
        <label className={styles.label}>稱呼</label>
        <input
          className={styles.input}
          type="text"
          placeholder="請輸入稱呼"
          value={value.name}
          onChange={(e) => onChange("name", e.target.value)}
          maxLength={20}
          disabled={disabled}
        />
      </div>

      {/* Gender */}
      <div className={styles.fieldGroup}>
        <label className={styles.label}>性別</label>
        <div className={styles.genderGroup}>
          <button
            type="button"
            className={value.gender === "male" ? styles.genderOptionActive : styles.genderOption}
            onClick={() => onChange("gender", "male")}
            disabled={disabled}
          >
            ♂ 男
          </button>
          <button
            type="button"
            className={value.gender === "female" ? styles.genderOptionActive : styles.genderOption}
            onClick={() => onChange("gender", "female")}
            disabled={disabled}
          >
            ♀ 女
          </button>
        </div>
      </div>

      {/* Calendar Type */}
      <div className={styles.fieldGroup}>
        <label className={styles.label}>曆法</label>
        <div className={styles.calendarTypeGroup}>
          <button
            type="button"
            className={!isLunar ? styles.calTypeActive : styles.calType}
            onClick={() => { onChange("calendarType", "solar"); onChange("isLeapMonth", false); }}
            disabled={disabled}
          >
            國曆
          </button>
          <button
            type="button"
            className={isLunar ? styles.calTypeActive : styles.calType}
            onClick={() => onChange("calendarType", "lunar")}
            disabled={disabled}
          >
            農曆
          </button>
        </div>
        {showLeapMonth && (
          <label className={styles.leapMonthLabel}>
            <input
              type="checkbox"
              checked={value.isLeapMonth}
              onChange={(e) => onChange("isLeapMonth", e.target.checked)}
              disabled={disabled}
            />
            閏月
          </label>
        )}
      </div>

      {/* Date */}
      <div className={styles.fieldGroup}>
        <label className={styles.label}>出生日期</label>
        <div className={styles.dateRow}>
          <select
            className={styles.select}
            value={value.year}
            onChange={(e) => onChange("year", e.target.value)}
            disabled={disabled}
            aria-label="年"
          >
            <option value="">年</option>
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
          <select
            className={styles.select}
            value={value.month}
            onChange={(e) => onChange("month", e.target.value)}
            disabled={disabled}
            aria-label="月"
          >
            <option value="">月</option>
            {MONTH_OPTIONS.map((m) => (
              <option key={m} value={String(m)}>{m}</option>
            ))}
          </select>
          <select
            className={styles.select}
            value={value.day}
            onChange={(e) => onChange("day", e.target.value)}
            disabled={disabled}
            aria-label="日"
          >
            <option value="">日</option>
            {dayOptions.map((d) => (
              <option key={d} value={String(d)}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Quick Mode Toggle */}
      <div className={styles.fieldGroup}>
        <label className={styles.quickModeLabel}>
          <input
            type="checkbox"
            checked={value.quickMode}
            onChange={(e) => onChange("quickMode", e.target.checked)}
            disabled={disabled}
          />
          不確定出生時間
        </label>
      </div>

      {/* Time — hidden when quickMode */}
      {!value.quickMode && (
        <div className={styles.fieldGroup}>
          <label className={styles.label}>出生時間</label>
          <div className={styles.timeRow}>
            <select
              className={styles.select}
              value={value.hour}
              onChange={(e) => onChange("hour", e.target.value)}
              disabled={disabled}
              aria-label="時"
            >
              <option value="">時</option>
              {HOUR_12_OPTIONS.map((h) => (
                <option key={h} value={String(h)}>{h}</option>
              ))}
            </select>
            <select
              className={styles.select}
              value={value.minute}
              onChange={(e) => onChange("minute", e.target.value)}
              disabled={disabled}
              aria-label="分"
            >
              <option value="">分</option>
              {MINUTE_OPTIONS.map((m) => (
                <option key={m} value={String(m).padStart(2, "0")}>{String(m).padStart(2, "0")}</option>
              ))}
            </select>
            <select
              className={styles.selectSmall}
              value={value.period}
              onChange={(e) => onChange("period", e.target.value)}
              disabled={disabled}
              aria-label="午別"
            >
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
        </div>
      )}

      {/* Region, City & Timezone — 3-column layout matching BirthDataForm */}
      <div className={styles.regionCityRow}>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>地區</label>
          <select
            className={styles.select}
            value={selectedRegion}
            onChange={(e) => handleRegionChange(e.target.value)}
            disabled={disabled}
          >
            {REGIONS.map((r) => (
              <option key={r.key} value={r.key}>{r.labelZhTw}</option>
            ))}
          </select>
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>出生地</label>
          <select
            className={styles.select}
            value={value.cityCode}
            onChange={(e) => handleCityChange(e.target.value)}
            disabled={disabled}
          >
            <option value="">選擇城市</option>
            {filteredCities.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
            {/* Fallback for unlisted cities (saved profiles) */}
            {value.cityCode && !filteredCities.some((c) => c.name === value.cityCode) && (
              <option value={value.cityCode}>{value.cityCode}</option>
            )}
          </select>
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>時區</label>
          <select
            className={styles.select}
            value={value.timezone}
            onChange={(e) => onChange("timezone", e.target.value)}
            disabled={disabled}
          >
            <option value="">選擇時區</option>
            {tzGroups.map((group) => (
              <optgroup key={group.region.key} label={group.region.labelZhTw}>
                {group.items.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
