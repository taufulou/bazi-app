import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { CurrentUser, AuthPayload } from '../auth/current-user.decorator';

// TODO: Add admin role guard — for now, all authenticated users can access
// In production, check Clerk metadata for admin role

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('api/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ============ Dashboard ============

  @Get('stats')
  @ApiOperation({ summary: 'Get admin dashboard statistics' })
  async getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  // ============ Services ============

  @Get('services')
  @ApiOperation({ summary: 'List all services (including inactive)' })
  async listServices() {
    return this.adminService.listServices();
  }

  @Patch('services/:id')
  @ApiOperation({ summary: 'Update a service' })
  async updateService(
    @CurrentUser() auth: AuthPayload,
    @Param('id') id: string,
    @Body() data: Record<string, unknown>,
  ) {
    return this.adminService.updateService(id, data, auth.userId);
  }

  // ============ Plans ============

  @Get('plans')
  @ApiOperation({ summary: 'List all plans (including inactive)' })
  async listPlans() {
    return this.adminService.listPlans();
  }

  @Patch('plans/:id')
  @ApiOperation({ summary: 'Update a plan' })
  async updatePlan(
    @CurrentUser() auth: AuthPayload,
    @Param('id') id: string,
    @Body() data: Record<string, unknown>,
  ) {
    return this.adminService.updatePlan(id, data, auth.userId);
  }

  // ============ Promo Codes ============

  @Get('promo-codes')
  @ApiOperation({ summary: 'List all promo codes' })
  async listPromoCodes() {
    return this.adminService.listPromoCodes();
  }

  @Get('promo-codes/validate/:code')
  @ApiOperation({ summary: 'Validate a promo code' })
  async validatePromoCode(@Param('code') code: string) {
    return this.adminService.validatePromoCode(code);
  }

  // ============ Prompt Templates ============

  @Get('prompt-templates')
  @ApiOperation({ summary: 'List all prompt templates' })
  async listPromptTemplates() {
    return this.adminService.listPromptTemplates();
  }

  @Patch('prompt-templates/:id')
  @ApiOperation({ summary: 'Update a prompt template' })
  async updatePromptTemplate(
    @CurrentUser() auth: AuthPayload,
    @Param('id') id: string,
    @Body() data: Record<string, unknown>,
  ) {
    return this.adminService.updatePromptTemplate(id, data, auth.userId);
  }

  // ============ Audit Log ============

  @Get('audit-log')
  @ApiOperation({ summary: 'Get admin audit log' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  async getAuditLog(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.adminService.getAuditLog(page, limit);
  }
}
