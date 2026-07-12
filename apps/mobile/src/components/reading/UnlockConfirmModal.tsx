/**
 * UnlockConfirmModal — spend-credits confirmation before generating a paid AI
 * reading. RN port of apps/web UnlockConfirmModal. Shows the credit cost, an
 * insufficient-credits guard, and (for 時辰未知 profiles) the 3-pillar
 * limitation warning.
 */
import { View, Text, Pressable, Modal, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { X, TriangleAlert } from 'lucide-react-native';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';

interface Props {
  visible: boolean;
  readingName: string;
  creditCost: number;
  credits: number | null;
  isUnlocking: boolean;
  hourUnknown?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Navigate to the store when the user lacks credits (M6 wires the store). */
  onBuyCredits?: () => void;
}

export default function UnlockConfirmModal({
  visible,
  readingName,
  creditCost,
  credits,
  isUnlocking,
  hourUnknown = false,
  onConfirm,
  onCancel,
  onBuyCredits,
}: Props) {
  const zh = useZh();
  const insufficient = credits !== null && credits < creditCost;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{zh('解鎖完整報告')}</Text>
            <Pressable onPress={onCancel} hitSlop={10} accessibilityLabel={zh('關閉')}>
              <X size={22} strokeWidth={2} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.lead}>
              {zh('即將為您解鎖')}
              <Text style={styles.leadName}>《{zh(readingName)}》</Text>
            </Text>

            <View style={styles.costRow}>
              <Text style={styles.costLabel}>{zh('將扣除')}</Text>
              <Text style={styles.costValue}>{creditCost}</Text>
              <Text style={styles.costLabel}>{zh('點')}</Text>
              {credits !== null ? (
                <Text style={styles.balance}>
                  （{zh('您有')} {credits} {zh('點')}）
                </Text>
              ) : null}
            </View>

            {hourUnknown ? (
              <View style={styles.warn}>
                <View style={styles.warnHead}>
                  <TriangleAlert size={16} color={colors.warning} />
                  <Text style={styles.warnLead}>
                    {zh('因為沒有出生時辰，這份報告會以「年、月、日」來推算（大約七成）。下列與時辰有關的內容，這次不會包含：')}
                  </Text>
                </View>
                <Text style={styles.warnItem}>• {zh('出生時辰那一柱的分析')}</Text>
                <Text style={styles.warnItem}>• {zh('子女宮、晚年運勢')}</Text>
                <Text style={styles.warnItem}>• {zh('命宮、身宮')}</Text>
                <Text style={styles.warnItem}>• {zh('部分與時辰有關的神煞')}</Text>
                <Text style={styles.warnNote}>
                  {zh('用神、五行比重會標示「僅供參考」。出生時辰無法事後補上；若日後得知，可另外建立一張新命盤查看完整分析。')}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {insufficient ? (
            <>
              <Text style={styles.insufficient}>{zh('點數不足，請先購買點數')}</Text>
              <Pressable
                style={styles.confirmBtn}
                onPress={onBuyCredits}
                accessibilityRole="button"
              >
                <Text style={styles.confirmText}>{zh('前往購買點數')}</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              style={[styles.confirmBtn, isUnlocking && styles.confirmDisabled]}
              onPress={onConfirm}
              disabled={isUnlocking}
              accessibilityRole="button"
            >
              {isUnlocking ? (
                <ActivityIndicator color={colors.textOnRed} />
              ) : (
                <Text style={styles.confirmText}>{zh('解鎖完整報告')}</Text>
              )}
            </Pressable>
          )}

          <Pressable style={styles.cancelBtn} onPress={onCancel} disabled={isUnlocking} accessibilityRole="button">
            <Text style={styles.cancelText}>{zh('取消')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.xl },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.xl,
    padding: spacing.xl,
    maxHeight: '85%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { fontFamily: fonts.serif, fontSize: fontSize.xl, fontWeight: '700', color: colors.textAccent },
  body: { gap: spacing.md, paddingBottom: spacing.md },
  lead: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 24 },
  leadName: { fontWeight: '700', color: colors.red },
  costRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, flexWrap: 'wrap' },
  costLabel: { fontSize: fontSize.base, color: colors.textSecondary },
  costValue: { fontFamily: fonts.serif, fontSize: fontSize.xxl, fontWeight: '800', color: colors.red },
  balance: { fontSize: fontSize.sm, color: colors.textMuted, marginLeft: spacing.xs },
  warn: {
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.35)',
    padding: spacing.md,
    gap: 4,
  },
  warnHead: { flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start', marginBottom: 2 },
  warnLead: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary, lineHeight: 20, fontWeight: '600' },
  warnItem: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20, marginLeft: spacing.lg },
  warnNote: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 18, marginTop: 4 },
  insufficient: { fontSize: fontSize.sm, color: colors.warning, textAlign: 'center', marginBottom: spacing.sm, fontWeight: '600' },
  confirmBtn: {
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  confirmDisabled: { opacity: 0.7 },
  confirmText: { color: colors.textOnRed, fontSize: fontSize.base, fontWeight: '700' },
  cancelBtn: { paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xs },
  cancelText: { color: colors.textSecondary, fontSize: fontSize.base, fontWeight: '600' },
});
