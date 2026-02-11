"use client";

import { useState } from "react";
import {
  CITIES,
  TIMEZONES,
  REGIONS,
  getTimezoneForCity,
  type TimezoneEntry,
  type CityRegion,
} from "@repo/shared";
import styles from "./BirthDataForm.module.css";

export interface BirthDataFormValues {
  name: string;
  gender: "male" | "female";
  birthDate: string;
  birthTime: string;
  birthCity: string;
  birthTimezone: string;
}

interface BirthDataFormProps {
  onSubmit: (data: BirthDataFormValues) => void;
  isLoading?: boolean;
  error?: string;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  children?: React.ReactNode;
}

/** Group items by region, returning only non-empty groups in market-priority order */
function groupByRegion<T extends { region: CityRegion }>(items: T[]) {
  return REGIONS
    .map((r) => ({ region: r, items: items.filter((i) => i.region === r.key) }))
    .filter((g) => g.items.length > 0);
}

export default function BirthDataForm({
  onSubmit,
  isLoading = false,
  error,
  title = "輸入出生資料",
  subtitle = "請填寫準確的出生時間以獲得最精確的分析",
  submitLabel = "開始排盤",
  children,
}: BirthDataFormProps) {
  const [form, setForm] = useState<BirthDataFormValues>({
    name: "",
    gender: "male",
    birthDate: "",
    birthTime: "",
    birthCity: "台北市",
    birthTimezone: "Asia/Taipei",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  const updateField = <K extends keyof BirthDataFormValues>(
    key: K,
    value: BirthDataFormValues[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleCityChange = (cityName: string) => {
    const tz = getTimezoneForCity(cityName);
    setForm((prev) => ({
      ...prev,
      birthCity: cityName,
      // Only auto-set timezone if the city exactly matches a known entry;
      // otherwise preserve the user's current timezone selection
      ...(tz ? { birthTimezone: tz } : {}),
    }));
  };

  const isValid =
    form.name.trim() !== "" &&
    form.birthDate !== "" &&
    form.birthTime !== "" &&
    form.birthCity.trim() !== "";

  const tzGroups = groupByRegion<TimezoneEntry>(TIMEZONES);

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
            onChange={(e) => handleCityChange(e.target.value)}
          />
          <datalist id="cities">
            {CITIES.map((city) => (
              <option key={city.name} value={city.name} />
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
            {tzGroups.map((group) => (
              <optgroup key={group.region.key} label={group.region.labelZhTw}>
                {group.items.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </optgroup>
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
