/**
 * AI Chat — frontend-local types (RN). Verbatim port of apps/web chat-types.ts
 * (mirrors the NestJS chat DTOs / Prisma enums).
 */

/** Role of a chat message — mirrors Prisma ChatRole enum. */
export type ChatRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

/** Identifies one of the chat dialog/banner copy strings. */
export type ChatDialogKey =
  | 'extend_standard'
  | 'turn20_warning_zero_balance'
  | 'turn20_warning_with_balance'
  | 'near_cap_warning'
  | 'hard_cap_reached'
  | 'new_session_lose_paid'
  | 'refuse_limit_reached'
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
  fortuneScope?: 'DAY' | 'MONTH' | 'YEAR' | null;
  fortuneAnchorDate?: string | null; // ISO YYYY-MM-DD
  profileId?: string | null;
  consecutiveRefuses?: number;
}

export type ChatStreamEvent =
  | { type: 'session_start'; messageId: string }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      messageId: string;
      messageCount: number;
      messagesRemaining: number;
      consecutiveRefuses: number;
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
