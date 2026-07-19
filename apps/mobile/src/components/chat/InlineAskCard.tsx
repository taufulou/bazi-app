/**
 * InlineAskCard — section-scoped «問 AI 命理師» card, rendered after a reading
 * section. Shows up to 2 curated sample questions for the (readingType,
 * sectionKey) tuple. Tapping a question opens the chat + POPULATES the composer
 * (populate-only, no auto-send). Returns null while loading / when no questions
 * exist. RN port of the web InlineAskCard.
 */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MessageCircle, ChevronRight } from 'lucide-react-native';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';
import { useSampleQuestions } from './hooks/useSampleQuestions';
import type { ChatReadingType } from '../../lib/chat-api';

interface Props {
  readingType: ChatReadingType;
  sectionKey: string;
  fortuneScope?: 'DAY' | 'MONTH' | 'YEAR';
  /** Open the chat + populate the composer with the question (no auto-send). */
  onAsk: (sectionKey: string, question: string) => void;
  /** Open the chat with this section as context (no question). */
  onOpenChat?: (sectionKey: string) => void;
}

export default function InlineAskCard({ readingType, sectionKey, fortuneScope, onAsk, onOpenChat }: Props) {
  const zh = useZh();
  const { questions, loading } = useSampleQuestions(readingType, sectionKey, fortuneScope);

  if (loading || questions.length === 0) return null;
  const visible = questions.slice(0, 2);

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.header}
        onPress={onOpenChat ? () => onOpenChat(sectionKey) : undefined}
        disabled={!onOpenChat}
        accessibilityRole={onOpenChat ? 'button' : undefined}
      >
        <MessageCircle size={15} strokeWidth={2} color={colors.red} />
        <Text style={styles.title}>
          {zh('這段想了解更多？')}
          <Text style={onOpenChat ? styles.titleCta : styles.titleCtaPlain}>{zh('AI 命理師深入解答')}</Text>
        </Text>
      </Pressable>
      <View style={styles.questions}>
        {visible.map((q) => (
          <Pressable
            key={q.id}
            style={styles.questionBtn}
            onPress={() => onAsk(sectionKey, q.questionText)}
            accessibilityRole="button"
          >
            <ChevronRight size={16} color={colors.red} />
            <Text style={styles.questionText}>{zh(q.questionText)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(226,61,40,0.05)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(226,61,40,0.15)',
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  title: { flex: 1, fontFamily: fonts.serifBold, fontSize: fontSize.sm, fontWeight: '700', color: colors.textAccent, lineHeight: 22 },
  titleCta: { color: colors.red, textDecorationLine: 'underline' },
  titleCtaPlain: { color: colors.textSecondary },
  questions: { gap: spacing.xs },
  questionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  questionText: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary, lineHeight: 22 },
});
