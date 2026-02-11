/**
 * Tests for AdminController — REST endpoint routing and service delegation.
 *
 * @jest-environment node
 */

/* ts-jest diagnostics disabled due to pre-existing DTO type mismatch in source */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { AdminController } from '../src/admin/admin.controller';
import { AuthPayload } from '../src/auth/current-user.decorator';

// ============================================================
// Mock Service
// ============================================================

const mockAdminService = {
  getDashboardStats: jest.fn(),
  listServices: jest.fn(),
  updateService: jest.fn(),
  listPlans: jest.fn(),
  updatePlan: jest.fn(),
  listPromoCodes: jest.fn(),
  createPromoCode: jest.fn(),
  updatePromoCode: jest.fn(),
  validatePromoCode: jest.fn(),
  listPromptTemplates: jest.fn(),
  updatePromptTemplate: jest.fn(),
  listGateways: jest.fn(),
  updateGateway: jest.fn(),
  listUsers: jest.fn(),
  getUserDetail: jest.fn(),
  adjustUserCredits: jest.fn(),
  getAICosts: jest.fn(),
  getRevenue: jest.fn(),
  getAuditLog: jest.fn(),
};

// ============================================================
// Test Data
// ============================================================

const AUTH_PAYLOAD: AuthPayload = {
  userId: 'admin-user-1',
  sessionId: 'sess_admin_1',
};

// ============================================================
// Tests
// ============================================================

describe('AdminController', () => {
  let controller: AdminController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AdminController(mockAdminService as any);
  });

  // ============================================================
  // Instantiation
  // ============================================================

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================================
  // Dashboard Stats
  // ============================================================

  describe('GET /api/admin/stats', () => {
    it('should delegate to adminService.getDashboardStats', async () => {
      const stats = { totalUsers: 150, totalReadings: 420, revenue: 5200 };
      mockAdminService.getDashboardStats.mockResolvedValue(stats);

      const result = await controller.getDashboardStats();

      expect(result).toEqual(stats);
      expect(mockAdminService.getDashboardStats).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // Services
  // ============================================================

  describe('GET /api/admin/services', () => {
    it('should delegate to adminService.listServices', async () => {
      const services = [
        { id: 'svc-1', slug: 'lifetime', nameZhTw: '八字終身運', isActive: true },
      ];
      mockAdminService.listServices.mockResolvedValue(services);

      const result = await controller.listServices();

      expect(result).toEqual(services);
      expect(mockAdminService.listServices).toHaveBeenCalledTimes(1);
    });
  });

  describe('PATCH /api/admin/services/:id', () => {
    it('should pass id, data, and auth.userId to adminService.updateService', async () => {
      const updateData = { nameZhTw: '八字流年運勢', creditCost: 3 };
      const updated = { id: 'svc-1', ...updateData };
      mockAdminService.updateService.mockResolvedValue(updated);

      const result = await controller.updateService(AUTH_PAYLOAD, 'svc-1', updateData as any);

      expect(result).toEqual(updated);
      expect(mockAdminService.updateService).toHaveBeenCalledWith(
        'svc-1',
        updateData,
        'admin-user-1',
      );
    });
  });

  // ============================================================
  // Plans
  // ============================================================

  describe('GET /api/admin/plans', () => {
    it('should delegate to adminService.listPlans', async () => {
      const plans = [
        { id: 'plan-1', slug: 'basic', priceMonthly: 4.99, isActive: true },
      ];
      mockAdminService.listPlans.mockResolvedValue(plans);

      const result = await controller.listPlans();

      expect(result).toEqual(plans);
      expect(mockAdminService.listPlans).toHaveBeenCalledTimes(1);
    });
  });

  describe('PATCH /api/admin/plans/:id', () => {
    it('should pass id, data, and auth.userId to adminService.updatePlan', async () => {
      const updateData = { priceMonthly: 6.99, isActive: true };
      const updated = { id: 'plan-1', ...updateData };
      mockAdminService.updatePlan.mockResolvedValue(updated);

      const result = await controller.updatePlan(AUTH_PAYLOAD, 'plan-1', updateData as any);

      expect(result).toEqual(updated);
      expect(mockAdminService.updatePlan).toHaveBeenCalledWith(
        'plan-1',
        updateData,
        'admin-user-1',
      );
    });
  });

  // ============================================================
  // Promo Codes
  // ============================================================

  describe('GET /api/admin/promo-codes', () => {
    it('should delegate to adminService.listPromoCodes', async () => {
      const codes = [
        { id: 'promo-1', code: 'LAUNCH2026', discountType: 'PERCENTAGE', discountValue: 20 },
      ];
      mockAdminService.listPromoCodes.mockResolvedValue(codes);

      const result = await controller.listPromoCodes();

      expect(result).toEqual(codes);
      expect(mockAdminService.listPromoCodes).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /api/admin/promo-codes', () => {
    it('should pass data and auth.userId to adminService.createPromoCode', async () => {
      const createData = {
        code: 'SUMMER2026',
        discountType: 'PERCENTAGE',
        discountValue: 15,
        maxUses: 100,
        validFrom: '2026-06-01T00:00:00.000Z',
        validUntil: '2026-08-31T23:59:59.000Z',
      };
      const created = { id: 'promo-2', ...createData };
      mockAdminService.createPromoCode.mockResolvedValue(created);

      const result = await controller.createPromoCode(AUTH_PAYLOAD, createData as any);

      expect(result).toEqual(created);
      expect(mockAdminService.createPromoCode).toHaveBeenCalledWith(
        createData,
        'admin-user-1',
      );
    });
  });

  describe('PATCH /api/admin/promo-codes/:id', () => {
    it('should pass id, data, and auth.userId to adminService.updatePromoCode', async () => {
      const updateData = { isActive: false };
      const updated = { id: 'promo-1', code: 'LAUNCH2026', isActive: false };
      mockAdminService.updatePromoCode.mockResolvedValue(updated);

      const result = await controller.updatePromoCode(AUTH_PAYLOAD, 'promo-1', updateData as any);

      expect(result).toEqual(updated);
      expect(mockAdminService.updatePromoCode).toHaveBeenCalledWith(
        'promo-1',
        updateData,
        'admin-user-1',
      );
    });
  });

  describe('GET /api/admin/promo-codes/validate/:code', () => {
    it('should pass code to adminService.validatePromoCode', async () => {
      const validation = { valid: true, discountType: 'PERCENTAGE', discountValue: 20 };
      mockAdminService.validatePromoCode.mockResolvedValue(validation);

      const result = await controller.validatePromoCode('LAUNCH2026');

      expect(result).toEqual(validation);
      expect(mockAdminService.validatePromoCode).toHaveBeenCalledWith('LAUNCH2026');
    });
  });

  // ============================================================
  // Prompt Templates
  // ============================================================

  describe('GET /api/admin/prompt-templates', () => {
    it('should delegate to adminService.listPromptTemplates', async () => {
      const templates = [
        { id: 'tpl-1', readingType: 'LIFETIME', provider: 'CLAUDE', isActive: true },
      ];
      mockAdminService.listPromptTemplates.mockResolvedValue(templates);

      const result = await controller.listPromptTemplates();

      expect(result).toEqual(templates);
      expect(mockAdminService.listPromptTemplates).toHaveBeenCalledTimes(1);
    });
  });

  describe('PATCH /api/admin/prompt-templates/:id', () => {
    it('should pass id, data, and auth.userId to adminService.updatePromptTemplate', async () => {
      const updateData = { systemPrompt: 'You are an expert Bazi reader.', isActive: true };
      const updated = { id: 'tpl-1', ...updateData };
      mockAdminService.updatePromptTemplate.mockResolvedValue(updated);

      const result = await controller.updatePromptTemplate(AUTH_PAYLOAD, 'tpl-1', updateData as any);

      expect(result).toEqual(updated);
      expect(mockAdminService.updatePromptTemplate).toHaveBeenCalledWith(
        'tpl-1',
        updateData,
        'admin-user-1',
      );
    });
  });

  // ============================================================
  // Gateways
  // ============================================================

  describe('GET /api/admin/gateways', () => {
    it('should delegate to adminService.listGateways', async () => {
      const gateways = [
        { id: 'gw-1', provider: 'STRIPE', region: 'GLOBAL', isActive: true },
      ];
      mockAdminService.listGateways.mockResolvedValue(gateways);

      const result = await controller.listGateways();

      expect(result).toEqual(gateways);
      expect(mockAdminService.listGateways).toHaveBeenCalledTimes(1);
    });
  });

  describe('PATCH /api/admin/gateways/:id', () => {
    it('should pass id, data, and auth.userId to adminService.updateGateway', async () => {
      const updateData = { isActive: false, config: { webhookSecret: 'whsec_new' } };
      const updated = { id: 'gw-1', ...updateData };
      mockAdminService.updateGateway.mockResolvedValue(updated);

      const result = await controller.updateGateway(AUTH_PAYLOAD, 'gw-1', updateData as any);

      expect(result).toEqual(updated);
      expect(mockAdminService.updateGateway).toHaveBeenCalledWith(
        'gw-1',
        updateData,
        'admin-user-1',
      );
    });
  });

  // ============================================================
  // Users
  // ============================================================

  describe('GET /api/admin/users', () => {
    it('should pass page, limit, and search to adminService.listUsers', async () => {
      const usersPage = {
        items: [{ id: 'usr-1', email: 'test@example.com' }],
        total: 1,
        page: 1,
        limit: 20,
      };
      mockAdminService.listUsers.mockResolvedValue(usersPage);

      const result = await controller.listUsers(1, 20, 'test');

      expect(result).toEqual(usersPage);
      expect(mockAdminService.listUsers).toHaveBeenCalledWith(1, 20, 'test');
    });
  });

  describe('GET /api/admin/users/:id', () => {
    it('should pass id to adminService.getUserDetail', async () => {
      const userDetail = {
        id: 'usr-1',
        email: 'test@example.com',
        credits: 10,
        readings: [],
      };
      mockAdminService.getUserDetail.mockResolvedValue(userDetail);

      const result = await controller.getUserDetail('usr-1');

      expect(result).toEqual(userDetail);
      expect(mockAdminService.getUserDetail).toHaveBeenCalledWith('usr-1');
    });
  });

  describe('PATCH /api/admin/users/:id/credits', () => {
    it('should pass id, data, and auth.userId to adminService.adjustUserCredits', async () => {
      const adjustData = { amount: 5, reason: 'Compensation for service outage' };
      const updated = { id: 'usr-1', credits: 15 };
      mockAdminService.adjustUserCredits.mockResolvedValue(updated);

      const result = await controller.adjustUserCredits(AUTH_PAYLOAD, 'usr-1', adjustData as any);

      expect(result).toEqual(updated);
      expect(mockAdminService.adjustUserCredits).toHaveBeenCalledWith(
        'usr-1',
        adjustData,
        'admin-user-1',
      );
    });
  });

  // ============================================================
  // AI Costs & Revenue
  // ============================================================

  describe('GET /api/admin/ai-costs', () => {
    it('should forward default days=30 to service', async () => {
      const costs = {
        days: 30,
        totalCost: 142.50,
        costByProvider: [],
        costByReadingType: [],
        costByTier: [],
      };
      mockAdminService.getAICosts.mockResolvedValue(costs);

      const result = await controller.getAICosts(30);

      expect(result).toEqual(costs);
      expect(mockAdminService.getAICosts).toHaveBeenCalledWith(30);
    });

    it('should forward days=7 to service', async () => {
      const costs = {
        days: 7,
        totalCost: 42.00,
        costByProvider: [],
        costByReadingType: [],
        costByTier: [],
      };
      mockAdminService.getAICosts.mockResolvedValue(costs);

      const result = await controller.getAICosts(7);

      expect(result).toEqual(costs);
      expect(mockAdminService.getAICosts).toHaveBeenCalledWith(7);
    });

    it('should forward days=90 to service', async () => {
      const costs = {
        days: 90,
        totalCost: 350.00,
        costByProvider: [],
        costByReadingType: [],
        costByTier: [],
      };
      mockAdminService.getAICosts.mockResolvedValue(costs);

      const result = await controller.getAICosts(90);

      expect(result).toEqual(costs);
      expect(mockAdminService.getAICosts).toHaveBeenCalledWith(90);
    });
  });

  describe('GET /api/admin/revenue', () => {
    it('should delegate to adminService.getRevenue', async () => {
      const revenue = {
        totalRevenue: 5200,
        subscriptions: 4800,
        oneTime: 400,
      };
      mockAdminService.getRevenue.mockResolvedValue(revenue);

      const result = await controller.getRevenue();

      expect(result).toEqual(revenue);
      expect(mockAdminService.getRevenue).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // Audit Log
  // ============================================================

  describe('GET /api/admin/audit-log', () => {
    it('should pass page and limit to adminService.getAuditLog', async () => {
      const auditLog = {
        items: [
          { id: 'log-1', action: 'UPDATE_SERVICE', adminUserId: 'admin-user-1', createdAt: '2026-01-15T10:00:00.000Z' },
        ],
        total: 1,
        page: 1,
        limit: 50,
      };
      mockAdminService.getAuditLog.mockResolvedValue(auditLog);

      const result = await controller.getAuditLog(1, 50);

      expect(result).toEqual(auditLog);
      expect(mockAdminService.getAuditLog).toHaveBeenCalledWith(1, 50);
    });
  });
});
