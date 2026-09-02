import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #19 — `/admin/ai-costs` was blind to the streaming path.
 *
 * `_executeStreamV2Common` never called `logUsage`, so a streamed reading wrote
 * NO `AIUsageLog` row — only the Redis spend counter moved. The dashboard
 * therefore omitted the most expensive path in the app, while still showing
 * 1,383 retained load-test fabrications (#17): close to the inverse of reality.
 *
 * Asserted at source level because the write lives in a generator's `finally`
 * inside a five-argument provider dispatch; the invariants that matter are
 * WHICH function is called and what it is NOT called alongside.
 */
const SRC = readFileSync(join(__dirname, '..', 'src/ai/ai.service.ts'), 'utf8');

const innerBody = (() => {
  const start = SRC.indexOf('*_streamProviderInner');
  const end = SRC.indexOf('// ---- Claude ----', start);
  return SRC.slice(start, end);
})();

describe('#19 — the streaming path writes an AIUsageLog row', () => {
  it('persists a row from _streamProviderInner', () => {
    expect(innerBody).toContain('this.persistUsageRow({');
  });

  it('does NOT call logUsage there — that would double-count the spend cap', () => {
    // `logUsage` does two things: `aiSpend.record()` AND the DB row. The
    // streaming path already calls `record()` directly a few lines above, so
    // reusing `logUsage` would move the Redis counter twice for one call and
    // trip the daily cap early.
    expect(innerBody).toContain('this.aiSpend.record({');
    expect(innerBody).not.toContain('this.logUsage(');
  });

  it('prices without awaiting record() — that call is a deliberate void', () => {
    // `record()` returns the cost, but it is fire-and-forget inside a
    // generator's `finally`; awaiting it would change when the generator
    // settles. The same pricing function is used instead.
    expect(innerBody).toContain('this.aiSpend.estimateCostUsd(');
    expect(innerBody).not.toContain('await this.aiSpend.record(');
  });

  it('records the estimated output tokens, not the raw ones (#20 interaction)', () => {
    // The estimate is applied to `usage.outputTokens` in place before both the
    // spend record and this row, so an aborted stream is not written to the
    // dashboard as zero output either.
    const applyAt = innerBody.indexOf('estimateOutputTokensFromChars(');
    const rowAt = innerBody.indexOf('this.persistUsageRow({');
    expect(applyAt).toBeGreaterThan(-1);
    expect(rowAt).toBeGreaterThan(applyAt);
  });

  it('is gated so a site with no reading identity writes nothing', () => {
    // Chat and fortune stream through other machinery and have no readingId;
    // an unattributable row would be indistinguishable from the orphaned
    // load-test residue #17 is about.
    expect(innerBody).toContain('if (attribution?.readingType || attribution?.readingId)');
  });

  it('logUsage still writes its row through the SAME helper', () => {
    // The extraction must not have left the non-streaming path writing
    // directly, or the two would drift.
    const logUsageAt = SRC.indexOf('private async logUsage(');
    const helperAt = SRC.indexOf('private async persistUsageRow(');
    expect(logUsageAt).toBeGreaterThan(-1);
    expect(SRC.slice(logUsageAt, helperAt)).toContain('this.persistUsageRow({');
    // ...and nobody bypasses it with a raw create.
    expect((SRC.match(/prisma\.aIUsageLog\.create\(/g) ?? []).length).toBe(1);
  });

  describe('attribution carries the reading identity', () => {
    it.each([
      ['call1', 'stream:${readingType}:call1'],
      ['call2', 'stream:${readingType}:call2'],
    ])('reading %s passes readingId and readingType', (_n, route) => {
      const at = SRC.indexOf(route);
      expect(at).toBeGreaterThan(-1);
      const window = SRC.slice(at, at + 220);
      expect(window).toContain('readingId: opts.readingId');
      expect(window).toContain('readingType');
    });

    it.each(['stream:COMPATIBILITY:call1', 'stream:COMPATIBILITY:call2'])(
      '%s passes a readingType', (route) => {
        const at = SRC.indexOf(route);
        expect(at).toBeGreaterThan(-1);
        expect(SRC.slice(at, at + 220)).toContain('readingType: ReadingType.COMPATIBILITY');
      },
    );
  });
});
