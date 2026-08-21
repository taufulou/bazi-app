/**
 * Next.js API Route: POST /api/bazi-calculate
 *
 * Proxies the free chart preview to the **NestJS API**, which then calls the
 * Python engine.
 *
 * ⚠️ M10. This used to call the engine DIRECTLY (keyed by B3-a, but still
 * bypassing NestJS), and it was the LAST non-NestJS engine caller in the repo.
 * That mattered for two reasons:
 *
 *   • B3-b — flipping the engine to fail-closed (`ENGINE_REQUIRE_KEY`) is only
 *     safe once every caller goes through a keyed door. This route was keyed,
 *     so it would not have 401'd, but it kept a second door open in a
 *     deployment where the engine is supposed to have exactly one client.
 *   • Rate limiting — a request that never reaches NestJS is a request no
 *     throttle can see. The free preview was the one AI-adjacent surface with
 *     no limit of any kind on it.
 *
 * The NestJS side already existed: `POST /api/bazi/calculate` (`@Public()`,
 * throttled), backed by `passthroughCalculate`. It returns the engine's
 * `{ status, data }` envelope verbatim, which is exactly what this route
 * returned before, so the client contract is unchanged — `page.tsx` reads
 * `baziResult.data || baziResult` and keeps working either way.
 *
 * ⚠️ KNOWN INTERIM (M1): NestJS registers the stock IP-scoped `ThrottlerGuard`,
 * so until M1 lands its per-user tracker, every preview proxied from this route
 * shares ONE bucket keyed to the WEB SERVER's IP — 20/min globally, not
 * per-user. Harmless pre-launch (no real users) and strictly more protection
 * than the zero this route had before, but it MUST NOT reach launch: M1 is in
 * the same phase and its acceptance criterion is "two distinct signed-in
 * clients → distinct throttle buckets".
 *
 * The bearer is minted SERVER-SIDE from the Clerk session rather than forwarded
 * — the browser client sends no Authorization header on this path (see
 * `page.tsx`, Content-Type only). Sending it is what lets M1's tracker key per
 * user without touching this file again. Anonymous callers send none and are
 * throttled by IP, which the plan documents as acceptable (scripts only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Errors are swallowed on purpose — a token we cannot mint means anonymous,
    // and anonymous is a valid state for the free preview.
    let bearer: string | null = null;
    try {
      const { getToken } = await auth();
      bearer = await getToken();
    } catch {
      bearer = null;
    }

    const response = await fetch(`${API_URL}/api/bazi/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      // NestJS shapes errors as `{ message }` — a STRING here, but an ARRAY for
      // class-validator failures, and elsewhere in this API an OBJECT
      // (`HttpException({ code, message })`). `AllExceptionsFilter` casts
      // without a runtime check, so all three can reach the wire.
      //
      // The client does `new Error(errData.error || …)`, which stringifies an
      // object to the literal "[object Object]" — so anything that is not a
      // string has to be normalised HERE or it becomes the user-visible error.
      // `detail` is the engine's own shape, kept as a fallback.
      const raw = errorBody.message ?? errorBody.detail;
      const detail =
        typeof raw === 'string' ? raw
        : Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').join('; ')
        : undefined;
      return NextResponse.json(
        { error: detail || `排盤失敗 (${response.status})` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `無法連線到排盤服務: ${message}` },
      { status: 502 },
    );
  }
}
