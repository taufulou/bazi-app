import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { MessageCircle } from 'lucide-react-native';
import ChatFloatingButton from '../chat/ChatFloatingButton';
import ChatSheet from '../chat/ChatSheet';
import { useSampleQuestions } from '../chat/hooks/useSampleQuestions';
import { colors, spacing, fontSize, radius, fonts } from '../../theme';
import { useZh } from '../../lib/language';

export type FortuneScope = 'DAY' | 'MONTH' | 'YEAR';

/**
 * 問 AI 命理師 overlay for the 運勢 tabs — the floating button + the chat sheet.
 * CONTROLLED: the parent (FortuneScreen) owns open/pending state so the inline
 * SampleQuestionStrip (which lives in the scroll flow) and this overlay can share
 * one sheet. Mirrors web, which mounts chat on all three fortune tabs.
 *
 * The whole FORTUNE chat stack already existed on mobile (chat-api's
 * FortuneSubject, ChatSheet's `fortune` prop, useChatSession's `fortune` arg) and
 * the backend ships DAY/MONTH/YEAR scopes — it was simply never mounted, so the
 * feature was unreachable on the phone.
 *
 * Renders nothing until profile + anchor resolve: a FORTUNE session needs
 * profileId + scope + anchorDate, and the backend rejects a session without them.
 */
export default function FortuneChat({
  profileId,
  scope,
  anchorDate,
  open,
  pending,
  onOpenChange,
  onPendingConsumed,
}: {
  profileId?: string;
  /** DAY → the viewed date · MONTH → 1st of month · YEAR → Jan 1 (backend normalizes). */
  scope: FortuneScope;
  anchorDate?: string;
  open: boolean;
  pending?: string;
  onOpenChange: (open: boolean) => void;
  onPendingConsumed: () => void;
}) {
  if (!profileId || !anchorDate) return null;

  return (
    <>
      <ChatFloatingButton onPress={() => onOpenChange(true)} />
      <ChatSheet
        visible={open}
        onClose={() => onOpenChange(false)}
        readingType="FORTUNE"
        fortune={{ profileId, fortuneScope: scope, fortuneAnchorDate: anchorDate }}
        pendingInitialMessage={pending}
        onPendingInitialMessageConsumed={onPendingConsumed}
        // Populate-only: a tapped question fills the composer, never auto-sends
        // (locked UX rule — the user always presses send).
        populateOnly
      />
    </>
  );
}

/**
 * 想問什麼？ — horizontal pill strip of «general» FORTUNE chat questions, mirroring
 * web's FortuneSampleQuestions (rendered below the daily NarrativeCard). Tapping a
 * pill calls `onPick`, which the parent uses to open the shared sheet with that
 * question prefilled. In-flow (scrolls with the page), so it's separate from the
 * overlay above.
 */
export function SampleQuestionStrip({ onPick }: { onPick: (question: string) => void }) {
  const zh = useZh();
  // General FORTUNE questions live at sectionKey=null. General questions are shared
  // across scopes, so the hook's default DAY scope is fine here.
  const { questions, loading } = useSampleQuestions('FORTUNE', null);

  if (loading || questions.length === 0) return null;
  const visible = questions.slice(0, 6);

  return (
    <View style={styles.stripCard}>
      <View style={styles.stripHeader}>
        <MessageCircle size={16} color={colors.textAccent} />
        <Text style={styles.stripTitle}>{zh('想問 AI 命理師什麼？')}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
        {visible.map((q) => (
          <Pressable
            key={q.id}
            style={styles.pill}
            onPress={() => onPick(q.questionText)}
            accessibilityRole="button"
          >
            <Text style={styles.pillText}>{zh(q.questionText)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  stripCard: { gap: spacing.sm },
  stripHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stripTitle: {
    fontFamily: fonts.serifBold,
    fontSize: fontSize.sm,
    color: colors.textAccent,
    fontWeight: '700',
  },
  pills: { gap: spacing.sm, paddingRight: spacing.md },
  pill: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    maxWidth: 260,
  },
  pillText: { fontSize: fontSize.sm, color: colors.textPrimary, lineHeight: 20 },
});
