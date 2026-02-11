/**
 * Next.js API Route: POST /api/bazi-calculate
 *
 * Proxies Bazi calculation requests to the Python engine (port 5001).
 * This avoids browser-to-engine direct calls that may be blocked by
 * macOS firewall or CORS issues.
 */

import { NextRequest, NextResponse } from 'next/server';

const BAZI_ENGINE_URL = process.env.BAZI_ENGINE_URL || 'http://127.0.0.1:5001';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${BAZI_ENGINE_URL}/calculate`, {
      method: 'POST',
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
