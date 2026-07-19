/**
 * ChatComposer — message input + send (RN port of apps/web ChatComposer).
 *
 * forwardRef exposes an imperative `appendToDraft(text)` used by the sample-
 * questions sheet to POPULATE the draft (never auto-send — locked UX decision).
 *
 * The parent sheet owns the KeyboardAvoidingView; this component must NOT add
 * one. Multiline input grows up to ~4 lines then scrolls internally.
 */
import * as React from 'react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Send } from 'lucide-react-native';
import { CHAT_INPUT_MAX_LENGTH } from '@repo/shared';
import { colors, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';

/** Load-bearing entertainment disclaimer (mirrors web DISCLAIMER_FOOTER). */
const DISCLAIMER_FOOTER = '本服務僅供參考與娛樂用途，不構成任何專業建議';

/** Imperative API — populate-only (does NOT send). */
export interface ChatComposerHandle {
  appendToDraft: (t: string) => void;
}

interface ChatComposerProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** True while a send is in flight — disables input + shows a spinner. */
  sending?: boolean;
}

const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(
  function ChatComposer(
    { onSend, disabled = false, placeholder = '想問點什麼?', sending = false },
    ref,
  ) {
    const zh = useZh();
    const [draft, setDraft] = useState('');
    const inputRef = useRef<TextInput>(null);

    // Empty deps: `appendToDraft` uses functional setState (no stale closure)
    // and reads only refs. Update the array if prop deps get added here.
    useImperativeHandle(
      ref,
      () => ({
        appendToDraft: (text: string) => {
          const trimmed = text.trim();
          if (!trimmed) return;
          setDraft((cur) => (cur.length === 0 ? trimmed : `${cur}\n${trimmed}`));
          // Focus after the state commit re-renders the input.
          requestAnimationFrame(() => inputRef.current?.focus());
        },
      }),
      [],
    );

    const handleSend = () => {
      const trimmed = draft.trim();
      if (!trimmed || disabled || sending) return;
      onSend(trimmed);
      setDraft('');
    };

    const charCount = draft.length;
    const overLimit = charCount > CHAT_INPUT_MAX_LENGTH;
    const sendDisabled = disabled || sending || draft.trim().length === 0 || overLimit;

    return (
      <View style={styles.wrap}>
        <View style={styles.row}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={zh(placeholder)}
            placeholderTextColor={colors.textMuted}
            editable={!disabled && !sending}
            multiline
            textAlignVertical="top"
            maxLength={CHAT_INPUT_MAX_LENGTH + 50 /* let overflow show before block */}
            accessibilityLabel={zh('輸入訊息')}
          />
          <Pressable
            style={[styles.sendBtn, sendDisabled && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={sendDisabled}
            accessibilityRole="button"
            accessibilityLabel={zh('傳送')}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.textOnRed} />
            ) : (
              <Send size={20} strokeWidth={2} color={colors.textOnRed} />
            )}
          </Pressable>
        </View>

        <View style={styles.meta}>
          <Text style={[styles.charCounter, overLimit && styles.overLimit]}>
            {charCount} / {CHAT_INPUT_MAX_LENGTH}
          </Text>
        </View>

        <Text style={styles.disclaimer}>{zh(DISCLAIMER_FOOTER)}</Text>
      </View>
    );
  },
);

export default ChatComposer;

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.bgSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 112, // ~4 lines then scrolls
    borderWidth: 1,
    borderColor: colors.borderMedium,
    borderRadius: radius.lg,
    backgroundColor: colors.bgCard,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.base,
    color: colors.textPrimary,
    lineHeight: 26,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  meta: { flexDirection: 'row', justifyContent: 'flex-end' },
  charCounter: { fontSize: fontSize.xs, color: colors.textMuted },
  overLimit: { color: colors.error, fontWeight: '700' },
  disclaimer: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'center' },
});
