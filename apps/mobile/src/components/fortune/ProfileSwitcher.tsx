/**
 * ProfileSwitcher — tappable chip showing the active birth profile; opens a
 * modal list of all profiles + a 「管理命盤」 footer → /profiles. RN port of
 * apps/web ProfileSwitcher (which is a header icon-popover); on mobile the chip
 * shows the active profile NAME + relationship tag since there's room and the
 * fortune/reading screens don't otherwise say whose chart is shown.
 *
 * Hidden entirely when profiles.length <= 1 (no value in a single-entry
 * switcher; the 0-profile state is handled upstream by the caller's
 * NO_PRIMARY_PROFILE branch).
 *
 * Uses a plain RN Modal (NOT @gorhom/bottom-sheet, which is a no-op under
 * SDK-57 New-Arch per the M1 ElementExplanation finding). Same picker pattern
 * as PeriodNavigator.
 */
import { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Users, ChevronDown, Check } from 'lucide-react-native';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';
import type { BirthProfile } from '../../lib/birth-profiles-api';

interface Props {
  profiles: BirthProfile[];
  activeProfileId: string | undefined;
  onSelect: (id: string) => void;
  isLoading?: boolean;
}

const REL_LABEL: Record<BirthProfile['relationshipTag'], string> = {
  SELF: '本人',
  FAMILY: '家人',
  FRIEND: '朋友',
};

/** ISO «1987-09-06» (or full timestamp) → «1987.09.06». */
function formatBirthDateChip(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]!}.${m[2]!}.${m[3]!}` : iso;
}

export default function ProfileSwitcher({ profiles, activeProfileId, onSelect, isLoading = false }: Props) {
  const zh = useZh();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Hide the switcher entirely when there's only one (or zero) profile.
  if (profiles.length <= 1) return null;

  const active =
    profiles.find((p) => p.id === activeProfileId) ?? profiles.find((p) => p.isPrimary) ?? profiles[0]!;

  const handleSelect = (id: string) => {
    setOpen(false);
    if (id !== activeProfileId) onSelect(id);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        testID="profile-switcher-chip"
        style={[styles.chip, isLoading && styles.chipDisabled]}
        onPress={() => !isLoading && setOpen(true)}
        disabled={isLoading}
        accessibilityRole="button"
        accessibilityLabel={zh(`切換命盤，目前為 ${active.name}`)}
      >
        <Users size={15} strokeWidth={2} color={colors.red} />
        <Text style={styles.chipName} numberOfLines={1}>
          {active.name}
        </Text>
        <Text style={styles.chipRel}>{zh(REL_LABEL[active.relationshipTag])}</Text>
        <ChevronDown size={15} strokeWidth={2} color={colors.red} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{zh('選擇命盤')}</Text>
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {profiles.map((p) => {
                const selected = p.id === active.id;
                return (
                  <Pressable
                    key={p.id}
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => handleSelect(p.id)}
                    accessibilityRole="button"
                  >
                    <View style={styles.optionMain}>
                      <Text style={[styles.optionName, selected && styles.optionNameSelected]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <View style={styles.optionMeta}>
                        <Text style={styles.relTag}>{zh(REL_LABEL[p.relationshipTag])}</Text>
                        <Text style={styles.birthChip}>{formatBirthDateChip(p.birthDate)}</Text>
                      </View>
                    </View>
                    {selected ? <Check size={18} strokeWidth={2.5} color={colors.red} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              style={styles.footerLink}
              onPress={() => {
                setOpen(false);
                router.push('/profiles');
              }}
              accessibilityRole="button"
            >
              <Text style={styles.footerText}>{zh('管理命盤 →')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: '90%',
    backgroundColor: colors.bgCard,
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderMedium,
  },
  chipDisabled: { opacity: 0.6 },
  chipName: { fontFamily: fonts.serifBold, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, flexShrink: 1 },
  chipRel: { fontSize: fontSize.xs, color: colors.textMuted },
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
    fontFamily: fonts.serifBold,
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
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleHair,
  },
  optionSelected: { backgroundColor: 'rgba(226,61,40,0.06)', borderRadius: radius.md },
  optionMain: { flex: 1, gap: 2 },
  optionName: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  optionNameSelected: { fontWeight: '700', color: colors.red },
  optionMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  relTag: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  birthChip: { fontSize: fontSize.xs, color: colors.textMuted },
  footerLink: { marginTop: spacing.md, marginHorizontal: spacing.lg, paddingVertical: spacing.md, alignItems: 'center' },
  footerText: { fontSize: fontSize.base, fontWeight: '600', color: colors.red },
});
