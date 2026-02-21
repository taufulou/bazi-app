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
import {
  lunarToSolar,
  getLunarDaysInMonth,
  getLeapMonthInYear,
  isValidLunarDate,
} from "../lib/lunar-utils";
import {
  getDaysInMonth,
  to12Hour,
  to24Hour,
  CURRENT_YEAR,
  YEAR_OPTIONS,
  MONTH_OPTIONS,
  HOUR_12_OPTIONS,
  MINUTE_OPTIONS,
} from "../lib/date-time-utils";
import styles from "./BirthDataForm.module.css";

export interface BirthDataFormValues {
  name: string;
  gender: "male" | "female";
  birthDate: string;
  birthTime: string;
  birthCity: string;
  birthTimezone: string;
  isLunarDate: boolean;
  isLeapMonth: boolean;
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
  wantsSave: boolean;
  relationshipTag: string;
  existingProfileId?: string;
  lunarBirthDate?: string;
}

/** Group items by region, returning only non-empty groups in market-priority order */
function groupByRegion<T extends { region: CityRegion }>(items: T[]) {
  return REGIONS
    .map((r) => ({ region: r, items: items.filter((i) => i.region === r.key) }))
    .filter((g) => g.items.length > 0);
}

interface BirthDataFormProps {
  onSubmit: (data: BirthDataFormValues, profileId: string | null, saveIntent?: SaveProfileIntent) => void;
  onSecondarySubmit?: (data: BirthDataFormValues, profileId: string | null, lunarBirthDate?: string) => void;
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
    isLunarDate: initialValues?.isLunarDate ?? false,
    isLeapMonth: initialValues?.isLeapMonth ?? false,
  });

  const [isLunarDate, setIsLunarDate] = useState(initialValues?.isLunarDate ?? false);
  const [isLeapMonth, setIsLeapMonth] = useState(initialValues?.isLeapMonth ?? false);
  const [submitError, setSubmitError] = useState("");

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
    if (birthDay && birthYear && birthMonth) {
      const maxDays = isLunarDate
        ? getLunarDaysInMonth(parseInt(birthYear), parseInt(birthMonth), isLeapMonth)
        : getDaysInMonth(birthYear, birthMonth);
      if (parseInt(birthDay) > maxDays) {
        setBirthDay(String(maxDays).padStart(2, "0"));
      }
    }
  }, [birthYear, birthMonth, birthDay, isLunarDate, isLeapMonth]);

  // Auto-reset leap month when year/month changes and leap month no longer applies
  useEffect(() => {
    if (!isLunarDate) return;
    const y = parseInt(birthYear);
    const m = parseInt(birthMonth);
    if (!y || !m) return;
    const leapMonth = getLeapMonthInYear(y);
    if (!leapMonth || m !== leapMonth) {
      setIsLeapMonth(false);
    }
  }, [birthYear, birthMonth, isLunarDate]);

  // Sync lunar fields to form state
  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      isLunarDate,
      isLeapMonth,
    }));
  }, [isLunarDate, isLeapMonth]);

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

    let submittedForm = { ...form };

    // If lunar date, convert to solar before submitting
    if (isLunarDate && birthYear && birthMonth && birthDay) {
      const y = parseInt(birthYear);
      const m = parseInt(birthMonth);
      const d = parseInt(birthDay);

      if (!isValidLunarDate(y, m, d, isLeapMonth)) {
        setSubmitError("無效的農曆日期，請檢查年月日是否正確");
        return;
      }

      try {
        const solarDateStr = lunarToSolar(y, m, d, isLeapMonth);
        submittedForm = { ...submittedForm, birthDate: solarDateStr };
      } catch {
        setSubmitError("無效的農曆日期，請檢查年月日是否正確");
        return;
      }
    }

    setSubmitError("");
    // Construct the original lunar date string for profile saving and engine accuracy
    const lunarDateStr = isLunarDate && birthYear && birthMonth && birthDay
      ? `${birthYear}-${birthMonth.padStart(2, "0")}-${birthDay.padStart(2, "0")}`
      : undefined;
    const saveIntent: SaveProfileIntent = {
      wantsSave,
      relationshipTag,
      existingProfileId: selectedProfileId || undefined,
      lunarBirthDate: lunarDateStr,
    };
    onSubmit(submittedForm, selectedProfileId, saveIntent);
  };

  const handleSecondaryClick = () => {
    if (onSecondarySubmit && isValid) {
      let submittedForm = { ...form };
      let lunarDateStr: string | undefined;
      if (isLunarDate && birthYear && birthMonth && birthDay) {
        const y = parseInt(birthYear);
        const m = parseInt(birthMonth);
        const d = parseInt(birthDay);
        if (!isValidLunarDate(y, m, d, isLeapMonth)) {
          setSubmitError("無效的農曆日期，請檢查年月日是否正確");
          return;
        }
        try {
          const solarDateStr = lunarToSolar(y, m, d, isLeapMonth);
          submittedForm = { ...submittedForm, birthDate: solarDateStr };
          lunarDateStr = `${birthYear}-${birthMonth.padStart(2, "0")}-${birthDay.padStart(2, "0")}`;
        } catch {
          setSubmitError("無效的農曆日期，請檢查年月日是否正確");
          return;
        }
      }
      setSubmitError("");
      onSecondarySubmit(submittedForm, selectedProfileId, lunarDateStr);
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
    const timeStr = profile.birthTime;
    const gender = profile.gender === "MALE" ? "male" : "female" as const;

    // Determine which date to show in the dropdowns
    if (profile.isLunarDate && profile.lunarBirthDate) {
      // For lunar profiles, show the original lunar date in dropdowns
      const lunarStr = profile.lunarBirthDate.substring(0, 10);
      setBirthYear(lunarStr.substring(0, 4));
      setBirthMonth(lunarStr.substring(5, 7));
      setBirthDay(lunarStr.substring(8, 10));
      setIsLunarDate(true);
      setIsLeapMonth(profile.isLeapMonth ?? false);
    } else {
      // Solar profiles — use birthDate (always solar)
      const dateStr = profile.birthDate.substring(0, 10);
      setBirthYear(dateStr.substring(0, 4));
      setBirthMonth(dateStr.substring(5, 7));
      setBirthDay(dateStr.substring(8, 10));
      setIsLunarDate(false);
      setIsLeapMonth(false);
    }

    setForm({
      name: profile.name,
      gender,
      birthDate: profile.birthDate.substring(0, 10),
      birthTime: timeStr,
      birthCity: profile.birthCity,
      birthTimezone: profile.birthTimezone,
      isLunarDate: profile.isLunarDate ?? false,
      isLeapMonth: profile.isLeapMonth ?? false,
    });

    // Sync time dropdowns
    const { hour12, period } = to12Hour(timeStr.substring(0, 2));
    setBirthHour(hour12);
    setBirthPeriod(period);
    setBirthMinute(timeStr.substring(3, 5));
    setSelectedRegion(getRegionForCity(profile.birthCity) ?? "taiwan");
    setSelectedProfileId(profile.id);
    setRelationshipTag(profile.relationshipTag);
    setSubmitError("");
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

  const dayCount = isLunarDate && birthYear && birthMonth
    ? getLunarDaysInMonth(parseInt(birthYear), parseInt(birthMonth), isLeapMonth)
    : getDaysInMonth(birthYear, birthMonth);
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

      {/* Calendar Type Toggle */}
      <div className={styles.fieldGroup}>
        <label className={styles.label}>曆法</label>
        <div className={styles.calendarTypeGroup}>
          <button
            type="button"
            className={
              !isLunarDate
                ? styles.calendarTypeOptionActive
                : styles.calendarTypeOption
            }
            onClick={() => { setIsLunarDate(false); setIsLeapMonth(false); setSubmitError(""); }}
          >
            國曆(陽曆)
          </button>
          <button
            type="button"
            className={
              isLunarDate
                ? styles.calendarTypeOptionActive
                : styles.calendarTypeOption
            }
            onClick={() => { setIsLunarDate(true); setSubmitError(""); }}
          >
            農曆(陰曆)
          </button>
        </div>
        {/* Leap month checkbox — only shown when lunar + correct year + month matches */}
        {isLunarDate && birthYear && birthMonth && (() => {
          const leapMonth = getLeapMonthInYear(parseInt(birthYear));
          return leapMonth && parseInt(birthMonth) === leapMonth;
        })() && (
          <div className={styles.leapMonthRow}>
            <label className={styles.leapMonthLabel}>
              <input
                type="checkbox"
                checked={isLeapMonth}
                onChange={(e) => setIsLeapMonth(e.target.checked)}
                className={styles.checkbox}
              />
              閏月
            </label>
            <p className={styles.leapMonthHint}>
              該年有閏{parseInt(birthMonth)}月，請確認是否為閏月出生
            </p>
          </div>
        )}
      </div>

      {/* Date & Time — industry standard Year/Month/Day + Hour/Minute dropdowns */}
      <div className={styles.dateTimeGroup}>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>{isLunarDate ? "農曆出生日期" : "出生日期"}</label>
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

      {(error || submitError) && <p className={styles.error}>{error || submitError}</p>}

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
