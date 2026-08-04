import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ZwdsService } from './zwds.service';
import { CurrentUser, AuthPayload } from '../auth/current-user.decorator';

/**
 * ZWDS (紫微斗數) — READ-ONLY.
 *
 * ⚠️ Every creation route was removed on 2026-08-03 (plan §A2.0). ZWDS is not
 * shipping, is hidden from the dashboard, and has no launch date, so the routes
 * were live surface that could spend credits and create rows for a product that
 * delivers nothing. Measured before removal:
 *   - ZWDS comparison rows ever created: 0
 *   - frontend call sites for every route except `readings`: none
 *   - `createZwdsReading` was wired but reachable only by typing a
 *     `/reading/zwds-*` URL — `ZWDS_CROSS_SELL` (AIReadingDisplay.tsx:1655)
 *     renders only when you are already inside a ZWDS reading.
 *
 * Removed: `POST chart-preview`, `POST readings`, `POST horoscope`,
 * `POST cross-system`, `POST deep-stars`, `POST comparisons`.
 *
 * Three of those charged credits through a raw
 * `tx.user.updateMany({ credits: { decrement } })` that writes NO `CreditLedger`
 * row (`zwds.service.ts:404`, `:659`, `:818`) — the exact pattern `CreditsService`
 * exists to replace. That spend was unauditable.
 *
 * ⚠️ `GET readings/:id` MUST STAY. The dev DB holds 2 `ZWDS_LIFETIME` rows worth
 * 4 already-spent credits; removing retrieval would make paid content vanish.
 * Charts still render for them — `ZwdsChart` goes through the Next.js
 * `apps/web/app/api/zwds-calculate/route.ts` (calculation only, no credits, no
 * DB), not these endpoints.
 *
 * The service methods are all intact, so re-enabling is a controller-level
 * revert. Before doing so, ZWDS owes:
 *   1. `paidAt: new Date()` in the comparison `create` — it charges at create and
 *      delivers immediately, so its rows are paid-and-delivered from birth. The
 *      Bazi-side reveal CAS is the only other writer and never touches them.
 *   2. all three deductions routed through `creditsService.deductCredits`.
 *   3. the Romance-V2 type guards on `generateComparisonAI` and
 *      `recalculateComparison` still present — `BaziComparison` is SHARED, and
 *      those guards are what stop a Bazi endpoint charging Bazi credits and
 *      overwriting a paid ZWDS report.
 *   4. a decision on a `system` discriminator column. It can never be
 *      backfilled, so a ZWDS revival is the moment to add it.
 */
@ApiTags('ZWDS')
@Controller('api/zwds')
export class ZwdsController {
  constructor(private readonly zwdsService: ZwdsService) {}

  @Get('readings/:id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a specific ZWDS reading (read-only — creation is disabled)',
  })
  async getReading(
    @CurrentUser() auth: AuthPayload,
    @Param('id') id: string,
  ) {
    return this.zwdsService.getReading(auth.userId, id);
  }
}
