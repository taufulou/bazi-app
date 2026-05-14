'use client';

/**
 * ChatHistoryPanel — list of all chat sessions for this reading.
 *
 * Triggered from a header button in ChatDrawer. Toggles open/closed.
 * Each row shows: relative date, message count, last message preview, status
 * badge (進行中 / 已結束 / 已達上限). Clicking a row switches the active
 * session — closed/full sessions enter read-only "view mode" (composer
 * locked); open sessions resume normally.
 */

import { useMemo } from 'react';
import type { ChatSession } from '../../lib/chat-types';
import styles from './ChatHistoryPanel.module.css';

interface ChatHistoryPanelProps {
  isOpen: boolean;
  sessions: ChatSession[];
  loading: boolean;
  activeSessionId: string | null;
  hardCap: number;
  onPickSession: (sessionId: string) => void;
  onClose: () => void;
}

export default function ChatHistoryPanel({
  isOpen,
  sessions,
  loading,
  activeSessionId,
  hardCap,
  onPickSession,
  onClose,
}: ChatHistoryPanelProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.panel} role="region" aria-label="過往對話">
      <div className={styles.header}>
        <span className={styles.title}>過往對話</span>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="關閉過往對話列表"
        >
          ✕
        </button>
      </div>
      {loading && sessions.length === 0 && (
        <div className={styles.empty}>載入中...</div>
      )}
      {!loading && sessions.length === 0 && (
        <div className={styles.empty}>尚無過往對話</div>
      )}
      <ul className={styles.list}>
        {sessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            isActive={s.id === activeSessionId}
            hardCap={hardCap}
            onClick={() => onPickSession(s.id)}
          />
        ))}
      </ul>
    </div>
  );
}

// ============================================================
// SessionRow
// ============================================================

function SessionRow({
  session,
  isActive,
  hardCap,
  onClick,
}: {
  session: ChatSession;
  isActive: boolean;
  hardCap: number;
  onClick: () => void;
}) {
  const status = useMemo(() => {
    if (session.endedAt !== null) return { label: '已結束', tone: 'muted' as const };
    if (session.messageCount >= hardCap)
      return { label: '已達上限', tone: 'muted' as const };
    return { label: '進行中', tone: 'active' as const };
  }, [session.endedAt, session.messageCount, hardCap]);

  return (
    <li>
      <button
        type="button"
        className={`${styles.row} ${isActive ? styles.activeRow : ''}`}
        onClick={onClick}
        aria-current={isActive ? 'true' : undefined}
      >
        <div className={styles.rowTopLine}>
          <span className={styles.date}>{formatRelativeDate(session.startedAt)}</span>
          <span
            className={`${styles.statusBadge} ${
              status.tone === 'active' ? styles.statusActive : styles.statusMuted
            }`}
          >
            {isActive ? '目前對話' : status.label}
          </span>
        </div>
        <div className={styles.rowMeta}>
          {session.messageCount} / {hardCap} 則
          {/* 剩餘付費 badge tells the user how many paid messages are still
              usable in this session if they choose to resume it. Only show
              for sessions that are still chattable — i.e., NOT ended AND
              NOT at hard cap. For sessions at 30/30 or explicitly ended,
              those paid messages are effectively forfeit; showing the
              count would mislead users into thinking they can still use
              them. */}
          {status.tone === 'active' && session.unusedPaidMessages > 0 && (
            <span className={styles.paidBadge}>
              · 剩餘付費 {session.unusedPaidMessages}
            </span>
          )}
        </div>
        {session.lastMessagePreview && (
          <div className={styles.preview}>{session.lastMessagePreview}</div>
        )}
      </button>
    </li>
  );
}

// ============================================================
// Date formatting
// ============================================================

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return '剛才';
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  if (diffHr < 24) return `${diffHr} 小時前`;
  if (diffDay < 7) return `${diffDay} 天前`;

  // Fallback: zh-TW short date.
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const sameYear = date.getFullYear() === now.getFullYear();
  return sameYear
    ? `${month}/${day}`
    : `${date.getFullYear()}/${month}/${day}`;
}
