/**
 * Next.js API Route: POST /api/explain-element
 *
 * Proxies element explanation requests to the Python Bazi engine.
 * This avoids CORS/PNA issues with direct browser→localhost:5001 calls.
 */

import { NextRequest, NextResponse } from 'next/server';

const BAZI_ENGINE_URL = process.env.BAZI_ENGINE_URL || 'http://localhost:5001';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${BAZI_ENGINE_URL}/explain-element`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return NextResponse.json(
        { error: `Engine error: ${response.status}`, detail: errorText },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[explain-element proxy] Error:', error);
    return NextResponse.json(
      { error: 'Failed to reach Bazi engine' },
      { status: 502 },
    );
  }
}
