/**
 * Next.js API Route: POST /api/bazi-calculate
 *
 * Proxies Bazi calculation requests to the Python engine (port 5001).
 * This avoids browser-to-engine direct calls that may be blocked by
 * macOS firewall or CORS issues.
 */

import { NextRequest, NextResponse } from 'next/server';
import { engineFetch } from '../../lib/engine-client';

const BAZI_ENGINE_URL = process.env.BAZI_ENGINE_URL || 'http://127.0.0.1:5001';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // B3-a: keyed. This is the ONLY live non-NestJS engine caller left — the
    // sibling `explain-element` route was already rerouted through NestJS by O3,
    // and `zwds-calculate` runs iztro in-process. Keying it here means flipping
    // the engine to enforce does not break the free chart preview.
    const response = await engineFetch(`${BAZI_ENGINE_URL}/calculate`, {
      method: 'POST',
      caller: 'web.bazi-calculate',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorBody.detail || `Bazi engine error: ${response.status}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `無法連線到排盤引擎: ${message}` },
      { status: 502 },
    );
  }
}
