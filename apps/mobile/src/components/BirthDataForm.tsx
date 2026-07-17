import { useState, useEffect, type ReactNode } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';
import {
  CITIES,
  TIMEZONES,
  REGIONS,
  getTimezoneForCity,
  getRegionForCity,
  type TimezoneEntry,
  type CityRegion,
} from '@repo/shared';
import { colors, radius, spacing, fontSize, fonts } from '../theme';
import { useZh } from '../lib/language';
import { SelectField, type SelectOption } from './SelectField';
import type { BirthProfile } from '../lib/birth-profiles-api';
import type { BirthDataFormValues, SaveProfileIntent } from '../lib/birth-profile-types';
import { lunarToSolar, getLunarDaysInMonth, getLeapMonthInYear, isValidLunarDate } from '../lib/lunar-utils';
import {
  getDaysInMonth,
  to12Hour,
  to24Hour,
  YEAR_OPTIONS,
  MONTH_OPTIONS,
  HOUR_12_OPTIONS,
  MINUTE_OPTIONS,
} from '../lib/date-time-utils';

export type { BirthDataFormValues, SaveProfileIntent };

const RELATIONSHIP_TAGS = [
  { value: 'SELF', label: '本人' },
  { value: 'FAMILY', label: '家人' },
  { value: 'FRIEND', label: '朋友' },
];
const TAG_LABEL_MAP: Record<string, string> = { SELF: '本人', FAMILY: '家人', FRIEND: '朋友' };

function groupByRegion<T extends { region: CityRegion }>(items: T[]) {
  return REGIONS.map((r) => ({ region: r, items: items.filter((i) => i.region === r.key) })).filter(
    (g) => g.items.length > 0,
  );
}

interface BirthDataFormProps {
  onSubmit: (data: BirthDataFormValues, profileId: string | null, saveIntent?: SaveProfileIntent) => void;
  onSecondarySubmit?: (data: BirthDataFormValues, profileId: string | null, lunarBirthDate?: string) => void;
  secondaryLabel?: string;
  isLoading?: boolean;
  error?: string;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  children?: ReactNode;
  initialValues?: Partial<BirthDataFormValues>;
  showSaveOption?: boolean;
  savedProfiles?: BirthProfile[];
  /** CRUD mode: saving is implied (no opt-in checkbox), relationship selector always shown. */
  forceSave?: boolean;
  /** Pre-fill the relationship tag (e.g. when editing an existing profile). */
  initialRelationshipTag?: string;
}

/** Small pressable checkbox (RN has no native one). */
function CheckRow({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  const zh = useZh();
  return (
    <Pressable style={styles.checkRow} onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked }}>
      <View style={[styles.checkBox, checked && styles.checkBoxOn]}>
        {checked ? <Check color={colors.textOnRed} size={14} /> : null}
      </View>
      <Text style={styles.checkLabel}>{zh(label)}</Text>
    </Pressable>
  );
}

export default function BirthDataForm({
  onSubmit,
  onSecondarySubmit,
  secondaryLabel,
  isLoading = false,
  error,
  title = '輸入出生資料',
  subtitle = '請填寫準確的出生時間以獲得最精確的分析',
  submitLabel = '開始排盤',
  children,
  initialValues,
  showSaveOption = false,
  savedProfiles,
  forceSave = false,
  initialRelationshipTag,
}: BirthDataFormProps) {
  const zh = useZh();

  const [form, setForm] = useState<BirthDataFormValues>({
    name: initialValues?.name ?? '',
    gender: initialValues?.gender ?? 'male',
    birthDate: initialValues?.birthDate ?? '',
    birthTime: initialValues?.birthTime ?? '',
    hourKnown: initialValues?.hourKnown ?? true,
    birthCity: initialValues?.birthCity ?? '台北市',
    birthTimezone: initialValues?.birthTimezone ?? 'Asia/Taipei',
    isLunarDate: initialValues?.isLunarDate ?? false,
    isLeapMonth: initialValues?.isLeapMonth ?? false,
  });

  const [isLunarDate, setIsLunarDate] = useState(initialValues?.isLunarDate ?? false);
  const [isLeapMonth, setIsLeapMonth] = useState(initialValues?.isLeapMonth ?? false);
  const [submitError, setSubmitError] = useState('');

  const [birthYear, setBirthYear] = useState(() => initialValues?.birthDate?.substring(0, 4) ?? '');
  const [birthMonth, setBirthMonth] = useState(() => initialValues?.birthDate?.substring(5, 7) ?? '');
  const [birthDay, setBirthDay] = useState(() => initialValues?.birthDate?.substring(8, 10) ?? '');
  const [birthHour, setBirthHour] = useState(() => {
    const h24 = initialValues?.birthTime?.substring(0, 2) ?? '';
    return h24 ? to12Hour(h24).hour12 : '';
  });
  const [birthPeriod, setBirthPeriod] = useState<'AM' | 'PM'>(() => {
    const h24 = initialValues?.birthTime?.substring(0, 2) ?? '';
    return h24 ? to12Hour(h24).period : 'AM';
  });
  const [birthMinute, setBirthMinute] = useState(() => initialValues?.birthTime?.substring(3, 5) ?? '');

  const [selectedRegion, setSelectedRegion] = useState<CityRegion>(
    () => getRegionForCity(initialValues?.birthCity ?? '台北市') ?? 'taiwan',
  );

  const [wantsSave, setWantsSave] = useState(showSaveOption || forceSave);
  const [relationshipTag, setRelationshipTag] = useState(initialRelationshipTag ?? 'SELF');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  // Sync date dropdowns → form.birthDate
  useEffect(() => {
    if (birthYear && birthMonth && birthDay) {
      setForm((prev) => ({ ...prev, birthDate: `${birthYear}-${birthMonth}-${birthDay}` }));
    } else {
      setForm((prev) => ({ ...prev, birthDate: '' }));
    }
  }, [birthYear, birthMonth, birthDay]);

  // Sync time dropdowns → form.birthTime (empty when hour unknown)
  useEffect(() => {
    if (!form.hourKnown) {
      setForm((prev) => (prev.birthTime === '' ? prev : { ...prev, birthTime: '' }));
      return;
    }
    if (birthHour !== '' && birthMinute !== '') {
      const h24 = to24Hour(birthHour, birthPeriod);
      setForm((prev) => ({ ...prev, birthTime: `${h24}:${birthMinute}` }));
    } else {
      setForm((prev) => ({ ...prev, birthTime: '' }));
    }
  }, [birthHour, birthMinute, birthPeriod, form.hourKnown]);

  // Clamp day when month/year shrinks the max
  useEffect(() => {
    if (birthDay && birthYear && birthMonth) {
      const maxDays = isLunarDate
        ? getLunarDaysInMonth(parseInt(birthYear), parseInt(birthMonth), isLeapMonth)
        : getDaysInMonth(birthYear, birthMonth);
      if (parseInt(birthDay) > maxDays) {
        setBirthDay(String(maxDays).padStart(2, '0'));
      }
    }
  }, [birthYear, birthMonth, birthDay, isLunarDate, isLeapMonth]);

  // Auto-reset leap month when it no longer applies
  useEffect(() => {
    if (!isLunarDate) return;
    const y = parseInt(birthYear);
    const m = parseInt(birthMonth);
    if (!y || !m) return;
    const leapMonth = getLeapMonthInYear(y);
    if (!leapMonth || m !== leapMonth) setIsLeapMonth(false);
  }, [birthYear, birthMonth, isLunarDate]);

  // Sync lunar fields into form
  useEffect(() => {
    setForm((prev) => ({ ...prev, isLunarDate, isLeapMonth }));
  }, [isLunarDate, isLeapMonth]);

  const updateField = <K extends keyof BirthDataFormValues>(key: K, value: BirthDataFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const convertLunarIfNeeded = (): { form: BirthDataFormValues; lunarDate?: string } | null => {
    let submittedForm = { ...form };
    let lunarDate: string | undefined;
    if (isLunarDate && birthYear && birthMonth && birthDay) {
      const y = parseInt(birthYear);
      const m = parseInt(birthMonth);
      const d = parseInt(birthDay);
      if (!isValidLunarDate(y, m, d, isLeapMonth)) {
        setSubmitError('無效的農曆日期，請檢查年月日是否正確');
        return null;
      }
      try {
        submittedForm = { ...submittedForm, birthDate: lunarToSolar(y, m, d, isLeapMonth) };
        lunarDate = `${birthYear}-${birthMonth.padStart(2, '0')}-${birthDay.padStart(2, '0')}`;
      } catch {
        setSubmitError('無效的農曆日期，請檢查年月日是否正確');
        return null;
      }
    }
    setSubmitError('');
    return { form: submittedForm, lunarDate };
  };

  const performSubmit = () => {
    const result = convertLunarIfNeeded();
    if (!result) return;
    const saveIntent: SaveProfileIntent = {
      wantsSave,
      relationshipTag,
      existingProfileId: selectedProfileId || undefined,
      lunarBirthDate: result.lunarDate,
    };
    onSubmit(result.form, selectedProfileId, saveIntent);
  };

  const handleSecondaryClick = () => {
    if (!onSecondarySubmit || !isValid) return;
    const result = convertLunarIfNeeded();
    if (!result) return;
    onSecondarySubmit(result.form, selectedProfileId, result.lunarDate);
  };

  const filteredCities = CITIES.filter((c) => c.region === selectedRegion);

  const handleRegionChange = (region: string) => {
    const r = region as CityRegion;
    if (r === selectedRegion) return;
    setSelectedRegion(r);
    const firstCity = CITIES.filter((c) => c.region === r)[0];
    if (firstCity) handleCityChange(firstCity.name);
  };

  const handleCityChange = (cityName: string) => {
    const tz = getTimezoneForCity(cityName);
    setForm((prev) => ({ ...prev, birthCity: cityName, ...(tz ? { birthTimezone: tz } : {}) }));
  };

  const selectProfile = (profile: BirthProfile) => {
    const timeStr = profile.birthTime ?? '';
    const profileHourKnown = profile.hourKnown ?? true;
    const gender = (profile.gender === 'MALE' ? 'male' : 'female') as 'male' | 'female';

    if (profile.isLunarDate && profile.lunarBirthDate) {
      const lunarStr = profile.lunarBirthDate.substring(0, 10);
      setBirthYear(lunarStr.substring(0, 4));
      setBirthMonth(lunarStr.substring(5, 7));
      setBirthDay(lunarStr.substring(8, 10));
      setIsLunarDate(true);
      setIsLeapMonth(profile.isLeapMonth ?? false);
    } else {
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
      hourKnown: profileHourKnown,
      birthCity: profile.birthCity,
      birthTimezone: profile.birthTimezone,
      isLunarDate: profile.isLunarDate ?? false,
      isLeapMonth: profile.isLeapMonth ?? false,
    });

    if (timeStr) {
      const { hour12, period } = to12Hour(timeStr.substring(0, 2));
      setBirthHour(hour12);
      setBirthPeriod(period);
      setBirthMinute(timeStr.substring(3, 5));
    } else {
      setBirthHour('');
      setBirthMinute('');
      setBirthPeriod('AM');
    }
    setSelectedRegion(getRegionForCity(profile.birthCity) ?? 'taiwan');
    setSelectedProfileId(profile.id);
    setRelationshipTag(profile.relationshipTag);
    setSubmitError('');
    setShowDropdown(false);
  };

  const handleNameChange = (inputValue: string) => {
    if (savedProfiles?.length) setShowDropdown(true);
    if (selectedProfileId) setSelectedProfileId(null);
    updateField('name', inputValue);
  };

  const dayCount =
    isLunarDate && birthYear && birthMonth
      ? getLunarDaysInMonth(parseInt(birthYear), parseInt(birthMonth), isLeapMonth)
      : getDaysInMonth(birthYear, birthMonth);
  const dayOptions: SelectOption[] = Array.from({ length: dayCount }, (_, i) => ({
    label: String(i + 1),
    value: String(i + 1).padStart(2, '0'),
  }));

  const isValid =
    form.name.trim() !== '' &&
    form.birthDate !== '' &&
    (form.hourKnown ? form.birthTime !== '' : true) &&
    form.birthCity.trim() !== '';

  const yearOptions: SelectOption[] = YEAR_OPTIONS.map((y) => ({ label: String(y), value: String(y) }));
  const monthOptions: SelectOption[] = MONTH_OPTIONS.map((m) => ({
    label: String(m),
    value: String(m).padStart(2, '0'),
  }));
  const hourOptions: SelectOption[] = HOUR_12_OPTIONS.map((h) => ({ label: String(h), value: String(h) }));
  const minuteOptions: SelectOption[] = MINUTE_OPTIONS.map((m) => ({
    label: String(m).padStart(2, '0'),
    value: String(m).padStart(2, '0'),
  }));
  const regionOptions: SelectOption[] = REGIONS.map((r) => ({ label: r.labelZhTw, value: r.key }));
  const cityOptions: SelectOption[] = [
    ...filteredCities.map((c) => ({ label: c.name, value: c.name })),
    ...(form.birthCity && !filteredCities.some((c) => c.name === form.birthCity)
      ? [{ label: form.birthCity, value: form.birthCity }]
      : []),
  ];
  const tzSections = groupByRegion<TimezoneEntry>(TIMEZONES).map((g) => ({
    title: g.region.labelZhTw,
    data: g.items.map((tz) => ({ label: tz.label, value: tz.value })),
  }));

  const showLeap = (() => {
    if (!isLunarDate || !birthYear || !birthMonth) return false;
    const leapMonth = getLeapMonthInYear(parseInt(birthYear));
    return !!leapMonth && parseInt(birthMonth) === leapMonth;
  })();

  const filteredProfiles = (savedProfiles ?? []).filter(
    (p) => !form.name || p.name.toLowerCase().includes(form.name.toLowerCase()),
  );

  return (
    <View style={styles.wrapper}>
      <Text style={styles.title}>{zh(title)}</Text>
      <Text style={styles.subtitle}>{zh(subtitle)}</Text>

      {/* Name */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{zh('稱呼')}</Text>
        <View style={styles.nameRow}>
          <TextInput
            style={styles.input}
            placeholder={zh(savedProfiles?.length ? '輸入稱呼或選擇已儲存的資料' : '請輸入稱呼')}
            placeholderTextColor={colors.textMuted}
            value={form.name}
            onChangeText={handleNameChange}
            onFocus={() => savedProfiles?.length && setShowDropdown(true)}
            maxLength={20}
            autoCorrect={false}
          />
          {savedProfiles?.length ? (
            <Pressable
              style={styles.dropdownToggle}
              onPress={() => setShowDropdown((p) => !p)}
              accessibilityRole="button"
              accessibilityLabel={zh('展開已儲存的資料')}
            >
              <ChevronDown color={colors.textSecondary} size={18} />
            </Pressable>
          ) : null}
        </View>
        {showDropdown && filteredProfiles.length ? (
          <View style={styles.profileDropdown}>
            {filteredProfiles.map((p) => (
              <Pressable
                key={p.id}
                style={styles.profileItem}
                onPress={() => selectProfile(p)}
                accessibilityRole="button"
              >
                <Text style={styles.profileName}>{zh(p.name)}</Text>
                <Text style={styles.profileTag}>{zh(TAG_LABEL_MAP[p.relationshipTag] || '')}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {/* Gender */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{zh('性別')}</Text>
        <View style={styles.toggleRow}>
          <Pressable
            style={[styles.toggleBtn, form.gender === 'male' && styles.toggleBtnOn]}
            onPress={() => updateField('gender', 'male')}
            accessibilityRole="button"
          >
            <Text style={[styles.toggleText, form.gender === 'male' && styles.toggleTextOn]}>♂ {zh('男')}</Text>
          </Pressable>
          <Pressable
            style={[styles.toggleBtn, form.gender === 'female' && styles.toggleBtnOn]}
            onPress={() => updateField('gender', 'female')}
            accessibilityRole="button"
          >
            <Text style={[styles.toggleText, form.gender === 'female' && styles.toggleTextOn]}>♀ {zh('女')}</Text>
          </Pressable>
        </View>
      </View>

      {/* Calendar type */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{zh('曆法')}</Text>
        <View style={styles.toggleRow}>
          <Pressable
            style={[styles.toggleBtn, !isLunarDate && styles.toggleBtnOn]}
            onPress={() => {
              setIsLunarDate(false);
              setIsLeapMonth(false);
              setSubmitError('');
            }}
            accessibilityRole="button"
          >
            <Text style={[styles.toggleText, !isLunarDate && styles.toggleTextOn]}>{zh('國曆(陽曆)')}</Text>
          </Pressable>
          <Pressable
            style={[styles.toggleBtn, isLunarDate && styles.toggleBtnOn]}
            onPress={() => {
              setIsLunarDate(true);
              setSubmitError('');
            }}
            accessibilityRole="button"
          >
            <Text style={[styles.toggleText, isLunarDate && styles.toggleTextOn]}>{zh('農曆(陰曆)')}</Text>
          </Pressable>
        </View>
        {showLeap ? (
          <View style={styles.leapRow}>
            <CheckRow checked={isLeapMonth} onToggle={() => setIsLeapMonth((v) => !v)} label="閏月" />
            <Text style={styles.hint}>
              {zh(`該年有閏${parseInt(birthMonth)}月，請確認是否為閏月出生`)}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Date */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{zh(isLunarDate ? '農曆出生日期' : '出生日期')}</Text>
        <View style={styles.tripleRow}>
          <View style={styles.tripleItem}>
            <SelectField value={birthYear} onChange={setBirthYear} options={yearOptions} placeholder="年" title="出生年" testID="pick-year" />
          </View>
          <View style={styles.tripleItem}>
            <SelectField value={birthMonth} onChange={setBirthMonth} options={monthOptions} placeholder="月" title="出生月" testID="pick-month" />
          </View>
          <View style={styles.tripleItem}>
            <SelectField value={birthDay} onChange={setBirthDay} options={dayOptions} placeholder="日" title="出生日" testID="pick-day" />
          </View>
        </View>
      </View>

      {/* Time */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{zh('出生時間')}</Text>
        <View style={styles.tripleRow}>
          <View style={styles.tripleItem}>
            <SelectField value={birthHour} onChange={setBirthHour} options={hourOptions} placeholder="時" title="時" disabled={!form.hourKnown} />
          </View>
          <View style={styles.tripleItem}>
            <SelectField value={birthMinute} onChange={setBirthMinute} options={minuteOptions} placeholder="分" title="分" disabled={!form.hourKnown} />
          </View>
          <View style={styles.tripleItem}>
            <SelectField
              value={birthPeriod}
              onChange={(v) => setBirthPeriod(v as 'AM' | 'PM')}
              options={[
                { label: '上午', value: 'AM' },
                { label: '下午', value: 'PM' },
              ]}
              disabled={!form.hourKnown}
            />
          </View>
        </View>
        <CheckRow checked={!form.hourKnown} onToggle={() => updateField('hourKnown', !form.hourKnown)} label="我不知道出生時辰" />
        {!form.hourKnown ? (
          <Text style={styles.hint}>
            {zh('沒有出生時辰也可以排盤：將以「年、月、日」推算（約七成）。與時辰有關的內容（子女運、晚年運等）會略過。')}
          </Text>
        ) : null}
      </View>

      {/* Region / City / Timezone */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{zh('地區')}</Text>
        <SelectField value={selectedRegion} onChange={handleRegionChange} options={regionOptions} title="地區" />
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{zh('出生地')}</Text>
        <SelectField value={form.birthCity} onChange={handleCityChange} options={cityOptions} title="出生地" testID="pick-city" />
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{zh('時區')}</Text>
        <SelectField value={form.birthTimezone} onChange={(v) => updateField('birthTimezone', v)} sections={tzSections} title="時區" />
      </View>

      {/* Save profile. CRUD mode (forceSave): saving is implied — no opt-in checkbox,
          relationship selector always shown. Preview mode (showSaveOption): opt-in. */}
      {showSaveOption || forceSave ? (
        <View style={styles.fieldGroup}>
          {!forceSave ? (
            <CheckRow checked={wantsSave} onToggle={() => setWantsSave((v) => !v)} label="儲存此資料以便下次使用" />
          ) : null}
          {forceSave || wantsSave ? (
            <View style={styles.tagRow}>
              <Text style={styles.label}>{zh('關係')}</Text>
              <View style={styles.toggleRow}>
                {RELATIONSHIP_TAGS.map((tag) => (
                  <Pressable
                    key={tag.value}
                    style={[styles.toggleBtn, relationshipTag === tag.value && styles.toggleBtnOn]}
                    onPress={() => setRelationshipTag(tag.value)}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.toggleText, relationshipTag === tag.value && styles.toggleTextOn]}>
                      {zh(tag.label)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {children}

      {error || submitError ? <Text style={styles.error}>{zh(error || submitError)}</Text> : null}

      <Pressable
        style={[styles.submitBtn, (!isValid || isLoading) && styles.submitBtnDisabled]}
        onPress={performSubmit}
        disabled={!isValid || isLoading}
        accessibilityRole="button"
        testID="submit-birth-form"
      >
        <Text style={styles.submitText}>{isLoading ? zh('排盤中...') : zh(submitLabel)}</Text>
      </Pressable>

      {onSecondarySubmit && secondaryLabel ? (
        <Pressable
          style={[styles.secondaryBtn, (!isValid || isLoading) && styles.submitBtnDisabled]}
          onPress={handleSecondaryClick}
          disabled={!isValid || isLoading}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>{zh(secondaryLabel)}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.lg },
  title: { fontFamily: fonts.serifBold, fontSize: fontSize.xl, fontWeight: '700', color: colors.textAccent },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: -spacing.sm },
  fieldGroup: { gap: spacing.sm },
  label: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  nameRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.base,
    color: colors.textPrimary,
    minHeight: 48,
  },
  dropdownToggle: {
    width: 44,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderMedium,
  },
  profileDropdown: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
  },
  profileItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  profileName: { fontSize: fontSize.base, color: colors.textPrimary },
  profileTag: { fontSize: fontSize.xs, color: colors.textMuted },
  toggleRow: { flexDirection: 'row', gap: spacing.sm },
  toggleBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    backgroundColor: colors.bgCard,
  },
  toggleBtnOn: { backgroundColor: colors.red, borderColor: colors.red },
  toggleText: { fontSize: fontSize.base, color: colors.textPrimary },
  toggleTextOn: { color: colors.textOnRed, fontWeight: '600' },
  tripleRow: { flexDirection: 'row', gap: spacing.sm },
  tripleItem: { flex: 1 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.borderMedium,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCard,
  },
  checkBoxOn: { backgroundColor: colors.red, borderColor: colors.red },
  checkLabel: { fontSize: fontSize.base, color: colors.textPrimary },
  leapRow: { gap: spacing.xs, marginTop: spacing.xs },
  hint: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 18 },
  tagRow: { gap: spacing.sm, marginTop: spacing.sm },
  error: { fontSize: fontSize.sm, color: colors.error },
  submitBtn: {
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { color: colors.textOnRed, fontSize: fontSize.lg, fontWeight: '700' },
  secondaryBtn: {
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.red,
  },
  secondaryText: { color: colors.red, fontSize: fontSize.base, fontWeight: '500' },
});
