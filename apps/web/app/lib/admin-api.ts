/**
 * Admin API client — extends the existing apiFetch pattern.
 * All functions require admin auth token.
 */

import { apiFetch } from './api';

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
  freeReadingUsed: boolean;
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
  freeReadingUsed: boolean;
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
  costByProvider: { provider: string; totalCost: number; count: number; avgCost: number; totalInputTokens: number; totalOutputTokens: number }[];
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

// ============ Dashboard ============

export async function getAdminStats(token: string): Promise<DashboardStats> {
  return apiFetch<DashboardStats>('/api/admin/stats', { token });
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
