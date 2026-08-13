/**
 * Next.js API Route: POST /api/explain-element
 *
 * Proxies element-explanation requests to the **NestJS API**, which then calls
 * the Python engine.
 *
 * ⚠️ It used to call the engine DIRECTLY, and that is why O3 was only half
 * fixed. The paid-layer gate lives in NestJS
 * (`bazi.service.ts::passthroughExplainElement`), so a route that skips NestJS
 * skips the gate: an anonymous `curl` against this path returned Layers B/C/D,
 * `pillarContext.paid`, `interactions` and the paid `dayPillarCombo` fields in
 * full. The mobile client already went through NestJS; the web client did not,
 * so fixing only the NestJS route left the web surface exactly as it was.
 *
 * This is M10's reroute applied to this one route, early, because leaving it
 * would make the audit record "O3 FIXED" while the hole was open.
 *
 * The bearer is minted SERVER-SIDE from the Clerk session (the browser client
 * sends no Authorization header), so NestJS can tell a subscriber apart.
 * Anonymous requests carry none and get the free tier, which is correct.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // ⚠️ Mint the bearer SERVER-SIDE rather than forwarding one from the
    // browser: the web client sends no Authorization header at all
    // (`element-explanation-api.ts:182` — Content-Type only), so relying on
    // forwarding would serve every SUBSCRIBER the free tier. Clerk's
    // middleware already runs on this route, so the session is available here.
    //
    // Errors are swallowed on purpose — a token we cannot mint means anonymous,
    // and anonymous is a valid state for this endpoint.
    let bearer: string | null = null;
    try {
      const { getToken } = await auth();
      bearer = await getToken();
    } catch {
      bearer = null;
    }

    const response = await fetch(`${API_URL}/api/bazi/explain-element`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return NextResponse.json(
        { error: `API error: ${response.status}`, detail: errorText },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[explain-element proxy] Error:', error);
    return NextResponse.json(
      { error: 'Failed to reach the API' },
      { status: 502 },
    );
  }
}
