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
// User Profile API
// ---------------------------------------------------------------------------

/** Shape returned by GET /api/users/me (cherry-picked fields) */
export interface UserProfile {
  id: string;
  credits: number;
  subscriptionTier: 'FREE' | 'BASIC' | 'PRO' | 'MASTER';
  freeReadingUsed: boolean;
  name: string | null;
}

/**
 * Get the current user's profile (credits, tier, etc.).
 * GET /api/users/me
 */
export async function getUserProfile(token: string): Promise<UserProfile> {
  return apiFetch<UserProfile>('/api/users/me', { token });
}

// ---------------------------------------------------------------------------
// Payment & Subscription API
// ---------------------------------------------------------------------------

/** Shape returned by GET /api/payments/subscription */
export interface SubscriptionStatus {
  subscriptionTier: 'FREE' | 'BASIC' | 'PRO' | 'MASTER';
  credits: number;
  freeReadingUsed: boolean;
  activeSubscription: {
    planTier: string;
    platform: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    status: string;
    cancelledAt: string | null;
  } | null;
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

/** A credit package returned by GET /api/payments/credit-packages */
export interface CreditPackage {
  id: string;
  slug: string;
  nameZhTw: string;
  nameZhCn: string;
  creditAmount: number;
  priceUsd: number;
  sortOrder: number;
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
  params: {
    planSlug: string;
    billingCycle: 'monthly' | 'annual';
    promoCode?: string;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<CheckoutSession> {
  return apiFetch<CheckoutSession>('/api/payments/checkout/subscription', {
    method: 'POST',
    token,
    body: JSON.stringify(params),
  });
}

/**
 * Create a Stripe Checkout session for a one-time purchase (credit package).
 * POST /api/payments/checkout/one-time
 */
export async function createOneTimeCheckout(
  token: string,
  params: {
    serviceSlug: string;
    promoCode?: string;
    successUrl: string;
    cancelUrl: string;
  },
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
export async function cancelSubscription(token: string): Promise<{ success: boolean; endsAt: string }> {
  return apiFetch<{ success: boolean; endsAt: string }>('/api/payments/cancel', {
    method: 'POST',
    token,
  });
}

/**
 * Upgrade (or change) subscription to a different plan.
 * POST /api/payments/upgrade
 */
export async function upgradeSubscription(
  token: string,
  params: { planSlug: string; billingCycle: 'monthly' | 'annual' },
): Promise<{ success: boolean; newTier: string }> {
  return apiFetch<{ success: boolean; newTier: string }>('/api/payments/upgrade', {
    method: 'POST',
    token,
    body: JSON.stringify(params),
  });
}

/**
 * Reactivate a previously-cancelled subscription.
 * POST /api/payments/reactivate
 */
export async function reactivateSubscription(token: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('/api/payments/reactivate', {
    method: 'POST',
    token,
  });
}

// ---------------------------------------------------------------------------
// Invoice API
// ---------------------------------------------------------------------------

/** A single invoice from Stripe returned by GET /api/payments/invoices */
export interface Invoice {
  id: string;
  number: string | null;
  date: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: string;
  description: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

/**
 * Get invoice history for the current user.
 * GET /api/payments/invoices
 */
export async function getInvoices(token: string, limit = 10): Promise<Invoice[]> {
  return apiFetch<Invoice[]>(`/api/payments/invoices?limit=${limit}`, { token });
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

// ---------------------------------------------------------------------------
// Credit Package API
// ---------------------------------------------------------------------------

/**
 * Get all active credit packages (public endpoint).
 * GET /api/payments/credit-packages
 */
export async function getCreditPackages(): Promise<CreditPackage[]> {
  return apiFetch<CreditPackage[]>('/api/payments/credit-packages');
}

/**
 * Create a Stripe Checkout session for a credit package purchase.
 * POST /api/payments/checkout/credits
 */
export async function createCreditCheckout(
  token: string,
  params: {
    packageSlug: string;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<CheckoutSession> {
  return apiFetch<CheckoutSession>('/api/payments/checkout/credits', {
    method: 'POST',
    token,
    body: JSON.stringify(params),
  });
}
