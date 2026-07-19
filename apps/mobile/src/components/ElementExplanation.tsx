import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { BlurView } from 'expo-blur';
import { X } from 'lucide-react-native';
import { colors, radius, spacing, fontSize, fonts } from '../theme';
import { useZh } from '../lib/language';
import {
  fetchElementExplanation,
  type ElementExplanationData,
  type ElementType,
  type GodRoles,
  type FourPillarsPayload,
} from '../lib/element-explanation-api';

export interface ElementClickInfo {
  elementType: ElementType;
  value: string;
  pillar: 'year' | 'month' | 'day' | 'hour';
  pillarLabel: string;
}

interface ElementExplanationProps {
  isOpen: boolean;
  onClose: () => void;
  info: ElementClickInfo | null;
  godRoles: GodRoles;
  fourPillars?: FourPillarsPayload;
  isSubscriber: boolean;
  gender: string;
  /** Called when the user taps the unlock CTA (paywall wired in M6). */
  onUnlock?: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  ten_god: '十神',
  stem: '天干',
  branch: '地支',
  hidden_stem: '藏干',
  life_stage: '十二運',
  nayin: '納音',
  shensha: '神煞',
  seasonal_state: '旺相休囚死',
  kong_wang: '空亡',
};

const NATURE_BADGE: Record<string, string> = {
  manifest: '強',
  latent: '隱',
  strong_root: '強',
  moderate_root: '中',
  weak_root: '弱',
  floating: '虛浮',
};


export function ElementExplanation({
  isOpen,
  onClose,
  info,
  godRoles,
  fourPillars,
  isSubscriber,
  gender,
  onUnlock,
}: ElementExplanationProps) {
  const zh = useZh();
  const [cache] = useState(() => new Map<string, ElementExplanationData>());
  const [data, setData] = useState<ElementExplanationData | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch when opened.
  useEffect(() => {
    if (!isOpen || !info) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    fetchElementExplanation(
      {
        elementType: info.elementType,
        value: info.value,
        pillar: info.pillar,
        godRoles,
        gender,
        fourPillars,
      },
      cache,
    )
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, info, godRoles, gender, fourPillars, cache]);

  const hasData = data && !data.error && data.generic.name;

  // A plain RN Modal bottom-sheet — @gorhom's BottomSheetModal does not present
  // under this SDK-57 New-Architecture + expo-router setup (present() is a no-op),
  // whereas RN Modal (the same pattern SelectField uses) works reliably.
  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
        <View style={styles.sheet}>
          <View style={styles.handleBar}>
            <View style={styles.handle} />
          </View>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>
                {info ? zh(info.value) : ''}
                {info ? <Text style={styles.headerSub}> · {zh(info.pillarLabel)}</Text> : null}
              </Text>
              {info ? <Text style={styles.categoryBadge}>{zh(CATEGORY_LABELS[info.elementType] || '')}</Text> : null}
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
              <X color={colors.textSecondary} size={22} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.red} />
            <Text style={styles.muted}>{zh('載入中…')}</Text>
          </View>
        ) : !hasData ? (
          <View style={styles.center}>
            <Text style={styles.muted}>{zh('此項目的詳細解讀即將推出')}</Text>
          </View>
        ) : (
          <>
            {/* Layer A — free */}
            <Text style={styles.bodyText}>{zh(data!.generic.meaning)}</Text>
            {data!.generic.keywords.length ? (
              <View style={styles.chipRow}>
                {data!.generic.keywords.map((k, i) => (
                  <View key={i} style={styles.chip}>
                    <Text style={styles.chipText}>{zh(k)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {data!.generic.liuQin ? (
              <Text style={styles.liuQin}>
                {zh('六親')}：{zh(gender === 'female' ? data!.generic.liuQin.female : data!.generic.liuQin.male)}
              </Text>
            ) : null}

            {/* Day-pillar combo — full card for subscribers, teaser for free. */}
            {data!.dayPillarCombo ? (
              <View style={styles.comboCard}>
                <Text style={styles.comboTitle}>
                  {zh('日柱')}：{info ? zh(info.value) : ''}
                  <Text style={styles.comboGrade}> {zh(data!.dayPillarCombo.grade)}</Text>
                </Text>
                {isSubscriber ? (
                  <>
                    {data!.dayPillarCombo.specialLabels?.length ? (
                      <View style={styles.chipRow}>
                        {data!.dayPillarCombo.specialLabels.map((l, i) => (
                          <View key={i} style={styles.chip}>
                            <Text style={styles.chipText}>{zh(l)}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    <Text style={styles.comboSeat}>
                      {zh('坐')}
                      {zh(data!.dayPillarCombo.lifeStageSeat)}
                      {data!.dayPillarCombo.gradeReason ? ` · ${zh(data!.dayPillarCombo.gradeReason)}` : ''}
                    </Text>
                    <Text style={styles.bodyText}>{zh(data!.dayPillarCombo.summary)}</Text>
                  </>
                ) : (
                  <Text style={styles.bodyText}>{zh(data!.dayPillarCombo.teaser)}</Text>
                )}
              </View>
            ) : null}

            {/* Pillar context — free teaser for non-subscribers */}
            {data!.pillarContext && info?.elementType !== 'seasonal_state' ? (
              <Text style={styles.bodyText}>
                {zh(isSubscriber ? data!.pillarContext.paid : data!.pillarContext.free)}
              </Text>
            ) : null}

            {/* Personalized (paid) block — gated */}
            {info?.elementType !== 'seasonal_state' && (data!.personalized.pillarMeaning || data!.personalized.godRoleMeaning) ? (
              isSubscriber ? (
                <View style={styles.paidBlock}>
                  {data!.personalized.godRole ? (
                    <Text style={styles.godRoleBadge}>{zh(data!.personalized.godRole)}</Text>
                  ) : null}
                  {data!.personalized.pillarMeaning ? (
                    <Text style={styles.bodyText}>{zh(data!.personalized.pillarMeaning)}</Text>
                  ) : null}
                  {data!.personalized.godRoleMeaning ? (
                    <Text style={styles.bodyText}>{zh(data!.personalized.godRoleMeaning)}</Text>
                  ) : null}
                  {data!.personalized.genderMeaning ? (
                    <Text style={styles.bodyText}>{zh(data!.personalized.genderMeaning)}</Text>
                  ) : null}
                  {data!.interactions?.length ? (
                    <View style={styles.interactions}>
                      <Text style={styles.sectionLabel}>{zh('命盤互動')}</Text>
                      {data!.interactions.map((it, i) => (
                        <View key={i} style={styles.interactionRow}>
                          <Text style={styles.interactionName}>
                            {it.icon} {zh(it.name)}{' '}
                            <Text style={styles.natureBadge}>{zh(NATURE_BADGE[it.nature] || it.nature)}</Text>
                          </Text>
                          <Text style={styles.bodyText}>{zh(it.description)}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.paywall}>
                  <View style={styles.blurWrap}>
                    <Text style={[styles.bodyText, styles.blurredText]} numberOfLines={4}>
                      {data!.personalized.pillarMeaning || '——'}
                    </Text>
                    <BlurView intensity={18} tint="light" style={StyleSheet.absoluteFill} />
                  </View>
                  <Pressable style={styles.unlockBtn} onPress={onUnlock} accessibilityRole="button">
                    <Text style={styles.unlockText}>🔓 {zh('訂閱解鎖個人化解讀')}</Text>
                  </Pressable>
                </View>
              )
            ) : null}
          </>
        )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.bgCard,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
  },
  handleBar: { alignItems: 'center', paddingVertical: spacing.sm },
  handle: { backgroundColor: colors.borderMedium, width: 40, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: spacing.sm,
  },
  headerTitle: { fontFamily: fonts.serifBold, fontSize: fontSize.xl, fontWeight: '700', color: colors.textAccent },
  headerSub: { fontSize: fontSize.base, color: colors.textSecondary, fontWeight: '400' },
  categoryBadge: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    fontSize: fontSize.xs,
    color: colors.textOnGold,
    backgroundColor: colors.goldLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  muted: { fontSize: fontSize.base, color: colors.textMuted },
  bodyText: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 26 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { backgroundColor: colors.bgBannerWarm, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chipText: { fontSize: fontSize.sm, color: colors.textAccent },
  liuQin: { fontSize: fontSize.sm, color: colors.textSecondary },
  comboCard: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  comboTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  comboGrade: { color: colors.red },
  comboSeat: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  paidBlock: { gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderLight, paddingTop: spacing.md },
  godRoleBadge: {
    alignSelf: 'flex-start',
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textOnRed,
    backgroundColor: colors.red,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  sectionLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textAccent, marginTop: spacing.sm },
  interactions: { gap: spacing.md },
  interactionRow: { gap: spacing.xs },
  interactionName: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  natureBadge: { fontSize: fontSize.xs, color: colors.textMuted },
  paywall: { gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderLight, paddingTop: spacing.md },
  blurWrap: { position: 'relative', overflow: 'hidden', borderRadius: radius.sm },
  blurredText: { opacity: 0.9 },
  unlockBtn: { backgroundColor: colors.red, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  unlockText: { color: colors.textOnRed, fontSize: fontSize.base, fontWeight: '700' },
});
