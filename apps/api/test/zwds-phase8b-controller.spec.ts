import { Test, TestingModule } from '@nestjs/testing';
import { ZwdsController } from '../src/zwds/zwds.controller';
import { ZwdsService } from '../src/zwds/zwds.service';
import { ReadingType } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('Phase 8B — ZwdsController', () => {
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
      createCrossSystemReading: jest.fn(),
      createDeepStarReading: jest.fn(),
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
  // POST /api/zwds/readings — Phase 8B reading types
  // ============================================================

  describe('POST /api/zwds/readings — ZWDS_MONTHLY', () => {
    it('should delegate monthly reading to createReading', async () => {
      const dto = {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_MONTHLY,
        targetYear: 2026,
        targetMonth: 3,
      };
      const reading = { id: 'reading-m1', readingType: ReadingType.ZWDS_MONTHLY };
      service.createReading.mockResolvedValue(reading as any);

      const result = await controller.createReading(mockAuth as any, dto);

      expect(service.createReading).toHaveBeenCalledWith('clerk_user_1', dto);
      expect(result).toEqual(reading);
    });
  });

  describe('POST /api/zwds/readings — ZWDS_DAILY', () => {
    it('should delegate daily reading to createReading', async () => {
      const dto = {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_DAILY,
        targetDay: '2026-2-10',
      };
      const reading = { id: 'reading-d1', readingType: ReadingType.ZWDS_DAILY };
      service.createReading.mockResolvedValue(reading as any);

      const result = await controller.createReading(mockAuth as any, dto);

      expect(service.createReading).toHaveBeenCalledWith('clerk_user_1', dto);
      expect(result).toEqual(reading);
    });
  });

  describe('POST /api/zwds/readings — ZWDS_MAJOR_PERIOD', () => {
    it('should delegate major period reading to createReading', async () => {
      const dto = {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_MAJOR_PERIOD,
      };
      const reading = { id: 'reading-mp1', readingType: ReadingType.ZWDS_MAJOR_PERIOD };
      service.createReading.mockResolvedValue(reading as any);

      const result = await controller.createReading(mockAuth as any, dto);

      expect(service.createReading).toHaveBeenCalledWith('clerk_user_1', dto);
      expect(result).toEqual(reading);
    });
  });

  describe('POST /api/zwds/readings — ZWDS_QA', () => {
    it('should delegate Q&A reading to createReading', async () => {
      const dto = {
        birthProfileId: 'profile-1',
        readingType: ReadingType.ZWDS_QA,
        questionText: '今年適合創業嗎？',
      };
      const reading = { id: 'reading-qa1', readingType: ReadingType.ZWDS_QA };
      service.createReading.mockResolvedValue(reading as any);

      const result = await controller.createReading(mockAuth as any, dto);

      expect(service.createReading).toHaveBeenCalledWith('clerk_user_1', dto);
      expect(result).toEqual(reading);
    });

    it('should propagate BadRequestException for missing questionText', async () => {
      service.createReading.mockRejectedValue(
        new BadRequestException('Question text is required for Q&A readings'),
      );

      await expect(
        controller.createReading(mockAuth as any, {
          birthProfileId: 'profile-1',
          readingType: ReadingType.ZWDS_QA,
        }),
      ).rejects.toThrow('Question text is required for Q&A readings');
    });
  });

  // ============================================================
  // POST /api/zwds/cross-system
  // ============================================================

  describe('POST /api/zwds/cross-system', () => {
    it('should delegate to createCrossSystemReading', async () => {
      const dto = { birthProfileId: 'profile-1' };
      const reading = { id: 'reading-cs1', readingType: ReadingType.ZWDS_LIFETIME };
      service.createCrossSystemReading.mockResolvedValue(reading as any);

      const result = await controller.createCrossSystemReading(mockAuth as any, dto);

      expect(service.createCrossSystemReading).toHaveBeenCalledWith('clerk_user_1', dto);
      expect(result).toEqual(reading);
    });

    it('should pass different auth userId correctly', async () => {
      const otherAuth = { userId: 'clerk_user_99' };
      service.createCrossSystemReading.mockResolvedValue({ id: 'r1' } as any);

      await controller.createCrossSystemReading(otherAuth as any, { birthProfileId: 'p1' });

      expect(service.createCrossSystemReading).toHaveBeenCalledWith('clerk_user_99', { birthProfileId: 'p1' });
    });

    it('should propagate service errors', async () => {
      service.createCrossSystemReading.mockRejectedValue(
        new BadRequestException('Insufficient credits'),
      );

      await expect(
        controller.createCrossSystemReading(mockAuth as any, { birthProfileId: 'p1' }),
      ).rejects.toThrow('Insufficient credits');
    });
  });

  // ============================================================
  // POST /api/zwds/deep-stars
  // ============================================================

  describe('POST /api/zwds/deep-stars', () => {
    it('should delegate to createDeepStarReading', async () => {
      const dto = { birthProfileId: 'profile-1' };
      const reading = { id: 'reading-ds1', readingType: ReadingType.ZWDS_LIFETIME };
      service.createDeepStarReading.mockResolvedValue(reading as any);

      const result = await controller.createDeepStarReading(mockAuth as any, dto);

      expect(service.createDeepStarReading).toHaveBeenCalledWith('clerk_user_1', dto);
      expect(result).toEqual(reading);
    });

    it('should propagate NotFoundException for missing user', async () => {
      service.createDeepStarReading.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      await expect(
        controller.createDeepStarReading(mockAuth as any, { birthProfileId: 'p1' }),
      ).rejects.toThrow('User not found');
    });

    it('should propagate BadRequestException for non-MASTER user', async () => {
      service.createDeepStarReading.mockRejectedValue(
        new BadRequestException('Deep star analysis is available for Master-tier subscribers only'),
      );

      await expect(
        controller.createDeepStarReading(mockAuth as any, { birthProfileId: 'p1' }),
      ).rejects.toThrow('Master-tier subscribers only');
    });
  });
});
