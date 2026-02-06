/**
 * API client for communicating with the NestJS backend.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * Fetch wrapper that adds auth token and handles errors.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody.message || `API error: ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

/**
 * Calculate Bazi chart directly via Python engine (for preview/demo).
 * This calls the Python Bazi engine directly, bypassing auth.
 */
export async function calculateBaziDirect(params: {
  birth_date: string;
  birth_time: string;
  birth_city: string;
  timezone: string;
  gender: string;
  target_year?: number;
}): Promise<Record<string, unknown>> {
  const BAZI_ENGINE_URL = process.env.NEXT_PUBLIC_BAZI_ENGINE_URL || 'http://localhost:5001';

  const response = await fetch(`${BAZI_ENGINE_URL}/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`Bazi engine error: ${response.status}`);
  }

  const result = await response.json();
  return result.data || result;
}
