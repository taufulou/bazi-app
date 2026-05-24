/**
 * AI Chat — Frontend-local types.
 *
 * Mirrors the shared types added in plan section "Shared Types". Defined
 * here (rather than in `@repo/shared`) so the worktree's frontend code
 * doesn't depend on the symlinked shared package being repointed during
 * iteration. Once merged, these types should also be exported from
 * `packages/shared/src/types.ts` (already done in this branch) and
 * imports can switch over.
 */

/** Role of a chat message — mirrors Prisma ChatRole enum on the API side. */
export type ChatRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

/** Identifies one of the chat dialog/banner copy strings. */
export type ChatDialogKey =
  | 'extend_standard'
  | 'turn20_warning_zero_balance'
  | 'turn20_warning_with_balance'
  | 'near_cap_warning'
  | 'hard_cap_reached'
  | 'new_session_lose_paid'
  | 'quota_badge'
  | 'disclaimer_footer';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  isRegrounding: boolean;
  errorCode: string | null;
  refundedAt: string | null;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  messageCount: number;
  unusedPaidMessages: number;
  lastMessagePreview: string | null;
  // Phase Fortune — only populated when this is a FORTUNE session. Lets
  // ChatHistoryPanel render «{fortuneAnchorDate} · X 則對話» rows + filter
  // by active anchor (plan MC-4 + Issue 10 — date-filtered resume).
  fortuneScope?: 'DAY' | 'MONTH' | 'YEAR' | null;
  fortuneAnchorDate?: string | null; // ISO YYYY-MM-DD
  profileId?: string | null;
}

export type ChatStreamEvent =
  | { type: 'session_start'; messageId: string }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      messageId: string;
      messageCount: number;
      messagesRemaining: number;
      usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
      };
    }
  | {
      type: 'error';
      code: string;
      message: string;
      refunded?: boolean;
      refundMethod?: string | null;
    };

export interface ChatExtendResponse {
  paidMessagesAllowance: number;
  messagesUntilHardCap: number;
  creditExtensions: number;
}

export interface ChatUsageResponse {
  thisMonth: {
    chatsUsed: number;
    monthlyQuota: number;
    resetsAt: string;
    subscriptionTier: string;
  };
  sessionsThisHour: number;
  hourlyRateLimit: number;
  recentTierUpgradeRefund: {
    creditsRefunded: number;
    refundedAt: string;
  } | null;
}
