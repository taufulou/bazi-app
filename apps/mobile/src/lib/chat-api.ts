/**
 * AI Chat — frontend API client (RN). Wraps the NestJS chat endpoints. The
 * streaming send (`streamChatMessage`) is POST + SSE (`data:`-only frames with
 * the event type inside the JSON, like the fortune streams), so it routes
 * through the shared `openSseStream` seam with the default frame parser.
 *
 * RN port of apps/web/app/lib/chat-api.ts.
 */
import { env } from './env';
import { notifyUnauthorized } from './api';
import { openSseStream } from './stream';
import type {
  ChatMessage,
  ChatSession,
  ChatStreamEvent,
  ChatExtendResponse,
  ChatUsageResponse,
} from './chat-types';

const API_BASE = env.apiUrl;

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

/** Discriminated error so callers can branch on `.code` (NEEDS_EXTENSION, HARD_CAP_REACHED, …). */
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

async function jsonFetch<T>(path: string, init: RequestInit & { token: string }): Promise<T> {
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
    // Chat endpoints are always authenticated → 401 means the session expired.
    if (response.status === 401) notifyUnauthorized();
    let body: { message?: string; code?: string } = {};
    try {
      body = (await response.json()) as { message?: string; code?: string };
    } catch {
      /* ignore parse error */
    }
    throw new ChatApiError(
      body.message || `Chat API error: ${response.status} ${response.statusText}`,
      response.status,
      body.code,
    );
  }
  return response.json() as Promise<T>;
}

// ============================================================
// JSON endpoints
// ============================================================

export function createChatSession(args: {
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

export function listSessionsForReading(args: { readingId: string; token: string }): Promise<ChatSession[]> {
  return jsonFetch(`/api/chat/readings/${args.readingId}/sessions`, { method: 'GET', token: args.token });
}

export function listSessionsForComparison(args: { comparisonId: string; token: string }): Promise<ChatSession[]> {
  return jsonFetch(`/api/chat/comparisons/${args.comparisonId}/sessions`, { method: 'GET', token: args.token });
}

export function listSessionsForFortune(args: {
  profileId: string;
  fortuneAnchorDate: string; // ISO YYYY-MM-DD
  fortuneScope?: 'DAY' | 'MONTH' | 'YEAR';
  token: string;
}): Promise<ChatSession[]> {
  const params = new URLSearchParams({ anchorDate: args.fortuneAnchorDate });
  if (args.fortuneScope) params.set('fortuneScope', args.fortuneScope);
  return jsonFetch(`/api/chat/profiles/${args.profileId}/fortune-sessions?${params.toString()}`, {
    method: 'GET',
    token: args.token,
  });
}

export function getMessages(args: {
  sessionId: string;
  cursor?: number;
  limit?: number;
  token: string;
}): Promise<ChatMessageListResponse> {
  const { sessionId, cursor = 0, limit = 5, token } = args;
  return jsonFetch(`/api/chat/sessions/${sessionId}/messages?cursor=${cursor}&limit=${limit}`, {
    method: 'GET',
    token,
  });
}

export function extendSession(args: { sessionId: string; token: string }): Promise<ChatExtendResponse> {
  return jsonFetch(`/api/chat/sessions/${args.sessionId}/extend`, {
    method: 'POST',
    body: JSON.stringify({}),
    token: args.token,
  });
}

export function getUsage(args: { token: string }): Promise<ChatUsageResponse> {
  return jsonFetch('/api/chat/usage/me', { method: 'GET', token: args.token });
}

// ============================================================
// Sample-question public endpoints (no auth)
// ============================================================

/** Backend ChatReadingType enum subset enabled for chat. */
export type ChatReadingType = 'LIFETIME' | 'LOVE' | 'CAREER' | 'ANNUAL' | 'COMPATIBILITY' | 'FORTUNE';

/** Nested discriminator for a FORTUNE chat subject (all 3 required together). */
export interface FortuneSubject {
  profileId: string;
  fortuneScope: 'DAY' | 'MONTH' | 'YEAR';
  fortuneAnchorDate: string; // ISO YYYY-MM-DD
}

export interface SampleQuestionItem {
  id: string;
  questionText: string;
  displayOrder: number;
}

/** Sample questions for a (readingType, sectionKey) tuple. Public — best-effort (returns [] on failure). */
export async function getSampleQuestions(args: {
  readingType: ChatReadingType;
  sectionKey: string | null;
  locale?: string;
  fortuneScope?: 'DAY' | 'MONTH' | 'YEAR';
}): Promise<SampleQuestionItem[]> {
  const params = new URLSearchParams({ readingType: args.readingType });
  if (args.sectionKey) params.set('sectionKey', args.sectionKey);
  if (args.locale) params.set('locale', args.locale);
  if (args.fortuneScope) params.set('fortuneScope', args.fortuneScope);
  try {
    const response = await fetch(`${API_BASE}/api/chat/sample-questions?${params.toString()}`, { method: 'GET' });
    if (!response.ok) return [];
    const body = (await response.json()) as { questions: SampleQuestionItem[] };
    return body.questions ?? [];
  } catch {
    return [];
  }
}

/** ALL active sample questions for a reading type (across sectionKeys). Public — best-effort. */
export async function getAllSampleQuestions(args: {
  readingType: ChatReadingType;
  locale?: string;
  fortuneScope?: 'DAY' | 'MONTH' | 'YEAR';
}): Promise<SampleQuestionItem[]> {
  const params = new URLSearchParams({ readingType: args.readingType });
  if (args.locale) params.set('locale', args.locale);
  if (args.fortuneScope) params.set('fortuneScope', args.fortuneScope);
  try {
    const response = await fetch(`${API_BASE}/api/chat/sample-questions/all?${params.toString()}`, { method: 'GET' });
    if (!response.ok) return [];
    const body = (await response.json()) as { questions: SampleQuestionItem[] };
    return body.questions ?? [];
  } catch {
    return [];
  }
}

// ============================================================
// POST + SSE streaming send
// ============================================================

/**
 * Stream an assistant reply for a chat message. POST + SSE via `openSseStream`
 * (expo/fetch). Returns a teardown that aborts the underlying fetch + reader.
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
  return openSseStream<ChatStreamEvent>({
    url: `${API_BASE}/api/chat/sessions/${args.sessionId}/messages`,
    token: args.token,
    method: 'POST',
    body: { content: args.content, sectionContextHint: args.sectionContextHint },
    onEvent: args.onEvent,
    onError: args.onError,
    onClose: args.onClose,
    onPreflightError: (status, body) => ({
      type: 'error',
      code: body.code || `HTTP_${status}`,
      message: body.message || `Chat stream failed: ${status}`,
    }),
    label: 'Chat stream',
  });
}
