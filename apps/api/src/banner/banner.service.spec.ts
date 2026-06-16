import { BannerService } from './banner.service';

const ADMIN = 'user_clerk_abc'; // Clerk user id (NOT a DB UUID)

function makeService(overrides: { redis?: Record<string, unknown> } = {}) {
  const prisma = {
    bannerSlide: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    ...overrides.redis,
  };
  const r2 = {
    deleteImage: jest.fn().mockResolvedValue(undefined),
    uploadImage: jest.fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new BannerService(prisma as any, redis as any, r2 as any);
  return { service, prisma, redis, r2 };
}

describe('BannerService', () => {
  it('create writes an audit log with the Clerk userId and invalidates cache', async () => {
    const { service, prisma, redis } = makeService();
    prisma.bannerSlide.create.mockResolvedValue({
      id: 's1',
      imageUrlDesktop: 'd',
      imageUrlMobile: 'm',
      linkHref: '/reading/annual',
    });

    await service.create(
      { imageUrlDesktop: 'd', imageUrlMobile: 'm', linkHref: '/reading/annual' } as never,
      ADMIN,
    );

    expect(prisma.bannerSlide.create).toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adminUserId: ADMIN,
          action: 'create_banner_slide',
          entityType: 'banner_slide',
        }),
      }),
    );
    expect(redis.del).toHaveBeenCalledWith('banners:active');
  });

  it('update deletes the OLD image from R2 only when that URL changes', async () => {
    const existing = {
      id: 's1',
      imageUrlDesktop: 'old-d',
      imageUrlMobile: 'm',
      linkHref: '/x',
      altText: null,
    };
    const { service, prisma, r2 } = makeService();
    prisma.bannerSlide.findUnique.mockResolvedValue(existing);
    prisma.bannerSlide.update.mockResolvedValue({ ...existing, imageUrlDesktop: 'new-d' });

    await service.update('s1', { imageUrlDesktop: 'new-d' } as never, ADMIN);

    expect(r2.deleteImage).toHaveBeenCalledWith('old-d');
    expect(r2.deleteImage).not.toHaveBeenCalledWith('m'); // mobile unchanged
  });

  it('update does NOT delete any image when only metadata changes', async () => {
    const existing = {
      id: 's1',
      imageUrlDesktop: 'd',
      imageUrlMobile: 'm',
      linkHref: '/x',
      altText: null,
    };
    const { service, prisma, r2 } = makeService();
    prisma.bannerSlide.findUnique.mockResolvedValue(existing);
    prisma.bannerSlide.update.mockResolvedValue(existing);

    await service.update('s1', { linkHref: '/y' } as never, ADMIN);

    expect(r2.deleteImage).not.toHaveBeenCalled();
  });

  it('delete removes both crops from R2, audits, and invalidates', async () => {
    const existing = {
      id: 's1',
      imageUrlDesktop: 'd',
      imageUrlMobile: 'm',
      linkHref: '/x',
      altText: null,
    };
    const { service, prisma, redis, r2 } = makeService();
    prisma.bannerSlide.findUnique.mockResolvedValue(existing);

    await service.delete('s1', ADMIN);

    expect(prisma.bannerSlide.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    expect(r2.deleteImage).toHaveBeenCalledWith('d');
    expect(r2.deleteImage).toHaveBeenCalledWith('m');
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'delete_banner_slide', adminUserId: ADMIN }),
      }),
    );
    expect(redis.del).toHaveBeenCalledWith('banners:active');
  });

  it('update/delete throw NotFound when the slide is missing', async () => {
    const { service, prisma } = makeService();
    prisma.bannerSlide.findUnique.mockResolvedValue(null);
    await expect(service.update('nope', {} as never, ADMIN)).rejects.toThrow();
    await expect(service.delete('nope', ADMIN)).rejects.toThrow();
  });

  it('listActive returns cached JSON without querying the DB', async () => {
    const cached = [
      { id: 's1', imageUrlDesktop: 'd', imageUrlMobile: 'm', linkHref: '/x', altText: null },
    ];
    const { service, prisma } = makeService({
      redis: { get: jest.fn().mockResolvedValue(JSON.stringify(cached)) },
    });
    const out = await service.listActive();
    expect(out).toEqual(cached);
    expect(prisma.bannerSlide.findMany).not.toHaveBeenCalled();
  });

  it('listActive queries the DB, caches, and drops admin-only fields (label)', async () => {
    const rows = [
      {
        id: 's1',
        label: 'secret-internal',
        imageUrlDesktop: 'd',
        imageUrlMobile: 'm',
        linkHref: '/x',
        altText: 'a',
        displayOrder: 0,
        isActive: true,
      },
    ];
    const { service, prisma, redis } = makeService();
    prisma.bannerSlide.findMany.mockResolvedValue(rows);

    const out = await service.listActive();

    expect(out).toEqual([
      { id: 's1', imageUrlDesktop: 'd', imageUrlMobile: 'm', linkHref: '/x', altText: 'a' },
    ]);
    expect((out[0] as unknown as Record<string, unknown>).label).toBeUndefined();
    expect(redis.set).toHaveBeenCalledWith(
      'banners:active',
      expect.any(String),
      expect.any(Number),
    );
  });
});
