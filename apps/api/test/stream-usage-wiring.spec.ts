import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatAiCallLog } from '../src/ai/ai-call-log';

/**
 * #20 wiring — the estimator has to be CALLED, at every site that meters a
 * stream.
 *
 * This repo's most reliable bug shape is a well-covered helper behind untested
 * wiring: `stream-usage.ts` itself was thoroughly tested while four of five
 * call sites read usage only from `finalMessage()`, which an abort never
 * reaches. Unit tests on the helper cannot see that, so the invariant is
 * asserted against the SOURCE.
 */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('#20 — the abort estimate is wired at every metering site', () => {
  const STREAM_SITES = [
    'src/chat/chat-stream.service.ts',
    'src/fortune/fortune-stream.service.ts',
  ];

  it.each(STREAM_SITES)('%s finalizes before EVERY hasUsage gate', (file) => {
    const src = read(file);
    const gates = src.split('if (hasUsage(streamUsage)) {');
    expect(gates.length).toBeGreaterThan(1); // the site still meters at all
    // Every gate must be immediately preceded by a finalize.
    for (const before of gates.slice(0, -1)) {
      expect(before.trimEnd().endsWith('finalizeStreamUsage(streamUsage);')).toBe(true);
    }
  });

  it.each(STREAM_SITES)('%s passes the estimated flag to record()', (file) => {
    const src = read(file);
    const uses = (src.match(/usage: streamUsage,/g) ?? []).length;
    const flags = (src.match(/outputTokensEstimated: streamUsage\.outputTokensEstimated,/g) ?? []).length;
    expect(uses).toBeGreaterThan(0);
    // An estimate indistinguishable from a measurement in the ledger is only
    // half the fix — ops must be able to size how much spend is inferred.
    expect(flags).toBe(uses);
  });

  it('the READING path applies the estimate before recording', () => {
    // The path #20's evidence came from, and the one with its own ad-hoc usage
    // object rather than StreamUsage.
    //
    // ⚠️ Scoped to `_streamProviderInner`'s BODY. A first version compared
    // `indexOf(estimate)` against `indexOf(record, fromEstimate)` over the whole
    // file, which searches FORWARD and so matched an unrelated `record(` call
    // further down — it passed with the estimate moved after the record, which
    // is the exact defect it was written to catch.
    const src = read('src/ai/ai.service.ts');
    const start = src.indexOf('*_streamProviderInner');
    const end = src.indexOf('// ---- Claude ----', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);

    const applyAt = body.indexOf('estimateOutputTokensFromChars(usage.outputTextChars');
    const recordAt = body.indexOf('void this.aiSpend.record({');
    expect(applyAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(-1);
    expect(body).toContain('usage.outputTokensEstimated = true;');
    // An estimate applied after the record books the un-estimated figure.
    expect(applyAt).toBeLessThan(recordAt);
  });

  it.each(['streamClaude', 'streamGPT', 'streamGemini'])(
    '%s counts the streamed characters', (fn) => {
      // ⚠️ All THREE, not just Claude. A line audit found GPT and Gemini
      // yielding text without counting it, so an abort on a FALLBACK provider
      // still booked zero output — and the fallback chain is used precisely
      // when things are going wrong, i.e. when aborts are most likely.
      const src = read('src/ai/ai.service.ts');
      const start = src.indexOf(`*${fn}(`);
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf('\n  }\n', start));
      expect(body).toContain('usageOut.outputTextChars = (usageOut.outputTextChars ?? 0)');
    },
  );

  it('the AI-CALL line carries outEst, always — including false', () => {
    // A field that appears only in the unusual case cannot be filtered on.
    const line = formatAiCallLog({
      route: 'r', provider: 'CLAUDE', model: 'm', ms: 1,
      inTok: 1, outTok: 2, cacheReadTok: 0, cacheWriteTok: 0,
      costUsd: 0.1, userIdHash: null, rlOutRemaining: null, rlOutReset: null,
    });
    expect(JSON.parse(line.replace('AI-CALL ', ''))).toMatchObject({ outEst: false });

    const est = formatAiCallLog({
      route: 'r', provider: 'CLAUDE', model: 'm', ms: 1,
      inTok: 1, outTok: 2, cacheReadTok: 0, cacheWriteTok: 0,
      costUsd: 0.1, userIdHash: null, rlOutRemaining: null, rlOutReset: null,
      outTokEstimated: true,
    });
    expect(JSON.parse(est.replace('AI-CALL ', ''))).toMatchObject({ outEst: true });
  });
});
