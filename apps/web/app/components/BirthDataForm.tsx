"use client";

import { useState, useRef, useEffect } from "react";
import {
  CITIES,
  TIMEZONES,
  REGIONS,
  getTimezoneForCity,
  getRegionForCity,
  type TimezoneEntry,
  type CityRegion,
} from "@repo/shared";
import type { BirthProfile } from "../lib/birth-profiles-api";
import styles from "./BirthDataForm.module.css";

export interface BirthDataFormValues {
  name: string;
  gender: "male" | "female";
  birthDate: string;
  birthTime: string;
  birthCity: string;
  birthTimezone: string;
}

const RELATIONSHIP_TAGS = [
  { value: "SELF", label: "本人" },
  { value: "FAMILY", label: "家人" },
  { value: "FRIEND", label: "朋友" },
];

const TAG_LABEL_MAP: Record<string, string> = { SELF: "本人", FAMILY: "家人", FRIEND: "朋友" };

function formatProfileOption(p: BirthProfile): string {
  return `${p.name} (${TAG_LABEL_MAP[p.relationshipTag] || ""})`;
}

export interface SaveProfileIntent {
  relationshipTag: string;
  existingProfileId?: string;
}

/** Group items by region, returning only non-empty groups in market-priority order */
function groupByRegion<T extends { region: CityRegion }>(items: T[]) {
  return REGIONS
    .map((r) => ({ region: r, items: items.filter((i) => i.region === r.key) }))
    .filter((g) => g.items.length > 0);
}

interface BirthDataFormProps {
  onSubmit: (data: BirthDataFormValues, profileId: string | null, saveIntent?: SaveProfileIntent) => void;
  onSecondarySubmit?: (data: BirthDataFormValues, profileId: string | null) => void;
  secondaryLabel?: React.ReactNode;
  isLoading?: boolean;
  error?: string;
  title?: string;
  subtitle?: string;
  submitLabel?: React.ReactNode;
  children?: React.ReactNode;
  afterSubmit?: React.ReactNode;
  initialValues?: Partial<BirthDataFormValues>;
  showSaveOption?: boolean;
  onSaveProfile?: (data: BirthDataFormValues, relationshipTag: string, existingProfileId?: string) => void;
  savedProfiles?: BirthProfile[];
}

/** Get number of days in a given month (handles leap years) */
function getDaysInMonth(year: string, month: string): number {
  if (!year || !month) return 31;
  return new Date(parseInt(year), parseInt(month), 0).getDate();
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 1920 + 1 }, (_, i) => CURRENT_YEAR - i);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
const HOUR_12_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1); // 1-12
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i);

/** Convert 24-hour string (e.g. "14") to 12-hour + period */
function to12Hour(hour24: string): { hour12: string; period: "AM" | "PM" } {
  if (hour24 === "") return { hour12: "", period: "AM" };
  const h = parseInt(hour24);
  if (h === 0) return { hour12: "12", period: "AM" };
  if (h < 12) return { hour12: String(h), period: "AM" };
  if (h === 12) return { hour12: "12", period: "PM" };
  return { hour12: String(h - 12), period: "PM" };
}

/** Convert 12-hour + period to 24-hour zero-padded string */
function to24Hour(hour12: string, period: "AM" | "PM"): string {
  if (hour12 === "") return "";
  const h = parseInt(hour12);
  if (period === "AM") {
    return String(h === 12 ? 0 : h).padStart(2, "0");
  }
  return String(h === 12 ? 12 : h + 12).padStart(2, "0");
}

export default function BirthDataForm({
  onSubmit,
  onSecondarySubmit,
  secondaryLabel,
  isLoading = false,
  error,
  title = "輸入出生資料",
  subtitle = "請填寫準確的出生時間以獲得最精確的分析",
  submitLabel = "開始排盤",
  children,
  afterSubmit,
  initialValues,
  showSaveOption = false,
  onSaveProfile,
  savedProfiles,
}: BirthDataFormProps) {
  const [form, setForm] = useState<BirthDataFormValues>({
    name: initialValues?.name ?? "",
    gender: initialValues?.gender ?? "male",
    birthDate: initialValues?.birthDate ?? "",
    birthTime: initialValues?.birthTime ?? "",
    birthCity: initialValues?.birthCity ?? "台北市",
    birthTimezone: initialValues?.birthTimezone ?? "Asia/Taipei",
  });

  // Date/time split into individual dropdown states
  const [birthYear, setBirthYear] = useState(() => initialValues?.birthDate?.substring(0, 4) ?? "");
  const [birthMonth, setBirthMonth] = useState(() => initialValues?.birthDate?.substring(5, 7) ?? "");
  const [birthDay, setBirthDay] = useState(() => initialValues?.birthDate?.substring(8, 10) ?? "");
  const [birthHour, setBirthHour] = useState(() => {
    const h24 = initialValues?.birthTime?.substring(0, 2) ?? "";
    return h24 ? to12Hour(h24).hour12 : "";
  });
  const [birthPeriod, setBirthPeriod] = useState<"AM" | "PM">(() => {
    const h24 = initialValues?.birthTime?.substring(0, 2) ?? "";
    return h24 ? to12Hour(h24).period : "AM";
  });
  const [birthMinute, setBirthMinute] = useState(() => initialValues?.birthTime?.substring(3, 5) ?? "");

  const [selectedRegion, setSelectedRegion] = useState<CityRegion>(
    () => getRegionForCity(initialValues?.birthCity ?? "台北市") ?? "taiwan"
  );

  const [wantsSave, setWantsSave] = useState(showSaveOption);
  const [relationshipTag, setRelationshipTag] = useState("SELF");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync date/time dropdowns → form.birthDate / form.birthTime
  useEffect(() => {
    if (birthYear && birthMonth && birthDay) {
      setForm((prev) => ({
        ...prev,
        birthDate: `${birthYear}-${birthMonth}-${birthDay}`,
      }));
    } else {
      setForm((prev) => ({ ...prev, birthDate: "" }));
    }
  }, [birthYear, birthMonth, birthDay]);

  useEffect(() => {
    if (birthHour !== "" && birthMinute !== "") {
      const h24 = to24Hour(birthHour, birthPeriod);
      setForm((prev) => ({
        ...prev,
        birthTime: `${h24}:${birthMinute}`,
      }));
    } else {
      setForm((prev) => ({ ...prev, birthTime: "" }));
    }
  }, [birthHour, birthMinute, birthPeriod]);

  // Clamp day when month/year changes (e.g., Jan 31 → Feb → clamp to 28/29)
  useEffect(() => {
    if (birthDay) {
      const maxDays = getDaysInMonth(birthYear, birthMonth);
      if (parseInt(birthDay) > maxDays) {
        setBirthDay(String(maxDays).padStart(2, "0"));
      }
    }
  }, [birthYear, birthMonth, birthDay]);

  // Sync region when initialValues changes (e.g. parent re-renders with new profile)
  useEffect(() => {
    if (initialValues?.birthCity) {
      const region = getRegionForCity(initialValues.birthCity);
      if (region) setSelectedRegion(region);
    }
  }, [initialValues?.birthCity]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const saveIntent: SaveProfileIntent | undefined =
      wantsSave
        ? { relationshipTag, existingProfileId: selectedProfileId || undefined }
        : undefined;
    onSubmit(form, selectedProfileId, saveIntent);
  };

  const handleSecondaryClick = () => {
    if (onSecondarySubmit && isValid) {
      onSecondarySubmit(form, selectedProfileId);
    }
  };

  const updateField = <K extends keyof BirthDataFormValues>(
    key: K,
    value: BirthDataFormValues[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const filteredCities = CITIES.filter((c) => c.region === selectedRegion);

  const handleRegionChange = (region: CityRegion) => {
    if (region === selectedRegion) return;
    setSelectedRegion(region);
    const citiesInRegion = CITIES.filter((c) => c.region === region);
    const firstCity = citiesInRegion[0];
    if (firstCity) {
      handleCityChange(firstCity.name);
    }
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

  const selectProfile = (profile: BirthProfile) => {
    const dateStr = profile.birthDate.substring(0, 10);
    const timeStr = profile.birthTime;
    setForm({
      name: profile.name,
      gender: profile.gender === "MALE" ? "male" : "female",
      birthDate: dateStr,
      birthTime: timeStr,
      birthCity: profile.birthCity,
      birthTimezone: profile.birthTimezone,
    });
    // Sync date/time dropdowns from profile
    setBirthYear(dateStr.substring(0, 4));
    setBirthMonth(dateStr.substring(5, 7));
    setBirthDay(dateStr.substring(8, 10));
    const { hour12, period } = to12Hour(timeStr.substring(0, 2));
    setBirthHour(hour12);
    setBirthPeriod(period);
    setBirthMinute(timeStr.substring(3, 5));
    setSelectedRegion(getRegionForCity(profile.birthCity) ?? "taiwan");
    setSelectedProfileId(profile.id);
    setRelationshipTag(profile.relationshipTag);
    setShowDropdown(false);
  };

  const handleNameChange = (inputValue: string) => {
    // Show dropdown while typing if there are profiles
    if (savedProfiles?.length) {
      setShowDropdown(true);
    }
    // User is typing a new name — no longer an existing profile
    if (selectedProfileId) {
      setSelectedProfileId(null);
    }
    updateField("name", inputValue);
  };

  const dayCount = getDaysInMonth(birthYear, birthMonth);
  const dayOptions = Array.from({ length: dayCount }, (_, i) => i + 1);

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
      <div className={styles.fieldGroup} ref={dropdownRef}>
        <label className={styles.label}>稱呼</label>
        <div className={styles.nameInputWrapper}>
          <input
            className={styles.input}
            type="text"
            placeholder={
              savedProfiles?.length
                ? "輸入稱呼或選擇已儲存的資料"
                : "請輸入稱呼"
            }
            value={form.name}
            onChange={(e) => handleNameChange(e.target.value)}
            onFocus={() => savedProfiles?.length && setShowDropdown(true)}
            maxLength={20}
            autoComplete="off"
          />
          {savedProfiles?.length ? (
            <button
              type="button"
              className={styles.dropdownToggle}
              onClick={() => setShowDropdown((prev) => !prev)}
              tabIndex={-1}
              aria-label="展開已儲存的資料"
            >
              ▾
            </button>
          ) : null}
        </div>
        {showDropdown && savedProfiles?.length ? (
          <ul className={styles.profileDropdown}>
            {savedProfiles
              .filter(
                (p) =>
                  !form.name ||
                  p.name.toLowerCase().includes(form.name.toLowerCase()),
              )
              .map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={styles.profileDropdownItem}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectProfile(p);
                    }}
                  >
                    <span className={styles.profileDropdownName}>{p.name}</span>
                    <span className={`${styles.profileDropdownTag} ${styles[`tag${p.relationshipTag}`] || ""}`}>
                      {TAG_LABEL_MAP[p.relationshipTag] || ""}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        ) : null}
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

      {/* Date & Time — industry standard Year/Month/Day + Hour/Minute dropdowns */}
      <div className={styles.dateTimeGroup}>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>出生日期</label>
          <div className={styles.dateRow}>
            <select
              className={styles.dateSelect}
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              aria-label="年"
            >
              <option value="">年</option>
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
            <select
              className={styles.dateSelect}
              value={birthMonth}
              onChange={(e) => setBirthMonth(e.target.value)}
              aria-label="月"
            >
              <option value="">月</option>
              {MONTH_OPTIONS.map((m) => (
                <option key={m} value={String(m).padStart(2, "0")}>{m}</option>
              ))}
            </select>
            <select
              className={styles.dateSelect}
              value={birthDay}
              onChange={(e) => setBirthDay(e.target.value)}
              aria-label="日"
            >
              <option value="">日</option>
              {dayOptions.map((d) => (
                <option key={d} value={String(d).padStart(2, "0")}>{d}</option>
              ))}
            </select>
          </div>
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>出生時間</label>
          <div className={styles.timeRow}>
            <select
              className={styles.dateSelect}
              value={birthHour}
              onChange={(e) => setBirthHour(e.target.value)}
              aria-label="時"
            >
              <option value="">時</option>
              {HOUR_12_OPTIONS.map((h) => (
                <option key={h} value={String(h)}>{h}</option>
              ))}
            </select>
            <select
              className={styles.dateSelect}
              value={birthMinute}
              onChange={(e) => setBirthMinute(e.target.value)}
              aria-label="分"
            >
              <option value="">分</option>
              {MINUTE_OPTIONS.map((m) => (
                <option key={m} value={String(m).padStart(2, "0")}>{String(m).padStart(2, "0")}</option>
              ))}
            </select>
            <select
              className={styles.dateSelect}
              value={birthPeriod}
              onChange={(e) => setBirthPeriod(e.target.value as "AM" | "PM")}
              aria-label="午別"
            >
              <option value="AM">上午</option>
              <option value="PM">下午</option>
            </select>
          </div>
        </div>
      </div>

      {/* Region, City & Timezone */}
      <div className={styles.regionCityRow}>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>地區</label>
          <select
            className={styles.select}
            value={selectedRegion}
            onChange={(e) => handleRegionChange(e.target.value as CityRegion)}
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
            value={form.birthCity}
            onChange={(e) => handleCityChange(e.target.value)}
          >
            {filteredCities.map((city) => (
              <option key={city.name} value={city.name}>{city.name}</option>
            ))}
            {/* Fallback for unlisted cities (saved profiles, initialValues) */}
            {form.birthCity && !filteredCities.some((c) => c.name === form.birthCity) && (
              <option value={form.birthCity}>{form.birthCity}</option>
            )}
          </select>
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

      {/* Save Profile Option */}
      {showSaveOption && (
        <div className={styles.saveProfileGroup}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={wantsSave}
              onChange={(e) => setWantsSave(e.target.checked)}
              className={styles.checkbox}
            />
            儲存此資料以便下次使用
          </label>
          {wantsSave && (
            <div className={styles.tagRow}>
              <label className={styles.label}>關係</label>
              <div className={styles.tagGroup}>
                {RELATIONSHIP_TAGS.map((tag) => (
                  <button
                    key={tag.value}
                    type="button"
                    className={
                      relationshipTag === tag.value
                        ? styles.tagOptionActive
                        : styles.tagOption
                    }
                    onClick={() => setRelationshipTag(tag.value)}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
      {onSecondarySubmit && secondaryLabel && (
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={handleSecondaryClick}
          disabled={!isValid || isLoading}
        >
          {secondaryLabel}
        </button>
      )}
      {afterSubmit}
    </form>
  );
}
