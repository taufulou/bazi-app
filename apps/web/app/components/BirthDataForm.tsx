"use client";

import { useState, useId, useRef, useEffect } from "react";
import type { BirthProfile } from "../lib/birth-profiles-api";
import DatePickerInput from "./DatePickerInput";
import TimePickerInput from "./TimePickerInput";
import styles from "./BirthDataForm.module.css";

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

interface BirthDataFormProps {
  onSubmit: (data: BirthDataFormValues, profileId: string | null, saveIntent?: SaveProfileIntent) => void;
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
  const formId = useId();

  const [form, setForm] = useState<BirthDataFormValues>({
    name: initialValues?.name ?? "",
    gender: initialValues?.gender ?? "male",
    birthDate: initialValues?.birthDate ?? "",
    birthTime: initialValues?.birthTime ?? "",
    birthCity: initialValues?.birthCity ?? "台北市",
    birthTimezone: initialValues?.birthTimezone ?? "Asia/Taipei",
  });

  const [wantsSave, setWantsSave] = useState(showSaveOption);
  const [relationshipTag, setRelationshipTag] = useState("SELF");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const updateField = <K extends keyof BirthDataFormValues>(
    key: K,
    value: BirthDataFormValues[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
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
          <DatePickerInput
            value={form.birthDate}
            onChange={(v) => updateField("birthDate", v)}
          />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>出生時間</label>
          <TimePickerInput
            value={form.birthTime}
            onChange={(v) => updateField("birthTime", v)}
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
            list={`cities-${formId}`}
            placeholder="輸入或選擇城市"
            value={form.birthCity}
            onChange={(e) => updateField("birthCity", e.target.value)}
          />
          <datalist id={`cities-${formId}`}>
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
