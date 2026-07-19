import { View, Text, StyleSheet } from 'react-native';
import { Ban, Clock, Compass, Hash, Leaf, Palette, type LucideIcon } from 'lucide-react-native';
import { colors, spacing, fontSize, radius, fonts, shadows } from '../../theme';
import { useZh } from '../../lib/language';
import type { DailyFortuneResponse } from '../../lib/fortune-api';

type FolkContent = DailyFortuneResponse['engineOutput']['folkContent'];

/** One slot in the folk grid: icon → label → value → note. */
function FolkCard({
  Icon,
  label,
  badge,
  value,
  note,
  wide,
  children,
}: {
  Icon: LucideIcon;
  label: string;
  badge?: string;
  value?: string;
  note: string;
  wide?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.card, wide && styles.cardWide]}>
      <Icon size={16} strokeWidth={2} color={colors.textAccent} />
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      </View>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {children}
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

/**
 * 命局層級參考 — the folk-content grid on the 日運 screen, mirroring web
 * (apps/web/app/reading/fortune/page.tsx::FolkContentCard):
 *   🧭 財運位 · 🌈 吉色 · 🔢 吉數(民俗) · 🍃 今日宜食 · 🚫 今日忌食 · 🕘 今日吉時
 *
 * Provenance is load-bearing and must stay visible: 吉數 is `folk_tradition`
 * (河圖洛書) rather than classical, so it carries a 「民俗」 badge to disclose the
 * weaker tier. 忌食 always shows its 五行 mechanism reason + a medical disclaimer.
 *
 * Every slot except 財運位 is nullable — the engine omits them when 用神 can't be
 * resolved — so each renders conditionally, exactly like web.
 */
export default function FolkContentCard({ folkContent }: { folkContent: FolkContent }) {
  const zh = useZh();

  // Defensive guard mirroring web: dev-mode HMR transients can pass undefined and
  // crash the destructure. Production always emits folkContent. Zero runtime cost.
  if (!folkContent) return null;

  const { wealthDirection, luckyColor, luckyNumber, luckyFoodFavor, luckyFoodAvoid, auspiciousHours } =
    folkContent;
  const showMedicalDisclaimer = !!luckyFoodAvoid;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{zh('命局層級參考')}</Text>

      <View style={styles.grid}>
        {/* 1. 財運位 (Phase 1) */}
        <FolkCard
          Icon={Compass}
          label={zh('財運位')}
          value={zh(wealthDirection.direction)}
          note={zh('您命格適合常用的方位')}
        />

        {/* 2. 吉色 (classical) */}
        {luckyColor ? (
          <FolkCard
            Icon={Palette}
            label={zh('吉色')}
            value={`${zh(luckyColor.primary)}／${zh(luckyColor.secondary)}`}
            note={zh(`用神（${luckyColor.element}）配色`)}
          />
        ) : null}

        {/* 3. 吉數 — folk_tradition tier, hence the visible 民俗 badge */}
        {luckyNumber ? (
          <FolkCard
            Icon={Hash}
            label={zh('吉數')}
            badge={zh('民俗')}
            value={luckyNumber.numbers.join('、')}
            note={zh('河圖五行數，民俗應用')}
          />
        ) : null}

        {/* 4. 今日宜食 (classical) */}
        {luckyFoodFavor ? (
          <FolkCard
            Icon={Leaf}
            label={zh('今日宜食')}
            value={zh(luckyFoodFavor.category)}
            note={zh(`例：${luckyFoodFavor.examples.join('、')}`)}
          />
        ) : null}

        {/* 5. 今日忌食 (classical) — the 五行 reason is required, never drop it */}
        {luckyFoodAvoid ? (
          <FolkCard
            Icon={Ban}
            label={zh('今日忌食')}
            value={zh(luckyFoodAvoid.category)}
            note={zh(luckyFoodAvoid.reason)}
          />
        ) : null}

        {/* 6. 今日吉時 — keys on day_branch only (協紀辨方書 卷十 青龍訣) */}
        {auspiciousHours.length > 0 ? (
          <FolkCard Icon={Clock} label={zh('今日吉時')} note={zh('協紀辨方書 卷十 黃道時辰')} wide>
            <View style={styles.hourChips}>
              {auspiciousHours.map((h) => (
                <Text key={h.branch} style={styles.hourChip}>
                  {zh(`${h.classical_name}時 ${h.branch}（${h.hour_range}）`)}
                </Text>
              ))}
            </View>
          </FolkCard>
        ) : null}
      </View>

      {showMedicalDisclaimer ? (
        <Text style={styles.medicalDisclaimer}>
          ℹ️{' '}
          {zh('飲食建議僅為命理參考，不取代醫療建議。如有特殊體質或健康狀況，請諮詢專業醫師。')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  sectionTitle: {
    fontFamily: fonts.serifBold,
    fontSize: fontSize.lg,
    color: colors.textAccent,
  },
  // Web uses a 2-col grid; on a phone we wrap 2-up and let 吉時 span full width.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: {
    flexGrow: 1,
    flexBasis: '46%',
    gap: 3,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.ruleHair,
    ...shadows.warm,
  },
  cardWide: { flexBasis: '100%' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  label: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  // 民俗 badge — discloses the weaker (folk_tradition) provenance tier.
  badge: {
    fontSize: fontSize.xs,
    fontStyle: 'italic',
    fontWeight: '600',
    color: colors.textMuted,
    backgroundColor: 'rgba(212,160,23,0.12)',
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  value: {
    fontFamily: fonts.serifBold,
    fontSize: fontSize.xl,
    color: colors.textPrimary,
  },
  note: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 18 },
  hourChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginVertical: spacing.xs },
  hourChip: {
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    backgroundColor: colors.bgBannerWarm,
    borderWidth: 1,
    borderColor: colors.ruleHair,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  medicalDisclaimer: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 18,
    backgroundColor: 'rgba(139,115,85,0.06)',
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
});
