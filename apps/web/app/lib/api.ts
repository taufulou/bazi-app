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

  // Map frontend field names to engine field names
  const { timezone, ...rest } = params;
  const enginePayload = { ...rest, birth_timezone: timezone };

  const response = await fetch(`${BAZI_ENGINE_URL}/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(enginePayload),
  });

  if (!response.ok) {
    throw new Error(`Bazi engine error: ${response.status}`);
  }

  const result = await response.json();
  return result.data || result;
}

// ---------------------------------------------------------------------------
// Payment & Subscription API
// ---------------------------------------------------------------------------

/** Shape returned by GET /api/payments/subscription */
export interface SubscriptionStatus {
  subscribed: boolean;
  plan: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/** A plan object returned by GET /api/payments/plans */
export interface Plan {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: 'month' | 'year' | 'one_time';
  features: string[];
  stripePriceId: string;
}

/** Shape returned by checkout endpoints */
export interface CheckoutSession {
  url: string;
  sessionId: string;
}

/** Shape returned by POST /api/payments/portal */
export interface PortalSession {
  url: string;
}

/** Shape returned by GET /api/payments/free-reading */
export interface FreeReadingStatus {
  used: boolean;
  available: boolean;
}

/**
 * Get the current user's subscription status.
 * GET /api/payments/subscription
 */
export async function getSubscriptionStatus(token: string): Promise<SubscriptionStatus> {
  return apiFetch<SubscriptionStatus>('/api/payments/subscription', { token });
}

/**
 * Get all active (public) plans.
 * GET /api/payments/plans
 */
export async function getActivePlans(): Promise<Plan[]> {
  return apiFetch<Plan[]>('/api/payments/plans');
}

/**
 * Create a Stripe Checkout session for a subscription plan.
 * POST /api/payments/checkout/subscription
 */
export async function createSubscriptionCheckout(
  token: string,
  params: { priceId: string; successUrl: string; cancelUrl: string },
): Promise<CheckoutSession> {
  return apiFetch<CheckoutSession>('/api/payments/checkout/subscription', {
    method: 'POST',
    token,
    body: JSON.stringify(params),
  });
}

/**
 * Create a Stripe Checkout session for a one-time purchase.
 * POST /api/payments/checkout/one-time
 */
export async function createOneTimeCheckout(
  token: string,
  params: { priceId: string; successUrl: string; cancelUrl: string },
): Promise<CheckoutSession> {
  return apiFetch<CheckoutSession>('/api/payments/checkout/one-time', {
    method: 'POST',
    token,
    body: JSON.stringify(params),
  });
}

/**
 * Create a Stripe Customer Portal session.
 * POST /api/payments/portal
 */
export async function createPortalSession(
  token: string,
  returnUrl: string,
): Promise<PortalSession> {
  return apiFetch<PortalSession>('/api/payments/portal', {
    method: 'POST',
    token,
    body: JSON.stringify({ returnUrl }),
  });
}

/**
 * Cancel the current user's subscription (at period end).
 * POST /api/payments/cancel
 */
export async function cancelSubscription(token: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/api/payments/cancel', {
    method: 'POST',
    token,
  });
}

/**
 * Reactivate a previously-cancelled subscription.
 * POST /api/payments/reactivate
 */
export async function reactivateSubscription(token: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/api/payments/reactivate', {
    method: 'POST',
    token,
  });
}

/**
 * Check whether the current user has a free reading available.
 * GET /api/payments/free-reading
 */
export async function checkFreeReading(token: string): Promise<FreeReadingStatus> {
  return apiFetch<FreeReadingStatus>('/api/payments/free-reading', { token });
}

/**
 * Consume the user's free reading.
 * POST /api/payments/free-reading/use
 */
export async function useFreeReading(token: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/api/payments/free-reading/use', {
    method: 'POST',
    token,
  });
}
