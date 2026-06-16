/**
 * Admin API client — extends the existing apiFetch pattern.
 * All functions require admin auth token.
 */

import { apiFetch } from './api';
import { redirectToSignInOnExpiry } from './auth-redirect';

// ============ Types ============

export interface DashboardStats {
  totalUsers: number;
  totalReadings: number;
  totalComparisons: number;
  recentUsers7d: number;
  readingsByType: { type: string; count: number }[];
}

export interface AdminService {
  id: string;
  slug: string;
  nameZhTw: string;
  nameZhCn: string;
  descriptionZhTw: string;
  descriptionZhCn: string;
  type: string;
  creditCost: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPlan {
  id: string;
  slug: string;
  nameZhTw: string;
  nameZhCn: string;
  priceMonthly: number;
  priceAnnual: number;
  currency: string;
  features: unknown;
  readingsPerMonth: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPromoCode {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  maxUses: number;
  currentUses: number;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
  createdAt: string;
}

export interface AdminPromptTemplate {
  id: string;
  readingType: string;
  aiProvider: string;
  version: number;
  systemPrompt: string;
  userPromptTemplate: string;
  outputFormatInstructions: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminGateway {
  id: string;
  provider: string;
  region: string;
  isActive: boolean;
  config: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUser {
  id: string;
  clerkUserId: string;
  name: string | null;
  avatarUrl: string | null;
  subscriptionTier: string;
  credits: number;
  languagePref: string;
  createdAt: string;
  updatedAt: string;
  _count: {
    baziReadings: number;
    subscriptions: number;
    transactions: number;
  };
}

export interface AdminUserDetail {
  id: string;
  clerkUserId: string;
  name: string | null;
  avatarUrl: string | null;
  subscriptionTier: string;
  credits: number;
  languagePref: string;
  createdAt: string;
  updatedAt: string;
  subscriptions: {
    id: string;
    planTier: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    createdAt: string;
  }[];
  transactions: {
    id: string;
    amount: number;
    currency: string;
    type: string;
    description: string | null;
    platform: string;
    createdAt: string;
  }[];
  _count: {
    baziReadings: number;
    baziComparisons: number;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CostByReadingType {
  readingType: string;
  totalCost: number;
  count: number;
  avgCost: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgLatencyMs: number;
  cacheHitRate: number;
}

export interface CostByTier {
  tier: string;
  label: string;
  readingTypes: string[];
  totalCost: number;
  count: number;
  avgCost: number;
}

export interface AICosts {
  days: number;
  totalCost: number;
  avgCostPerReading: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  cacheHitRate: number;
  costByProvider: {
    provider: string;
    totalCost: number;
    count: number;
    avgCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  }[];
  costByReadingType: CostByReadingType[];
  costByTier: CostByTier[];
  dailyCosts: { date: string; totalCost: number; count: number }[];
}

export interface Revenue {
  totalRevenue30d: number;
  monthlyRevenue: { month: string; total: number; count: number }[];
  activeSubscriptions: { tier: string; count: number }[];
}

export interface AuditLogEntry {
  id: string;
  adminUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

// ============ Credit Packages ============

export interface AdminCreditPackage {
  id: string;
  slug: string;
  nameZhTw: string;
  nameZhCn: string;
  creditAmount: number;
  priceUsd: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface MonetizationAnalytics {
  days: number;
  creditPackagePurchases: {
    description: string;
    totalRevenue: number;
    count: number;
    avgAmount: number;
  }[];
  adRewardClaims: {
    rewardType: string;
    count: number;
    creditsGranted: number;
  }[];
  adRewardDailyTrend: {
    date: string;
    count: number;
  }[];
  sectionUnlockStats: {
    sectionKey: string;
    count: number;
  }[];
  activeSubscriptionsByTier: {
    tier: string;
    count: number;
  }[];
  newSubscriptions: number;
  cancelledSubscriptions: number;
  conversionFunnel: {
    totalUsers: number;
    usersWithReadings: number;
    creditPurchasers: number;
    subscribers: number;
  };
  revenueByType: {
    type: string;
    total: number;
    count: number;
  }[];
}

// ============ Dashboard ============

export async function getAdminStats(token: string): Promise<DashboardStats> {
  return apiFetch<DashboardStats>('/api/admin/stats', { token });
}

// ============ Chat aggregate (Phase 1.10) ============

export interface ChatAggregateResponse {
  generatedAt: string;
  sessions: {
    total: number;
    last7Days: number;
    last24Hours: number;
    atHardCap: number;
    extended: number;
    avgMessagesPerSession: number;
  };
  messages: {
    total: number;
    user: number;
    assistant: number;
    system: number;
    refunded: number;
    refundRate: number;
  };
  validators: {
    bannedPhraseOrCitationAutoFixed: number;
    llmJudgeSampled: number;
    llmJudgeFail: number;
    llmJudgeFailRate: number;
  };
  tokens: {
    totalInput: number;
    totalOutput: number;
    totalCacheRead: number;
    totalCacheCreation: number;
    cacheHitRate: number;
  };
  monthly: {
    periodStart: string;
    byTier: Array<{
      tier: string;
      activeUsers: number;
      totalChatsUsed: number;
    }>;
  };
  extensions: {
    sessionsExtendedCount: number;
    totalCreditsSpent: number;
  };
  /** Phase 1.11 — 7-day rolling cost breakdown by session-length bucket. */
  costByBucket: {
    windowDays: number;
    buckets: Array<{
      range: '1-10' | '11-20' | '21-30';
      sessionCount: number;
      avgCostUsd: number;
      totalCostUsd: number;
    }>;
  };
}

export async function getChatAggregate(token: string): Promise<ChatAggregateResponse> {
  return apiFetch<ChatAggregateResponse>('/api/admin/chat/aggregate', { token });
}

// ============ Services ============

export async function listServices(token: string): Promise<AdminService[]> {
  return apiFetch<AdminService[]>('/api/admin/services', { token });
}

export async function updateService(
  token: string,
  id: string,
  data: Partial<Pick<AdminService, 'nameZhTw' | 'nameZhCn' | 'creditCost' | 'isActive' | 'sortOrder'>>,
): Promise<AdminService> {
  return apiFetch<AdminService>(`/api/admin/services/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(data),
  });
}

// ============ Plans ============

export async function listPlans(token: string): Promise<AdminPlan[]> {
  return apiFetch<AdminPlan[]>('/api/admin/plans', { token });
}

export async function updatePlan(
  token: string,
  id: string,
  data: Record<string, unknown>,
): Promise<AdminPlan> {
  return apiFetch<AdminPlan>(`/api/admin/plans/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(data),
  });
}

// ============ Promo Codes ============

export async function listPromoCodes(token: string): Promise<AdminPromoCode[]> {
  return apiFetch<AdminPromoCode[]>('/api/admin/promo-codes', { token });
}

export async function createPromoCode(
  token: string,
  data: {
    code: string;
    discountType: string;
    discountValue: number;
    maxUses: number;
    validFrom: string;
    validUntil: string;
    isActive?: boolean;
  },
): Promise<AdminPromoCode> {
  return apiFetch<AdminPromoCode>('/api/admin/promo-codes', {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  });
}

export async function updatePromoCode(
  token: string,
  id: string,
  data: Partial<Pick<AdminPromoCode, 'discountType' | 'discountValue' | 'maxUses' | 'validFrom' | 'validUntil' | 'isActive'>>,
): Promise<AdminPromoCode> {
  return apiFetch<AdminPromoCode>(`/api/admin/promo-codes/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(data),
  });
}

// ============ Prompt Templates ============

export async function listPromptTemplates(token: string): Promise<AdminPromptTemplate[]> {
  return apiFetch<AdminPromptTemplate[]>('/api/admin/prompt-templates', { token });
}

export async function updatePromptTemplate(
  token: string,
  id: string,
  data: Partial<Pick<AdminPromptTemplate, 'systemPrompt' | 'userPromptTemplate' | 'outputFormatInstructions' | 'isActive'>>,
): Promise<AdminPromptTemplate> {
  return apiFetch<AdminPromptTemplate>(`/api/admin/prompt-templates/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(data),
  });
}

// ============ Payment Gateways ============

export async function listGateways(token: string): Promise<AdminGateway[]> {
  return apiFetch<AdminGateway[]>('/api/admin/gateways', { token });
}

export async function updateGateway(
  token: string,
  id: string,
  data: { isActive?: boolean; config?: Record<string, unknown> },
): Promise<AdminGateway> {
  return apiFetch<AdminGateway>(`/api/admin/gateways/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(data),
  });
}

// ============ Users ============

export async function listUsers(
  token: string,
  params?: { page?: number; limit?: number; search?: string },
): Promise<PaginatedResponse<AdminUser>> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.search) query.set('search', params.search);
  const qs = query.toString();
  return apiFetch<PaginatedResponse<AdminUser>>(
    `/api/admin/users${qs ? `?${qs}` : ''}`,
    { token },
  );
}

export async function getUserDetail(token: string, id: string): Promise<AdminUserDetail> {
  return apiFetch<AdminUserDetail>(`/api/admin/users/${id}`, { token });
}

export async function adjustUserCredits(
  token: string,
  userId: string,
  data: { amount: number; reason: string },
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/api/admin/users/${userId}/credits`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(data),
  });
}

// ============ Analytics ============

export async function getAICosts(token: string, params?: { days?: number }): Promise<AICosts> {
  const query = new URLSearchParams();
  if (params?.days) query.set('days', String(params.days));
  const qs = query.toString();
  return apiFetch<AICosts>(`/api/admin/ai-costs${qs ? `?${qs}` : ''}`, { token });
}

export async function getRevenue(token: string): Promise<Revenue> {
  return apiFetch<Revenue>('/api/admin/revenue', { token });
}

// ============ Credit Packages ============

export async function listCreditPackages(token: string): Promise<AdminCreditPackage[]> {
  return apiFetch<AdminCreditPackage[]>('/api/admin/credit-packages', { token });
}

export async function createCreditPackage(
  token: string,
  data: {
    slug: string;
    nameZhTw: string;
    nameZhCn: string;
    creditAmount: number;
    priceUsd: number;
    isActive?: boolean;
    sortOrder?: number;
  },
): Promise<AdminCreditPackage> {
  return apiFetch<AdminCreditPackage>('/api/admin/credit-packages', {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  });
}

export async function updateCreditPackage(
  token: string,
  id: string,
  data: Partial<Pick<AdminCreditPackage, 'nameZhTw' | 'nameZhCn' | 'creditAmount' | 'priceUsd' | 'isActive' | 'sortOrder'>>,
): Promise<AdminCreditPackage> {
  return apiFetch<AdminCreditPackage>(`/api/admin/credit-packages/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(data),
  });
}

// ============ Monetization Analytics ============

export async function getMonetizationAnalytics(
  token: string,
  params?: { days?: number },
): Promise<MonetizationAnalytics> {
  const query = new URLSearchParams();
  if (params?.days) query.set('days', String(params.days));
  const qs = query.toString();
  return apiFetch<MonetizationAnalytics>(
    `/api/admin/monetization-analytics${qs ? `?${qs}` : ''}`,
    { token },
  );
}

// ============ Audit Log ============

export async function getAuditLog(
  token: string,
  params?: { page?: number; limit?: number },
): Promise<PaginatedResponse<AuditLogEntry>> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return apiFetch<PaginatedResponse<AuditLogEntry>>(
    `/api/admin/audit-log${qs ? `?${qs}` : ''}`,
    { token },
  );
}

// ============ Dashboard Banner Slides ============

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface AdminBannerSlide {
  id: string;
  label: string | null;
  imageUrlDesktop: string;
  imageUrlMobile: string;
  linkHref: string;
  altText: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BannerSlideInput {
  label?: string;
  imageUrlDesktop: string;
  imageUrlMobile: string;
  linkHref: string;
  altText?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export async function listBannerSlides(token: string): Promise<AdminBannerSlide[]> {
  const res = await apiFetch<{ items: AdminBannerSlide[] }>('/api/admin/banners', {
    token,
  });
  return res.items;
}

export async function createBannerSlide(
  token: string,
  data: BannerSlideInput,
): Promise<AdminBannerSlide> {
  const res = await apiFetch<{ item: AdminBannerSlide }>('/api/admin/banners', {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  });
  return res.item;
}

export async function updateBannerSlide(
  token: string,
  id: string,
  data: Partial<BannerSlideInput>,
): Promise<AdminBannerSlide> {
  const res = await apiFetch<{ item: AdminBannerSlide }>(
    `/api/admin/banners/${id}`,
    { method: 'PATCH', token, body: JSON.stringify(data) },
  );
  return res.item;
}

export async function deleteBannerSlide(token: string, id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/admin/banners/${id}`, {
    method: 'DELETE',
    token,
  });
}

/**
 * Upload a banner image to R2. Uses a raw `fetch` with `FormData` (NOT
 * apiFetch — apiFetch force-sets `Content-Type: application/json`, but
 * multipart needs the browser to set the boundary). Returns the public URL.
 */
export async function uploadBannerImage(token: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/api/admin/banners/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }, // no Content-Type — browser sets multipart boundary
    body: form,
  });
  if (!res.ok) {
    // Layer C (Global Signed-Out Handler) — authenticated raw fetch must
    // redirect to sign-in on a mid-session 401 (mirrors readings-api.ts).
    if (res.status === 401) redirectToSignInOnExpiry();
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Upload failed: ${res.status}`);
  }
  const data = (await res.json()) as { url: string };
  return data.url;
}
