/**
 * DualBirthDataForm — 合盤 two-person entry. RN port of the web
 * DualBirthDataForm. Mobile adaptation: Person A (本人) is a saved-profile
 * picker (defaults to the SELF profile, the common case — web auto-fills A from
 * SELF and rarely inline-creates it), while Person B (對方) reuses the full
 * mobile `BirthDataForm` (pick-an-existing OR enter-new, matching the M3 reading
 * flow). Person B's form submit drives the whole comparison. Emits
 * `{ profileAId, profileBId, comparisonType }` — profile IDs, not raw birth data.
 */
import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fonts, fontSize, spacing, radius } from '../theme';
import { useZh } from '../lib/language';
import type { BirthProfile } from '../lib/birth-profiles-api';
import { createBirthProfile, formValuesToPayload } from '../lib/birth-profiles-api';
import type { BirthDataFormValues, SaveProfileIntent } from '../lib/birth-profile-types';
import { SelectField } from './SelectField';
import BirthDataForm from './BirthDataForm';

type ComparisonSlug = 'romance' | 'business' | 'friendship';

const COMPARISON_TYPES: Array<{ slug: ComparisonSlug; icon: string; label: string }> = [
  { slug: 'romance', icon: '💕', label: '感情合盤' },
  { slug: 'business', icon: '💼', label: '事業合盤' },
  { slug: 'friendship', icon: '🤝', label: '友誼合盤' },
];

// Only 感情合盤 (romance) is supported for now — 事業/友誼 (V1 radar path) are
// hidden until built. Re-enable by widening this filter. When only one type is
// enabled, the type-selector row is hidden entirely (nothing to choose).
const ENABLED_COMPARISON_TYPES = COMPARISON_TYPES.filter((ct) => ct.slug === 'romance');
const SHOW_TYPE_SELECTOR = ENABLED_COMPARISON_TYPES.length > 1;

const TAG_LABEL_MAP: Record<string, string> = { SELF: '本人', FAMILY: '家人', FRIEND: '朋友' };

interface Props {
  onSubmit: (params: {
    profileAId: string;
    profileBId: string;
    comparisonType: ComparisonSlug;
  }) => Promise<void>;
  isLoading: boolean;
  error?: string | null;
  savedProfiles: BirthProfile[];
  userCredits: number;
  creditCost: number;
  getToken: () => Promise<string | null>;
}

function profileSummary(zh: (s: string) => string, p: BirthProfile): string {
  const g = p.gender === 'MALE' ? zh('男') : zh('女');
  // birthDate is an ISO string (may carry a time part) — show the date only.
  const date = p.birthDate.slice(0, 10);
  return `${g} · ${date}`;
}

export default function DualBirthDataForm({
  onSubmit,
  isLoading,
  error,
  savedProfiles,
  userCredits,
  creditCost,
  getToken,
}: Props) {
  const zh = useZh();

  const [comparisonType, setComparisonType] = useState<ComparisonSlug>('romance');

  // Person A defaults to the SELF profile → primary → first saved.
  const defaultAId = useMemo(() => {
    const self = savedProfiles.find((p) => p.relationshipTag === 'SELF');
    const primary = savedProfiles.find((p) => p.isPrimary);
    return self?.id ?? primary?.id ?? savedProfiles[0]?.id ?? '';
  }, [savedProfiles]);
  const [selectedProfileAId, setSelectedProfileAId] = useState<string>(defaultAId);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const profileA = savedProfiles.find((p) => p.id === selectedProfileAId);
  const aOptions = savedProfiles.map((p) => ({
    value: p.id,
    label: `${p.name}（${TAG_LABEL_MAP[p.relationshipTag] || ''}）`,
  }));
  // Person B's form excludes whoever is chosen as A (avoid comparing a chart with itself).
  const bSavedProfiles = savedProfiles.filter((p) => p.id !== selectedProfileAId);

  const insufficientCredits = userCredits < creditCost;

  // Person B's BirthDataForm submit drives the whole comparison.
  const handleBSubmit = async (
    data: BirthDataFormValues,
    _pid: string | null,
    saveIntent?: SaveProfileIntent,
  ) => {
    setSubmitError(null);
    if (!selectedProfileAId) {
      setSubmitError(zh('請選擇您的命盤'));
      return;
    }
    if (insufficientCredits) {
      setSubmitError(zh(`點數不足。此分析需要 ${creditCost} 點，您目前有 ${userCredits} 點。`));
      return;
    }
    setIsSubmitting(true);
    try {
      const token = await getToken();
      if (!token) {
        setSubmitError(zh('請先登入'));
        return;
      }
      // Resolve Person B's profile id — picked existing, or create a new one.
      let profileBId = saveIntent?.existingProfileId ?? null;
      if (!profileBId) {
        const payload = formValuesToPayload(
          data,
          saveIntent?.relationshipTag ?? 'FRIEND',
          saveIntent?.lunarBirthDate,
        );
        const created = await createBirthProfile(token, payload);
        profileBId = created.id;
      }
      if (profileBId === selectedProfileAId) {
        setSubmitError(zh('請選擇不同的兩個人進行比較'));
        return;
      }
      await onSubmit({ profileAId: selectedProfileAId, profileBId, comparisonType });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : zh('發生錯誤，請重試'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const busy = isLoading || isSubmitting;

  if (savedProfiles.length === 0) {
    return (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyText}>{zh('請先於「我的」建立您的命盤，才能進行合盤分析。')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <Text style={styles.title}>{zh('八字合盤分析')}</Text>
      <Text style={styles.subtitle}>
        {zh(SHOW_TYPE_SELECTOR ? '選擇比較類型，輸入雙方出生資料' : '輸入雙方出生資料，查看兩人感情合盤')}
      </Text>

      {/* Comparison type — hidden while only 感情合盤 is enabled */}
      {SHOW_TYPE_SELECTOR ? (
        <View style={styles.typeRow}>
          {ENABLED_COMPARISON_TYPES.map((ct) => {
            const active = comparisonType === ct.slug;
            return (
              <Pressable
                key={ct.slug}
                style={[styles.typeBtn, active && styles.typeBtnActive]}
                onPress={() => setComparisonType(ct.slug)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={styles.typeIcon}>{ct.icon}</Text>
                <Text style={[styles.typeLabel, active && styles.typeLabelActive]}>{zh(ct.label)}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Person A — saved-profile picker */}
      <View style={styles.panel}>
        <Text style={styles.panelLabel}>{zh('本人')}</Text>
        <SelectField
          value={selectedProfileAId}
          onChange={setSelectedProfileAId}
          options={aOptions}
          placeholder={zh('選擇您的命盤')}
          title={zh('選擇本人命盤')}
          testID="compat-person-a"
        />
        {profileA ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryName}>{profileA.name}</Text>
            <Text style={styles.summaryMeta}>{profileSummary(zh, profileA)}</Text>
            {!profileA.hourKnown ? (
              <View style={styles.hourBadge}>
                <Text style={styles.hourBadgeText}>{zh('時辰未知')}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.divider}>
        <Text style={styles.dividerIcon}>🔗</Text>
      </View>

      {/* Person B — full BirthDataForm (pick existing or enter new). Its submit
          button drives the comparison. */}
      <View style={styles.panel}>
        <BirthDataForm
          title={zh('對方')}
          subtitle={zh('選擇已儲存的人，或輸入新的出生資料')}
          submitLabel={comparisonType === 'romance' ? zh('查看合盤分數') : zh('開始合盤分析')}
          savedProfiles={bSavedProfiles}
          onSubmit={handleBSubmit}
          isLoading={busy}
          error={submitError || error || undefined}
          // A newly-entered 對方 is persisted as FRIEND, NOT the SELF default —
          // otherwise the account gets a 2nd "本人" profile (SELF is not unique
          // server-side) and later screens can pick the partner as the user.
          initialRelationshipTag="FRIEND"
        />
      </View>

      {/* Credit line — hidden for romance (free-score-first framing, matches web) */}
      {comparisonType !== 'romance' ? (
        <Text style={styles.creditInfo}>
          {zh(`消耗 ${creditCost} 點 · 目前餘額 ${userCredits} 點`)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.lg },
  title: { fontFamily: fonts.serifBold, fontSize: fontSize.xl, fontWeight: '700', color: colors.textAccent, textAlign: 'center' },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', marginTop: -spacing.sm },
  typeRow: { flexDirection: 'row', gap: spacing.sm },
  typeBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    backgroundColor: colors.bgCard,
  },
  typeBtnActive: { borderColor: colors.red, backgroundColor: colors.bgBannerWarm },
  typeIcon: { fontSize: 22 },
  typeLabel: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  typeLabelActive: { color: colors.red },
  panel: { gap: spacing.sm },
  panelLabel: { fontFamily: fonts.serifBold, fontSize: fontSize.base, fontWeight: '700', color: colors.textAccent },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  summaryName: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  summaryMeta: { fontSize: fontSize.sm, color: colors.textSecondary },
  hourBadge: {
    marginLeft: 'auto',
    backgroundColor: colors.bgBannerWarm,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  hourBadgeText: { fontSize: fontSize.xs, color: colors.orange, fontWeight: '700' },
  divider: { alignItems: 'center' },
  dividerIcon: { fontSize: 20 },
  creditInfo: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  emptyBox: { padding: spacing.xl, alignItems: 'center' },
  emptyText: { fontSize: fontSize.base, color: colors.textSecondary, textAlign: 'center', lineHeight: 26 },
});
