/**
 * BannerService — admin CRUD + public read for the homepage banner carousel.
 * Mirrors the ChatSampleQuestion admin pattern (audit log + Redis cache).
 *
 * - Public `listActive()` is Redis-cached under `banners:active` (invalidated
 *   on every mutation) and shaped to drop admin-only fields (label).
 * - Mutations write an AdminAuditLog row using the Clerk user id (NOT the DB
 *   UUID) — same convention as admin.service.ts.
 * - On delete / image-replace, the old R2 object(s) are removed best-effort.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BannerSlide, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { R2Service } from './r2.service';
import { CreateBannerSlideDto, UpdateBannerSlideDto } from './dto';

const ACTIVE_CACHE_KEY = 'banners:active';
const ACTIVE_CACHE_TTL_SECONDS = 5 * 60;

/** Public-facing slide shape — no admin-only fields (label). */
export interface PublicBannerSlide {
  id: string;
  imageUrlDesktop: string;
  imageUrlMobile: string;
  imageUrlDesktopSimplified: string | null;
  imageUrlMobileSimplified: string | null;
  linkHref: string;
  altText: string | null;
}

@Injectable()
export class BannerService {
  private readonly logger = new Logger(BannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly r2: R2Service,
  ) {}

  /** Public — active slides ordered for the carousel. Redis-cached. */
  async listActive(): Promise<PublicBannerSlide[]> {
    try {
      const cached = await this.redis.get(ACTIVE_CACHE_KEY);
      if (cached) return JSON.parse(cached) as PublicBannerSlide[];
    } catch {
      // Redis down → fall through to DB.
    }

    const rows = await this.prisma.bannerSlide.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const slides: PublicBannerSlide[] = rows.map((r) => ({
      id: r.id,
      imageUrlDesktop: r.imageUrlDesktop,
      imageUrlMobile: r.imageUrlMobile,
      imageUrlDesktopSimplified: r.imageUrlDesktopSimplified,
      imageUrlMobileSimplified: r.imageUrlMobileSimplified,
      linkHref: r.linkHref,
      altText: r.altText,
    }));

    try {
      await this.redis.set(
        ACTIVE_CACHE_KEY,
        JSON.stringify(slides),
        ACTIVE_CACHE_TTL_SECONDS,
      );
    } catch {
      // Non-fatal — next read re-queries.
    }
    return slides;
  }

  /** Admin — all slides (active + inactive). */
  async listAllForAdmin(): Promise<BannerSlide[]> {
    return this.prisma.bannerSlide.findMany({
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(
    data: CreateBannerSlideDto,
    adminUserId: string,
  ): Promise<BannerSlide> {
    const created = await this.prisma.bannerSlide.create({
      data: {
        label: data.label ?? null,
        imageUrlDesktop: data.imageUrlDesktop,
        imageUrlMobile: data.imageUrlMobile,
        imageUrlDesktopSimplified: data.imageUrlDesktopSimplified ?? null,
        imageUrlMobileSimplified: data.imageUrlMobileSimplified ?? null,
        linkHref: data.linkHref,
        altText: data.altText ?? null,
        displayOrder: data.displayOrder ?? 0,
        isActive: data.isActive ?? true,
      },
    });
    await this.logAudit(adminUserId, 'create_banner_slide', created.id, null, created);
    await this.invalidate();
    return created;
  }

  async update(
    id: string,
    data: UpdateBannerSlideDto,
    adminUserId: string,
  ): Promise<BannerSlide> {
    const existing = await this.prisma.bannerSlide.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Banner slide not found');

    const updated = await this.prisma.bannerSlide.update({
      where: { id },
      data,
    });

    // Best-effort R2 cleanup when an image URL is replaced.
    if (
      data.imageUrlDesktop &&
      data.imageUrlDesktop !== existing.imageUrlDesktop
    ) {
      await this.r2.deleteImage(existing.imageUrlDesktop);
    }
    if (data.imageUrlMobile && data.imageUrlMobile !== existing.imageUrlMobile) {
      await this.r2.deleteImage(existing.imageUrlMobile);
    }
    // Simplified crops — clean up the old object on replace OR clear (DTO field
    // present, differs, and an old value existed). `!== undefined` lets a null
    // (clear-back-to-fallback) trigger cleanup too.
    if (
      data.imageUrlDesktopSimplified !== undefined &&
      existing.imageUrlDesktopSimplified &&
      data.imageUrlDesktopSimplified !== existing.imageUrlDesktopSimplified
    ) {
      await this.r2.deleteImage(existing.imageUrlDesktopSimplified);
    }
    if (
      data.imageUrlMobileSimplified !== undefined &&
      existing.imageUrlMobileSimplified &&
      data.imageUrlMobileSimplified !== existing.imageUrlMobileSimplified
    ) {
      await this.r2.deleteImage(existing.imageUrlMobileSimplified);
    }

    await this.logAudit(adminUserId, 'update_banner_slide', id, existing, updated);
    await this.invalidate();
    return updated;
  }

  async delete(id: string, adminUserId: string): Promise<void> {
    const existing = await this.prisma.bannerSlide.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Banner slide not found');

    await this.prisma.bannerSlide.delete({ where: { id } });
    await this.r2.deleteImage(existing.imageUrlDesktop);
    await this.r2.deleteImage(existing.imageUrlMobile);
    if (existing.imageUrlDesktopSimplified) {
      await this.r2.deleteImage(existing.imageUrlDesktopSimplified);
    }
    if (existing.imageUrlMobileSimplified) {
      await this.r2.deleteImage(existing.imageUrlMobileSimplified);
    }

    await this.logAudit(adminUserId, 'delete_banner_slide', id, existing, null);
    await this.invalidate();
  }

  // ============================================================
  // Internals
  // ============================================================

  private async invalidate(): Promise<void> {
    try {
      await this.redis.del(ACTIVE_CACHE_KEY);
    } catch (err) {
      this.logger.warn(`Failed to invalidate ${ACTIVE_CACHE_KEY}: ${err}`);
    }
  }

  private async logAudit(
    adminUserId: string,
    action: string,
    entityId: string,
    oldValue: unknown,
    newValue: unknown,
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action,
        entityType: 'banner_slide',
        entityId,
        oldValue: oldValue as Prisma.InputJsonValue,
        newValue: newValue as Prisma.InputJsonValue,
      },
    });
  }
}
