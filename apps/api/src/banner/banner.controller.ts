/**
 * Banner endpoints.
 *
 * Public (`GET /api/banners`):
 *   - `@Public()` is LOAD-BEARING — ClerkAuthGuard is a global APP_GUARD, so
 *     without it the homepage fetch 401s. Throttled @60/min/IP.
 *
 * Admin (`/api/admin/banners`):
 *   - AdminGuard + 30/min throttle (mirrors AdminController).
 *   - `POST /upload` is the codebase's first multipart endpoint. It is
 *     FILE-ONLY (global ValidationPipe forbidNonWhitelisted would 400 any
 *     extra text field). The file type is validated by a server-side
 *     magic-byte sniff (NOT the client mimetype), and size by a multer hard
 *     cap + an explicit business-limit check.
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser, AuthPayload } from '../auth/current-user.decorator';
import { BannerService } from './banner.service';
import { R2Service } from './r2.service';
import { CreateBannerSlideDto, UpdateBannerSlideDto } from './dto';

/** Business size limit surfaced to admins (recommended crops are < 300 KB). */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Multer hard cap — bounds in-memory buffering well above the business limit. */
const MULTER_HARD_CAP_BYTES = 8 * 1024 * 1024;

// ============================================================
// Public read endpoint
// ============================================================

@ApiTags('Banner')
@Controller('api/banners')
export class BannerPublicController {
  constructor(private readonly service: BannerService) {}

  @Public()
  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'List active banner slides (public, ordered by displayOrder)',
  })
  async list() {
    const slides = await this.service.listActive();
    return { slides };
  }
}

// ============================================================
// Admin CRUD + upload endpoints
// ============================================================

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('api/admin/banners')
export class BannerAdminController {
  constructor(
    private readonly service: BannerService,
    private readonly r2: R2Service,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all banner slides (admin)' })
  async listAll() {
    const items = await this.service.listAllForAdmin();
    return { items };
  }

  @Post()
  @ApiOperation({ summary: 'Create a banner slide (admin)' })
  async create(
    @CurrentUser() auth: AuthPayload,
    @Body() dto: CreateBannerSlideDto,
  ) {
    const item = await this.service.create(dto, auth.userId);
    return { item };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a banner slide (admin)' })
  async update(
    @CurrentUser() auth: AuthPayload,
    @Param('id') id: string,
    @Body() dto: UpdateBannerSlideDto,
  ) {
    const item = await this.service.update(id, dto, auth.userId);
    return { item };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a banner slide (admin)' })
  async delete(@CurrentUser() auth: AuthPayload, @Param('id') id: string) {
    await this.service.delete(id, auth.userId);
    return { ok: true };
  }

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a banner image to R2 and return its public URL (admin)',
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MULTER_HARD_CAP_BYTES } }),
  )
  // Dedicated tighter limit than the class 30/min — each call hits R2 and
  // buffers up to 8 MB (mirrors the cost-endpoint precedent in fortune.controller).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file || !file.buffer) {
      throw new HttpException(
        { code: 'NO_FILE', message: 'No file uploaded (field name must be "file").' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new HttpException(
        {
          code: 'FILE_TOO_LARGE',
          message: `Image exceeds the ${MAX_IMAGE_BYTES / (1024 * 1024)} MB limit.`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const sniffed = sniffImageType(file.buffer);
    if (!sniffed) {
      throw new HttpException(
        {
          code: 'INVALID_IMAGE',
          message: 'File must be a PNG, JPEG, or WebP image.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    // Distinct, clear error when R2 isn't configured. MUST stay OUTSIDE the
    // try/catch below — that blanket `catch` would otherwise rewrap this as a
    // generic UPLOAD_FAILED / 500, losing the 503 + R2_NOT_CONFIGURED code.
    if (!this.r2.isConfigured()) {
      throw new HttpException(
        { code: 'R2_NOT_CONFIGURED', message: 'Image storage (R2) is not configured.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    try {
      const url = await this.r2.uploadImage(
        file.buffer,
        sniffed.ext,
        sniffed.mime,
      );
      return { url };
    } catch (err) {
      throw new HttpException(
        { code: 'UPLOAD_FAILED', message: (err as Error).message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Magic-byte sniff — do NOT trust the client-supplied mimetype (blocks
 * spoofed extensions and SVG/script payloads). WebP requires TWO
 * non-contiguous windows: 'RIFF' at [0,4) and 'WEBP' at [8,12).
 */
export function sniffImageType(
  buf: Buffer,
): { ext: string; mime: string } | null {
  if (!buf || buf.length < 12) return null;

  // PNG: 89 50 4E 47
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return { ext: 'png', mime: 'image/png' };
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  // WebP: 'RIFF'....'WEBP'
  if (
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}
