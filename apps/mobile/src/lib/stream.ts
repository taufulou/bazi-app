/**
 * Shared SSE streaming seam for the mobile app.
 *
 * Mirrors the web's fetch + ReadableStream reader-loop + `\n\n` frame-split
 * contract (apps/web/app/lib/fortune-api.ts::streamDailyFortune and
 * chat-api.ts::streamChatMessage), but uses **`expo/fetch`** instead of the
 * global fetch: React Native's built-in fetch buffers the whole response and
 * does NOT expose a streaming body, whereas `expo/fetch`'s WinterCG
 * `FetchResponse` exposes `response.body` as a real `ReadableStream<Uint8Array>`
 * with `.getReader()` — the exact API the web reader-loop relies on.
 *
 * Every AI-streaming feature (fortune 日/月/年運, chat) routes through
 * `openSseStream` so there is a single transport seam to harden/fallback.
 */
import { fetch as expoFetch } from 'expo/fetch';
import { notifyUnauthorized } from './api';

/** Canonical error frame shape shared by all streaming domains. */
export interface SseErrorEvent {
  type: 'error';
  code: string;
  message: string;
}

export interface OpenSseStreamOpts<E> {
  url: string;
  token: string;
  method?: 'GET' | 'POST';
  /** JSON body (POST streams, e.g. chat). Serialized + Content-Type set automatically. */
  body?: unknown;
  /**
   * Parse one SSE frame (the text between `\n\n`) into a typed event, or null to
   * skip. Defaults to `parseSseDataFrame` (extract `data:` lines → JSON.parse).
   */
  parseFrame?: (frame: string) => E | null;
  onEvent: (event: E) => void;
  onError: (err: Error) => void;
  onClose: () => void;
  /**
   * Shape the pre-flight (`!response.ok`) failure into a domain event. The
   * fortune/chat unions all carry a `{ type:'error', code, message }` member,
   * so the default emits exactly that. 401 always fires `notifyUnauthorized`
   * first (session-expiry sign-out) regardless of this hook.
   */
  onPreflightError?: (status: number, body: { code?: string; message?: string }) => E;
  /** Label used in default error messages. */
  label?: string;
}

/**
 * Extract the `data:` payload from a single SSE frame and JSON.parse it.
 * Mirrors web `dispatchFortuneFrame` — joins multi-line `data:` parts, drops
 * malformed frames silently (returns null).
 */
export function parseSseDataFrame<E>(frame: string): E | null {
  const lines = frame.split('\n');
  const dataParts: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('data: ')) dataParts.push(line.slice(6));
    else if (line.startsWith('data:')) dataParts.push(line.slice(5));
  }
  if (dataParts.length === 0) return null;
  try {
    return JSON.parse(dataParts.join('\n')) as E;
  } catch {
    return null; // drop malformed frames
  }
}

/**
 * Open an SSE stream and dispatch parsed events. Returns a teardown function
 * that aborts the underlying fetch + reader (call it on unmount / dep change).
 */
export function openSseStream<E>(opts: OpenSseStreamOpts<E>): () => void {
  const controller = new AbortController();
  const parse = opts.parseFrame ?? parseSseDataFrame<E>;
  const label = opts.label ?? 'Stream';

  (async () => {
    let response: Response;
    try {
      response = (await expoFetch(opts.url, {
        method: opts.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: 'text/event-stream',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      })) as unknown as Response;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      opts.onError(err as Error);
      opts.onClose();
      return;
    }

    if (!response.ok) {
      // 401 → session expired: sign out + redirect BEFORE emitting the error event.
      if (response.status === 401) notifyUnauthorized();
      // Pre-flight errors (subscription gate, 401, throttle 429) come back as
      // plain JSON `{ code, message }` per the NestJS AllExceptionsFilter.
      let errBody: { code?: string; message?: string } = {};
      try {
        errBody = (await response.json()) as { code?: string; message?: string };
      } catch {
        // non-JSON body — keep defaults
      }
      const event = opts.onPreflightError
        ? opts.onPreflightError(response.status, errBody)
        : ({
            type: 'error',
            code: errBody.code || `HTTP_${response.status}`,
            message: errBody.message || `${label} failed: ${response.status} ${response.statusText}`,
          } as unknown as E);
      opts.onEvent(event);
      opts.onClose();
      return;
    }

    if (!response.body) {
      opts.onError(new Error(`${label}: missing response body`));
      opts.onClose();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let frameEnd = buffer.indexOf('\n\n');
        while (frameEnd !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          const event = parse(frame);
          if (event) opts.onEvent(event);
          frameEnd = buffer.indexOf('\n\n');
        }
      }
      if (buffer.trim().length > 0) {
        const event = parse(buffer);
        if (event) opts.onEvent(event);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') opts.onError(err as Error);
    } finally {
      opts.onClose();
    }
  })();

  return () => controller.abort();
}
