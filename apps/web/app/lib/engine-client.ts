import { randomUUID } from 'node:crypto';

/**
 * B3-a — the web side of the engine shared secret.
 *
 * A deliberate duplicate of `apps/api/src/common/engine-client.ts`: `apps/web`
 * cannot import from `apps/api`, and `@repo/shared` is off-limits to the NestJS
 * runtime, so there is no single home for this. The two are kept small and the
 * CI guard treats both as the only permitted doors to the engine.
 *
 * ⚠️ SERVER-ONLY. `ENGINE_KEY` has no `NEXT_PUBLIC_` prefix precisely so it
 * cannot be inlined into the client bundle. Importing this from a Client
 * Component would ship an empty key, not the real one — but do not rely on
 * that: only call it from route handlers and server components.
 */

export const ENGINE_KEY_HEADER = 'X-Engine-Key';
export const ENGINE_CALLER_HEADER = 'X-Engine-Caller';
export const ENGINE_REQUEST_ID_HEADER = 'X-Request-Id';

/** Mirrors `EngineCaller` in the API helper; web owns only this one. */
export type WebEngineCaller = 'web.bazi-calculate';

export function buildEngineHeaders(
  caller: WebEngineCaller,
  extra?: Record<string, string>,
): Record<string, string> {
  const key = (process.env.ENGINE_KEY || process.env.ENGINE_KEYS?.split(',')[0] || '').trim();
  return {
    ...(key ? { [ENGINE_KEY_HEADER]: key } : {}),
    [ENGINE_CALLER_HEADER]: caller,
    [ENGINE_REQUEST_ID_HEADER]: randomUUID(),
    ...(extra || {}),
  };
}

export function engineFetch(
  url: string,
  init: Omit<RequestInit, 'headers'> & {
    caller: WebEngineCaller;
    headers?: Record<string, string>;
  },
): Promise<Response> {
  const { caller, headers, ...rest } = init;
  return fetch(url, { ...rest, headers: buildEngineHeaders(caller, headers) });
}
