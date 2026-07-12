/**
 * PeriodNavigator — tappable period chip that opens a modal list picker.
 *
 * Picker-only pattern (mirrors web DateNavigator/MonthNavigator/YearNavigator,
 * Phase 3.1): NO prev/next arrows (each arrow = a fresh AI generation / real
 * cost). The chip is the sole interaction — chevron-down + hint signal it opens
 * a picker. One deliberate selection = one fetch.
 *
 * Subscriber-aware: subscribers browse the in-window `options` list; FREE users'
 * tap fires `onLockedAttempt` (upsell). The list is a native Modal + scrollable
 * options (no native datetimepicker dependency) so gating is inherent — the
 * list only contains allowed periods.
 */
import { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { ChevronDown, Lock, Check } from 'lucide-react-native';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';

export interface PeriodOption {
  label: string;
  value: string;
}

interface Props {
  /** Current chip display label (e.g. «2026年7月12日 週日»). */
  currentLabel: string;
  /** Hint under the chip (e.g. «點擊選擇日期»). */
  hint: string;
  /** In-window selectable periods (subscribers). Ignored for FREE. */
  options: PeriodOption[];
  value: string;
  onChange: (value: string) => void;
  /** FREE tier → tap fires onLockedAttempt instead of opening the picker. */
  isFree: boolean;
  onLockedAttempt: () => void;
  /** Disable while a fortune fetch is in-flight. */
  disabled?: boolean;
  /** Accessible title for the picker modal (e.g. «選擇日期»). */
  pickerTitle: string;
}

export default function PeriodNavigator({
  currentLabel,
  hint,
  options,
  value,
  onChange,
  isFree,
  onLockedAttempt,
  disabled = false,
  pickerTitle,
}: Props) {
  const zh = useZh();
  const [open, setOpen] = useState(false);

  const onChipPress = () => {
    if (disabled) return;
    if (isFree) {
      onLockedAttempt();
      return;
    }
    setOpen(true);
  };

  const onSelect = (v: string) => {
    setOpen(false);
    if (v !== value) onChange(v);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        style={[styles.chip, disabled && styles.chipDisabled]}
        onPress={onChipPress}
        accessibilityRole="button"
        accessibilityLabel={zh(`${currentLabel}，${isFree ? '需訂閱' : '點擊選擇'}`)}
      >
        <Text style={styles.chipLabel}>{zh(currentLabel)}</Text>
        {isFree ? (
          <Lock size={15} strokeWidth={2} color={colors.textMuted} />
        ) : (
          <ChevronDown size={16} strokeWidth={2} color={colors.red} />
        )}
      </Pressable>
      <Text style={styles.hint}>{zh(hint)}</Text>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{zh(pickerTitle)}</Text>
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {options.map((opt) => {
                const selected = opt.value === value;
                return (
                  <Pressable
                    key={opt.value}
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => onSelect(opt.value)}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{zh(opt.label)}</Text>
                    {selected ? <Check size={18} strokeWidth={2.5} color={colors.red} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={styles.cancel} onPress={() => setOpen(false)} accessibilityRole="button">
              <Text style={styles.cancelText}>{zh('取消')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgCard,
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderMedium,
  },
  chipDisabled: { opacity: 0.6 },
  chipLabel: { fontFamily: fonts.serif, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  hint: { fontSize: fontSize.xs, color: colors.textMuted },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '70%',
  },
  sheetTitle: {
    fontFamily: fonts.serif,
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.textAccent,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  list: { flexGrow: 0 },
  listContent: { paddingHorizontal: spacing.lg },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  optionSelected: { backgroundColor: 'rgba(226,61,40,0.06)', borderRadius: radius.md },
  optionText: { fontSize: fontSize.base, color: colors.textPrimary },
  optionTextSelected: { fontWeight: '700', color: colors.red },
  cancel: { marginTop: spacing.md, marginHorizontal: spacing.lg, paddingVertical: spacing.md, alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: radius.md },
  cancelText: { fontSize: fontSize.base, fontWeight: '600', color: colors.textSecondary },
});
