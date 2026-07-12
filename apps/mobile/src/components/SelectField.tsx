import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  FlatList,
  SectionList,
  StyleSheet,
} from 'react-native';
import { ChevronDown, Check, X } from 'lucide-react-native';
import { colors, radius, spacing, fontSize } from '../theme';
import { useZh } from '../lib/language';

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectSection {
  title: string;
  data: SelectOption[];
}

interface SelectFieldProps {
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  sections?: SelectSection[]; // grouped variant (e.g. timezones); takes precedence
  placeholder?: string;
  disabled?: boolean;
  /** Modal title; defaults to the placeholder. */
  title?: string;
  testID?: string;
}

/**
 * Compact dropdown: a pressable showing the selected label, opening a modal list.
 * Replaces web `<select>` — iOS inline picker wheels are impractical for the many
 * dropdowns in the birth-data form.
 */
export function SelectField({
  value,
  onChange,
  options,
  sections,
  placeholder,
  disabled,
  title,
  testID,
}: SelectFieldProps) {
  const zh = useZh();
  const [open, setOpen] = useState(false);

  const flat = sections ? sections.flatMap((s) => s.data) : options ?? [];
  const selected = flat.find((o) => o.value === value);
  const displayLabel = selected ? zh(selected.label) : zh(placeholder ?? '請選擇');

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const renderItem = (item: SelectOption) => {
    const isSel = item.value === value;
    return (
      <Pressable
        style={[styles.optionRow, isSel && styles.optionRowSelected]}
        onPress={() => select(item.value)}
        accessibilityRole="button"
      >
        <Text style={[styles.optionText, isSel && styles.optionTextSelected]}>
          {zh(item.label)}
        </Text>
        {isSel ? <Check color={colors.red} size={18} /> : null}
      </Pressable>
    );
  };

  return (
    <>
      <Pressable
        testID={testID}
        style={[styles.field, disabled && styles.fieldDisabled]}
        onPress={() => !disabled && setOpen(true)}
        accessibilityRole="button"
        disabled={disabled}
      >
        <Text style={[styles.fieldText, !selected && styles.placeholderText]} numberOfLines={1}>
          {displayLabel}
        </Text>
        <ChevronDown color={disabled ? colors.textMuted : colors.textSecondary} size={16} />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{zh(title ?? placeholder ?? '請選擇')}</Text>
            <Pressable onPress={() => setOpen(false)} accessibilityRole="button" hitSlop={8}>
              <X color={colors.textSecondary} size={22} />
            </Pressable>
          </View>
          {sections ? (
            <SectionList
              sections={sections}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => renderItem(item)}
              renderSectionHeader={({ section }) => (
                <Text style={styles.sectionHeader}>{zh(section.title)}</Text>
              )}
              stickySectionHeadersEnabled={false}
              keyboardShouldPersistTaps="handled"
            />
          ) : (
            <FlatList
              data={options ?? []}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => renderItem(item)}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.xs,
    minHeight: 48,
  },
  fieldDisabled: { opacity: 0.45 },
  fieldText: { flex: 1, fontSize: fontSize.base, color: colors.textPrimary },
  placeholderText: { color: colors.textMuted },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '70%',
    backgroundColor: colors.bgCard,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingBottom: spacing.xxl,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  sheetTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  sectionHeader: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textAccent,
    backgroundColor: colors.bgSecondary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  optionRowSelected: { backgroundColor: colors.bgBannerWarm },
  optionText: { fontSize: fontSize.base, color: colors.textPrimary },
  optionTextSelected: { color: colors.red, fontWeight: '600' },
});
