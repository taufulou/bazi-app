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

/** Mirrors `ENGINE_CALLERS` in the API helper; web owns only this one. */
export const WEB_ENGINE_CALLERS = ['web.bazi-calculate'] as const;
export type WebEngineCaller = (typeof WEB_ENGINE_CALLERS)[number];

/** Exported so the parity spec can compare the two helpers' resolution rules. */
export function resolveEngineKey(env: NodeJS.ProcessEnv = process.env): string {
  const single = (env.ENGINE_KEY || '').trim();
  if (single) return single;
  return (env.ENGINE_KEYS || '').split(',')[0]?.trim() || '';
}

let warnedMissingKey = false;

/** Test seam: the missing-key warning fires once per process by design. */
export function resetEngineKeyWarningForTests(): void {
  warnedMissingKey = false;
}

export function buildEngineHeaders(
  caller: WebEngineCaller,
  extra?: Record<string, string>,
): Record<string, string> {
  const key = resolveEngineKey();
  if (!key && !warnedMissingKey) {
    warnedMissingKey = true;
    // The API helper warns; without the same warning here the web route would
    // degrade to unkeyed with no diagnostic anywhere — and this route is the
    // free chart preview, the one engine caller reachable without signing in.
    console.warn(
      '[engine-client] ENGINE_KEY is not set — engine calls from the web app go ' +
        'out unkeyed. Harmless while the engine runs in observe mode; enforcing ' +
        '(ENGINE_REQUIRE_KEY) would 401 the free chart preview. Note Next.js reads ' +
        'env from apps/web/.env.local, not the monorepo root.',
    );
  }
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
