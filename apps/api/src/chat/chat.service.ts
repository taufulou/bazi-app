import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ChatRole, Prisma, ReadingType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChatPaymentService,
  CHAT_SESSION_HARD_CAP_MESSAGES,
  CHAT_HISTORY_RETENTION_DAYS,
  ChatPaymentMethod,
} from './chat-payment.service';
import { ChatContextService } from './chat-context.service';
import { ChatValidatorsService } from './chat-validators.service';
import { RedisService } from '../redis/redis.service';
import { buildPrompt } from './chat-prompt-builder';
import {
  CreateChatSessionResponse,
  SendMessageResponse,
  ExtendSessionResponse,
  ChatSessionSummary,
  ChatMessageDto,
  ChatMessageListResponse,
  ChatUsageResponse,
} from './dto';

// mirrors @repo/shared CHAT_OUTPUT_MAX_TOKENS / CHAT_REGROUNDING_TRIGGER_TURN
const CHAT_OUTPUT_MAX_TOKENS_LOCAL = 800;
const CHAT_REGROUNDING_TRIGGER_TURN_LOCAL = 4;
const CHAT_HISTORY_LOAD_PAGE_SIZE_LOCAL = 5;
const CHAT_RECENT_MESSAGES_FOR_PROMPT = 10; // keep last 10 for context window

/**
 * TTL for the per-session `chat-extend:{sessionId}` lock (T6 fix). Sized
 * generously (30s) vs. the typical extension transaction time (<200ms). The
 * lock is RELEASED in the `finally` block on every code path, so the TTL
 * only matters as a safety net against process crashes between acquire
 * and release.
 */
const EXTEND_LOCK_TTL_SECONDS = 30;

/**
 * Phase 2 — env-driven whitelist of reading types where chat is enabled.
 * Replaces the Phase 1 hard-coded `readingType !== 'LIFETIME'` gate with a
 * comma-separated env var so per-reading-type rollout is a config change,
 * not a redeploy. On parse error / missing env, falls back to LIFETIME-only
 * (the safest default — preserves Phase 1 behavior).
 *
 * Example: `CHAT_ENABLED_READING_TYPES=LIFETIME,LOVE` enables LOVE chat
 * without redeploying when ready to test post-Phase-1 reading types.
 */
function parseChatEnabledReadingTypes(envValue: string | undefined): Set<ReadingType> {
  const fallback = new Set<ReadingType>(['LIFETIME']);
  if (!envValue) return fallback;
  // Whitelist of reading types where chat is permitted (Phase 2 + 3).
  // ZWDS_* types are intentionally excluded (anti-hallucination prompts
  // not yet hardened for ZWDS — see plan «Out of scope» / Phase 4+).
  // HEALTH / ZWDS_* are placeholders for future phases; not enabled
  // even if an operator typo'd them into env.
  const VALID_TYPES: ReadingType[] = ['LIFETIME', 'LOVE', 'CAREER', 'ANNUAL', 'COMPATIBILITY'];
  const validSet = new Set<string>(VALID_TYPES);
  const parsed = envValue
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => validSet.has(s)) as ReadingType[];
  if (parsed.length === 0) return fallback;
  return new Set(parsed);
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly anthropic: Anthropic;
  private readonly model: string;
  /** Phase 2 — whitelist of reading types where chat is enabled. Parsed
   *  from env at construction; falls back to LIFETIME-only on missing/bad
   *  config so we never accidentally disable Phase 1 chat. */
  private readonly enabledReadingTypes: Set<ReadingType>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly paymentService: ChatPaymentService,
    private readonly contextService: ChatContextService,
    private readonly validators: ChatValidatorsService,
    private readonly redis: RedisService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY not set — chat will fail at runtime');
    }
    this.anthropic = new Anthropic({ apiKey: apiKey || 'placeholder' });
    // Phase 1.5 follow-up C iter 2: upgraded default from Sonnet 4.5 to
    // Sonnet 4.6 after eval showed dramatic accuracy improvement (judge
    // fail rate 39.6% → 11.3%). Identical pricing — no cost impact.
    // Production env can still override via CLAUDE_MODEL.
    this.model = this.config.get<string>('CLAUDE_MODEL') || 'claude-sonnet-4-6';

    // Phase 2 — parse the chat-enabled reading-type whitelist from env.
    // Defaults to LIFETIME-only on parse error. Logged once on boot so
    // operators can verify the config took effect.
    this.enabledReadingTypes = parseChatEnabledReadingTypes(
      this.config.get<string>('CHAT_ENABLED_READING_TYPES'),
    );
    this.logger.log(
      `Chat enabled for reading types: ${Array.from(this.enabledReadingTypes).join(', ')}`,
    );
  }

  // ============================================================
  // Session lifecycle
  // ============================================================

  async createSession(
    clerkUserId: string,
    args: { readingId?: string; comparisonId?: string },
  ): Promise<CreateChatSessionResponse> {
    const { readingId, comparisonId } = args;

    // Phase 3 — validate exactly one of (readingId, comparisonId) is set.
    // Mirrors the DB CHECK constraint at chat_sessions_subject_check.
    const hasReading = Boolean(readingId);
    const hasComparison = Boolean(comparisonId);
    if (hasReading === hasComparison) {
      throw new BadRequestException({
        code: 'INVALID_SUBJECT',
        message: 'Exactly one of (readingId, comparisonId) must be provided.',
      });
    }

    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    let resolvedReadingType: ReadingType;

    if (hasReading) {
      // Validate reading ownership
      const reading = await this.prisma.baziReading.findUnique({
        where: { id: readingId },
        select: { id: true, userId: true, readingType: true },
      });
      if (!reading) throw new NotFoundException(`Reading ${readingId} not found`);
      if (reading.userId !== user.id) {
        throw new ForbiddenException('Reading not owned by this user');
      }
      resolvedReadingType = reading.readingType;
    } else {
      // Phase 3 — COMPATIBILITY path. Validate BaziComparison ownership.
      const comparison = await this.prisma.baziComparison.findUnique({
        where: { id: comparisonId! },
        select: { id: true, userId: true, comparisonType: true },
      });
      if (!comparison) {
        throw new NotFoundException(`Comparison ${comparisonId} not found`);
      }
      if (comparison.userId !== user.id) {
        throw new ForbiddenException('Comparison not owned by this user');
      }
      // H6 (Phase 3 follow-up) — Phase 3 ships ROMANCE only. Engine
      // supports BUSINESS/FRIENDSHIP/PARENT_CHILD but UX doesn't expose
      // them, AND the chat system prompt + refuse template + cross-sell
      // map are all hard-coded to 愛情/婚姻 framing. A BUSINESS-compat
      // chat session would produce nonsensical 愛情-scoped responses.
      // Guard explicitly — error catalog convention is inline-coded
      // SCREAMING_SNAKE_CASE (see CONTEXT_VERSION_DRIFTED / NEEDS_EXTENSION
      // / HARD_CAP_REACHED elsewhere in this file).
      if (comparison.comparisonType !== 'ROMANCE') {
        throw new BadRequestException({
          code: 'COMPARISON_TYPE_NOT_SUPPORTED',
          message: `Chat is only supported for ROMANCE comparisons in Phase 3 (got: ${comparison.comparisonType}).`,
        });
      }
      resolvedReadingType = 'COMPATIBILITY';
    }

    // Phase 2 — env-driven whitelist. Phase 3 — whitelist now includes COMPATIBILITY.
    if (!this.enabledReadingTypes.has(resolvedReadingType)) {
      throw new BadRequestException({
        code: 'READING_TYPE_NOT_ENABLED',
        message: `Chat for reading type ${resolvedReadingType} is not currently enabled.`,
      });
    }

    // Snapshot version strings — stored on session for mid-session drift detection.
    const versions = this.contextService.getCurrentSnapshotVersions(resolvedReadingType);

    // 12-month PDPA hard-delete date
    const hardDeleteAt = new Date();
    hardDeleteAt.setUTCDate(hardDeleteAt.getUTCDate() + CHAT_HISTORY_RETENTION_DAYS);

    const session = await this.prisma.chatSession.create({
      data: {
        userId: user.id,
        // Phase 3 — exactly one of (readingId, comparisonId) is set.
        readingId: hasReading ? readingId : null,
        comparisonId: hasComparison ? comparisonId : null,
        readingType: resolvedReadingType,
        contextVersion: versions.contextVersion,
        preAnalysisVersion: versions.preAnalysisVersion,
        hardDeleteAt,
      },
    });

    // Get usage for response
    const usage = await this.paymentService.getMonthlyUsage(user.id);

    // sessionsThisHour = count of sessions started in last 1h (rate limiter input)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const sessionsThisHour = await this.prisma.chatSession.count({
      where: { userId: user.id, startedAt: { gte: oneHourAgo } },
    });

    return {
      sessionId: session.id,
      freeQuotaRemaining: Math.max(0, usage.monthlyQuota - usage.chatsUsed),
      monthlyQuota: usage.monthlyQuota,
      currentSessionAllowance: 0, // fresh session — no extensions yet
      sessionsThisHour,
      contextVersion: session.contextVersion,
    };
  }

  async listSessionsForReading(
    clerkUserId: string,
    readingId: string,
  ): Promise<ChatSessionSummary[]> {
    return this._listSessionsByWhere(clerkUserId, { readingId });
  }

  /** Phase 3 — parallel for COMPATIBILITY sessions. */
  async listSessionsForComparison(
    clerkUserId: string,
    comparisonId: string,
  ): Promise<ChatSessionSummary[]> {
    return this._listSessionsByWhere(clerkUserId, { comparisonId });
  }

  private async _listSessionsByWhere(
    clerkUserId: string,
    where: { readingId?: string; comparisonId?: string },
  ): Promise<ChatSessionSummary[]> {
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    const sessions = await this.prisma.chatSession.findMany({
      where: { userId: user.id, ...where },
      orderBy: { startedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          where: { role: 'ASSISTANT' },
        },
      },
    });

    return sessions.map((s): ChatSessionSummary => {
      const lastMsg = s.messages[0];
      const totalAllowance = s.creditExtensions * 10; // CHAT_INITIAL_MESSAGES_PER_CREDIT
      const unusedPaid = Math.max(0, totalAllowance - s.paidMessagesUsed);
      return {
        id: s.id,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
        messageCount: s.messageCount,
        unusedPaidMessages: unusedPaid,
        lastMessagePreview: lastMsg
          ? lastMsg.content.slice(0, 80) + (lastMsg.content.length > 80 ? '...' : '')
          : null,
      };
    });
  }

  async getMessages(
    clerkUserId: string,
    sessionId: string,
    cursor: number | undefined,
    limit: number = CHAT_HISTORY_LOAD_PAGE_SIZE_LOCAL,
  ): Promise<ChatMessageListResponse> {
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (session.userId !== user.id) {
      throw new ForbiddenException('Session not owned by this user');
    }

    const totalCount = await this.prisma.chatMessage.count({
      where: { sessionId, isRegrounding: false },
    });

    // Pagination: descending order from newest to oldest. Cursor = number of
    // already-loaded messages from the top (frontend "Load 5 more" semantic).
    const skip = cursor ?? 0;
    const messages = await this.prisma.chatMessage.findMany({
      where: { sessionId, isRegrounding: false },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });

    const nextCursor = skip + messages.length < totalCount ? skip + messages.length : null;

    return {
      messages: messages.map((m): ChatMessageDto => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sectionContextHint: m.sectionContextHint,
        isRegrounding: m.isRegrounding,
        errorCode: m.errorCode,
        refundedAt: m.refundedAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
      nextCursor,
      totalCount,
    };
  }

  async getUsage(clerkUserId: string): Promise<ChatUsageResponse> {
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    const usage = await this.paymentService.getMonthlyUsage(user.id);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const sessionsThisHour = await this.prisma.chatSession.count({
      where: { userId: user.id, startedAt: { gte: oneHourAgo } },
    });

    // Surface tier-upgrade refunds (Option A1) within the last 24h. The
    // frontend renders a one-time banner so users see they got their
    // stranded paid messages refunded as credits. Banner is dismissed
    // client-side via localStorage keyed by refundedAt.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentRefunds = await this.prisma.creditLedger.findMany({
      where: {
        userId: user.id,
        amount: { gt: 0 },
        reason: { startsWith: 'tier_upgrade_refund' },
        createdAt: { gte: dayAgo },
      },
      orderBy: { createdAt: 'desc' },
    });
    const totalCreditsRefunded = recentRefunds.reduce(
      (sum, e) => sum + e.amount,
      0,
    );
    const recentTierUpgradeRefund =
      totalCreditsRefunded > 0 && recentRefunds[0]
        ? {
            creditsRefunded: totalCreditsRefunded,
            refundedAt: recentRefunds[0].createdAt.toISOString(),
          }
        : null;

    return {
      thisMonth: {
        chatsUsed: usage.chatsUsed,
        monthlyQuota: usage.monthlyQuota,
        resetsAt: usage.resetsAt.toISOString(),
        subscriptionTier: usage.subscriptionTier,
      },
      sessionsThisHour,
      hourlyRateLimit: 5, // CHAT_SESSIONS_PER_HOUR
      recentTierUpgradeRefund,
    };
  }

  async extendSession(
    clerkUserId: string,
    sessionId: string,
  ): Promise<ExtendSessionResponse> {
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    // T6 fix — concurrent extension purchase double-charge:
    //
    // Without this lock, two near-simultaneous POSTs to /extend (rapid
    // double-click on Dialog 1's primary button, retry-on-network-error,
    // multi-tab clicks) BOTH commit their transactions, charging 2 credits
    // and creating 2 extensions on the same session. The frontend has its
    // own debounce as defense-in-depth, but Redis SETNX is the
    // authoritative deduplication boundary — a malicious / scripted client
    // could bypass any pure-frontend guard.
    //
    // Mirrors the pattern at chat-stream.service.ts:202-225 (per-session
    // stream lock). Lock is held across version-check + credit deduction
    // + creditExtensions++ so even the "first wins, second runs after"
    // race window is closed.
    const lockKey = `chat-extend:${sessionId}`;
    const acquired = await this.redis.acquireLock(
      lockKey,
      EXTEND_LOCK_TTL_SECONDS,
    );
    if (!acquired) {
      throw new HttpException(
        {
          code: 'EXTEND_IN_PROGRESS',
          message: '另一個延伸購買請求正在處理中，請稍候再試',
        },
        HttpStatus.CONFLICT,
      );
    }

    try {
      // M1 (Phase 3 follow-up) — explicit existence + ownership guards.
      // Previously these were wrapped in `if (session && session.userId === user.id)`
      // which silently fell through to paymentService when missing/unowned.
      // Now mirrors the eager-throw pattern used in sendMessage / streaming.
      const session = await this.prisma.chatSession.findUnique({
        where: { id: sessionId },
      });
      if (!session) {
        throw new NotFoundException(`ChatSession ${sessionId} not found`);
      }
      if (session.userId !== user.id) {
        throw new ForbiddenException('Session not owned by this user');
      }
      // Reject extension on drifted sessions — otherwise the user pays a
      // credit they cannot spend (next send would be rejected with
      // CONTEXT_VERSION_DRIFTED). Mirrors the check in sendMessage / streaming.
      // Phase 2 (round-2 NEW#2) — pass session.readingType so the version
      // check uses THIS reading-type's CHAT_PROMPT_VERSIONS entry. A
      // LOVE-only prompt bump no longer mass-invalidates LIFETIME sessions.
      const currentVersions = this.contextService.getCurrentSnapshotVersions(session.readingType);
      if (
        session.contextVersion !== currentVersions.contextVersion ||
        session.preAnalysisVersion !== currentVersions.preAnalysisVersion
      ) {
        throw new HttpException(
          {
            code: 'CONTEXT_VERSION_DRIFTED',
            message: 'Engine doctrine has been updated. Please start a new session.',
          },
          HttpStatus.CONFLICT,
        );
      }

      return await this.paymentService.extendSession(sessionId, user.id);
    } finally {
      await this.redis.releaseLock(lockKey).catch((err) => {
        // Non-fatal: TTL will reap the lock if release fails.
        this.logger.warn(`Failed to release extend lock ${lockKey}: ${err}`);
      });
    }
  }

  // ============================================================
  // Message handling (non-streaming for Phase 1.3; streaming in Phase 1.6)
  // ============================================================

  async sendMessage(
    clerkUserId: string,
    sessionId: string,
    content: string,
    sectionContextHint?: string,
  ): Promise<SendMessageResponse> {
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) throw new NotFoundException('User not found');

    // Sanitize user content to prevent <system-reminder> prompt-injection attack
    // (Phase 1.3 audit Bug B). The AI is instructed to treat <system-reminder>
    // content as authoritative server-injected fact — without this, a malicious
    // user typing the tag could escalate their input to system-priority.
    const sanitizedContent = sanitizeUserContent(content);

    // Phase 1.4 Layer 7: refuse-list pre-flight. Cheap regex check; if matches
    // (lottery/medical/legal/death prediction), short-circuit with a synthetic
    // refusal — no Anthropic call, no token spend.
    const refusal = this.validators.refuseListPreFlight(sanitizedContent);

    // 1. Load session, verify ownership, age, cap, version
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (session.userId !== user.id) {
      throw new ForbiddenException('Session not owned by this user');
    }

    const sessionAgeMs = Date.now() - session.startedAt.getTime();
    if (sessionAgeMs > 24 * 60 * 60 * 1000) {
      throw new HttpException(
        { code: 'SESSION_EXPIRED', message: 'Session older than 24h. Start a new session.' },
        HttpStatus.GONE,
      );
    }

    if (session.endedAt !== null) {
      throw new BadRequestException('Session has ended');
    }

    // Mid-session version drift check (Layer 4) — Phase 2 (round-2 NEW#2)
    // uses session.readingType so per-readingType version bumps invalidate
    // only that type's sessions.
    const currentVersions = this.contextService.getCurrentSnapshotVersions(session.readingType);
    if (
      session.contextVersion !== currentVersions.contextVersion ||
      session.preAnalysisVersion !== currentVersions.preAnalysisVersion
    ) {
      this.logger.warn(
        `Session ${sessionId} contextVersion drifted: ` +
          `stored=${session.contextVersion}, current=${currentVersions.contextVersion}. ` +
          `Forcing new-session start.`,
      );
      throw new HttpException(
        {
          code: 'CONTEXT_VERSION_DRIFTED',
          message: 'Engine doctrine has been updated. Please start a new session.',
        },
        HttpStatus.CONFLICT,
      );
    }

    // 2. Atomic deduction + user message persistence in one transaction.
    //    Per Phase 1.3 audit Bug C: previously the user-message create was outside
    //    the deduction txn, so a DB write failure could leak a deduction without
    //    persisting the message.
    //    deductForMessage throws 402 NEEDS_EXTENSION or 409 HARD_CAP_REACHED.
    const { deduction, userMessage } = await this.prisma.$transaction(async (tx) => {
      const result = await this.paymentService.deductForMessage(sessionId, user.id, tx);
      // Set firstMessageAt on first deduction (idempotent updateMany guard)
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
          paymentMethod: result.method,
        },
      });
      return { deduction: result, userMessage: um };
    });

    // Layer 7 short-circuit: if the user's input matches the refuse list, persist
    // a synthetic refusal message and skip the Anthropic call. The deduction
    // ABOVE still applies (per plan: refusal still consumes 1 quota slot since
    // session creation already commits to that — prevents free abuse vector).
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
      const refreshed = await this.prisma.chatSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      const remainingFree = await this.computeRemainingFree(user.id, deduction.method);
      const remainingPaid = Math.max(
        0,
        refreshed.creditExtensions * 10 - refreshed.paidMessagesUsed,
      );
      return {
        messageId: refusalMsg.id,
        assistantMessage: refusal.syntheticReply!,
        messagesRemaining: remainingFree + remainingPaid,
        messageCount: refreshed.messageCount,
        hardCap: CHAT_SESSION_HARD_CAP_MESSAGES,
        streaming: false,
      };
    }

    try {
      // 4. Build the prompt
      // Phase 2 — pass session.readingType so the per-type crossSellPivotHint
      // gets computed and substituted into the refuse template.
      // Phase 3 — branch on COMPATIBILITY sessions (comparisonId path).
      let chatContext;
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
      } else {
        throw new Error(`Session ${sessionId} has neither readingId nor comparisonId (CHECK constraint violation)`);
      }

      // Load recent messages for context (last N user/assistant exchanges).
      // Phase 1.3 audit Bug A: filter out failed/refunded messages — they are
      // "stuck" user messages with no assistant reply, which would break the
      // alternation requirement in the Anthropic prompt and cause API rejects.
      const recentMessagesRaw = await this.prisma.chatMessage.findMany({
        where: {
          sessionId,
          isRegrounding: false,
          role: { in: [ChatRole.USER, ChatRole.ASSISTANT] },
          // Exclude the just-persisted user message — it's the new turn
          id: { not: userMessage.id },
          // Exclude failed messages and refunded messages (would break alternation)
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
          content: m.content,
        }));

      // session.messageCount BEFORE this message — when >= regrounding trigger,
      // inject <system-reminder>
      const shouldInjectRegrounding =
        session.messageCount + 1 >= CHAT_REGROUNDING_TRIGGER_TURN_LOCAL;

      const { systemPromptText, messages } = buildPrompt({
        chatContext,
        recentMessages,
        newUserMessage: content,
        // Phase 2 — per-readingType prompt routing.
        readingType: session.readingType,
        sectionContextHint,
        shouldInjectRegrounding,
      });

      // 5. Call Anthropic (non-streaming for Phase 1.3).
      // Phase 1.3 audit Bug D: explicit 60s timeout. Default Anthropic SDK
      // timeout is ~10 min — without this, a hung upstream pins our server
      // resources and racks up output tokens. Phase 1.6 streaming uses a
      // delta-level watchdog instead.
      const response = await this.anthropic.messages.create(
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
        { timeout: 60_000 },
      );

      const assistantContent = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');

      // Phase 1.4 Layer 6 — full 3-stage validator:
      //   Stage A: banned-phrase regex strip (一定/絕對/必定/...)
      //   Stage B: citation enforcement (auto-prepends if missing)
      //   Stage C: LLM-as-judge sample (5% in prod, async, non-blocking)
      const validation = this.validators.postValidate(assistantContent, chatContext);
      const finalAssistantContent = validation.text;

      // Stage C — LLM-as-judge async sample. Don't block the response on it;
      // the verdict is persisted on the message row for retro-tuning.
      let llmJudgePromise: Promise<{ verdict: 'pass' | 'fail'; reason: string }> | null = null;
      if (this.validators.shouldJudge()) {
        llmJudgePromise = this.validators.judgeResponse({
          userMessage: sanitizedContent,
          assistantResponse: finalAssistantContent,
          chatContext,
        });
      }

      const usage = response.usage;
      const cacheReadTokens = (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
      const cacheCreationTokens = (usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0;

      // 6. Persist assistant message + increment session.messageCount
      const assistantMessage = await this.prisma.$transaction(async (tx) => {
        const am = await tx.chatMessage.create({
          data: {
            sessionId,
            role: ChatRole.ASSISTANT,
            content: finalAssistantContent,
            tokensInput: usage.input_tokens,
            tokensOutput: usage.output_tokens,
            cacheReadTokens,
            cacheCreationTokens,
            model: this.model,
            bannedPhraseStripped: validation.bannedPhraseStripped,
            citationAutoPrepended: validation.citationAutoPrepended,
            paymentMethod: null, // assistant messages don't deduct
          },
        });
        // Increment messageCount for THIS exchange (count user msg, not asst)
        const updated = await tx.chatSession.update({
          where: { id: sessionId },
          data: { messageCount: { increment: 1 } },
        });
        // Auto-end session at hard cap
        if (updated.messageCount >= CHAT_SESSION_HARD_CAP_MESSAGES) {
          await tx.chatSession.update({
            where: { id: sessionId },
            data: { endedAt: new Date() },
          });
        }
        return am;
      });

      // 7. Persist LLM-judge verdict in background (non-blocking; just for telemetry)
      if (llmJudgePromise) {
        llmJudgePromise
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
          .catch((err) => {
            this.logger.warn(`LLM-judge background task failed: ${err}`);
          });
      }

      // 8. Compute remaining allowance
      const refreshed = await this.prisma.chatSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      const remainingFree = await this.computeRemainingFree(user.id, deduction.method);
      const remainingPaid = Math.max(
        0,
        refreshed.creditExtensions * 10 - refreshed.paidMessagesUsed,
      );

      return {
        messageId: assistantMessage.id,
        assistantMessage: finalAssistantContent,
        messagesRemaining: remainingFree + remainingPaid,
        messageCount: refreshed.messageCount,
        hardCap: CHAT_SESSION_HARD_CAP_MESSAGES,
        streaming: false,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadTokens,
          cacheCreationTokens,
        },
      };
    } catch (err) {
      // Anthropic call failed — refund the deducted message
      this.logger.error(`Anthropic call failed for message ${userMessage.id}: ${err}`);

      // Mark the user message with error code BEFORE refund (refund preserves errorCode)
      await this.prisma.chatMessage.update({
        where: { id: userMessage.id },
        data: { errorCode: 'AI_FAILED' },
      });

      const refundResult = await this.paymentService.refundLastMessage(
        userMessage.id,
        sessionId,
        user.id,
        `ai-failed: ${err instanceof Error ? err.message : String(err)}`,
      );

      this.logger.warn(
        `Refunded ${refundResult.method ?? 'none'} for message ${userMessage.id}: ${refundResult.refunded}`,
      );

      throw new HttpException(
        {
          code: 'AI_CALL_FAILED',
          message: 'AI 暫時無法回答，已退還點數',
          refunded: refundResult.refunded,
          refundMethod: refundResult.method,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  private async computeRemainingFree(
    userId: string,
    deductionMethod: ChatPaymentMethod,
  ): Promise<number> {
    if (deductionMethod !== 'FREE_QUOTA') {
      // Paid path — still tell the user how much free they have for OTHER sessions
      const usage = await this.paymentService.getMonthlyUsage(userId);
      return Math.max(0, usage.monthlyQuota - usage.chatsUsed);
    }
    const usage = await this.paymentService.getMonthlyUsage(userId);
    return Math.max(0, usage.monthlyQuota - usage.chatsUsed);
  }
}

/**
 * Sanitize user content for prompt-injection prevention. The system prompt
 * instructs the AI to treat `<system-reminder>` tags as authoritative
 * server-injected fact (Layer 5.1). Without this sanitization, a user could
 * type the tag and escalate their input to system-priority — bypassing
 * refuse-list rules and citation requirements (Phase 1.3 audit Bug B).
 *
 * Strategy: HTML-escape `<` and `>` only inside system-reminder-like patterns.
 * Doesn't touch normal Chinese/English text.
 */
export function sanitizeUserContent(input: string): string {
  return input
    // Catch any case-variation of <system-reminder> (open or close) and escape
    // the angle brackets so the AI sees the LITERAL text "&lt;system-reminder&gt;"
    // rather than treating it as a server-injected directive
    .replace(/<\s*\/?\s*system-reminder\s*>/gi, (match) =>
      match.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    )
    // Also catch the doctrineDirective marker pattern used in the engine's
    // injection blocks — a malicious user typing `[doctrineDirective: shangguanJianGuan]`
    // would forge a doctrine override
    .replace(/\[\s*doctrineDirective\s*:[^\]]*\]/gi, (match) =>
      match.replace(/\[/g, '&lbrack;').replace(/\]/g, '&rbrack;'),
    );
}

// Phase 1.4: stripAbsoluteLanguage replaced by ChatValidatorsService.postValidate()
// (Stages A + B + C). See chat-validators.service.ts.
