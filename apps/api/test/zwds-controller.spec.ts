import { Test, TestingModule } from '@nestjs/testing';
import { ZwdsController } from '../src/zwds/zwds.controller';
import { ZwdsService } from '../src/zwds/zwds.service';

/**
 * ZWDS is READ-ONLY as of 2026-08-03 (plan §A2.0).
 *
 * Every creation route was removed: ZWDS is not shipping, is hidden from the
 * dashboard, and three of its routes charged credits through a raw
 * `user.updateMany({ credits: { decrement } })` that wrote no `CreditLedger`
 * row — unauditable spend on a product that delivers nothing.
 *
 * This file previously exercised those routes. It now asserts they are GONE,
 * and that retrieval still works.
 *
 * ⚠️ `getReading` must survive. The dev DB holds 2 `ZWDS_LIFETIME` rows worth 4
 * already-spent credits; removing retrieval would make paid content vanish.
 *
 * `zwds-phase8b-controller.spec.ts` was DELETED rather than rewritten: all 12 of
 * its tests targeted `createReading` / `createCrossSystemReading` /
 * `createDeepStarReading`, which the `it.each` block below now asserts are
 * absent. The SERVICE-level logic those routes used is still covered by
 * `zwds-phase8b-service.spec.ts` and `zwds-service.spec.ts`, which continue to
 * pass — the service methods remain intact for the re-enable case, only the
 * controller routes are gone.
 */
describe('ZwdsController — read-only surface', () => {
  let controller: ZwdsController;
  let service: jest.Mocked<ZwdsService>;

  const mockAuth = { userId: 'clerk_user_1' };

  beforeEach(async () => {
    const mockService = { getReading: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ZwdsController],
      providers: [{ provide: ZwdsService, useValue: mockService }],
    }).compile();

    controller = module.get<ZwdsController>(ZwdsController);
    service = module.get(ZwdsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /api/zwds/readings/:id — MUST still work', () => {
    it('delegates to zwdsService.getReading', async () => {
      const expected = { id: 'r1', readingType: 'ZWDS_LIFETIME' };
      service.getReading.mockResolvedValue(expected as never);

      const result = await controller.getReading(mockAuth as never, 'r1');

      expect(service.getReading).toHaveBeenCalledWith('clerk_user_1', 'r1');
      expect(result).toEqual(expected);
    });

    it('propagates service errors', async () => {
      service.getReading.mockRejectedValue(new Error('not found'));
      await expect(controller.getReading(mockAuth as never, 'missing')).rejects.toThrow(
        'not found',
      );
    });
  });

  describe('creation routes are REMOVED', () => {
    // A handler that no longer exists cannot be reached. Asserting on the
    // controller surface is the unit-level equivalent of asserting a 404.
    it.each([
      'createReading',
      'createComparison',
      'createCrossSystemReading',
      'createDeepStarReading',
      'getChartPreview',
      'getHoroscope',
    ])('%s is not exposed', (method) => {
      expect((controller as unknown as Record<string, unknown>)[method]).toBeUndefined();
    });

    it('exposes ONLY the read route', () => {
      const handlers = Object.getOwnPropertyNames(
        Object.getPrototypeOf(controller),
      ).filter((n) => n !== 'constructor');

      expect(handlers).toEqual(['getReading']);
    });
  });
});
