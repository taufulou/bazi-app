'use client';

import type { ChatMessage as ChatMessageType } from '../../lib/chat-types';
import styles from './ChatMessage.module.css';

interface ChatMessageProps {
  message: ChatMessageType;
  /** When true, the message is currently streaming (show caret). */
  isStreaming?: boolean;
}

export default function ChatMessage({
  message,
  isStreaming,
}: ChatMessageProps) {
  // Skip system / regrounding messages — they're not user-visible content.
  if (message.role === 'SYSTEM' || message.isRegrounding) return null;

  const isUser = message.role === 'USER';
  // REFUSED_PRE_FLIGHT is the intended successful response when refuse-list
  // matches (lottery, medical, legal, death prediction, etc.). It's stored
  // with an errorCode for telemetry but should NOT render as a failure.
  const isRefusal = message.errorCode === 'REFUSED_PRE_FLIGHT';
  const isFailed = (!!message.errorCode && !isRefusal) || !!message.refundedAt;

  return (
    <div
      className={`${styles.row} ${isUser ? styles.user : styles.assistant}`}
      data-streaming={isStreaming || undefined}
    >
      <div
        className={`${styles.bubble} ${isFailed ? styles.failed : ''}`}
      >
        {/* Preserve newlines from AI responses */}
        {message.content.split('\n').map((line, idx) => (
          <p key={idx} className={styles.line}>
            {line || ' '}
          </p>
        ))}
        {isStreaming && message.content.length === 0 && (
          <span className={styles.thinking}>正在思考...</span>
        )}
        {isStreaming && message.content.length > 0 && (
          <span className={styles.caret} aria-hidden>▍</span>
        )}
        {isFailed && message.errorCode && (
          <div className={styles.errorTag}>已取消（{message.errorCode}）</div>
        )}
      </div>
    </div>
  );
}
