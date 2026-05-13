'use client';

import { useEffect, useRef } from 'react';
import type { ChatMessage as ChatMessageType } from '../../lib/chat-types';
import ChatMessage from './ChatMessage';
import styles from './ChatThread.module.css';

interface ChatThreadProps {
  messages: ChatMessageType[];
  loading: boolean;
  hasMoreHistory: boolean;
  loadMoreLoading: boolean;
  onLoadMore: () => void;
  /** True while a stream is in flight; affects the trailing assistant caret. */
  streaming: boolean;
  /** Optional empty-state slot rendered when no messages and not loading. */
  emptyState?: React.ReactNode;
}

export default function ChatThread({
  messages,
  loading,
  hasMoreHistory,
  loadMoreLoading,
  onLoadMore,
  streaming,
  emptyState,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastLengthRef = useRef(0);

  // Auto-scroll to bottom when a new message is appended OR a streaming
  // delta lands. We only auto-scroll when the user is already near bottom,
  // so users reading history aren't yanked away.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const lastMessage = messages[messages.length - 1];
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const wasShortlyBelow = distanceFromBottom < 80;
    const grew = messages.length > lastLengthRef.current;
    const isOwnMessage = lastMessage?.role === 'USER';
    if (grew || wasShortlyBelow || isOwnMessage) {
      el.scrollTop = el.scrollHeight;
    }
    lastLengthRef.current = messages.length;
  }, [messages]);

  // Filter out regrounding/system messages once for empty-state check.
  const visibleMessages = messages.filter(
    (m) => m.role !== 'SYSTEM' && !m.isRegrounding,
  );
  const showEmpty = !loading && visibleMessages.length === 0;

  return (
    <div ref={scrollRef} className={styles.thread}>
      {hasMoreHistory && (
        <div className={styles.loadMoreWrap}>
          <button
            className={styles.loadMoreBtn}
            onClick={onLoadMore}
            disabled={loadMoreLoading}
          >
            {loadMoreLoading ? '載入中...' : '載入前 5 則'}
          </button>
        </div>
      )}

      {loading && messages.length === 0 && (
        <div className={styles.loading}>正在載入對話...</div>
      )}

      {showEmpty && emptyState}

      {messages.map((m, idx) => {
        const isLast = idx === messages.length - 1;
        const isStreamingThis =
          isLast && streaming && m.role === 'ASSISTANT';
        return (
          <ChatMessage
            key={m.id}
            message={m}
            isStreaming={isStreamingThis}
          />
        );
      })}
    </div>
  );
}
