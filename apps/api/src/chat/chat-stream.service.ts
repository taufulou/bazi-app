import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { ChatRole } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  ChatPaymentService,
  CHAT_SESSION_HARD_CAP_MESSAGES,
  CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT,
} from './chat-payment.service';
import { ChatContextService } from './chat-context.service';
import { ChatValidatorsService } from './chat-validators.service';
import { buildPrompt } from './chat-prompt-builder';
import { sanitizeUserContent } from './chat.service';
import { isTopicBoundaryRefuse } from '../ai/prompts';

// ============================================================
// Constants
// ============================================================

const CHAT_OUTPUT_MAX_TOKENS_LOCAL = 800;
const CHAT_REGROUNDING_TRIGGER_TURN_LOCAL = 4;
const CHAT_RECENT_MESSAGES_FOR_PROMPT = 10;

/** Watchdog: if no text_delta event for this many milliseconds, abort the
 *  stream + refund. Per plan Layer 6 streaming pipeline step 10. */
const STREAM_WATCHDOG_MS = 60_000;

/** Anthropic SDK timeout. Hard ceiling for the entire stream duration. */
const ANTHROPIC_STREAM_TIMEOUT_MS = 90_000;

/**
 * Redis lock TTL for concurrent-stream prevention. MUST be > Anthropic
 * timeout — otherwise the lock could expire mid-stream and a second
 * concurrent stream could acquire it, defeating the lock's purpose
 * (Phase 1.6 audit Bug B).
 */
const STREAM_LOCK_TTL_SECONDS = 150;

// ============================================================
// SSE event types — wire protocol contract with frontend
// ============================================================

type StreamEvent =
  | { type: 'session_start'; messageId: string }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      messageId: string;
      messageCount: number;
      messagesRemaining: number;
      /**
       * Phase Fortune+ — current value of `ChatSession.consecutiveRefuses`
       * after this message is persisted. Surfaced so the frontend can fire
       * the soft-warning dialog the moment refunding stops (cost-defense
       * policy, see CHAT_CONSECUTIVE_REFUSE_WARNING_THRESHOLD).
       */
      consecutiveRefuses: number;
      usage: TokenUsage;
    }
  | { type: 'error'; code: string; message: string; refunded?: boolean; refundMethod?: string | null };

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// ============================================================
// Service
// ============================================================

/**
 * SSE streaming for chat messages (Phase 1.6 of the
 * next-the-big-feature-proud-manatee plan).
 *
 * Replaces the non-streaming `ChatService.sendMessage` flow with token-by-token
 * SSE streaming via Anthropic SDK `messages.stream()`. Adds:
 * - **Concurrent-stream lock**: per-session Redis SETNX prevents double-stream
 *   from rapid double-click. Lock TTL 90s (worst-case stream duration).
 * - **60s watchdog**: if no `text_delta` event arrives for 60s, abort + refund.
 *   Default Anthropic SDK timeout is ~10min — without this, hung upstream
 *   pins server resources and accrues output tokens.
 * - **Pre-flight refusal short-circuit**: refuse-list match writes synthetic
 *   refusal as a single 'done' event, no Anthropic call.
 *
 * Layer 5.1 `<system-reminder>` re-grounding inherited from `chat-prompt-builder`.
 *
 * Wire protocol (SSE events):
 *   data: {"type":"session_start","messageId":"..."}
 *   data: {"type":"delta","text":"根據"}
 *   data: {"type":"delta","text":"您的"}
 *   ...
 *   data: {"type":"done","messageId":"...","messageCount":5,"messagesRemaining":10,"usage":{...}}
 *
 * Or on error:
 *   data: {"type":"error","code":"AI_CALL_FAILED","message":"...","refunded":true,"refundMethod":"FREE_QUOTA"}
 */
@Injectable()
export class ChatStreamService {
  private readonly logger = new Logger(ChatStreamService.name);
  private readonly anthropic: Anthropic;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly paymentService: ChatPaymentService,
    private readonly contextService: ChatContextService,
    private readonly validators: ChatValidatorsService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY not set — chat will fail at runtime');
    }
    this.anthropic = new Anthropic({ apiKey: apiKey || 'placeholder' });
    // Phase 1.5 follow-up C iter 2: upgraded default from Sonnet 4.5 to
    // Sonnet 4.6 after eval showed dramatic accuracy improvement (judge
    // fail rate 39.6% → 11.3%). Identical pricing. See chat.service.ts
    // line 57 for matching change.
    this.model = this.config.get<string>('CLAUDE_MODEL') || 'claude-sonnet-4-6';
  }

  /**
   * Stream a chat message via SSE. Manages session lifecycle, payment,
   * refusal pre-flight, Anthropic streaming, watchdog, refund, and SSE
   * wire protocol.
   *
   * Caller (controller) handles HTTP response setup (text/event-stream
   * headers, etc.) and passes the Express Response to this method.
   * The service writes events and closes the response.
   */
  async streamMessage(
    clerkUserId: string,
    sessionId: string,
    rawContent: string,
    sectionContextHint: string | undefined,
    response: Response,
  ): Promise<void> {
    // Setup SSE response headers (caller may have set, but ensure)
    if (!response.headersSent) {
      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
      // Phase 1.6 audit Bug D: flush headers immediately so the client sees
      // the connection establish before the first SSE event. Without this,
      // some proxies buffer the response until the first body write —
      // adding 200-500ms of perceived latency.
      response.flushHeaders();
    }

    // ============================================================
    // Pre-flight: auth, ownership, validation, lock acquisition
    // ============================================================

    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) {
      this._emitError(response, 'NOT_FOUND', 'User not found');
      return;
    }

    const sanitizedContent = sanitizeUserContent(rawContent);
    const refusal = this.validators.refuseListPreFlight(sanitizedContent);

    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      this._emitError(response, 'NOT_FOUND', `Session ${sessionId} not found`);
      return;
    }
    if (session.userId !== user.id) {
      this._emitError(response, 'FORBIDDEN', 'Session not owned by this user');
      return;
    }

    const sessionAgeMs = Date.now() - session.startedAt.getTime();
    if (sessionAgeMs > 24 * 60 * 60 * 1000) {
      this._emitError(response, 'SESSION_EXPIRED',
        'Session older than 24h. Start a new session.');
      return;
    }
    if (session.endedAt !== null) {
      this._emitError(response, 'SESSION_ENDED', 'Session has ended');
      return;
    }

    // Mid-session version drift check (Layer 4) — Phase 2 (round-2 NEW#2)
    // pass session.readingType so a per-type version bump invalidates only
    // that type's sessions (not all chats globally).
    //
    // Phase 2.x L3.5b — FORTUNE sessions must use scope-aware version lookup
    // (mirror chat.service::createSession line 245). Without this, FORTUNE
    // MONTH sessions created with `fort-month=` version key are compared
    // against the legacy `fort=` key and ALWAYS report drift → every MONTH
    // chat first-message returns CONTEXT_VERSION_DRIFTED. Symmetric for DAY.
    const currentVersions =
      session.readingType === 'FORTUNE' && session.fortuneScope
        ? this.contextService.getCurrentSnapshotVersionsForFortune(
            session.fortuneScope as 'DAY' | 'MONTH' | 'YEAR',
          )
        : this.contextService.getCurrentSnapshotVersions(session.readingType);
    if (
      session.contextVersion !== currentVersions.contextVersion ||
      session.preAnalysisVersion !== currentVersions.preAnalysisVersion
    ) {
      this._emitError(
        response,
        'CONTEXT_VERSION_DRIFTED',
        'Engine doctrine has been updated. Please start a new session.',
      );
      return;
    }

    // Acquire per-session concurrent-stream lock
    const lockKey = `chat-session-stream:${sessionId}`;
    const acquired = await this.redis.acquireLock(lockKey, STREAM_LOCK_TTL_SECONDS);
    if (!acquired) {
      this._emitError(
        response,
        'CONCURRENT_STREAM',
        '您已有進行中的對話，請稍候再試',
      );
      return;
    }

    try {
      await this._streamWithLock(
        response,
        user.id,
        session,
        sanitizedContent,
        sectionContextHint,
        refusal,
      );
    } finally {
      await this.redis.releaseLock(lockKey).catch((err) => {
        this.logger.warn(`Failed to release stream lock ${lockKey}: ${err}`);
      });
    }
  }

  /**
   * Inner stream flow — runs while holding the concurrent-stream lock.
   * Handles: deduction, message persistence, refusal short-circuit,
   * Anthropic streaming, watchdog, refund.
   */
  private async _streamWithLock(
    response: Response,
    userId: string,
    // Phase 2 — added `readingType` so the per-type prompt routing (topic
    // scope + refuse template + crossSellPivotHint extractor) can read
    // the session's snapshot type from the in-memory object without
    // re-querying.
    session: {
      id: string;
      messageCount: number;
      firstMessageAt: Date | null;
      readingId: string | null;
      comparisonId: string | null; // Phase 3 — COMPATIBILITY sessions key on this instead
      // Phase Fortune — FORTUNE sessions reference a BirthProfile +
      // anchorDate triplet instead of readingId/comparisonId. The
      // controller passes these through from the session record.
      profileId: string | null;
      fortuneAnchorDate: Date | null;
      // Phase 2.x L3.5b — fortuneScope drives DAY vs MONTH chat-context
      // dispatch + scope-specific refuse template / few-shots routing.
      fortuneScope: import('@prisma/client').FortuneScope | null;
      readingType: import('@prisma/client').ReadingType;
      creditExtensions: number;
      paidMessagesUsed: number;
    },
    sanitizedContent: string,
    sectionContextHint: string | undefined,
    refusal: { refused: boolean; syntheticReply?: string; matchedPattern?: string },
  ): Promise<void> {
    const sessionId = session.id;

    // ============================================================
    // Atomic deduction + user-message persistence (mirrors chat.service)
    // ============================================================

    let deduction: { method: 'FREE_QUOTA' | 'PAID_ALLOWANCE' };
    let userMessageId: string;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const d = await this.paymentService.deductForMessage(sessionId, userId, tx);
        if (session.firstMessageAt === null) {
          await tx.chatSession.updateMany({
            where: { id: sessionId, firstMessageAt: null },
            data: { firstMessageAt: new Date() },
          });
        }
        const um = await tx.chatMessage.create({
          data: {
            sessionId,
            role: ChatRole.USER,
            content: sanitizedContent,
            sectionContextHint: sectionContextHint || null,
            paymentMethod: d.method,
          },
        });
        return { deduction: d, userMessageId: um.id };
      });
      deduction = result.deduction;
      userMessageId = result.userMessageId;
    } catch (err) {
      // Map known HttpExceptions to SSE error codes
      if (err instanceof HttpException) {
        const responseObj = err.getResponse();
        const code = (typeof responseObj === 'object' && responseObj !== null
          && 'code' in responseObj)
          ? (responseObj as { code: string }).code
          : 'PAYMENT_FAILED';
        const message = err.message || 'Payment resolution failed';
        this._emitError(response, code, message);
        return;
      }
      this._emitError(response, 'PAYMENT_FAILED',
        err instanceof Error ? err.message : 'Unknown payment error');
      return;
    }

    // Emit session_start so frontend knows the user message is persisted
    this._emitEvent(response, { type: 'session_start', messageId: userMessageId });

    // ============================================================
    // Refuse-list short-circuit — write synthetic refusal, no Anthropic
    // ============================================================

    if (refusal.refused) {
      this.logger.log(
        `Refuse-list pre-flight matched on session ${sessionId}: pattern=${refusal.matchedPattern}`,
      );
      const refusalMsg = await this.prisma.$transaction(async (tx) => {
        const am = await tx.chatMessage.create({
          data: {
            sessionId,
            role: ChatRole.ASSISTANT,
            content: refusal.syntheticReply!,
            errorCode: 'REFUSED_PRE_FLIGHT',
            paymentMethod: null,
          },
        });
        await tx.chatSession.update({
          where: { id: sessionId },
          data: { messageCount: { increment: 1 } },
        });
        return am;
      });

      // Emit the refusal text as a single delta + done
      this._emitEvent(response, { type: 'delta', text: refusal.syntheticReply! });
      const refreshed = await this.prisma.chatSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      const remainingFree = await this._computeRemainingFree(userId);
      const remainingPaid = Math.max(
        0,
        refreshed.creditExtensions * 10 - refreshed.paidMessagesUsed,
      );
      this._emitEvent(response, {
        type: 'done',
        messageId: refusalMsg.id,
        messageCount: refreshed.messageCount,
        messagesRemaining: remainingFree + remainingPaid,
        // Pre-flight refusals deliberately do NOT increment `consecutiveRefuses`.
        // Rationale: pre-flight rejections (e.g., refuse-list match for lottery
        // queries) incur ZERO Anthropic API cost, so the cost-defense policy
        // (CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT) doesn't apply. Surface the
        // current counter value unchanged so the FE soft-warning dialog fires
        // ONLY on AI-generated topic-boundary refuses (where each refuse
        // actually costs us API spend). `consecutiveRefuses` is non-nullable
        // (Int @default(0) in schema) — no null-guard needed.
        consecutiveRefuses: refreshed.consecutiveRefuses,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      });
      response.end();
      return;
    }

    // ============================================================
    // Build prompt + start Anthropic streaming with watchdog
    // ============================================================

    let chatContext;
    try {
      // Phase 2 — pass session.readingType for per-type crossSellPivotHint.
      // Phase 3 — branch on subject type: COMPATIBILITY sessions use
      // comparisonId path (dual-chart slim); all others use readingId.
      // Phase Fortune — third subject path: FORTUNE sessions use
      // profileId + anchorDate (no readingId / comparisonId).
      if (session.comparisonId) {
        chatContext = await this.contextService.getChatContextForComparison(
          session.comparisonId,
          session.readingType,
        );
      } else if (session.readingId) {
        chatContext = await this.contextService.getChatContextForReading(
          session.readingId,
          session.readingType,
        );
      } else if (
        session.readingType === 'FORTUNE' &&
        session.profileId &&
        session.fortuneAnchorDate
      ) {
        // Phase 2.x L3.5b — pass fortuneScope so engine dispatches DAY vs MONTH
        // chat-context. Default 'DAY' for sessions with null scope (pre-L3.5b
        // back-compat).
        chatContext = await this.contextService.getChatContextForFortune(
          session.profileId,
          session.fortuneAnchorDate.toISOString().slice(0, 10),
          session.readingType,
          (session.fortuneScope as 'DAY' | 'MONTH' | 'YEAR' | null) ?? 'DAY',
        );
      } else {
        // CHECK constraint should prevent this. Defensive guard.
        throw new Error(
          `Session ${sessionId} has no resolvable subject (readingId / comparisonId / fortune triplet all missing)`,
        );
      }
    } catch (err) {
      await this._refundOnError(response, sessionId, userId, userMessageId,
        `chat-context-fetch-failed: ${err}`);
      return;
    }

    const recentMessagesRaw = await this.prisma.chatMessage.findMany({
      where: {
        sessionId,
        isRegrounding: false,
        role: { in: [ChatRole.USER, ChatRole.ASSISTANT] },
        id: { not: userMessageId },
        errorCode: null,
        refundedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: CHAT_RECENT_MESSAGES_FOR_PROMPT,
    });
    const recentMessages = recentMessagesRaw
      .reverse()
      .map((m) => ({
        role: (m.role === ChatRole.USER ? 'user' : 'assistant') as 'user' | 'assistant',
        // Phase 5 (PR #44 follow-up Issue 1) defense-in-depth — re-sanitize
        // USER content at read time. Symmetric with chat.service.ts. Protects
        // against any unsanitized <system-reminder> tags persisted before
        // the Issue 1 fix landed. Idempotent on already-clean strings.
        content:
          m.role === ChatRole.USER ? sanitizeUserContent(m.content) : m.content,
      }));

    const shouldInjectRegrounding =
      session.messageCount + 1 >= CHAT_REGROUNDING_TRIGGER_TURN_LOCAL;

    // Tier C — cross-sell targets the user already owns (fresh per message;
    // outside the cached chat-context blob). Never block a stream on the lookup
    // → empty set degrades to original "go unlock" wording. anchorYear: FORTUNE
    // → anchor date's year; else current. Symmetric with chat.service.ts.
    let ownedCrossSellTargets = new Set<string>();
    try {
      const anchorYear =
        session.readingType === 'FORTUNE' && session.fortuneAnchorDate
          ? session.fortuneAnchorDate.getUTCFullYear()
          : new Date().getUTCFullYear();
      ownedCrossSellTargets = await this.contextService.resolveOwnedCrossSellTargets({
        userId, // _streamWithLock receives userId as a separate param (session subset omits it)
        readingType: session.readingType,
        birthProfileId: chatContext.birthProfileId,
        anchorYear,
      });
    } catch (err) {
      this.logger.warn(`Tier C ownership lookup failed (streaming): ${err}`);
    }

    const { systemPromptText, messages } = buildPrompt({
      chatContext,
      recentMessages,
      newUserMessage: sanitizedContent,
      // Phase 2 — per-readingType prompt routing. session.readingType is
      // the snapshot taken at create time (createSession sets it from
      // BaziReading.readingType). Drives topic-scope clause + refuse
      // template + readingType-specific refuse few-shots.
      readingType: session.readingType,
      // Phase 2.x L3.5b — for FORTUNE, dispatch refuse template + few-shots
      // by scope. DAY → 《八字日運》 + F-1/F-2/F-3; MONTH → 《八字月運》 + M-1/M-2.
      fortuneScope: (session.fortuneScope as 'DAY' | 'MONTH' | 'YEAR' | null) ?? undefined,
      sectionContextHint,
      shouldInjectRegrounding,
      ownedCrossSellTargets,
    });

    // Phase 1.6 audit Bug A — use AbortController so watchdog actually
    // interrupts a hung Anthropic request mid-await. The original `aborted = true`
    // flag was only checked at iteration boundaries, useless when Anthropic is
    // hung waiting for the next event.
    const abortController = new AbortController();
    let lastDeltaAt = Date.now();
    let watchdogTriggered = false;
    const watchdogTimer = setInterval(() => {
      if (Date.now() - lastDeltaAt > STREAM_WATCHDOG_MS) {
        this.logger.warn(`Stream watchdog timeout for session ${sessionId}`);
        watchdogTriggered = true;
        abortController.abort();
      }
    }, 5_000);

    // Phase 1.6 audit Bug C — abort the stream if the client disconnects
    // (mobile sleep, tab close, etc.). Without this, we keep streaming
    // Anthropic events to a dead response and hold the lock for 150s wasted.
    let clientDisconnected = false;
    const onClientClose = () => {
      this.logger.log(`Client disconnected mid-stream for session ${sessionId}`);
      clientDisconnected = true;
      abortController.abort();
    };
    response.on('close', onClientClose);

    let assistantBuffer = '';
    let usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };

    try {
      const stream = this.anthropic.messages.stream(
        {
          model: this.model,
          max_tokens: CHAT_OUTPUT_MAX_TOKENS_LOCAL,
          system: [
            {
              type: 'text',
              text: systemPromptText,
              cache_control: { type: 'ephemeral', ttl: '1h' },
            },
          ],
          messages,
        },
        {
          timeout: ANTHROPIC_STREAM_TIMEOUT_MS,
          signal: abortController.signal,
        },
      );

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          const text = event.delta.text;
          assistantBuffer += text;
          lastDeltaAt = Date.now();
          this._emitEvent(response, { type: 'delta', text });
        }
      }

      // Stream finished — extract final usage
      const finalMessage = await stream.finalMessage();
      usage = {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
        cacheReadTokens:
          (finalMessage.usage as { cache_read_input_tokens?: number })
            .cache_read_input_tokens ?? 0,
        cacheCreationTokens:
          (finalMessage.usage as { cache_creation_input_tokens?: number })
            .cache_creation_input_tokens ?? 0,
      };
    } catch (err) {
      clearInterval(watchdogTimer);
      response.off('close', onClientClose);

      // If client disconnected, no need to write to dead response.
      // The user message is persisted; refund applies because no assistant
      // reply was completed.
      if (clientDisconnected) {
        this.logger.log(
          `Stream aborted on client disconnect for ${sessionId} — refunding`,
        );
        // Mark message as AI_FAILED + refund (don't write to closed response)
        try {
          await this.prisma.chatMessage.update({
            where: { id: userMessageId },
            data: { errorCode: 'CLIENT_DISCONNECTED' },
          });
          await this.paymentService.refundLastMessage(
            userMessageId,
            sessionId,
            userId,
            'client-disconnected',
          );
        } catch (refundErr) {
          this.logger.warn(`Refund-after-disconnect failed: ${refundErr}`);
        }
        return;
      }

      const reason = watchdogTriggered
        ? 'watchdog-timeout-no-delta-60s'
        : `ai-stream-failed: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(`Anthropic stream failed for ${sessionId}: ${reason}`);
      await this._refundOnError(response, sessionId, userId, userMessageId, reason);
      return;
    } finally {
      clearInterval(watchdogTimer);
      response.off('close', onClientClose);
    }

    // ============================================================
    // Post-validate, persist assistant message, emit done
    // ============================================================

    const validation = this.validators.postValidate(
      assistantBuffer,
      chatContext,
      ownedCrossSellTargets, // Tier C output safety-net (owned-reword)
    );

    // If validator changed the text, emit a final delta with the diff
    // (frontend may show the corrected version)
    if (validation.text !== assistantBuffer) {
      // Simple replace: emit a "replace" delta. For Phase 1.6 minimal, just
      // log the change — Phase 1.7 frontend will fetch the persisted version.
      this.logger.log(
        `Stream ${sessionId}: validator changed assistant content `
        + `(stripped=${validation.bannedPhraseStripped}, cited=${validation.citationAutoPrepended})`,
      );
    }

    // Phase 2 (round-2 NEW#3 + round-3 NEW#9) — detect topic-boundary refuse
    // AFTER `postValidate` (so we see the same text that gets persisted) and
    // BEFORE the assistant-message persist (so `isRefuse=true` is included
    // in the same INSERT, no second UPDATE). Refuses are NOT BILLED — the
    // user's upfront deduction is reversed via `refundLastMessage`.
    //
    // Uses isTopicBoundaryRefuse() rather than direct regex `.test()` because
    // the post-validator may auto-prepend a citation prefix BEFORE the
    // refuse opener (we caught this in the first LOVE chat test —
    // «根據您的日主甲..., 謝謝您的提問。關於...» wouldn't have matched
    // ^-anchored regex). The helper looks at the first 200 chars.
    const isRefuse = isTopicBoundaryRefuse(validation.text);

    const { assistantMessage, sessionAfter } = await this.prisma.$transaction(
      async (tx) => {
        const am = await tx.chatMessage.create({
          data: {
            sessionId,
            role: ChatRole.ASSISTANT,
            content: validation.text,
            tokensInput: usage.inputTokens,
            tokensOutput: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheCreationTokens: usage.cacheCreationTokens,
            model: this.model,
            bannedPhraseStripped: validation.bannedPhraseStripped,
            citationAutoPrepended: validation.citationAutoPrepended,
            isRefuse, // Phase 2 — set in the same insert, no second UPDATE.
            paymentMethod: null,
          },
        });
        const updated = await tx.chatSession.update({
          where: { id: sessionId },
          data: {
            messageCount: { increment: 1 },
            // Phase 2 (round-3 NEW#8) — atomic Prisma `{ increment: 1 }` /
            // `{ set: 0 }` operators. Avoids read-modify-write race when two
            // streams interleave for the same session (rare but possible on
            // user retry).
            consecutiveRefuses: isRefuse ? { increment: 1 } : { set: 0 },
          },
        });
        // Auto-end at hard cap
        if (updated.messageCount >= CHAT_SESSION_HARD_CAP_MESSAGES) {
          await tx.chatSession.update({
            where: { id: sessionId },
            data: { endedAt: new Date() },
          });
        }
        return { assistantMessage: am, sessionAfter: updated };
      },
    );

    // Phase 2 — refund the user's upfront deduction for refuse messages,
    // capped at CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT consecutive refuses.
    // The deduction at chat-stream.service.ts:~252 happens BEFORE the AI
    // runs (we don't yet know the response will be a refuse). After the
    // assistant message is persisted, we know — undo the deduction via the
    // existing idempotent refundLastMessage helper. Reason: 'topic-boundary-refuse'
    // for audit.
    //
    // Cost-defense policy (CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT = 2):
    //  - 1st + 2nd consecutive refuses → refund (forgive occasional mistakes)
    //  - 3rd consecutive refuse onward → NO refund (user pays for repeated
    //    off-topic spam; aligns incentive + recovers Anthropic API cost)
    // Counter `consecutiveRefuses` resets to 0 on any in-topic message
    // (existing `{ set: 0 }` semantics in the same-tx update above).
    //
    // The post-update counter value is also returned to the frontend in the
    // SSE done event so the soft-warning dialog can fire when the cap is hit.
    //
    // Out-of-band so a refund failure doesn't break the user's chat
    // experience (they got their refused-but-helpful response).
    // `consecutiveRefuses` is non-nullable (Int @default(0) in schema).
    // We read the post-tx value directly — no null-guard needed.
    const consecutiveRefuses = sessionAfter.consecutiveRefuses;
    if (isRefuse && consecutiveRefuses <= CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT) {
      try {
        await this.paymentService.refundLastMessage(
          userMessageId,
          sessionId,
          userId,
          'topic-boundary-refuse',
        );
        this.logger.log(
          `Refunded refuse message ${userMessageId} (session ${sessionId}, consecutiveRefuses=${consecutiveRefuses})`,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to refund refuse message ${userMessageId}: ${err}`,
        );
      }
    } else if (isRefuse) {
      this.logger.log(
        `Suppressed refund for refuse message ${userMessageId} (session ${sessionId}, consecutiveRefuses=${consecutiveRefuses} > limit ${CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT})`,
      );
      // Sentry breadcrumb so product can track refund-cap fire frequency
      // (spam-pattern detection) without scraping server logs. Info-level —
      // not an error (this is by-design cost-defense). `level: 'info'`
      // shows on the breadcrumb timeline if a subsequent ERROR is captured
      // in the same session.
      Sentry.addBreadcrumb({
        category: 'chat.refund_cap',
        level: 'info',
        message: `Refund cap fired (consecutiveRefuses=${consecutiveRefuses})`,
        data: {
          sessionId,
          userId,
          consecutiveRefuses,
          limit: CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT,
        },
      });
    }

    // LLM-as-judge async — fire and forget
    if (this.validators.shouldJudge()) {
      this.validators
        .judgeResponse({
          userMessage: sanitizedContent,
          assistantResponse: validation.text,
          chatContext,
        })
        .then(async (judgement) => {
          await this.prisma.chatMessage.update({
            where: { id: assistantMessage.id },
            data: { llmJudgeVerdict: judgement.verdict },
          });
          if (judgement.verdict === 'fail') {
            this.logger.warn(
              `LLM-as-judge FAIL on message ${assistantMessage.id}: ${judgement.reason}`,
            );
          }
        })
        .catch((err) => this.logger.warn(`LLM-judge background failed: ${err}`));
    }

    const refreshed = await this.prisma.chatSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    const remainingFree = await this._computeRemainingFree(userId);
    const remainingPaid = Math.max(
      0,
      refreshed.creditExtensions * 10 - refreshed.paidMessagesUsed,
    );

    this._emitEvent(response, {
      type: 'done',
      messageId: assistantMessage.id,
      messageCount: refreshed.messageCount,
      messagesRemaining: remainingFree + remainingPaid,
      // `consecutiveRefuses` is non-nullable (Int @default(0) in schema).
      consecutiveRefuses: refreshed.consecutiveRefuses,
      usage,
    });
    response.end();
  }

  // ============================================================
  // Helpers
  // ============================================================

  private _emitEvent(response: Response, event: StreamEvent): void {
    if (response.writableEnded) return;
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  private _emitError(
    response: Response,
    code: string,
    message: string,
    refunded?: boolean,
    refundMethod?: string | null,
  ): void {
    this._emitEvent(response, {
      type: 'error',
      code,
      message,
      ...(refunded !== undefined && { refunded }),
      ...(refundMethod !== undefined && { refundMethod }),
    });
    if (!response.writableEnded) {
      response.end();
    }
  }

  private async _refundOnError(
    response: Response,
    sessionId: string,
    userId: string,
    userMessageId: string,
    reason: string,
  ): Promise<void> {
    // Mark user message with errorCode BEFORE refund (refund preserves original)
    try {
      await this.prisma.chatMessage.update({
        where: { id: userMessageId },
        data: { errorCode: 'AI_FAILED' },
      });
    } catch {
      // Non-fatal — message may have been deleted concurrently
    }

    const refundResult = await this.paymentService.refundLastMessage(
      userMessageId,
      sessionId,
      userId,
      reason,
    );

    this.logger.warn(
      `Refunded ${refundResult.method ?? 'none'} for message ${userMessageId}: ${refundResult.refunded}`,
    );

    this._emitError(
      response,
      'AI_CALL_FAILED',
      'AI 暫時無法回答，已退還點數',
      refundResult.refunded,
      refundResult.method,
    );
  }

  private async _computeRemainingFree(userId: string): Promise<number> {
    const usage = await this.paymentService.getMonthlyUsage(userId);
    return Math.max(0, usage.monthlyQuota - usage.chatsUsed);
  }
}
