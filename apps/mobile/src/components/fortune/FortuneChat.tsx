import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MessageCircle } from 'lucide-react-native';
import ChatFloatingButton from '../chat/ChatFloatingButton';
import ChatSheet from '../chat/ChatSheet';
import { useSampleQuestions } from '../chat/hooks/useSampleQuestions';
import { colors, spacing, fontSize, radius, fonts, text as T } from '../../theme';
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
  /** Forwarded to the FAB so the fortune screen can park it while scrolling down. */
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
  // Four, not six: these wrap onto ~2 rows at 360dp, and the block is a nudge to
  // start a conversation rather than a menu to read through.
  const visible = questions.slice(0, 4);

  return (
    <View style={styles.stripCard}>
      <View style={styles.stripHeader}>
        <MessageCircle size={16} color={colors.textAccent} />
        <Text style={styles.stripTitle}>{zh('想問 AI 命理師什麼？')}</Text>
      </View>
      <View style={styles.pills}>
        {visible.map((q) => (
          <Pressable
            key={q.id}
            style={styles.pill}
            onPress={() => onPick(q.questionText)}
            accessibilityRole="button"
          >
            <Text style={styles.pillText} numberOfLines={2} ellipsizeMode="tail">
              {zh(q.questionText)}
            </Text>
          </Pressable>
        ))}
      </View>
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
  // A WRAPPING row, not a horizontal ScrollView. The carousel put every question
  // past the second one off-screen with no affordance that it was scrollable, so
  // readers simply never saw four of the six. Wrapping shows them all at once.
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderMedium,
    // No maxWidth: in a wrapping row a cap just forces a mid-question ellipsis.
    // flexShrink lets a long pill give way instead of pushing past the edge.
    flexShrink: 1,
  },
  // numberOfLines + ellipsize on the <Text>: `flexShrink` above lets a long pill
  // give way rather than push past the edge, and without a line cap the text
  // inside it would just keep wrapping. Two lines keeps virtually every question
  // whole; anything past that ends in an ellipsis rather than a silent cut.
  pillText: { ...T.bodyTight, color: colors.textPrimary },
});
