import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminService } from './admin.service';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser, AuthPayload } from '../auth/current-user.decorator';
import {
  UpdateServiceDto,
  UpdatePlanDto,
  UpdatePromptTemplateDto,
  CreatePromoCodeDto,
  UpdatePromoCodeDto,
  UpdateGatewayDto,
  AdjustCreditsDto,
} from './dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Throttle({ default: { limit: 30, ttl: 60000 } })
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
    @Body() data: UpdateServiceDto,
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
    @Body() data: UpdatePlanDto,
  ) {
    return this.adminService.updatePlan(id, data, auth.userId);
  }

  // ============ Promo Codes ============

  @Get('promo-codes')
  @ApiOperation({ summary: 'List all promo codes' })
  async listPromoCodes() {
    return this.adminService.listPromoCodes();
  }

  @Post('promo-codes')
  @ApiOperation({ summary: 'Create a new promo code' })
  async createPromoCode(
    @CurrentUser() auth: AuthPayload,
    @Body() data: CreatePromoCodeDto,
  ) {
    return this.adminService.createPromoCode(data, auth.userId);
  }

  @Patch('promo-codes/:id')
  @ApiOperation({ summary: 'Update a promo code' })
  async updatePromoCode(
    @CurrentUser() auth: AuthPayload,
    @Param('id') id: string,
    @Body() data: UpdatePromoCodeDto,
  ) {
    return this.adminService.updatePromoCode(id, data, auth.userId);
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
    @Body() data: UpdatePromptTemplateDto,
  ) {
    return this.adminService.updatePromptTemplate(id, data, auth.userId);
  }

  // ============ Payment Gateways ============

  @Get('gateways')
  @ApiOperation({ summary: 'List all payment gateways' })
  async listGateways() {
    return this.adminService.listGateways();
  }

  @Patch('gateways/:id')
  @ApiOperation({ summary: 'Update a payment gateway' })
  async updateGateway(
    @CurrentUser() auth: AuthPayload,
    @Param('id') id: string,
    @Body() data: UpdateGatewayDto,
  ) {
    return this.adminService.updateGateway(id, data, auth.userId);
  }

  // ============ User Management ============

  @Get('users')
  @ApiOperation({ summary: 'List users with pagination and search' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name or Clerk ID' })
  async listUsers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ) {
    return this.adminService.listUsers(page, limit, search);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get user detail with subscriptions and readings count' })
  async getUserDetail(@Param('id') id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Patch('users/:id/credits')
  @ApiOperation({ summary: 'Adjust user credits (add or subtract)' })
  async adjustUserCredits(
    @CurrentUser() auth: AuthPayload,
    @Param('id') id: string,
    @Body() data: AdjustCreditsDto,
  ) {
    return this.adminService.adjustUserCredits(id, data, auth.userId);
  }

  // ============ Analytics ============

  @Get('ai-costs')
  @ApiOperation({ summary: 'Get AI usage costs and analytics' })
  @ApiQuery({ name: 'days', required: false, example: 30, description: 'Lookback window in days (1-365, default 30)' })
  async getAICosts(
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return this.adminService.getAICosts(days);
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Get revenue analytics' })
  async getRevenue() {
    return this.adminService.getRevenue();
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
