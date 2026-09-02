import { AiSpendService } from '../src/ai/ai-spend.service';
import { planRepair, type RepairableRow } from '../src/scripts/repair-usage-costs';

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
