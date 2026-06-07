/**
 * DTOs for the AI chat feature endpoints.
 *
 * Per next-the-big-feature-proud-manatee plan — Phase 1.3 (non-streaming first).
 * Streaming response shapes (SSE) come in Phase 1.6.
 */
import {
  IsString,
  IsOptional,
  MaxLength,
  IsInt,
  Min,
  IsUUID,
  IsIn,
  IsDateString,
  ValidateNested,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

// mirrors @repo/shared CHAT_INPUT_MAX_LENGTH (NestJS has known runtime issue
// importing @repo/shared at runtime — see CLAUDE.md «@repo/shared runtime issue»)
export const CHAT_INPUT_MAX_LENGTH_LOCAL = 500;

// ============================================================
// POST /api/chat/sessions
// ============================================================

/** Phase Fortune — nested discriminator for FORTUNE chat scope. All 3 fields
 *  required together; missing any one is rejected at DTO level.
 *  Note: `fortuneScope` is currently DAY-only (Phase Fortune ships daily;
 *  MONTH/YEAR deferred). */
export class FortuneSubjectDto {
  @IsUUID()
  profileId!: string;

  @IsIn(['DAY', 'MONTH', 'YEAR'])
  fortuneScope!: 'DAY' | 'MONTH' | 'YEAR';

  /** ISO YYYY-MM-DD. Caller (frontend) is responsible for resolving the
   *  23:00 子時 boundary against Asia/Taipei BEFORE sending — backend
   *  trusts the value and uses it verbatim as the BaziDate anchor. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fortuneAnchorDate must be YYYY-MM-DD',
  })
  // Review fix: strict ISO-8601 rejects impossible dates (2026-02-30) that the
  // format regex alone would let through to a DB 500.
  @IsDateString({ strict: true }, { message: 'fortuneAnchorDate must be a valid calendar date' })
  fortuneAnchorDate!: string;
}

export class CreateChatSessionDto {
  // Phase 3 — exactly one of (readingId, comparisonId, fortune) must be set
  // (XOR enforced at service layer). Phase Fortune adds the nested
  // `fortune` discriminator for FORTUNE chat sessions which reference a
  // BirthProfile + fortuneScope + fortuneAnchorDate instead of a
  // BaziReading or BaziComparison.
  @IsOptional()
  @IsUUID()
  readingId?: string;

  @IsOptional()
  @IsUUID()
  comparisonId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => FortuneSubjectDto)
  fortune?: FortuneSubjectDto;
}

export interface CreateChatSessionResponse {
  sessionId: string;
  freeQuotaRemaining: number;
  monthlyQuota: number;
  /** Session-level paid allowance from prior extensions (always 0 for new session). */
  currentSessionAllowance: number;
  /** Sessions started in the rolling 1h window (from rate limiter). */
  sessionsThisHour: number;
  /** Snapshot of context version at session creation — used to detect mid-session
   *  drift if Phase 1.5 ships a new chat-prompt version. */
  contextVersion: string;
}

// ============================================================
// POST /api/chat/sessions/:sessionId/messages
// ============================================================

export class SendMessageDto {
  @IsString()
  @MaxLength(CHAT_INPUT_MAX_LENGTH_LOCAL, {
    message: 'Message too long; max 500 characters',
  })
  content!: string;

  /** Section the user clicked the InlineAskCard from (e.g. "love_pattern").
   *  Metadata only — does NOT filter the slim payload. The full chat context
   *  is always shipped to the AI per plan Layer 5 (Issue 19 fix). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sectionContextHint?: string;
}

export interface SendMessageResponse {
  messageId: string;
  assistantMessage: string;
  /** How many messages remain on this session's allowance (free + paid combined). */
  messagesRemaining: number;
  /** Total messages in this session AFTER persisting this exchange. */
  messageCount: number;
  /** Hard cap from plan — currently 30. */
  hardCap: number;
  /** Phase 1.6 will switch to SSE streaming. Phase 1.3 returns the full reply at once. */
  streaming: false;
  /** Token + cost telemetry per message — populated only when AI call succeeded. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
}

// ============================================================
// POST /api/chat/sessions/:sessionId/extend
// ============================================================

export class ExtendSessionDto {}

export interface ExtendSessionResponse {
  paidMessagesAllowance: number;
  messagesUntilHardCap: number;
  creditExtensions: number;
}

// ============================================================
// GET /api/chat/readings/:readingId/sessions
// ============================================================

export interface ChatSessionSummary {
  id: string;
  startedAt: string; // ISO
  endedAt: string | null;
  messageCount: number;
  /** Number of paid messages in this session that the user did NOT consume.
   *  Used by the frontend's "new-session-loses-paid" warning dialog. */
  unusedPaidMessages: number;
  lastMessagePreview: string | null;
  /** Phase Fortune — populated only when this is a FORTUNE session. Lets
   *  the frontend ChatHistoryPanel render «{fortuneAnchorDate} · X 則對話»
   *  rows and filter by the currently-active anchor date (MC-4). */
  fortuneScope?: 'DAY' | 'MONTH' | 'YEAR' | null;
  fortuneAnchorDate?: string | null; // ISO YYYY-MM-DD
  /** Phase Fortune — denormalized BirthProfile reference for FORTUNE
   *  sessions. NULL for non-FORTUNE sessions. */
  profileId?: string | null;
  /** Phase Fortune+ — current consecutive topic-boundary refuse count.
   *  Resets to 0 on any in-topic message. Used by ChatDrawer to render the
   *  «超出範圍提醒» soft-warning dialog when the cap fires (see
   *  CHAT_CONSECUTIVE_REFUSE_WARNING_THRESHOLD in @repo/shared). */
  consecutiveRefuses?: number;
}

// ============================================================
// GET /api/chat/sessions/:sessionId/messages
// ============================================================

export interface ChatMessageDto {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  sectionContextHint: string | null;
  isRegrounding: boolean;
  errorCode: string | null;
  refundedAt: string | null;
  createdAt: string; // ISO
}

export interface ChatMessageListResponse {
  messages: ChatMessageDto[];
  /** Cursor for next page; null if no more. */
  nextCursor: number | null;
  totalCount: number;
}

// ============================================================
// GET /api/chat/usage/me
// ============================================================

export interface ChatUsageResponse {
  thisMonth: {
    chatsUsed: number;
    monthlyQuota: number;
    resetsAt: string; // ISO
    subscriptionTier: string;
  };
  sessionsThisHour: number;
  hourlyRateLimit: number;
  /** Tier-upgrade refund banner (Option A1). Surfaces a recent (within
   *  24h) refund of stranded paid messages so the chat drawer can show
   *  a one-time banner. */
  recentTierUpgradeRefund: {
    creditsRefunded: number;
    refundedAt: string; // ISO
  } | null;
}
