import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIService } from '../src/ai/ai.service';
import { AiSpendService } from '../src/ai/ai-spend.service';

/**
 * D1 — one calculation for the cost of a call.
 *
 * `logUsage` wrote the same token counts to two destinations and priced them
 * from two different sources: the Redis spend counter via
 * `estimateCostUsd(model, usage)`, and `AIUsageLog.costUsd` from a
 * caller-supplied `estimatedCostUsd` that NINE call sites hardcoded to `0`.
 * They disagreed by construction. Three production COMPATIBILITY rows showed
 * 14,769 / 11,347 / 9,939 input tokens against `$0`.
 *
 * The fix removes the parameter so a caller cannot supply a wrong cost at all.
 */
describe('AIUsageLog cost pricing', () => {
  const realSpend = () => {
    const svc = Object.create(AiSpendService.prototype) as AiSpendService;
    Object.assign(svc, { logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() } });
    return svc;
  };

  function build(spend: Partial<AiSpendService>) {
    const create = jest.fn().mockResolvedValue({});
    const svc = Object.create(AIService.prototype) as AIService;
    Object.assign(svc, {
      prisma: { aIUsageLog: { create } },
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      aiSpend: spend,
    });
    return { svc, create };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const persist = (svc: AIService, row: Record<string, unknown>) => (svc as any).persistUsageRow(row);
  const ROW = {
    userId: 'u1', readingId: 'r1', readingType: null,
    provider: 'CLAUDE', model: 'claude-sonnet-4-5-20250929',
    inputTokens: 1_000_000, outputTokens: 0, latencyMs: 10,
  };

  it('prices the row from model + tokens', async () => {
    const spend = realSpend();
    const { svc, create } = build(spend);
    await persist(svc, ROW);
    // 1M input at $3/1M. Sonnet resolves by longest prefix from the dated id.
    expect(create.mock.calls[0][0].data.costUsd).toBeCloseTo(3, 6);
  });

  it('COUNTER AND ROW AGREE — the property the change exists for', async () => {
    // ⚠️ Token counts chosen so the exact cost is representable at 6dp, making
    // the 6dp rounding in `priceOrZero` a no-op. Otherwise this assertion sits
    // on its own boundary: `toBeCloseTo(x, 6)` needs a difference < 5e-7, and
    // rounding to 6dp produces a maximum error of exactly 5e-7.
    const spend = realSpend();
    const recorded = spend.estimateCostUsd(ROW.model, {
      inputTokens: ROW.inputTokens, outputTokens: ROW.outputTokens,
    });
    const { svc, create } = build(spend);
    await persist(svc, ROW);
    expect(Number(create.mock.calls[0][0].data.costUsd)).toBeCloseTo(recorded, 6);
  });

  it('an UNKNOWN model still writes a row, at the fallback rate', async () => {
    // ⚠️ Unknown does NOT throw — `priceFor` returns FALLBACK_PRICE after a
    // warn. This asserts the fallback VALUE, not an exception.
    const spend = realSpend();
    const { svc, create } = build(spend);
    await persist(svc, { ...ROW, model: 'some-new-model-v9' });
    expect(create.mock.calls[0][0].data.costUsd).toBeCloseTo(15, 6); // FALLBACK input rate
  });

  it('a THROWING estimateCostUsd logs at error and still writes the row', async () => {
    // ⚠️ Must be a spy: under the current signature the real function cannot
    // throw (the usage object is built in place from two required numbers), so
    // a malformed-input version of this test would pass for the wrong reason
    // and leave the defensive branch unexercised.
    const spend = realSpend();
    jest.spyOn(spend, 'estimateCostUsd').mockImplementation(() => { throw new Error('boom'); });
    const { svc, create } = build(spend);
    await persist(svc, ROW);
    expect(create).toHaveBeenCalled();
    expect(create.mock.calls[0][0].data.costUsd).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errs = ((svc as any).logger.error as jest.Mock).mock.calls.flat().join(' ');
    expect(errs).toContain('Failed to price');
    // Names the likely cause, so a stub gap is not mistaken for a pricing failure.
    expect(errs).toContain('typeof estimateCostUsd');
  });

  it('a NON-FINITE price writes the row at 0 rather than losing it', async () => {
    // `Math.round(NaN)` is `NaN`, and Prisma rejects that for a Decimal column
    // from inside `create` — past the try — so the ROW would be lost. Token
    // counts are the part that cannot be recomputed later.
    const spend = realSpend();
    jest.spyOn(spend, 'estimateCostUsd').mockReturnValue(NaN);
    const { svc, create } = build(spend);
    await persist(svc, ROW);
    expect(create.mock.calls[0][0].data.costUsd).toBe(0);
  });

  it('rounds to 6dp — what the Decimal(10,6) column stores anyway', async () => {
    const spend = realSpend();
    jest.spyOn(spend, 'estimateCostUsd').mockReturnValue(0.1234567891);
    const { svc, create } = build(spend);
    await persist(svc, ROW);
    expect(create.mock.calls[0][0].data.costUsd).toBe(0.123457);
  });
});

/**
 * C-bis — `hasPriceEntry`, the accessor the backfill (D2) cannot work without.
 */
describe('AiSpendService.hasPriceEntry', () => {
  const svc = () => {
    const s = Object.create(AiSpendService.prototype) as AiSpendService;
    Object.assign(s, { logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() } });
    return s;
  };

  it('claude-opus-4 is TRUE — the case the accessor exists for', () => {
    // ⚠️ This is exactly what a value-based check gets wrong. `FALLBACK_PRICE`
    // is byte-identical to the `claude-opus-4` entry, so comparing prices would
    // report the most expensive REAL model in the table as unpriced — and a
    // repair keying on that would skip the rows most worth repairing.
    expect(svc().hasPriceEntry('claude-opus-4')).toBe(true);
    expect(svc().hasPriceEntry('claude-opus')).toBe(true);
  });

  it('an unmatched id is FALSE', () => {
    expect(svc().hasPriceEntry('some-new-model-v9')).toBe(false);
    expect(svc().hasPriceEntry('')).toBe(false);
  });

  it('resolves dated snapshots by prefix, like priceFor', () => {
    expect(svc().hasPriceEntry('claude-sonnet-4-5-20250929')).toBe(true);
  });

  it('does NOT warn — it is a predicate, not a pricing call', () => {
    // A predicate with a logging side effect would emit one line per row when a
    // caller partitions a batch on it, colliding with that warning's job as the
    // unknown-model signal.
    const s = svc();
    s.hasPriceEntry('some-new-model-v9');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(((s as any).logger.warn as jest.Mock)).not.toHaveBeenCalled();
    // ...while priceFor still does.
    s.priceFor('some-new-model-v9');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(((s as any).logger.warn as jest.Mock)).toHaveBeenCalled();
  });
});

/**
 * Source invariants — the properties that must survive future edits.
 */
describe('D1 source invariants', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
  const AI = read('src/ai/ai.service.ts');

  it('ONE price table — the second one is gone', () => {
    // `providerConfig.costPerInputToken/OutputToken` was a second table that
    // agreed with PRICE_TABLE for Claude and GPT but priced gemini-2.0-flash at
    // $2/$12 against PRICE_TABLE's $0.10/$0.40 — 20x and 30x.
    expect(AI).not.toMatch(/costPer(Input|Output)Token/);
  });

  it('scoped to apps/api, not just src/ai — spec copies count too', () => {
    // Four spec files carried stale rate literals. They break no compile (they
    // are `any`-typed), so only an explicit sweep removes them.
    const hits = execSync(
      `grep -rlE "costPerInputToken|costPerOutputToken" ${__dirname}/.. --include="*.ts" || true`,
    ).toString().trim().split('\n').filter(Boolean)
      // Exclude this file: like the stub guard below, its own pattern text
      // contains the strings it hunts for.
      .filter((f) => !f.endsWith('usage-row-pricing.spec.ts'));
    expect(hits).toEqual([]);
  });

  it('no caller can supply a cost — persistUsageRow has no costUsd parameter', () => {
    const start = AI.indexOf('private async persistUsageRow(');
    const sig = AI.slice(start, AI.indexOf('): Promise<void>', start));
    expect(start).toBeGreaterThan(-1);
    expect(sig).not.toMatch(/costUsd\s*:/);
  });

  it('the price inputs stay (model, inputTokens, outputTokens) — recomputability', () => {
    // ⚠️ The behavioural recomputability test is near-tautological today, since
    // `persistUsageRow` has no cache-token parameters to diverge on. THIS is the
    // half that bites: `ai_usage_log` has no cache columns, so the moment anyone
    // feeds cache tokens into the price, `costUsd` stops being recomputable from
    // stored data and the D2 backfill silently under-prices. Widening the price
    // needs no schema change, so nothing else catches it.
    const start = AI.indexOf('private priceOrZero(');
    const body = AI.slice(start, AI.indexOf('private async persistUsageRow(', start));
    expect(start).toBeGreaterThan(-1);
    expect(body).not.toMatch(/cacheReadTokens|cacheWriteTokens/);
  });

  it('nine hardcoded estimatedCostUsd: 0 literals are gone', () => {
    expect(AI).not.toMatch(/estimatedCostUsd: 0,/);
  });

  it('priceFor and hasPriceEntry share ONE scan', () => {
    // A boolean carries no price, so `priceFor` delegating to `hasPriceEntry`
    // would have to scan again. The private `findPrice` is what makes the
    // single-scan claim true.
    const SPEND = read('src/ai/ai-spend.service.ts');
    expect(SPEND).toContain('private findPrice(');
    expect((SPEND.match(/id\.startsWith\(key\)/g) ?? []).length).toBe(1);
  });
});

/**
 * ⚠️ The stub gap — the way this fix could ship green and unfixed.
 *
 * `persistUsageRow` prices through `aiSpend.estimateCostUsd`, and its own
 * try/catch swallows a `TypeError` from a stub that lacks it — writing
 * `costUsd: 0`, i.e. reproducing the exact defect under test while every spec
 * stays green.
 *
 * This repo has been bitten by that anonymous stub before:
 * `ai-spend-chokepoints.spec.ts:10-23` — "Two audits found this independently,
 * and neither the 22 service tests nor the CI guard caught it, because every
 * spec injected an ANONYMOUS stub … that no assertion could reach."
 *
 * So the guard is on the STUB SHAPE, not on a list of specs someone has to keep
 * complete. Deleting `estimateCostUsd` from any of them fails here.
 */
describe('every aiSpend stub carries estimateCostUsd', () => {
  it('no three-method stub survives in the spec tree', () => {
    const files = execSync(
      `grep -rl "recordFailure: jest.fn()" ${__dirname}/.. --include="*.spec.ts" || true`,
    ).toString().trim().split('\n').filter(Boolean)
      // Exclude this file: its own regex source contains the pattern it hunts.
      .filter((f) => !f.endsWith('usage-row-pricing.spec.ts'));
    expect(files.length).toBeGreaterThan(10); // the idiom is widespread; keep it that way

    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        // One-line object literals; every occurrence in the tree is one.
        if (/recordFailure:\s*jest\.fn\(\)/.test(line) && !/estimateCostUsd/.test(line)) {
          offenders.push(`${f.split('/').slice(-1)[0]}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

