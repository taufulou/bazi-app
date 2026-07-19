"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import type { BirthProfile } from "../lib/birth-profiles-api";
import {
  createBirthProfile,
  formValuesToPayload,
} from "../lib/birth-profiles-api";
import PersonBirthFields from "./PersonBirthFields";
import {
  lunarToSolar,
  isValidLunarDate,
} from "../lib/lunar-utils";
import {
  EMPTY_PERSON_FIELDS,
  toBirthDataFormValues,
  profileToPersonFields,
  type PersonFieldValues,
} from "../lib/date-time-utils";
import styles from "./DualBirthDataForm.module.css";

// ============================================================
// Types
// ============================================================

type ComparisonSlug = "romance" | "business" | "friendship";

interface DualBirthDataFormProps {
  onSubmit: (params: {
    profileAId: string;
    profileBId: string;
    comparisonType: string;
  }) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  savedProfiles: BirthProfile[];
  userCredits: number;
  creditCost: number;
  /** Override Clerk getToken (used for E2E test mode) */
  getTokenOverride?: () => Promise<string | null>;
}

// ============================================================
// Constants
// ============================================================

const COMPARISON_TYPES: Array<{
  slug: ComparisonSlug;
  icon: string;
  label: string;
}> = [
  { slug: "romance", icon: "💕", label: "感情合盤" },
  { slug: "business", icon: "💼", label: "事業合盤" },
  { slug: "friendship", icon: "🤝", label: "友誼合盤" },
];

// Only 感情合盤 (romance) is supported for now — 事業/友誼 are hidden until built.
// Re-enable by widening this filter. When only one type is enabled, the
// type-selector is hidden entirely (nothing to choose).
const ENABLED_COMPARISON_TYPES = COMPARISON_TYPES.filter((ct) => ct.slug === "romance");
const SHOW_TYPE_SELECTOR = ENABLED_COMPARISON_TYPES.length > 1;

const RELATIONSHIP_TAGS = [
  { value: "FAMILY", label: "家人" },
  { value: "FRIEND", label: "朋友" },
];

const TAG_LABEL_MAP: Record<string, string> = {
  SELF: "本人",
  FAMILY: "家人",
  FRIEND: "朋友",
};

// ============================================================
// Component
// ============================================================

export default function DualBirthDataForm({
  onSubmit,
  isLoading,
  error,
  savedProfiles,
  userCredits,
  creditCost,
  getTokenOverride,
}: DualBirthDataFormProps) {
  const clerkAuth = useAuth();
  const getToken = getTokenOverride || clerkAuth.getToken;

  // Comparison type
  const [comparisonType, setComparisonType] = useState<ComparisonSlug>("romance");

  // Person A state
  const [personAFields, setPersonAFields] = useState<PersonFieldValues>(EMPTY_PERSON_FIELDS);
  const [selectedProfileAId, setSelectedProfileAId] = useState<string | null>(null);

  // Person B state
  const [personBFields, setPersonBFields] = useState<PersonFieldValues>(EMPTY_PERSON_FIELDS);
  const [selectedProfileBId, setSelectedProfileBId] = useState<string | null>(null);
  const [wantsSaveB, setWantsSaveB] = useState(false);
  const [relationTag, setRelationTag] = useState("FRIEND");

  // Form state
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-fill Person A from SELF-tagged profile on mount
  useEffect(() => {
    const selfProfile = savedProfiles.find((p) => p.relationshipTag === "SELF");
    if (selfProfile) {
      setPersonAFields(profileToPersonFields(selfProfile));
      setSelectedProfileAId(selfProfile.id);
    }
  }, [savedProfiles]);

  // Field change handlers
  const handleFieldChangeA = useCallback(
    (field: keyof PersonFieldValues, val: string | boolean) => {
      setPersonAFields((prev) => ({ ...prev, [field]: val }));
      // If user modifies fields, clear profile selection
      if (field !== "regionCode" && field !== "cityCode" && field !== "timezone") {
        // Don't clear on region/city/tz changes since they auto-cascade
        if (selectedProfileAId && field === "name") {
          setSelectedProfileAId(null);
        }
      }
    },
    [selectedProfileAId],
  );

  const handleFieldChangeB = useCallback(
    (field: keyof PersonFieldValues, val: string | boolean) => {
      setPersonBFields((prev) => ({ ...prev, [field]: val }));
      if (field !== "regionCode" && field !== "cityCode" && field !== "timezone") {
        if (selectedProfileBId && field === "name") {
          setSelectedProfileBId(null);
        }
      }
    },
    [selectedProfileBId],
  );

  // Profile selection
  const selectProfileA = (profile: BirthProfile) => {
    setPersonAFields(profileToPersonFields(profile));
    setSelectedProfileAId(profile.id);
  };

  const selectProfileB = (profile: BirthProfile) => {
    setPersonBFields(profileToPersonFields(profile));
    setSelectedProfileBId(profile.id);
    setWantsSaveB(false); // Already saved
  };

  // Validation
  const isPersonValid = (fields: PersonFieldValues, profileId: string | null): boolean => {
    if (profileId) return true; // Existing profile is always valid
    return (
      fields.name.trim() !== "" &&
      fields.gender !== "" &&
      fields.year !== "" &&
      fields.month !== "" &&
      fields.day !== ""
    );
  };

  const personAValid = isPersonValid(personAFields, selectedProfileAId);
  const personBValid = isPersonValid(personBFields, selectedProfileBId);
  const isDuplicate = selectedProfileAId && selectedProfileBId && selectedProfileAId === selectedProfileBId;
  const insufficientCredits = userCredits < creditCost;
  const canSubmit = personAValid && personBValid && !isDuplicate && !insufficientCredits && !isLoading && !isSubmitting;

  // Submit handler with two-step sequencing
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitError(null);
    setIsSubmitting(true);

    try {
      let profileAId = selectedProfileAId;
      let profileBId = selectedProfileBId;

      const token = await getToken();
      if (!token) {
        setSubmitError("請先登入");
        return;
      }

      // Step 1a: Create Person A profile if needed (rare — usually pre-selected)
      if (!profileAId) {
        const formValues = toBirthDataFormValues(personAFields);

        // Handle lunar→solar conversion and preserve original lunar date
        let lunarDateStrA: string | undefined;
        if (formValues.isLunarDate && personAFields.year && personAFields.month && personAFields.day) {
          const y = parseInt(personAFields.year);
          const m = parseInt(personAFields.month);
          const d = parseInt(personAFields.day);
          if (!isValidLunarDate(y, m, d, personAFields.isLeapMonth)) {
            setSubmitError("本人的農曆日期無效，請檢查年月日是否正確");
            return;
          }
          try {
            const solarDateStr = lunarToSolar(y, m, d, personAFields.isLeapMonth);
            formValues.birthDate = solarDateStr;
            lunarDateStrA = `${personAFields.year}-${personAFields.month.padStart(2, "0")}-${personAFields.day.padStart(2, "0")}`;
          } catch {
            setSubmitError("本人的農曆日期無效，請檢查年月日是否正確");
            return;
          }
        }

        const payload = formValuesToPayload(formValues, "SELF", lunarDateStrA);
        const newProfile = await createBirthProfile(token, payload);
        profileAId = newProfile.id;
      }

      // Step 1b: Create Person B profile if needed
      if (!profileBId) {
        const formValues = toBirthDataFormValues(personBFields);

        // Handle lunar→solar conversion and preserve original lunar date
        let lunarDateStrB: string | undefined;
        if (formValues.isLunarDate && personBFields.year && personBFields.month && personBFields.day) {
          const y = parseInt(personBFields.year);
          const m = parseInt(personBFields.month);
          const d = parseInt(personBFields.day);
          if (!isValidLunarDate(y, m, d, personBFields.isLeapMonth)) {
            setSubmitError("對方的農曆日期無效，請檢查年月日是否正確");
            return;
          }
          try {
            const solarDateStr = lunarToSolar(y, m, d, personBFields.isLeapMonth);
            formValues.birthDate = solarDateStr;
            lunarDateStrB = `${personBFields.year}-${personBFields.month.padStart(2, "0")}-${personBFields.day.padStart(2, "0")}`;
          } catch {
            setSubmitError("對方的農曆日期無效，請檢查年月日是否正確");
            return;
          }
        }

        const tag = wantsSaveB ? relationTag : "FRIEND";
        const payload = formValuesToPayload(formValues, tag, lunarDateStrB);
        const newProfile = await createBirthProfile(token, payload);
        profileBId = newProfile.id;
      }

      // Step 2: Create comparison
      await onSubmit({
        profileAId: profileAId!,
        profileBId: profileBId!,
        comparisonType,
      });
    } catch (err) {
      if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError("發生錯誤，請重試");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className={styles.formWrapper} onSubmit={handleSubmit}>
      {/* Header */}
      <h2 className={styles.formTitle}>八字合盤分析</h2>
      <p className={styles.formSubtitle}>
        {SHOW_TYPE_SELECTOR ? "選擇比較類型，輸入雙方出生資料" : "輸入雙方出生資料，查看兩人感情合盤"}
      </p>

      {/* Comparison Type Selector — hidden while only 感情合盤 is enabled */}
      {SHOW_TYPE_SELECTOR && (
        <div className={styles.typeSelector}>
          {ENABLED_COMPARISON_TYPES.map((ct) => (
            <button
              key={ct.slug}
              type="button"
              className={
                comparisonType === ct.slug
                  ? `${styles.typeBtn} ${styles.typeBtnActive} ${styles[`type_${ct.slug}`]}`
                  : styles.typeBtn
              }
              onClick={() => setComparisonType(ct.slug)}
            >
              <span className={styles.typeBtnIcon}>{ct.icon}</span>
              <span className={styles.typeBtnLabel}>{ct.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Dual panels */}
      <div className={styles.dualPanels}>
        {/* Person A */}
        <div className={styles.panel}>
          {/* Profile dropdown for Person A */}
          {savedProfiles.length > 0 && (
            <div className={styles.profileSelect}>
              <select
                className={styles.profileDropdown}
                value={selectedProfileAId || ""}
                onChange={(e) => {
                  const profile = savedProfiles.find((p) => p.id === e.target.value);
                  if (profile) selectProfileA(profile);
                }}
              >
                <option value="">選擇已儲存的人</option>
                {savedProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({TAG_LABEL_MAP[p.relationshipTag] || ""})
                  </option>
                ))}
              </select>
            </div>
          )}
          <PersonBirthFields
            value={personAFields}
            onChange={handleFieldChangeA}
            label="本人"
          />
        </div>

        {/* Divider */}
        <div className={styles.divider}>
          <span className={styles.dividerIcon}>🔗</span>
        </div>

        {/* Person B */}
        <div className={styles.panel}>
          {/* Profile dropdown for Person B */}
          {savedProfiles.length > 0 && (
            <div className={styles.profileSelect}>
              <select
                className={styles.profileDropdown}
                value={selectedProfileBId || ""}
                onChange={(e) => {
                  if (e.target.value === "") {
                    setSelectedProfileBId(null);
                    setPersonBFields(EMPTY_PERSON_FIELDS);
                    return;
                  }
                  const profile = savedProfiles.find((p) => p.id === e.target.value);
                  if (profile) selectProfileB(profile);
                }}
              >
                <option value="">選擇已儲存的人或輸入新資料</option>
                {savedProfiles
                  .filter((p) => p.id !== selectedProfileAId) // Don't show Person A
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({TAG_LABEL_MAP[p.relationshipTag] || ""})
                    </option>
                  ))}
              </select>
            </div>
          )}
          <PersonBirthFields
            value={personBFields}
            onChange={handleFieldChangeB}
            label="對方"
          />

          {/* Save Person B checkbox */}
          {!selectedProfileBId && (
            <div className={styles.saveSection}>
              <label className={styles.saveLabel}>
                <input
                  type="checkbox"
                  checked={wantsSaveB}
                  onChange={(e) => setWantsSaveB(e.target.checked)}
                />
                儲存此人資料
              </label>
              {wantsSaveB && (
                <div className={styles.tagGroup}>
                  {RELATIONSHIP_TAGS.map((tag) => (
                    <button
                      key={tag.value}
                      type="button"
                      className={
                        relationTag === tag.value
                          ? styles.tagBtnActive
                          : styles.tagBtn
                      }
                      onClick={() => setRelationTag(tag.value)}
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Errors */}
      {isDuplicate && (
        <div className={styles.errorMsg}>請選擇不同的人進行比較</div>
      )}
      {insufficientCredits && (
        <div className={styles.creditWarning}>
          點數不足。此分析需要 {creditCost} 點，您目前有 {userCredits} 點。
        </div>
      )}
      {(error || submitError) && (
        <div className={styles.errorMsg}>{error || submitError}</div>
      )}

      {/* Submit */}
      <div className={styles.submitSection}>
        {comparisonType !== 'romance' && (
        <div className={styles.creditInfo}>
          消耗 {creditCost} 點 · 目前餘額 {userCredits} 點
        </div>
        )}
        <button
          type="submit"
          className={styles.submitBtn}
          disabled={!canSubmit}
        >
          {isLoading || isSubmitting ? "分析中..." : "開始分析"}
        </button>
      </div>
    </form>
  );
}
