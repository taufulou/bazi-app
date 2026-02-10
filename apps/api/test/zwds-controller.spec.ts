import { Test, TestingModule } from '@nestjs/testing';
import { ZwdsController } from '../src/zwds/zwds.controller';
import { ZwdsService } from '../src/zwds/zwds.service';
import { ReadingType } from '@prisma/client';

describe('ZwdsController', () => {
  let controller: ZwdsController;
  let service: jest.Mocked<ZwdsService>;

  const mockAuth = { userId: 'clerk_user_1' };

  beforeEach(async () => {
    const mockService = {
      getChartPreview: jest.fn(),
      createReading: jest.fn(),
      getReading: jest.fn(),
      getHoroscope: jest.fn(),
      createComparison: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ZwdsController],
      providers: [
        { provide: ZwdsService, useValue: mockService },
      ],
    }).compile();

    controller = module.get<ZwdsController>(ZwdsController);
    service = module.get(ZwdsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================================
  // POST /api/zwds/chart-preview
  // ============================================================

  describe('POST /api/zwds/chart-preview', () => {
    it('should delegate to zwdsService.getChartPreview', async () => {
      const dto = { birthProfileId: 'profile-1' };
      const chartData = { palaces: [], solarDate: '2000-1-15' };
      service.getChartPreview.mockResolvedValue(chartData as any);

      const result = await controller.getChartPreview(mockAuth as any, dto);

      expect(service.getChartPreview).toHaveBeenCalledWith('clerk_user_1', dto);
      expect(result).toEqual(chartData);
    });

    it('should pass auth userId correctly', async () => {
      const differentAuth = { userId: 'clerk_user_2' };
      service.getChartPreview.mockResolvedValue({ palaces: [] } as any);

      await controller.getChartPreview(differentAuth as any, { birthProfileId: 'p1' });

      expect(service.getChartPreview).toHaveBeenCalledWith('clerk_user_2', { birthProfileId: 'p1' });
    });

    it('should propagate service errors', async () => {
      service.getChartPreview.mockRejectedValue(new Error('Profile not found'));

      await expect(
        controller.getChartPreview(mockAuth as any, { birthProfileId: 'bad' }),
      ).rejects.toThrow('Profile not found');
    });
  });

  // ============================================================
  // POST /api/zwds/readings
  // ============================================================

  describe('POST /api/zwds/readings', () => {
    it('should delegate to zwdsService.createReading for ZWDS_LIFETIME', async () => {
      const dto = { birthProfileId: 'profile-1', readingType: ReadingType.ZWDS_LIFETIME };
      const reading = { id: 'reading-1', readingType: ReadingType.ZWDS_LIFETIME };
      service.createReading.mockResolvedValue(reading as any);

      const result = await controller.createReading(mockAuth as any, dto);

      expect(service.createReading).toHaveBeenCalledWith('clerk_user_1', dto);
      expect(result).toEqual(reading);
    });

    it('should pass targetYear for ZWDS_ANNUAL readings', async () => {
      const dto = {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_ANNUAL,
        targetYear: 2026,
      };
      service.createReading.mockResolvedValue({ id: 'reading-2' } as any);

      await controller.createReading(mockAuth as any, dto);

      expect(service.createReading).toHaveBeenCalledWith('clerk_user_1', dto);
    });

    it('should delegate ZWDS_CAREER reading', async () => {
      const dto = { birthProfileId: 'profile-1', readingType: ReadingType.ZWDS_CAREER };
      service.createReading.mockResolvedValue({ id: 'r-career', readingType: ReadingType.ZWDS_CAREER } as any);

      const result = await controller.createReading(mockAuth as any, dto);

      expect(result.readingType).toBe(ReadingType.ZWDS_CAREER);
    });

    it('should delegate ZWDS_LOVE reading', async () => {
      const dto = { birthProfileId: 'profile-1', readingType: ReadingType.ZWDS_LOVE };
      service.createReading.mockResolvedValue({ id: 'r-love', readingType: ReadingType.ZWDS_LOVE } as any);

      const result = await controller.createReading(mockAuth as any, dto);

      expect(result.readingType).toBe(ReadingType.ZWDS_LOVE);
    });

    it('should delegate ZWDS_HEALTH reading', async () => {
      const dto = { birthProfileId: 'profile-1', readingType: ReadingType.ZWDS_HEALTH };
      service.createReading.mockResolvedValue({ id: 'r-health', readingType: ReadingType.ZWDS_HEALTH } as any);

      const result = await controller.createReading(mockAuth as any, dto);

      expect(result.readingType).toBe(ReadingType.ZWDS_HEALTH);
    });

    it('should propagate BadRequestException from service', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      service.createReading.mockRejectedValue(new BadRequestException('Invalid reading type'));

      await expect(
        controller.createReading(mockAuth as any, {
          birthProfileId: 'p1',
          readingType: ReadingType.LIFETIME as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================================
  // GET /api/zwds/readings/:id
  // ============================================================

  describe('GET /api/zwds/readings/:id', () => {
    it('should delegate to zwdsService.getReading', async () => {
      const reading = { id: 'reading-1', readingType: ReadingType.ZWDS_LIFETIME };
      service.getReading.mockResolvedValue(reading as any);

      const result = await controller.getReading(mockAuth as any, 'reading-1');

      expect(service.getReading).toHaveBeenCalledWith('clerk_user_1', 'reading-1');
      expect(result).toEqual(reading);
    });

    it('should pass reading ID from URL param', async () => {
      service.getReading.mockResolvedValue({ id: 'abc-123' } as any);

      await controller.getReading(mockAuth as any, 'abc-123');

      expect(service.getReading).toHaveBeenCalledWith('clerk_user_1', 'abc-123');
    });

    it('should propagate NotFoundException', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      service.getReading.mockRejectedValue(new NotFoundException('Reading not found'));

      await expect(
        controller.getReading(mockAuth as any, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // POST /api/zwds/horoscope
  // ============================================================

  describe('POST /api/zwds/horoscope', () => {
    it('should delegate to zwdsService.getHoroscope', async () => {
      const dto = { birthProfileId: 'profile-1', targetDate: '2026-2-10' };
      const chartWithHoroscope = { palaces: [], horoscope: { decadal: {}, yearly: {} } };
      service.getHoroscope.mockResolvedValue(chartWithHoroscope as any);

      const result = await controller.getHoroscope(mockAuth as any, dto);

      expect(service.getHoroscope).toHaveBeenCalledWith('clerk_user_1', dto);
      expect(result).toEqual(chartWithHoroscope);
    });

    it('should pass different target dates', async () => {
      const dto = { birthProfileId: 'profile-1', targetDate: '2030-6-15' };
      service.getHoroscope.mockResolvedValue({ palaces: [] } as any);

      await controller.getHoroscope(mockAuth as any, dto);

      expect(service.getHoroscope).toHaveBeenCalledWith('clerk_user_1', dto);
    });

    it('should propagate errors from service', async () => {
      service.getHoroscope.mockRejectedValue(new Error('Profile not found'));

      await expect(
        controller.getHoroscope(mockAuth as any, {
          birthProfileId: 'bad',
          targetDate: '2026-1-1',
        }),
      ).rejects.toThrow();
    });
  });

  // ============================================================
  // POST /api/zwds/comparisons
  // ============================================================

  describe('POST /api/zwds/comparisons', () => {
    it('should delegate to zwdsService.createComparison for ROMANCE', async () => {
      const dto = {
        profileAId: 'profile-1',
        profileBId: 'profile-2',
        comparisonType: 'ROMANCE' as const,
      };
      const comparison = { id: 'comp-1', comparisonType: 'ROMANCE' };
      service.createComparison.mockResolvedValue(comparison as any);

      const result = await controller.createComparison(mockAuth as any, dto);

      expect(service.createComparison).toHaveBeenCalledWith('clerk_user_1', dto);
      expect(result).toEqual(comparison);
    });

    it('should delegate BUSINESS comparison type', async () => {
      const dto = {
        profileAId: 'profile-1',
        profileBId: 'profile-2',
        comparisonType: 'BUSINESS' as const,
      };
      service.createComparison.mockResolvedValue({ id: 'comp-2', comparisonType: 'BUSINESS' } as any);

      const result = await controller.createComparison(mockAuth as any, dto);

      expect(result.comparisonType).toBe('BUSINESS');
    });

    it('should delegate FRIENDSHIP comparison type', async () => {
      const dto = {
        profileAId: 'profile-1',
        profileBId: 'profile-2',
        comparisonType: 'FRIENDSHIP' as const,
      };
      service.createComparison.mockResolvedValue({ id: 'comp-3', comparisonType: 'FRIENDSHIP' } as any);

      const result = await controller.createComparison(mockAuth as any, dto);

      expect(result.comparisonType).toBe('FRIENDSHIP');
    });

    it('should propagate insufficient credits error', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      service.createComparison.mockRejectedValue(
        new BadRequestException('Insufficient credits. This comparison requires 3 credits.'),
      );

      await expect(
        controller.createComparison(mockAuth as any, {
          profileAId: 'p1',
          profileBId: 'p2',
          comparisonType: 'ROMANCE' as const,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
