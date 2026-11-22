import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { useAiConsent } from '../lib/ai-consent';
import { useZh } from '../lib/language';
import { colors, radius, spacing, surfaces, text as T } from '../theme';

/**
 * Shown where AI narration would be, before the user has agreed to the AI-data
 * disclosure (1C item 2). The button asks for consent from a plain tap — no other
 * Modal is up on these screens — and once granted the parent re-renders with the
 * AI path enabled.
 */
export function AiConsentCard({ body }: { body?: string }) {
  const zh = useZh();
  const { requireAiConsent } = useAiConsent();
  return (
    <View style={styles.card} testID="ai-consent-card">
      <Sparkles color={colors.textAccent} size={22} />
      <Text style={styles.title}>{zh('AI 解讀需要您的同意')}</Text>
      <Text style={styles.body}>
        {zh(body ?? '此部分由 AI 根據您的命盤產生。開始前，請先閱讀並同意 AI 解讀資料說明。')}
      </Text>
      <Pressable
        testID="ai-consent-card-enable"
        style={styles.button}
        accessibilityRole="button"
        onPress={() => void requireAiConsent()}
      >
        <Text style={styles.buttonText}>{zh('開啟 AI 解讀')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...surfaces.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: { ...T.section, color: colors.textAccent, textAlign: 'center' },
  body: { ...T.bodyTight, color: colors.textSecondary, textAlign: 'center' },
  button: {
    marginTop: spacing.sm,
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  buttonText: { ...T.bodyTight, color: colors.textOnRed, fontWeight: '700' },
});
