/**
 * AI Chat — Frontend API client.
 *
 * Wraps the NestJS chat endpoints. Streaming endpoint uses a small inline
 * POST+SSE helper (`streamChatMessage`) — see below for design rationale.
 *
 * Pattern mirrors `apps/web/app/lib/api.ts` for consistency.
 */

import type {
  ChatMessage,
  ChatSession,
  ChatStreamEvent,
  ChatExtendResponse,
  ChatUsageResponse,
} from './chat-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// ============================================================
// Response types — mirror NestJS DTOs
// ============================================================

export interface CreateChatSessionResponse {
  sessionId: string;
  freeQuotaRemaining: number;
  monthlyQuota: number;
  currentSessionAllowance: number;
  sessionsThisHour: number;
  contextVersion: string;
}

export interface ChatMessageListResponse {
  messages: ChatMessage[];
  nextCursor: number | null;
  totalCount: number;
}

// ============================================================
// JSON endpoints
// ============================================================

async function jsonFetch<T>(
  path: string,
  init: RequestInit & { token: string },
): Promise<T> {
  const { token, ...rest } = init;
  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(rest.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    let body: { message?: string; code?: string } = {};
    try {
      body = await response.json();
    } catch {
      // ignore parse error
    }
    const err = new ChatApiError(
      body.message || `Chat API error: ${response.status} ${response.statusText}`,
      response.status,
      body.code,
    );
    throw err;
  }
  return response.json() as Promise<T>;
}

/** Discriminated error class so callers can branch on error.code (e.g.,
 *  `NEEDS_EXTENSION`, `HARD_CAP_REACHED`). */
export class ChatApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ChatApiError';
  }
}

export function createChatSession(args: {
  // Phase 3 + Phase Fortune — exactly one of (readingId, comparisonId,
  // fortune) must be set. Service-level validation enforces XOR at backend.
  readingId?: string;
  comparisonId?: string;
  fortune?: {
    profileId: string;
    fortuneScope: 'DAY' | 'MONTH' | 'YEAR';
    fortuneAnchorDate: string; // ISO YYYY-MM-DD
  };
  token: string;
}): Promise<CreateChatSessionResponse> {
  return jsonFetch('/api/chat/sessions', {
    method: 'POST',
    body: JSON.stringify({
      readingId: args.readingId,
      comparisonId: args.comparisonId,
      fortune: args.fortune,
    }),
    token: args.token,
  });
}

export function listSessionsForReading(args: {
  readingId: string;
  token: string;
}): Promise<ChatSession[]> {
  return jsonFetch(`/api/chat/readings/${args.readingId}/sessions`, {
    method: 'GET',
    token: args.token,
  });
}

// Phase 3 — parallel for COMPATIBILITY sessions
export function listSessionsForComparison(args: {
  comparisonId: string;
  token: string;
}): Promise<ChatSession[]> {
  return jsonFetch(`/api/chat/comparisons/${args.comparisonId}/sessions`, {
    method: 'GET',
    token: args.token,
  });
}

// Phase Fortune — list FORTUNE sessions for a (profileId, anchorDate).
// anchorDate is required so date navigation spawns new sessions (plan
// Issue 10 — date-filtered resume).
export function listSessionsForFortune(args: {
  profileId: string;
  fortuneAnchorDate: string; // ISO YYYY-MM-DD
  token: string;
}): Promise<ChatSession[]> {
  const params = new URLSearchParams({ anchorDate: args.fortuneAnchorDate });
  return jsonFetch(
    `/api/chat/profiles/${args.profileId}/fortune-sessions?${params.toString()}`,
    {
      method: 'GET',
      token: args.token,
    },
  );
}

export function getMessages(args: {
  sessionId: string;
  cursor?: number;
  limit?: number;
  token: string;
}): Promise<ChatMessageListResponse> {
  const { sessionId, cursor = 0, limit = 5, token } = args;
  return jsonFetch(
    `/api/chat/sessions/${sessionId}/messages?cursor=${cursor}&limit=${limit}`,
    { method: 'GET', token },
  );
}

export function extendSession(args: {
  sessionId: string;
  token: string;
}): Promise<ChatExtendResponse> {
  return jsonFetch(`/api/chat/sessions/${args.sessionId}/extend`, {
    method: 'POST',
    body: JSON.stringify({}),
    token: args.token,
  });
}

export function getUsage(args: { token: string }): Promise<ChatUsageResponse> {
  return jsonFetch('/api/chat/usage/me', {
    method: 'GET',
    token: args.token,
  });
}

// ============================================================
// Phase 2 — sample-question public endpoint (no auth)
// ============================================================

/** Mirrors backend ChatReadingType enum subset enabled for chat. */
export type ChatReadingType =
  | 'LIFETIME'
  | 'LOVE'
  | 'CAREER'
  | 'ANNUAL'
  | 'COMPATIBILITY'
  | 'FORTUNE'; // Phase Fortune — daily fortune chat scope (DAY only)

/** Phase Fortune — nested discriminator for FORTUNE chat subject. All 3
 *  fields required together (backend DTO uses @ValidateNested). */
export interface FortuneSubject {
  profileId: string;
  fortuneScope: 'DAY' | 'MONTH' | 'YEAR';
  /** ISO YYYY-MM-DD. Caller (page) is responsible for resolving the
   *  23:00 子時 boundary against Asia/Taipei BEFORE sending. */
  fortuneAnchorDate: string;
}

export interface SampleQuestionItem {
  id: string;
  questionText: string;
  displayOrder: number;
}

/**
 * Fetch sample questions for a (readingType, sectionKey) tuple.
 * Public endpoint — does NOT need an auth token.
 *
 * `sectionKey === null` returns the «general» floating-button questions
 * (used in ChatDrawer's empty state).
 */
export async function getSampleQuestions(args: {
  readingType: ChatReadingType;
  sectionKey: string | null;
  locale?: string;
}): Promise<SampleQuestionItem[]> {
  const params = new URLSearchParams({ readingType: args.readingType });
  if (args.sectionKey) params.set('sectionKey', args.sectionKey);
  if (args.locale) params.set('locale', args.locale);
  const response = await fetch(
    `${API_BASE}/api/chat/sample-questions?${params.toString()}`,
    { method: 'GET' },
  );
  if (!response.ok) {
    // Don't throw — sample questions are best-effort UI sugar; on failure
    // the caller renders nothing rather than an error.
    return [];
  }
  const body = (await response.json()) as { questions: SampleQuestionItem[] };
  return body.questions ?? [];
}

/**
 * Phase 4 — fetch ALL active sample questions for a reading type (across
 * all sectionKeys). Used by the SampleQuestionsBrowser in-drawer overlay.
 * Public endpoint — does NOT need an auth token.
 *
 * Ordering: section-grouped (sectionKey ASC, NULLS LAST), then displayOrder
 * within each section. General «catch-all» questions appear at the bottom.
 */
export async function getAllSampleQuestions(args: {
  readingType: ChatReadingType;
  locale?: string;
}): Promise<SampleQuestionItem[]> {
  const params = new URLSearchParams({ readingType: args.readingType });
  if (args.locale) params.set('locale', args.locale);
  const response = await fetch(
    `${API_BASE}/api/chat/sample-questions/all?${params.toString()}`,
    { method: 'GET' },
  );
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as { questions: SampleQuestionItem[] };
  return body.questions ?? [];
}

// ============================================================
// POST + SSE streaming helper
// ============================================================

/**
 * Stream chat messages from the API. Uses fetch + ReadableStream rather than
 * `EventSource` (which doesn't support POST) or `@microsoft/fetch-event-source`
 * (which adds undesired auto-reconnect for an authoritative chat reply).
 *
 * Buffers partial chunks across reads — SSE messages can split mid-text.
 *
 * Returns a teardown function that aborts the underlying fetch and stream.
 */
export function streamChatMessage(args: {
  sessionId: string;
  content: string;
  sectionContextHint?: string;
  token: string;
  onEvent: (event: ChatStreamEvent) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}): () => void {
  const controller = new AbortController();

  (async () => {
    let response: Response;
    try {
      response = await fetch(
        `${API_BASE}/api/chat/sessions/${args.sessionId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${args.token}`,
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            content: args.content,
            sectionContextHint: args.sectionContextHint,
          }),
          signal: controller.signal,
        },
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      args.onError(err as Error);
      args.onClose();
      return;
    }

    if (!response.ok) {
      // Non-2xx (e.g., NEEDS_EXTENSION 402, HARD_CAP_REACHED 409). Backend
      // emits these via the SSE error event normally, but pre-flight errors
      // (auth, throttle) come back as plain JSON with the error.
      let body: { message?: string; code?: string } = {};
      try {
        body = await response.json();
      } catch {
        // ignore
      }
      args.onEvent({
        type: 'error',
        code: body.code || `HTTP_${response.status}`,
        message:
          body.message ||
          `Chat stream failed: ${response.status} ${response.statusText}`,
      });
      args.onClose();
      return;
    }

    if (!response.body) {
      args.onError(new Error('Chat stream: missing response body'));
      args.onClose();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      // SSE frames are delimited by `\n\n` per the spec. We accumulate text
      // across reads and flush whenever a frame boundary appears.
      // Each frame contains zero or more `data: ...\n` lines.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let frameEnd = buffer.indexOf('\n\n');
        while (frameEnd !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          dispatchFrame(frame, args.onEvent);
          frameEnd = buffer.indexOf('\n\n');
        }
      }
      // Flush trailing partial frame (rare — server should always end on \n\n).
      if (buffer.trim().length > 0) {
        dispatchFrame(buffer, args.onEvent);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        args.onError(err as Error);
      }
    } finally {
      args.onClose();
    }
  })();

  return () => controller.abort();
}

function dispatchFrame(
  frame: string,
  onEvent: (event: ChatStreamEvent) => void,
): void {
  // A frame may contain multiple `data: ` lines that should be concatenated
  // per the SSE spec, but the backend always emits a single `data: ` per
  // frame, so the simple `data: ` prefix path covers all real events.
  const lines = frame.split('\n');
  const dataParts: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('data: ')) {
      dataParts.push(line.slice(6));
    } else if (line.startsWith('data:')) {
      dataParts.push(line.slice(5));
    }
    // Ignore `event:`, `id:`, `retry:` — backend doesn't emit them.
  }
  if (dataParts.length === 0) return;
  const payload = dataParts.join('\n');
  try {
    const event = JSON.parse(payload) as ChatStreamEvent;
    onEvent(event);
  } catch {
    // Drop malformed frames silently — would only happen if the backend
    // emits non-JSON, which is a server bug we can't recover from client-side.
  }
}
