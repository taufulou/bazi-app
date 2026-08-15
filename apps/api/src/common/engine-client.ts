import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';

/**
 * B3-a — the single door to the Bazi engine.
 *
 * Every call to the Python engine goes through {@link engineFetch}. That is
 * enforced statically by `scripts/check-engine-callers.mjs` in CI, and the
 * static check is the load-bearing half: the engine's own request counter can
 * only tell you that *some* caller of a path was keyed, not that *all* of them
 * were. `/calculate` alone is reached from three different NestJS call sites
 * plus one Next.js route, so a runtime counter reading "keyed" on that path
 * proves nothing about the other three.
 *
 * The header this attaches does nothing today — the engine ships in observe
 * mode and rejects no one. What it buys now is the evidence for the flip:
 * unkeyed callers show up in the engine's rollup log with the name of the site
 * that made the call.
 */

const logger = new Logger('EngineClient');

export const ENGINE_KEY_HEADER = 'X-Engine-Key';
export const ENGINE_CALLER_HEADER = 'X-Engine-Caller';
export const ENGINE_REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Stable, low-cardinality names for the call sites. They reach the engine's
 * rollup as `<path><-<caller>`, which is what makes an unkeyed request
 * actionable — the path alone is ambiguous.
 *
 * ⚠️ Keep these matching `_LABEL_SAFE` in `packages/bazi-engine/app/engine_auth.py`
 * (`[A-Za-z0-9._/-]`, 48 chars). Anything else is rewritten on arrival and the
 * name you grep for is not the name in the log.
 */
export type EngineCaller =
  | 'bazi.reading'
  | 'bazi.passthrough'
  | 'bazi.compatibility'
  | 'zwds.calculate'
  | 'fortune.daily'
  | 'fortune.monthly'
  | 'fortune.yearly'
  | 'chat.context'
  | 'chat.context-compat'
  | 'chat.context-fortune'
  | 'health.probe';

/**
 * The key this service presents.
 *
 * `ENGINE_KEY` is the steady state — one Railway shared variable referenced by
 * both services, so they cannot drift. `ENGINE_KEYS` is accepted as a fallback
 * only so that setting the engine's list variable on the API service by mistake
 * degrades to "sends the first key" instead of "sends nothing at all", which
 * would be silent.
 */
export function resolveEngineKey(env: NodeJS.ProcessEnv = process.env): string {
  const single = (env.ENGINE_KEY || '').trim();
  if (single) return single;
  const first = (env.ENGINE_KEYS || '').split(',')[0]?.trim() || '';
  return first;
}

let warnedMissingKey = false;

/** Test seam: the missing-key warning fires once per process by design. */
export function resetEngineKeyWarningForTests(): void {
  warnedMissingKey = false;
}

export interface EngineHeaderOptions {
  caller: EngineCaller;
  /** Reuse an id when one already exists for the surrounding request. */
  requestId?: string;
  /** Merged last, so a call site can still set `Content-Type` and friends. */
  extra?: Record<string, string>;
}

export function buildEngineHeaders(opts: EngineHeaderOptions): Record<string, string> {
  const key = resolveEngineKey();
  if (!key && !warnedMissingKey) {
    warnedMissingKey = true;
    logger.warn(
      'ENGINE_KEY is not set — engine calls go out unkeyed. Harmless while the ' +
        'engine runs in observe mode; every request will be counted as `absent` ' +
        'in its rollup, and enforcing (ENGINE_REQUIRE_KEY) would 401 all of them.',
    );
  }
  return {
    ...(key ? { [ENGINE_KEY_HEADER]: key } : {}),
    [ENGINE_CALLER_HEADER]: opts.caller,
    [ENGINE_REQUEST_ID_HEADER]: opts.requestId || randomUUID(),
    ...(opts.extra || {}),
  };
}

export type EngineFetchInit = Omit<RequestInit, 'headers'> & {
  caller: EngineCaller;
  requestId?: string;
  headers?: Record<string, string>;
};

/**
 * A thin wrapper: merge headers, call `fetch`, return the `Response` untouched.
 *
 * Deliberately does NOT catch, retry, or inspect the status. Call sites own
 * their own timeouts and error mapping (502 vs 422 vs pass-through), and a
 * helper that swallowed a rejection here would change failure behaviour at
 * eleven sites at once.
 */
export function engineFetch(url: string, init: EngineFetchInit): Promise<Response> {
  const { caller, requestId, headers, ...rest } = init;
  return fetch(url, {
    ...rest,
    headers: buildEngineHeaders({ caller, requestId, extra: headers }),
  });
}
