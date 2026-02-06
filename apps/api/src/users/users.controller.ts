import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateBirthProfileDto, UpdateBirthProfileDto } from './dto/create-birth-profile.dto';
import { CurrentUser, AuthPayload } from '../auth/current-user.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ============ User Profile ============

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@CurrentUser() auth: AuthPayload) {
    return this.usersService.findByClerkId(auth.userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  async updateProfile(
    @CurrentUser() auth: AuthPayload,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateProfile(auth.userId, dto);
  }

  // ============ Birth Profiles ============

  @Get('me/birth-profiles')
  @ApiOperation({ summary: 'List birth profiles for current user' })
  async getBirthProfiles(@CurrentUser() auth: AuthPayload) {
    return this.usersService.getBirthProfiles(auth.userId);
  }

  @Post('me/birth-profiles')
  @ApiOperation({ summary: 'Create a new birth profile' })
  async createBirthProfile(
    @CurrentUser() auth: AuthPayload,
    @Body() dto: CreateBirthProfileDto,
  ) {
    return this.usersService.createBirthProfile(auth.userId, dto);
  }

  @Get('me/birth-profiles/:id')
  @ApiOperation({ summary: 'Get a specific birth profile' })
  async getBirthProfile(
    @CurrentUser() auth: AuthPayload,
    @Param('id') id: string,
  ) {
    return this.usersService.getBirthProfile(auth.userId, id);
  }

  @Patch('me/birth-profiles/:id')
  @ApiOperation({ summary: 'Update a birth profile' })
  async updateBirthProfile(
    @CurrentUser() auth: AuthPayload,
    @Param('id') id: string,
    @Body() dto: UpdateBirthProfileDto,
  ) {
    return this.usersService.updateBirthProfile(auth.userId, id, dto);
  }

  @Delete('me/birth-profiles/:id')
  @ApiOperation({ summary: 'Delete a birth profile' })
  async deleteBirthProfile(
    @CurrentUser() auth: AuthPayload,
    @Param('id') id: string,
  ) {
    return this.usersService.deleteBirthProfile(auth.userId, id);
  }

  // ============ Reading History ============

  @Get('me/readings')
  @ApiOperation({ summary: 'Get reading history for current user' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  async getReadingHistory(
    @CurrentUser() auth: AuthPayload,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.usersService.getReadingHistory(auth.userId, page, limit);
  }
}
