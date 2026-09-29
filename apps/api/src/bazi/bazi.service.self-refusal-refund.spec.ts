import { HttpException, HttpStatus } from '@nestjs/common';
import { ReadingType } from '@prisma/client';
import { BaziService } from './bazi.service';
import { STREAMABLE_READING_TYPES } from './dto/create-reading.dto';
import { AI_SPEND_CAP_CODE } from '../ai/ai-spend.service';
import { AI_BUSY_CODE } from '../ai/ai-governor.service';
import { QUOTA_EXCEEDED_CODE } from '../ai/quota.service';

/**
 * #21 — a refusal WE issue must not leave the user charged.
 *
 * All three self-refusals (S2 spend cap, S4 quota, S1 concurrency) are raised
 * inside `_setupStream`, which runs AFTER `createReading` has already deducted
 * credits on the streaming path. Its catch released the stream slot and
 * rethrew, and nothing gave the money back.
 *
 * Measured in production 2026-09-02: the spend-cap drill's own refusal took 3
 * credits and delivered nothing. The user-facing string even promises
 * 「已生成的內容仍可查看」 while nothing had been generated.
 *
 * Same class as `cc02da5` ("the charge must follow the content") on the sibling
 * path — that one fixed *AI failed → charged*, this is *we refused → charged*.
 */
describe('BaziService._setupStream — self-refusal refund backstop', () => {
  const USER_ID = 'user-1';

  const refusal = (code: string) =>
    new HttpException({ code, message: 'refused' }, HttpStatus.SERVICE_UNAVAILABLE);

  function build(opts: {
    throws: unknown;
    aiInterpretation?: unknown;
    refundResult?: { refunded: boolean; amount: number };
    refundThrows?: boolean;
  }) {
    const reading = {
      id: 'reading-1',
      userId: USER_ID,
      creditsUsed: 3,
      aiInterpretation: opts.aiInterpretation ?? null,
      refundedAt: null,
      isDegraded: false,
      readingType: 'LIFETIME',
      targetYear: null,
      calculationData: {},
      birthProfile: { gender: 'MALE', birthDate: new Date('1987-09-06'), birthCity: 'x', hourKnown: true },
    };
    const refundReadingCredit = opts.refundThrows
      ? jest.fn().mockRejectedValue(new Error('db down'))
      : jest.fn().mockResolvedValue(opts.refundResult ?? { refunded: true, amount: 3 });

    const service = Object.create(BaziService.prototype) as BaziService;
    Object.assign(service, {
      prisma: {
        user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID }) },
        baziReading: { findFirst: jest.fn().mockResolvedValue(reading) },
      },
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      redis: {
        incrementRateLimit: jest.fn().mockResolvedValue(1),
        getClient: jest.fn().mockReturnValue({ decr: jest.fn().mockResolvedValue(0) }),
        acquireLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(undefined),
      },
      aiService: { getMaxStreamedGenerationMs: jest.fn().mockReturnValue(1_260_000) },
      // The refusal under test — raised where the real ones are raised.
      aiSpend: { assertUnderCap: jest.fn().mockRejectedValue(opts.throws) },
      quota: { consume: jest.fn().mockResolvedValue(undefined) },
      creditsService: { refundReadingCredit },
      emitStaticSections: jest.fn(),
    });
    return { service, refundReadingCredit };
  }

  const run = (svc: BaziService) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any)._setupStream('clerk_1', 'reading-1', { next: jest.fn(), complete: jest.fn() });

  it.each([
    ['spend cap', AI_SPEND_CAP_CODE],
    ['quota', QUOTA_EXCEEDED_CODE],
    ['concurrency', AI_BUSY_CODE],
  ])('refunds when refused by %s before any content', async (_label, code) => {
    const { service, refundReadingCredit } = build({ throws: refusal(code) });
    await expect(run(service)).rejects.toBeDefined();
    expect(refundReadingCredit).toHaveBeenCalledWith('reading-1', `self-refusal:${code}`);
  });

  it('still THROWS the refusal — the client must see it, refund or not', async () => {
    const { service } = build({ throws: refusal(AI_SPEND_CAP_CODE) });
    await expect(run(service)).rejects.toMatchObject({
      response: expect.objectContaining({ code: AI_SPEND_CAP_CODE }),
    });
  });

  it('does NOT refund a genuine AI failure — that path degrades and has its own refund', async () => {
    // Over-refunding here would hand back credits for a reading the existing
    // ai.service failure path is about to serve or refund itself.
    const { service, refundReadingCredit } = build({ throws: new Error('provider exploded') });
    await expect(run(service)).rejects.toThrow('provider exploded');
    expect(refundReadingCredit).not.toHaveBeenCalled();
  });

  it('does not let a FAILED refund swallow the refusal', async () => {
    // A lost refund is recoverable from the log; a swallowed 503 is not — the
    // client would render a success it never got.
    const { service } = build({ throws: refusal(AI_SPEND_CAP_CODE), refundThrows: true });
    await expect(run(service)).rejects.toMatchObject({
      response: expect.objectContaining({ code: AI_SPEND_CAP_CODE }),
    });
  });

  it('logs at ERROR when the refund fails, so a charged user is findable', async () => {
    const { service } = build({ throws: refusal(AI_SPEND_CAP_CODE), refundThrows: true });
    await expect(run(service)).rejects.toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errs = ((service as any).logger.error as jest.Mock).mock.calls.flat().join(' ');
    expect(errs).toContain('REFUND FAILED');
    expect(errs).toContain('reading-1');
  });

  it('releases the stream slot as well as refunding — a wedge would outlive the refusal', async () => {
    const { service } = build({ throws: refusal(AI_BUSY_CODE) });
    await expect(run(service)).rejects.toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((service as any).redis.releaseLock).toHaveBeenCalled();
  });

  it('a row WITH content never reaches the catch at all (step 2 returns early)', async () => {
    // Documents why the `!reading.aiInterpretation` conjunct is unreachable-false
    // rather than load-bearing. If this ever fails, that conjunct has become the
    // only thing stopping a refund for delivered content.
    const { service, refundReadingCredit } = build({
      throws: refusal(AI_SPEND_CAP_CODE),
      aiInterpretation: { sections: { personality: { preview: 'p', full: 'f' } } },
    });
    await run(service);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((service as any).emitStaticSections).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((service as any).aiSpend.assertUnderCap).not.toHaveBeenCalled();
    expect(refundReadingCredit).not.toHaveBeenCalled();
  });

  // ONE harness for every "row reaches _setupStream" test below (the ZWDS
  // describe and the dispatch describe share it). ⚠️ Twin of `build()` in
  // `bazi.service.stream-dispatch-default.spec.ts` — that file must
  // `jest.mock` the DTO module, and `jest.mock` is file-scoped, so it cannot
  // import this one. Change both together.
  //
  // Every streamer returns `{ subscribe }`: `_setupStream` calls
  // `aiObservable.subscribe(...)` and awaits nothing after it, so this is the
  // complete mock. A bare `jest.fn()` returns undefined, `undefined.subscribe`
  // throws a TypeError the catch rethrows, and a test asserting only
  // `rejects.toBeDefined()` would pass while the run was crashing.
  function buildWith(reading: Record<string, unknown>) {
    const refundReadingCredit = jest.fn().mockResolvedValue({ refunded: true, amount: 3 });
    const observable = () => ({ subscribe: jest.fn() });
    const streamers = {
      streamLifetimeV2: jest.fn().mockReturnValue(observable()),
      streamCareerV2: jest.fn().mockReturnValue(observable()),
      streamAnnualV2: jest.fn().mockReturnValue(observable()),
      streamLoveV2: jest.fn().mockReturnValue(observable()),
    };
    const redis = {
      incrementRateLimit: jest.fn().mockResolvedValue(1),
      getClient: jest.fn().mockReturnValue({ decr: jest.fn().mockResolvedValue(0) }),
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    const aiSpend = { assertUnderCap: jest.fn().mockResolvedValue(undefined) };
    const quota = { consume: jest.fn().mockResolvedValue(undefined) };
    const service = Object.create(BaziService.prototype) as BaziService;
    Object.assign(service, {
      prisma: {
        user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID }) },
        baziReading: { findFirst: jest.fn().mockResolvedValue(reading) },
      },
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      redis,
      aiService: { getMaxStreamedGenerationMs: jest.fn().mockReturnValue(1_260_000), ...streamers },
      aiSpend,
      quota,
      creditsService: { refundReadingCredit },
      emitStaticSections: jest.fn(),
    });
    return { service, streamers, ...streamers, redis, aiSpend, quota, refundReadingCredit };
  }

  describe('ZWDS — a row with no streamer must be refused, not silently regenerated', () => {
    // Found by auditing the recovery branch (#21c): `_setupStream`'s switch used
    // to end in `default: streamLifetimeV2` (it now THROWS, and step 2b refuses
    // first), so a ZWDS row sent there would have generated 八字終身運 content
    // over 紫微斗數 data and OVERWRITTEN one of the two paid `ZWDS_LIFETIME`
    // reports. The comparison path has carried this guard for a
    // while (`_assertRomanceV2`); the reading path never had it.
    const zwdsReading = (aiInterpretation: unknown = null) => ({
      id: 'reading-z', userId: USER_ID, creditsUsed: 3,
      aiInterpretation, refundedAt: null, isDegraded: false,
      readingType: 'ZWDS_LIFETIME', targetYear: null, calculationData: {},
      birthProfile: { gender: 'MALE', birthDate: new Date('1987-09-06'), birthCity: 'x', hourKnown: true },
    });

    it('REFUSES rather than generating LIFETIME over ZWDS data', async () => {
      const { service, streamLifetimeV2 } = buildWith(zwdsReading());
      await expect(run(service)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'READING_TYPE_NOT_STREAMABLE' }),
      });
      expect(streamLifetimeV2).not.toHaveBeenCalled();
    });

    it('does NOT refund — the user keeps a report we merely decline to regenerate', async () => {
      const { service, refundReadingCredit } = buildWith(zwdsReading());
      await expect(run(service)).rejects.toBeDefined();
      expect(refundReadingCredit).not.toHaveBeenCalled();
    });

    it('still SERVES a paid ZWDS row that already has content', async () => {
      // The guard sits after step 2 on purpose. Placing it earlier would break
      // the two paid reports it exists to protect.
      const { service } = buildWith(zwdsReading({ sections: { a: { preview: 'p', full: 'f' } } }));
      await run(service);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((service as any).emitStaticSections).toHaveBeenCalled();
    });

    it('does not refuse a normal Bazi row — the run RESOLVES and the streamer is called', async () => {
      // Before the `{ subscribe }` mocks this asserted `rejects.not.toMatchObject`,
      // which passed on a TypeError from `undefined.subscribe` — green while the
      // run was crashing. Asserting resolution + the call is the real property.
      const { service, streamLifetimeV2 } = buildWith({ ...zwdsReading(), readingType: 'LIFETIME' });
      await expect(run(service)).resolves.toBeUndefined();
      expect(streamLifetimeV2).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispatch — every streamable type has its own case, everything else is refused (todo #3)', () => {
    // `_setupStream`'s switch used to end in `default: streamLifetimeV2`, so a
    // HEALTH row (V1, inline-only, no V2 streamer) sent to the stream route was
    // narrated as 八字終身運 and PERSISTED that way. Measured on production:
    // reading `ab232801…`, `readingType: HEALTH`, `failedReason:
    // ai-failed-LIFETIME-call1=0/8-call2=0/7` — LIFETIME's section shape.
    const paidEmpty = (readingType: string, aiInterpretation: unknown = null) => ({
      id: 'reading-h', userId: USER_ID, creditsUsed: 2,
      aiInterpretation, refundedAt: null, isDegraded: false,
      readingType, targetYear: null, calculationData: {},
      birthProfile: { gender: 'MALE', birthDate: new Date('1987-09-06'), birthCity: 'x', hourKnown: true },
    });

    // Exhaustively typed: a type added to STREAMABLE_READING_TYPES without a
    // mapping here is a COMPILE error in this spec (ts-jest diagnostics are on),
    // which is a legible red rather than an incidental matcher error.
    const STREAMER_FOR: Record<
      (typeof STREAMABLE_READING_TYPES)[number],
      'streamLifetimeV2' | 'streamCareerV2' | 'streamAnnualV2' | 'streamLoveV2'
    > = {
      [ReadingType.LIFETIME]: 'streamLifetimeV2',
      [ReadingType.CAREER]: 'streamCareerV2',
      [ReadingType.ANNUAL]: 'streamAnnualV2',
      [ReadingType.LOVE]: 'streamLoveV2',
    };

    // Test 1 — derived from the constant, so the list is proven to be READ by
    // the dispatcher (the surface spec's equality assertion compares two
    // literals and cannot prove that on its own).
    it.each(STREAMABLE_READING_TYPES)('%s dispatches to its OWN streamer and no other', async (type) => {
      const { service, streamers } = buildWith(paidEmpty(type));
      await expect(run(service)).resolves.toBeUndefined();
      const expected = STREAMER_FOR[type];
      for (const [name, mock] of Object.entries(streamers)) {
        expect(mock).toHaveBeenCalledTimes(name === expected ? 1 : 0);
      }
    });

    // Test 2 — the production case.
    it('REFUSES a paid-empty HEALTH row before anything is spent', async () => {
      const { service, streamers, redis, quota, refundReadingCredit } = buildWith(paidEmpty('HEALTH'));
      await expect(run(service)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'READING_TYPE_NOT_STREAMABLE' }),
      });
      for (const mock of Object.values(streamers)) expect(mock).not.toHaveBeenCalled();
      expect(refundReadingCredit).not.toHaveBeenCalled(); // not a self-refusal: the user keeps the row
      expect(redis.incrementRateLimit).not.toHaveBeenCalled(); // no slot taken
      expect(redis.acquireLock).not.toHaveBeenCalled(); // no lock taken
      // "A refusal we issue must not spend the user's daily allowance" — CLAUDE.md.
      expect(quota.consume).not.toHaveBeenCalled();
    });

    it('uses a non-ZWDS message for HEALTH — 停用 is the ZWDS wording, not this one', async () => {
      const { service } = buildWith(paidEmpty('HEALTH'));
      await expect(run(service)).rejects.toMatchObject({
        response: expect.objectContaining({ message: expect.stringContaining('不支援串流生成') }),
      });
    });

    // Test 3 — placement ABOVE S2/S4: with the cap tripped, the type refusal
    // still wins, and neither the cap nor the quota is consulted. (A row WITH
    // content cannot pin this — step 2 returns before either check.)
    it('is placed above the spend cap and the quota — the type refusal wins even when the cap is tripped', async () => {
      const { service, aiSpend, quota, refundReadingCredit } = buildWith(paidEmpty('HEALTH'));
      aiSpend.assertUnderCap.mockRejectedValue(refusal(AI_SPEND_CAP_CODE));
      await expect(run(service)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'READING_TYPE_NOT_STREAMABLE' }),
      });
      expect(aiSpend.assertUnderCap).not.toHaveBeenCalled();
      expect(quota.consume).not.toHaveBeenCalled();
      expect(refundReadingCredit).not.toHaveBeenCalled();
    });

    // Test 4 — placement BELOW step 2: a paid HEALTH row that already HAS its
    // (V1) content is still served, never refused.
    it('still SERVES a paid HEALTH row that already has content', async () => {
      const { service, streamers } = buildWith(
        paidEmpty('HEALTH', { sections: { constitution: { preview: 'p', full: 'f' } } }),
      );
      await expect(run(service)).resolves.toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((service as any).emitStaticSections).toHaveBeenCalled();
      for (const mock of Object.values(streamers)) expect(mock).not.toHaveBeenCalled();
    });
  });
});
