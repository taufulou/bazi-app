"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import styles from "./BirthDataForm.module.css";
import {
  trackFormStarted,
  trackFormFieldFilled,
  trackFormSubmitted,
  trackFormAbandoned,
} from "../lib/analytics";

// Common timezones for target markets
const TIMEZONES = [
  { value: "Asia/Taipei", label: "台灣 (UTC+8)" },
  { value: "Asia/Hong_Kong", label: "香港 (UTC+8)" },
  { value: "Asia/Kuala_Lumpur", label: "馬來西亞 (UTC+8)" },
  { value: "Asia/Singapore", label: "新加坡 (UTC+8)" },
  { value: "Asia/Shanghai", label: "中國 (UTC+8)" },
  { value: "Asia/Tokyo", label: "日本 (UTC+9)" },
  { value: "Asia/Seoul", label: "韓國 (UTC+9)" },
  { value: "America/New_York", label: "美東 (UTC-5)" },
  { value: "America/Los_Angeles", label: "美西 (UTC-8)" },
  { value: "Europe/London", label: "倫敦 (UTC+0)" },
];

// Common birth cities
const CITIES = [
  "台北市", "台中市", "高雄市", "台南市", "新北市", "桃園市",
  "香港", "九龍", "新界",
  "吉隆坡", "檳城", "新山",
  "北京", "上海", "廣州", "深圳",
  "新加坡",
];

export interface BirthDataFormValues {
  name: string;
  gender: "male" | "female";
  birthDate: string;
  birthTime: string;
  birthCity: string;
  birthTimezone: string;
}

// Initial/default form values — used for state init and to detect real user changes
const INITIAL_VALUES: BirthDataFormValues = {
  name: "",
  gender: "male",
  birthDate: "",
  birthTime: "",
  birthCity: "台北市",
  birthTimezone: "Asia/Taipei",
};

interface BirthDataFormProps {
  onSubmit: (data: BirthDataFormValues) => void;
  isLoading?: boolean;
  error?: string;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  readingType?: string;
  children?: React.ReactNode;
}

export default function BirthDataForm({
  onSubmit,
  isLoading = false,
  error,
  title = "輸入出生資料",
  subtitle = "請填寫準確的出生時間以獲得最精確的分析",
  submitLabel = "開始排盤",
  readingType = "unknown",
  children,
}: BirthDataFormProps) {
  const [form, setForm] = useState<BirthDataFormValues>({ ...INITIAL_VALUES });

  // Analytics: track which fields have been filled and when form was started
  const formStartTime = useRef<number>(0);
  const filledFields = useRef<Set<string>>(new Set());
  const hasTrackedStart = useRef(false);
  const hasSubmitted = useRef(false);
  const readingTypeRef = useRef(readingType);

  // Keep ref in sync so cleanup always has the latest readingType
  useEffect(() => {
    readingTypeRef.current = readingType;
  }, [readingType]);

  // Reset tracking state when readingType changes (e.g., client-side navigation)
  useEffect(() => {
    hasTrackedStart.current = false;
    hasSubmitted.current = false;
    filledFields.current = new Set();
    formStartTime.current = 0;
  }, [readingType]);

  // Track form_started on first interaction
  const trackStartOnce = useCallback(() => {
    if (!hasTrackedStart.current) {
      hasTrackedStart.current = true;
      formStartTime.current = Date.now();
      trackFormStarted({ readingType });
    }
  }, [readingType]);

  // Track form abandonment on unmount (if started but not submitted)
  useEffect(() => {
    return () => {
      if (hasTrackedStart.current && !hasSubmitted.current) {
        trackFormAbandoned({
          readingType: readingTypeRef.current,
          filledFields: Array.from(filledFields.current),
          timeSpentMs: Date.now() - formStartTime.current,
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    hasSubmitted.current = true;
    trackFormSubmitted({
      readingType,
      gender: form.gender,
      birthCity: form.birthCity,
      timezone: form.birthTimezone,
    });
    onSubmit(form);
  };

  const updateField = <K extends keyof BirthDataFormValues>(
    key: K,
    value: BirthDataFormValues[K],
  ) => {
    trackStartOnce();
    // Only track field_filled when user changes a field from its initial/default value
    if (!filledFields.current.has(key) && value !== INITIAL_VALUES[key]) {
      filledFields.current.add(key);
      trackFormFieldFilled({ readingType, fieldName: key });
    }
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const isValid =
    form.name.trim() !== "" &&
    form.birthDate !== "" &&
    form.birthTime !== "" &&
    form.birthCity.trim() !== "";

  return (
    <form className={styles.formWrapper} onSubmit={handleSubmit}>
      <h2 className={styles.formTitle}>{title}</h2>
      <p className={styles.formSubtitle}>{subtitle}</p>

      {/* Name */}
      <div className={styles.fieldGroup}>
        <label className={styles.label}>稱呼</label>
        <input
          className={styles.input}
          type="text"
          placeholder="請輸入稱呼"
          value={form.name}
          onChange={(e) => updateField("name", e.target.value)}
          maxLength={20}
        />
      </div>

      {/* Gender */}
      <div className={styles.fieldGroup}>
        <label className={styles.label}>性別</label>
        <div className={styles.genderGroup}>
          <button
            type="button"
            className={
              form.gender === "male"
                ? styles.genderOptionActive
                : styles.genderOption
            }
            onClick={() => updateField("gender", "male")}
          >
            ♂ 男
          </button>
          <button
            type="button"
            className={
              form.gender === "female"
                ? styles.genderOptionActive
                : styles.genderOption
            }
            onClick={() => updateField("gender", "female")}
          >
            ♀ 女
          </button>
        </div>
      </div>

      {/* Date & Time */}
      <div className={styles.row}>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>出生日期</label>
          <input
            className={styles.input}
            type="date"
            value={form.birthDate}
            onChange={(e) => updateField("birthDate", e.target.value)}
            max={new Date().toISOString().split("T")[0]}
            min="1920-01-01"
          />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>出生時間</label>
          <input
            className={styles.input}
            type="time"
            value={form.birthTime}
            onChange={(e) => updateField("birthTime", e.target.value)}
          />
        </div>
      </div>

      {/* City & Timezone */}
      <div className={styles.row}>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>出生城市</label>
          <input
            className={styles.input}
            type="text"
            list="cities"
            placeholder="輸入或選擇城市"
            value={form.birthCity}
            onChange={(e) => updateField("birthCity", e.target.value)}
          />
          <datalist id="cities">
            {CITIES.map((city) => (
              <option key={city} value={city} />
            ))}
          </datalist>
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>時區</label>
          <select
            className={styles.select}
            value={form.birthTimezone}
            onChange={(e) => updateField("birthTimezone", e.target.value)}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Extra inputs injected by parent (e.g., monthly/daily/Q&A pickers) */}
      {children}

      {error && <p className={styles.error}>{error}</p>}

      <button
        type="submit"
        className={styles.submitBtn}
        disabled={!isValid || isLoading}
      >
        {isLoading ? "排盤中..." : submitLabel}
      </button>
    </form>
  );
}
