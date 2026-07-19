import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, fontSize, fonts } from '../../theme';
import { useZh } from '../../lib/language';

/**
 * ①② step indicator for the reading flow, mirroring web page.tsx:1725-1740.
 * Two steps joined by a connector: 輸入資料 → 查看結果.
 * `current='input'` = form step; `current='result'` = preview/reading steps.
 * Hidden by the caller when a reading was opened from history (no form step).
 */
export default function StepIndicator({ current }: { current: 'input' | 'result' }) {
  const zh = useZh();
  const onResult = current === 'result';

  return (
    <View style={styles.row}>
      {/* Step 1 — 輸入資料 (completed once we leave the form) */}
      <View style={styles.step}>
        <View style={[styles.circle, onResult ? styles.circleDone : styles.circleActive]}>
          <Text style={[styles.num, onResult ? styles.numDone : styles.numActive]}>
            {onResult ? '✓' : '1'}
          </Text>
        </View>
        <Text style={[styles.label, onResult ? styles.labelDone : styles.labelActive]}>
          {zh('輸入資料')}
        </Text>
      </View>

      {/* Connector */}
      <View style={[styles.line, onResult && styles.lineActive]} />

      {/* Step 2 — 查看結果 */}
      <View style={styles.step}>
        <View style={[styles.circle, onResult ? styles.circleActive : styles.circleIdle]}>
          <Text style={[styles.num, onResult ? styles.numActive : styles.numIdle]}>2</Text>
        </View>
        <Text style={[styles.label, onResult ? styles.labelActive : styles.labelIdle]}>
          {zh('查看結果')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  circle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  circleActive: { backgroundColor: 'rgba(226,61,40,0.10)', borderColor: colors.red },
  circleDone: { backgroundColor: 'rgba(76,175,80,0.12)', borderColor: colors.success },
  circleIdle: { backgroundColor: 'transparent', borderColor: colors.borderMedium },
  num: { fontSize: fontSize.sm, fontFamily: fonts.serifBold, fontWeight: '700' },
  numActive: { color: colors.red },
  numDone: { color: colors.successText },
  numIdle: { color: colors.textMuted },
  label: { fontSize: fontSize.sm, fontWeight: '600' },
  labelActive: { color: colors.red },
  labelDone: { color: colors.successText },
  labelIdle: { color: colors.textMuted },
  line: { width: 32, height: 2, backgroundColor: colors.borderMedium, borderRadius: 1 },
  lineActive: { backgroundColor: colors.success },
});
