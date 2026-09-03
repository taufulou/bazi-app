import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #8 — the provider's timeout must not be spent on QUEUE WAIT.
 *
 * `AI_CALL_TIMEOUT_MS` / `AI_STREAM_TIMEOUT_MS` bound the upstream call. Arming
 * the abort BEFORE taking an S1 slot charges up to `QUEUE_TIMEOUT_MS` (15s for
 * the `reading` pool) against that budget, and under load turns backpressure
 * into failed PAID readings instead of a fast, retryable `AI_BUSY`.
 *
 * ⚠️ Sizing, so nobody over-claims this later: the NON-streaming path was fixed
 * earlier (`a56dcd9`) and is where the measured evidence came from — 26 calls
 * hitting exactly 60.000s, a 25% cut at that budget. The streaming path still
 * armed early, but at a 300s budget the worst case is ~5%. Real, bounded, and
 * worth making uniform rather than dramatic.
 *
 * Safe to move because queue wait is SEPARATELY bounded: `acquire` rejects with
 * AI_BUSY after `QUEUE_TIMEOUT_MS`, so a slow queue cannot become an unbounded
 * hang.
 */
const SRC = readFileSync(join(__dirname, '..', 'src/ai/ai.service.ts'), 'utf8');
const GOV = readFileSync(join(__dirname, '..', 'src/ai/ai-governor.service.ts'), 'utf8');

describe('#8 — abort timeouts are armed after the S1 slot is held', () => {
  it('the premise holds: queue wait is bounded, so moving the clock cannot hang', () => {
    // If `acquire` ever waited forever, arming later would replace budget
    // erosion with a request that never times out at all — strictly worse.
    expect(GOV).toContain('QUEUE_TIMEOUT_MS');
    expect(GOV).toMatch(/reading:\s*15_000/);
    expect(GOV).toContain('AI_BUSY_CODE');
  });

  it('runGenerator acquires BEFORE invoking the factory — what makes the hook valid', () => {
    const body = GOV.slice(GOV.indexOf('async *runGenerator'), GOV.indexOf('async *runGenerator') + 400);
    const acquireAt = body.indexOf('await this.acquire(');
    const yieldAt = body.indexOf('yield* gen()');
    expect(acquireAt).toBeGreaterThan(-1);
    expect(yieldAt).toBeGreaterThan(acquireAt);
  });

  it('_streamProviderInner invokes the hook, and does so before timing the call', () => {
    const start = SRC.indexOf('*_streamProviderInner');
    const body = SRC.slice(start, SRC.indexOf('// ---- Claude ----', start));
    const hookAt = body.indexOf('onSlotAcquired?.()');
    const clockAt = body.indexOf('const aiStartedAt = Date.now()');
    expect(hookAt).toBeGreaterThan(-1);
    expect(clockAt).toBeGreaterThan(hookAt);
  });

  it('a throwing hook cannot take down the generation', () => {
    const start = SRC.indexOf('*_streamProviderInner');
    const body = SRC.slice(start, SRC.indexOf('// ---- Claude ----', start));
    // Caller timer bookkeeping is not worth losing a paid reading over.
    expect(body).toMatch(/try \{\s*\n\s*onSlotAcquired\?\.\(\);\s*\n\s*\} catch/);
  });

  describe('every streaming call site arms through the hook, not inline', () => {
    // The property: `setTimeout(... .abort(), timeoutMs)` must live inside an
    // arming function passed to streamProvider, never on the straight-line path
    // before it.
    it.each([
      ['reading call1', 'armCall1Timeout'],
      ['reading call2', 'armCall2Timeout'],
      ['compat call1', 'armCompatCall1'],
      ['compat call2', 'armCompatCall2'],
    ])('%s passes an arming function', (_n, fn) => {
      // Declared...
      expect(SRC).toContain(`const ${fn} = () => {`);
      // ...and actually handed to streamProvider.
      expect(SRC).toContain(`${fn},\n        `.trimEnd());
      expect(new RegExp(`${fn},`).test(SRC)).toBe(true);
    });

    it('EVERY abort timeout in the file is armed after a slot, by one of two shapes', () => {
      // The property is "armed after the slot is held", and there are two
      // legitimate ways to get it:
      //   (a) lexically inside `aiGovernor.run(...)` — the non-streaming site,
      //       fixed earlier in a56dcd9;
      //   (b) inside an `arm*` closure handed to `streamProvider` as
      //       `onSlotAcquired` — the streaming sites.
      // A new site that arms on the straight-line path matches neither and
      // fails here, rather than quietly eating 15s of its own budget.
      //
      // Line-based rather than a character window: the first version used
      // `slice(index - N)` and needed retuning twice (the non-streaming
      // callback opens with a long comment), and it flagged a DOC COMMENT that
      // merely quotes the pattern.
      const lines = SRC.split('\n');
      const isComment = (l: string) => /^\s*(\/\/|\*|\/\*)/.test(l);

      const offenders: string[] = [];
      let armed = 0;
      for (let i = 0; i < lines.length; i++) {
        if (isComment(lines[i]!) || !lines[i]!.includes('setTimeout(')) continue;
        // Does this timer abort something? Look at its callback body.
        if (!lines.slice(i, i + 6).join('\n').includes('.abort()')) continue;
        armed++;
        // Scan back for the nearest enclosing "after the slot" marker.
        let ok = false;
        for (let j = i; j >= Math.max(0, i - 60); j--) {
          const l = lines[j]!;
          if (isComment(l)) continue;
          if (/const arm[A-Za-z0-9]*\s*=\s*\(\)\s*=>\s*\{/.test(l) ||
              /this\.aiGovernor\.run\(/.test(l)) { ok = true; break; }
        }
        if (!ok) offenders.push(`line ${i + 1}: ${lines[i]!.trim()}`);
      }

      expect(armed).toBeGreaterThanOrEqual(5); // 4 streaming + 1 non-streaming
      expect(offenders).toEqual([]);
    });
  });

  it('cleanup tolerates a timeout that was never armed', () => {
    // A refusal at the S1 gate (AI_BUSY) or a budget break means the slot was
    // never held, so the handle stays undefined and clearTimeout must not run
    // on it.
    expect(SRC).toContain('if (call1Timeout !== undefined) {');
    expect(SRC).toContain('if (call2Timeout !== undefined) {');
  });
});
