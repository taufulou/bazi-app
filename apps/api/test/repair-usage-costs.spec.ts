import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AiSpendService } from '../src/ai/ai-spend.service';
import { executeRepair, planRepair, type RepairableRow } from '../src/scripts/repair-usage-costs';

/**
 * D2 — the backfill's money decision, tested without a database.
 *
 * ⚠️ This write is ONE-WAY. The predicate is `costUsd = 0 AND tokens > 0`, so a
 * repaired row has `costUsd > 0` and no longer matches — a wrong run cannot be
 * corrected in bulk, only through `--rows`. That is why the decision is a pure
 * function with tests rather than inline in a script.
 */
describe('planRepair', () => {
  const pricer = () => {
    const s = Object.create(AiSpendService.prototype) as AiSpendService;
    Object.assign(s, { logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() } });
    return s;
  };
  const row = (o: Partial<RepairableRow> = {}): RepairableRow => ({
    id: 'a', aiModel: 'claude-sonnet-4-5-20250929', inputTokens: 1_000_000, outputTokens: 0, ...o,
  });

  it('prices a known model from PRICE_TABLE', () => {
    const p = planRepair([row()], pricer());
    expect(p.priced).toHaveLength(1);
    expect(p.costs.get('a')).toBeCloseTo(3, 6); // 1M input at $3/1M
    expect(p.totalUsd).toBeCloseTo(3, 6);
  });

  it('SKIPS an unknown model by default — FALLBACK would overstate it forever', () => {
    // `priceFor` bills an unrecognised model at $15/$75 so the BREAKER errs
    // toward tripping early. That bias is right for a breaker and simply wrong
    // in a one-way reporting repair.
    const p = planRepair([row({ aiModel: 'mystery-model-v9' })], pricer());
    expect(p.priced).toEqual([]);
    expect(p.unpriced).toHaveLength(1);
    expect(p.willWrite).toEqual([]);
    expect(p.totalUsd).toBe(0);
  });

  it('does NOT skip claude-opus — the collision that makes a value check wrong', () => {
    // FALLBACK_PRICE is byte-identical to the `claude-opus-4` entry, so a
    // value-based "did it fall back?" check would classify the most expensive
    // REAL model as unpriced and refuse the rows most worth repairing.
    for (const m of ['claude-opus-4', 'claude-opus', 'claude-opus-4-6']) {
      const p = planRepair([row({ aiModel: m })], pricer());
      expect(p.unpriced).toEqual([]);
      expect(p.priced).toHaveLength(1);
    }
  });

  it('--allow-fallback-price writes them, deliberately', () => {
    const p = planRepair([row({ aiModel: 'mystery-model-v9' })], pricer(), { allowFallback: true });
    expect(p.willWrite).toHaveLength(1);
    expect(p.costs.get('a')).toBeCloseTo(15, 6); // FALLBACK input rate
  });

  it('rounds to 6dp, so a repaired row matches a freshly written one', () => {
    // `priceOrZero` rounds the same way, and the column is Decimal(10,6).
    const p = planRepair([row({ inputTokens: 1, outputTokens: 1 })], pricer());
    const c = p.costs.get('a')!;
    expect(Number(c.toFixed(6))).toBe(c);
  });

  it('a mixed batch partitions rather than failing whole', () => {
    const p = planRepair(
      [row({ id: 'ok' }), row({ id: 'bad', aiModel: 'mystery-model-v9' }), row({ id: 'ok2' })],
      pricer(),
    );
    expect(p.priced.map((r) => r.id)).toEqual(['ok', 'ok2']);
    expect(p.unpriced.map((r) => r.id)).toEqual(['bad']);
    expect(p.willWrite).toHaveLength(2);
  });

  it('an empty batch is a no-op, not a crash', () => {
    const p = planRepair([], pricer());
    expect(p.willWrite).toEqual([]);
    expect(p.totalUsd).toBe(0);
  });

  it('computes a cost consistent with what a NEW row would get', () => {
    // The repair must not invent a different number from the live path. Both go
    // through `estimateCostUsd` and both round to 6dp.
    const s = pricer();
    const live = Math.round(
      s.estimateCostUsd('claude-sonnet-4-5-20250929', { inputTokens: 22222, outputTokens: 7667 }) * 1e6,
    ) / 1e6;
    const p = planRepair([row({ inputTokens: 22222, outputTokens: 7667 })], s);
    expect(p.costs.get('a')).toBe(live);
  });
});

/**
 * ⚠️ The assumption the repair script's construction rests on.
 *
 * `repair-usage-costs.ts` does `new AiSpendService(null as never, null as never)`
 * — deliberately, so a one-off repair does not boot Redis, cron and Clerk for
 * what is a pure function. That is only safe while the pricing methods touch
 * neither dependency. If someone adds a config read to `estimateCostUsd`, the
 * script dies at runtime, mid-repair, on a ONE-WAY write.
 *
 * The source assertion is the guard, because no unit test of the METHOD would
 * notice: tests build the service with `Object.create` and assign what they
 * need.
 */
describe('the repair script may construct AiSpendService without deps', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

  it('the pricing methods touch neither redis nor config', () => {
    const SRC = read('src/ai/ai-spend.service.ts');
    const start = SRC.indexOf('private findPrice(');
    const end = SRC.indexOf('// The breaker', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // findPrice + hasPriceEntry + priceFor + estimateCostUsd all live in here.
    const pricingBlock = SRC.slice(start, end);
    expect(pricingBlock).toContain('hasPriceEntry');
    expect(pricingBlock).toContain('estimateCostUsd');
    expect(pricingBlock).not.toMatch(/this\.redis/);
    expect(pricingBlock).not.toMatch(/this\.config/);
  });

  it('constructing with null deps really does price correctly', () => {
    // The behavioural half: prove the construction the script uses works,
    // rather than only asserting the source property that permits it.
    const s = new AiSpendService(null as never, null as never);
    expect(s.hasPriceEntry('claude-sonnet-4-5-20250929')).toBe(true);
    expect(s.estimateCostUsd('claude-sonnet-4-5-20250929', {
      inputTokens: 1_000_000, outputTokens: 0,
    })).toBeCloseTo(3, 6);
  });
});

/**
 * ⚠️ No silent caps.
 *
 * The script fetches with `take`, so a batch larger than the cap is partially
 * covered. An earlier version reported `rows.length` against the TABLE total,
 * which read as complete coverage — the operator would see "repaired: 5000",
 * believe the job done, and leave rows broken with no signal. On a one-way
 * write that is the worst failure mode available.
 *
 * Source-level because the property is about what the run TELLS the operator,
 * and driving `main()` would need the whole database mocked to assert a console
 * line.
 */
describe('the repair announces truncation', () => {
  const SRC = readFileSync(join(__dirname, '..', 'src/scripts/repair-usage-costs.ts'), 'utf8');

  it('counts MATCHING rows, not the table', () => {
    // `count()` with no `where` is the bug: it makes the denominator the table.
    expect(SRC).toContain('prisma.aIUsageLog.count({ where })');
    expect(SRC).not.toMatch(/aIUsageLog\.count\(\)/);
  });

  it('warns when the cap truncated the batch', () => {
    expect(SRC).toContain('TRUNCATED');
    expect(SRC).toMatch(/matching > rows\.length/);
  });

  it('says what REMAINS after an execute, not just what was written', () => {
    const after = SRC.slice(SRC.indexOf('repaired: ${written}'));
    expect(after).toMatch(/remaining/);
  });

  it('reports partial progress when a write throws mid-loop', () => {
    // One-way and partially applied: "which rows are done" is the only thing
    // the operator needs, and a bare stack trace does not say.
    expect(SRC).toMatch(/FAILED after repairing \$\{written\} of/);
  });
});

/**
 * F6 — the write loop, tested as a WRITE.
 *
 * ⚠️ Before the refactor this was untestable: `main()` was a bare module-scope
 * call, so importing the module ran the repair. The best available check was a
 * source assertion — which is exactly what the finding objected to, since
 * `--allow-fallback-price` is the one flag that permits an irreversible write
 * at the most-expensive fallback rate.
 */
describe('executeRepair', () => {
  const writer = (opts: { failAt?: number } = {}) => {
    const calls: Array<{ id: string; costUsd: number }> = [];
    const update = jest.fn(async (args: { where: { id: string }; data: { costUsd: number } }) => {
      if (opts.failAt !== undefined && calls.length === opts.failAt) throw new Error('db down');
      calls.push({ id: args.where.id, costUsd: args.data.costUsd });
      return {};
    });
    return { prisma: { aIUsageLog: { update } }, calls };
  };
  const row = (id: string): RepairableRow => ({
    id, aiModel: 'claude-sonnet-4-5-20250929', inputTokens: 1_000_000, outputTokens: 0,
  });

  it('writes the planned cost for each row', async () => {
    const { prisma, calls } = writer();
    const costs = new Map([['a', 3], ['b', 1.5]]);
    const n = await executeRepair(prisma, [row('a'), row('b')], costs);
    expect(n).toBe(2);
    expect(calls).toEqual([{ id: 'a', costUsd: 3 }, { id: 'b', costUsd: 1.5 }]);
  });

  it('--allow-fallback-price really WRITES the unpriced rows', async () => {
    // The end-to-end property the source assertion could not reach: a refactor
    // dropping `willWrite` back to `priced` now fails a test.
    const pricer = Object.create(AiSpendService.prototype) as AiSpendService;
    Object.assign(pricer, { logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() } });
    const unknown: RepairableRow = { ...row('u'), aiModel: 'mystery-model-v9' };

    const plan = planRepair([unknown], pricer, { allowFallback: true });
    const { prisma, calls } = writer();
    const n = await executeRepair(prisma, plan.willWrite, plan.costs);

    expect(n).toBe(1);
    expect(calls[0]!.costUsd).toBeCloseTo(15, 6); // FALLBACK input rate
  });

  it('WITHOUT the flag, an unpriced row is not written at all', async () => {
    const pricer = Object.create(AiSpendService.prototype) as AiSpendService;
    Object.assign(pricer, { logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() } });
    const plan = planRepair([{ ...row('u'), aiModel: 'mystery-model-v9' }], pricer);
    const { prisma, calls } = writer();
    expect(await executeRepair(prisma, plan.willWrite, plan.costs)).toBe(0);
    expect(calls).toEqual([]);
  });

  it('reports how far it got before rethrowing — the run is one-way', async () => {
    const { prisma, calls } = writer({ failAt: 2 });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const costs = new Map([['a', 1], ['b', 2], ['c', 3]]);
    await expect(executeRepair(prisma, [row('a'), row('b'), row('c')], costs)).rejects.toThrow('db down');
    expect(calls).toHaveLength(2);   // partially applied, and irreversibly so
    expect(errSpy.mock.calls.flat().join(' ')).toContain('FAILED after repairing 2 of 3');
    errSpy.mockRestore();
  });

  it('a missing cost writes 0 rather than undefined', async () => {
    // Prisma would reject `undefined` for a Decimal column, losing the row.
    const { prisma, calls } = writer();
    expect(await executeRepair(prisma, [row('a')], new Map())).toBe(1);
    expect(calls[0]!.costUsd).toBe(0);
  });
});

