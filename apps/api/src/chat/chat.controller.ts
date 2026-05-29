import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Res,
  ParseIntPipe,
  ParseUUIDPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { CurrentUser, AuthPayload } from '../auth/current-user.decorator';
import { ChatService } from './chat.service';
import { ChatStreamService } from './chat-stream.service';
import {
  CreateChatSessionDto,
  CreateChatSessionResponse,
  SendMessageDto,
  SendMessageResponse,
  ExtendSessionDto,
  ExtendSessionResponse,
  ChatSessionSummary,
  ChatMessageListResponse,
  ChatUsageResponse,
} from './dto';

@ApiTags('Chat')
@Controller('api/chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly streamService: ChatStreamService,
  ) {}

  // ============================================================
  // Session lifecycle
  // ============================================================

  @Post('sessions')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new chat session for a reading',
    description:
      'Creates a session row but does NOT deduct credit/quota yet — that happens on first message via per-message dispatch (free quota → paid allowance → reject).',
  })
  // 5 sessions per hour per user (CHAT_SESSIONS_PER_HOUR)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  async createSession(
    @CurrentUser() auth: AuthPayload,
    @Body() dto: CreateChatSessionDto,
  ): Promise<CreateChatSessionResponse> {
    return this.chatService.createSession(auth.userId, {
      readingId: dto.readingId,
      comparisonId: dto.comparisonId,
      fortune: dto.fortune,
    });
  }

  @Get('readings/:readingId/sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List past chat sessions for a reading' })
  async listSessionsForReading(
    @CurrentUser() auth: AuthPayload,
    @Param('readingId', ParseUUIDPipe) readingId: string,
  ): Promise<ChatSessionSummary[]> {
    return this.chatService.listSessionsForReading(auth.userId, readingId);
  }

  // Phase 3 — parallel endpoint for COMPATIBILITY sessions
  @Get('comparisons/:comparisonId/sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List past chat sessions for a comparison (Phase 3)' })
  async listSessionsForComparison(
    @CurrentUser() auth: AuthPayload,
    @Param('comparisonId', ParseUUIDPipe) comparisonId: string,
  ): Promise<ChatSessionSummary[]> {
    return this.chatService.listSessionsForComparison(auth.userId, comparisonId);
  }

  // Phase Fortune — parallel endpoint for FORTUNE sessions. anchorDate
  // query parameter is REQUIRED — frontend hook filters by it so date
  // navigation spawns new sessions per plan Issue 10.
  //
  // Phase 2.x L3.5b audit H#1 — fortuneScope query param added. Required
  // for MONTH scope. Defaults to DAY for back-compat (pre-L3.5b callers).
  // Without it, MONTH sessions and DAY sessions collide on 1st-of-month
  // anchors and the list contains both scopes' rows (cross-scope leak).
  @Get('profiles/:profileId/fortune-sessions')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List FORTUNE chat sessions for a (profile, anchorDate, fortuneScope) triplet (Phase Fortune)',
    description:
      'anchorDate is required (YYYY-MM-DD). fortuneScope is optional (defaults to DAY for back-compat). Returns sessions matching the exact anchor + scope; date navigation spawns a new session rather than resuming yesterday\'s.',
  })
  async listSessionsForFortune(
    @CurrentUser() auth: AuthPayload,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Query('anchorDate') anchorDate: string,
    @Query('fortuneScope') fortuneScope?: string,
  ): Promise<ChatSessionSummary[]> {
    if (!anchorDate || !/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
      throw new BadRequestException({
        code: 'INVALID_ANCHOR_DATE',
        message: 'anchorDate query parameter is required in YYYY-MM-DD format',
      });
    }
    // Validate scope when provided; back-compat default is DAY.
    let normalizedScope: 'DAY' | 'MONTH' | 'YEAR' | undefined;
    if (fortuneScope !== undefined && fortuneScope !== '') {
      if (
        fortuneScope !== 'DAY' &&
        fortuneScope !== 'MONTH' &&
        fortuneScope !== 'YEAR'
      ) {
        throw new BadRequestException({
          code: 'INVALID_FORTUNE_SCOPE',
          message: 'fortuneScope must be one of: DAY, MONTH, YEAR',
        });
      }
      normalizedScope = fortuneScope;
    } else {
      // Back-compat: no scope param → assume DAY (pre-L3.5b behaviour).
      normalizedScope = 'DAY';
    }
    return this.chatService.listSessionsForFortune(auth.userId, {
      profileId,
      fortuneAnchorDate: anchorDate,
      fortuneScope: normalizedScope,
    });
  }

  @Get('sessions/:sessionId/messages')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Paginated chat messages for a session ("Load 5 more")',
    description:
      'Returns messages newest-first. cursor=number-of-already-loaded-messages.',
  })
  async getMessages(
    @CurrentUser() auth: AuthPayload,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Query('cursor', new DefaultValuePipe(0), ParseIntPipe) cursor: number,
    @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number,
  ): Promise<ChatMessageListResponse> {
    return this.chatService.getMessages(auth.userId, sessionId, cursor, limit);
  }

  // ============================================================
  // Message handling (non-streaming for Phase 1.3; SSE in Phase 1.6)
  // ============================================================

  @Post('sessions/:sessionId/messages')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Send a chat message and stream AI reply via SSE (Phase 1.6 streaming)',
    description:
      'Per-message free-quota → paid-allowance → reject. Token-by-token SSE streaming. May emit error events: NEEDS_EXTENSION (call /extend), HARD_CAP_REACHED, CONCURRENT_STREAM (existing stream still running on this session), AI_CALL_FAILED (refund issued).',
  })
  // 30 messages per minute per user (CHAT_MESSAGES_PER_MINUTE)
  @Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
  async streamMessage(
    @CurrentUser() auth: AuthPayload,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: SendMessageDto,
    @Res() response: Response,
  ): Promise<void> {
    await this.streamService.streamMessage(
      auth.userId,
      sessionId,
      dto.content,
      dto.sectionContextHint,
      response,
    );
  }

  /**
   * Non-streaming variant — kept for unit testing & CLI eval. Production
   * frontend uses the streaming POST /messages endpoint above.
   */
  @Post('sessions/:sessionId/messages-sync')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Non-streaming chat message (Phase 1.3 testing endpoint)',
    description:
      'Returns full reply at once. Used by CI eval corpus + unit tests where streaming is not needed.',
  })
  @Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
  async sendMessageSync(
    @CurrentUser() auth: AuthPayload,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: SendMessageDto,
  ): Promise<SendMessageResponse> {
    return this.chatService.sendMessage(
      auth.userId,
      sessionId,
      dto.content,
      dto.sectionContextHint,
    );
  }

  @Post('sessions/:sessionId/extend')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Purchase a 10-message paid allowance extension for the session',
    description:
      'Deducts 1 credit, increments creditExtensions. Capped so total session messageCount cannot exceed 30. Frontend must pre-warn user when remaining capacity (30 - messageCount) < 10 (partial-credit edge case at msg 25). Concurrent purchase requests on the same session are deduplicated via Redis SETNX — a second in-flight call returns 409 with code EXTEND_IN_PROGRESS.',
  })
  @Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
  async extendSession(
    @CurrentUser() auth: AuthPayload,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() _dto: ExtendSessionDto,
  ): Promise<ExtendSessionResponse> {
    return this.chatService.extendSession(auth.userId, sessionId);
  }

  // ============================================================
  // Usage telemetry for the QuotaBadge UI
  // ============================================================

  @Get('usage/me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current month chat usage and rate-limit info',
    description:
      'Returns synthetic default {chatsUsed:0, monthlyQuota:tierQuota} when no row exists for the current month — does NOT create a row (avoids empty-row noise from users who never chat).',
  })
  async getUsage(
    @CurrentUser() auth: AuthPayload,
  ): Promise<ChatUsageResponse> {
    return this.chatService.getUsage(auth.userId);
  }
}
