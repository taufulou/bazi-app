'use client';

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { CHAT_INPUT_MAX_LENGTH } from '@repo/shared';
import styles from './ChatComposer.module.css';
import { DISCLAIMER_FOOTER } from './dialog-copy';

interface ChatComposerProps {
  onSend: (content: string) => void;
  disabled: boolean;
  placeholder?: string;
  /** When set, the input is read-only (e.g., hard cap reached). */
  readOnlyReason?: string;
}

/**
 * Phase 4 — imperative handle exposed via forwardRef. Used by
 * `SampleQuestionsBrowser` (via ChatDrawer) to populate the draft from
 * outside without lifting state. Narrow API surface:
 *
 *   - appendToDraft(text): adds `text` to current draft (with `\n` separator
 *     if non-empty). Focuses the textarea after append. NO-OP if the
 *     textarea is not currently mounted (composer in readOnly mode) —
 *     drawer-level guards prevent this path from firing in that state.
 *   - focusInput(): focuses the textarea (no other effect).
 */
export interface ChatComposerHandle {
  appendToDraft: (text: string) => void;
  focusInput: () => void;
}

const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(
  { onSend, disabled, placeholder = '想問點什麼?', readOnlyReason },
  ref,
) {
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Phase 4 — imperative handle. Deps array is intentionally empty:
  //   * `appendToDraft` uses functional `setDraft((cur) => ...)` so no
  //     stale closure on `draft` state.
  //   * `focusInput` reads from `textareaRef.current` (a ref, not state).
  // If future maintenance adds prop dependencies inside either method,
  // the deps array MUST be updated accordingly.
  useImperativeHandle(
    ref,
    () => ({
      appendToDraft: (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setDraft((cur) =>
          cur.length === 0 ? trimmed : `${cur}\n${trimmed}`,
        );
        // After state commits + textarea re-renders, focus + place cursor at end.
        requestAnimationFrame(() => {
          const ta = textareaRef.current;
          if (!ta) return; // readOnly mode — textarea not mounted; no-op
          ta.focus();
          const end = ta.value.length;
          ta.setSelectionRange(end, end);
        });
      },
      focusInput: () => {
        textareaRef.current?.focus();
      },
    }),
    [],
  );

  const handleSend = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setDraft('');
  }, [draft, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const charCount = draft.length;
  const overLimit = charCount > CHAT_INPUT_MAX_LENGTH;
  const sendDisabled = disabled || draft.trim().length === 0 || overLimit;

  return (
    <div className={styles.wrap}>
      {readOnlyReason ? (
        <div className={styles.readOnly}>{readOnlyReason}</div>
      ) : (
        <div className={styles.row}>
          <textarea
            ref={textareaRef}
            className={styles.input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            aria-label="輸入訊息"
            maxLength={CHAT_INPUT_MAX_LENGTH + 50 /* let user see overflow before block */}
          />
          <button
            // Polish item 2 — explicit type="button" so this button never
            // accidentally submits a parent <form> if the composer is ever
            // wrapped in one (defaults to type="submit" inside forms).
            type="button"
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={sendDisabled}
            aria-label="傳送"
          >
            {disabled ? '...' : '傳送'}
          </button>
        </div>
      )}
      {!readOnlyReason && (
        <div className={styles.meta}>
          <span
            className={`${styles.charCounter} ${overLimit ? styles.overLimit : ''}`}
          >
            {charCount} / {CHAT_INPUT_MAX_LENGTH}
          </span>
        </div>
      )}
      <div className={styles.disclaimer}>{DISCLAIMER_FOOTER}</div>
    </div>
  );
});

export default ChatComposer;
