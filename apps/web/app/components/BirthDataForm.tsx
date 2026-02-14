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

/** Group items by region, returning only non-empty groups in market-priority order */
function groupByRegion<T extends { region: CityRegion }>(items: T[]) {
  return REGIONS
    .map((r) => ({ region: r, items: items.filter((i) => i.region === r.key) }))
    .filter((g) => g.items.length > 0);
}

interface BirthDataFormProps {
  onSubmit: (data: BirthDataFormValues, profileId: string | null) => void;
  isLoading?: boolean;
  error?: string;
  title?: string;
  subtitle?: string;
  submitLabel?: React.ReactNode;
  children?: React.ReactNode;
  initialValues?: Partial<BirthDataFormValues>;
  showSaveOption?: boolean;
  onSaveProfile?: (data: BirthDataFormValues, relationshipTag: string, existingProfileId?: string) => void;
  savedProfiles?: BirthProfile[];
}

export default function BirthDataForm({
  onSubmit,
  isLoading = false,
  error,
  title = "輸入出生資料",
  subtitle = "請填寫準確的出生時間以獲得最精確的分析",
  submitLabel = "開始排盤",
  children,
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

  const [selectedRegion, setSelectedRegion] = useState<CityRegion>(
    () => getRegionForCity(initialValues?.birthCity ?? "台北市") ?? "taiwan"
  );

  const [wantsSave, setWantsSave] = useState(showSaveOption);
  const [relationshipTag, setRelationshipTag] = useState("SELF");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    if (wantsSave && onSaveProfile) {
      onSaveProfile(form, relationshipTag, selectedProfileId || undefined);
    }
    onSubmit(form, selectedProfileId);
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
    if (citiesInRegion.length > 0) {
      handleCityChange(citiesInRegion[0].name);
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
    setForm({
      name: profile.name,
      gender: profile.gender === "MALE" ? "male" : "female",
      birthDate: profile.birthDate.substring(0, 10),
      birthTime: profile.birthTime,
      birthCity: profile.birthCity,
      birthTimezone: profile.birthTimezone,
    });
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
    </form>
  );
}
