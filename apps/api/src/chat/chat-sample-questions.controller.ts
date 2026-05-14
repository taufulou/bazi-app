/**
 * Public + admin endpoints for chat sample questions.
 *
 * Public (`GET /api/chat/sample-questions`):
 *   - Unauthenticated read; throttled @60req/min/IP per round-1 LOWEST-#1
 *     to prevent enumeration / accidental DoS.
 *
 * Admin (`POST/PATCH/DELETE /api/admin/chat-questions`):
 *   - AdminGuard + 30req/min throttle (mirrors AdminController).
 *   - Mutations return the updated/created row so admin UI can
 *     optimistically refetch (round-1 LOW-#2).
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ReadingType } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { AdminGuard } from '../auth/admin.guard';
import { ChatSampleQuestionService } from './chat-sample-questions.service';

// ============================================================
// Public read endpoint
// ============================================================

@ApiTags('Chat')
@Controller('api/chat/sample-questions')
export class ChatSampleQuestionsPublicController {
  constructor(
    private readonly service: ChatSampleQuestionService,
  ) {}

  @Public()
  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Get sample questions for a (readingType, sectionKey) tuple',
    description:
      'Returns active sample questions, ordered by displayOrder. ' +
      'sectionKey query param: omit or pass empty for "general" floating-button questions. ' +
      'Public + throttled per IP (60/min) — these are non-PII marketing copy. ' +
      'Cached in-process with Redis-backed version-stamp invalidation; admin edits propagate within ~5min worst case.',
  })
  @ApiQuery({ name: 'readingType', enum: ['LIFETIME', 'LOVE', 'CAREER', 'ANNUAL', 'COMPATIBILITY'] })
  @ApiQuery({ name: 'sectionKey', required: false })
  @ApiQuery({ name: 'locale', required: false })
  async getSampleQuestions(
    @Query('readingType') readingType: string,
    @Query('sectionKey') sectionKey: string | undefined,
    @Query('locale') locale: string | undefined,
  ) {
    if (!isValidReadingType(readingType)) {
      throw new HttpException(
        { code: 'INVALID_READING_TYPE', message: `Invalid readingType: ${readingType}` },
        HttpStatus.BAD_REQUEST,
      );
    }
    const sectionKeyOrNull = sectionKey && sectionKey.length > 0 ? sectionKey : null;
    const questions = await this.service.listActive(
      readingType as ReadingType,
      sectionKeyOrNull,
      locale ?? 'zh-TW',
    );
    return { questions };
  }

  // Phase 4 — SampleQuestionsBrowser in chat drawer fetches ALL active
  // questions for a reading type (across all sectionKeys) to show users
  // the full menu of what they can ask. NOTE: `@Public()` is LOAD-BEARING
  // here — the class has no class-level `@Public()`, so Clerk JWT guard
  // would reject unauthenticated requests (sample questions are public
  // marketing content). Route declared BEFORE any future parameterized
  // routes (e.g. `@Get(':id')`) to avoid Nest route-matching shadowing.
  @Public()
  @Get('all')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'List ALL active sample questions for a reading type (Phase 4 — drawer browser)',
    description:
      'Returns ALL active sample questions across all sectionKeys for the given readingType, ' +
      'ordered by sectionKey ASC (NULLS LAST) then displayOrder. General «catch-all» questions ' +
      '(sectionKey=NULL) appear at the bottom. Public + throttled (60/min/IP). ' +
      'Cached in-process with version-stamp invalidation.',
  })
  @ApiQuery({ name: 'readingType', enum: ['LIFETIME', 'LOVE', 'CAREER', 'ANNUAL', 'COMPATIBILITY'] })
  @ApiQuery({ name: 'locale', required: false })
  async listAllForType(
    @Query('readingType') readingType: string,
    @Query('locale') locale: string | undefined,
  ) {
    if (!isValidReadingType(readingType)) {
      throw new HttpException(
        { code: 'INVALID_READING_TYPE', message: `Invalid readingType: ${readingType}` },
        HttpStatus.BAD_REQUEST,
      );
    }
    const questions = await this.service.listAllActiveForType(
      readingType as ReadingType,
      locale ?? 'zh-TW',
    );
    return { questions };
  }
}

// ============================================================
// Admin CRUD endpoints
// ============================================================

interface CreateChatSampleQuestionDto {
  readingType: ReadingType;
  sectionKey: string | null;
  questionText: string;
  displayOrder?: number;
  locale?: string;
}

interface UpdateChatSampleQuestionDto {
  questionText?: string;
  displayOrder?: number;
  isActive?: boolean;
  sectionKey?: string | null;
}

interface CreateManyChatSampleQuestionsDto {
  items: CreateChatSampleQuestionDto[];
}

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('api/admin/chat-questions')
export class ChatSampleQuestionsAdminController {
  constructor(
    private readonly service: ChatSampleQuestionService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all sample questions (admin)' })
  @ApiQuery({ name: 'readingType', required: false, enum: ['LIFETIME', 'LOVE', 'CAREER', 'ANNUAL', 'COMPATIBILITY'] })
  async listAll(@Query('readingType') readingType?: string) {
    if (readingType && !isValidReadingType(readingType)) {
      throw new HttpException(
        { code: 'INVALID_READING_TYPE', message: `Invalid readingType: ${readingType}` },
        HttpStatus.BAD_REQUEST,
      );
    }
    const items = await this.service.listAllForAdmin(readingType as ReadingType | undefined);
    return { items };
  }

  @Get('section-keys/:readingType')
  @ApiOperation({ summary: 'Section-keys whitelist for the sectionKey dropdown' })
  async getValidSectionKeys(@Param('readingType') readingType: string) {
    if (!isValidReadingType(readingType)) {
      throw new HttpException(
        { code: 'INVALID_READING_TYPE', message: `Invalid readingType: ${readingType}` },
        HttpStatus.BAD_REQUEST,
      );
    }
    return {
      sectionKeys: this.service.getValidSectionKeys(readingType as ReadingType),
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create a sample question (admin)' })
  async create(@Body() dto: CreateChatSampleQuestionDto) {
    try {
      const created = await this.service.create(dto);
      return { item: created };
    } catch (err) {
      throw new HttpException(
        { code: 'CREATE_FAILED', message: (err as Error).message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('bulk')
  @ApiOperation({
    summary: 'Bulk create sample questions (admin)',
    description:
      'Single transaction → single cache invalidation (round-1 LOW-#1). ' +
      'Used by TSV-paste in admin UI + by the seed migration.',
  })
  async createMany(@Body() dto: CreateManyChatSampleQuestionsDto) {
    try {
      const result = await this.service.createMany({ items: dto.items });
      return result;
    } catch (err) {
      throw new HttpException(
        { code: 'BULK_CREATE_FAILED', message: (err as Error).message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a sample question (admin)',
    description: 'Returns the updated row so admin UI can optimistic-refetch.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateChatSampleQuestionDto,
  ) {
    try {
      const updated = await this.service.update(id, dto);
      return { item: updated };
    } catch (err) {
      throw new HttpException(
        { code: 'UPDATE_FAILED', message: (err as Error).message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a sample question (admin)' })
  async delete(@Param('id') id: string) {
    await this.service.delete(id);
    return { ok: true };
  }
}

// ============================================================
// Helpers
// ============================================================

function isValidReadingType(s: string): boolean {
  return ['LIFETIME', 'LOVE', 'CAREER', 'ANNUAL', 'COMPATIBILITY'].includes(s);
}
