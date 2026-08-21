import { HttpException } from '@nestjs/common';
import { QUOTA_EXCEEDED_CODE } from '../src/ai/quota.service';
import { AI_SPEND_CAP_CODE } from '../src/ai/ai-spend.service';
import { AI_BUSY_CODE } from '../src/ai/ai-governor.service';
import {
  isQuotaError,
  isSpendCapError,
  isAiBusyError,
  isSelfRefusal,
} from '../src/ai/typed-refusals';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const count = (s: string, re: RegExp) => (s.match(re) || []).length;
/** Comments must not count as code when asserting what happens between two calls. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * S1/S2/S4 — the WIRING, not the services.
 *
 * `quota.service.spec.ts` has 20 tests on the helper and every call site had
 * none: both specs that build a `BaziService` stubbed the quota inline and never
 * captured the mock, so deleting any of the five calls was green in jest AND in
 * CI. That is instance eleven of this project's recurring defect, and the audit
 * that found it also found the guard rule I added to prevent it had regressed to
 * a presence check.
 *
 * ⚠️ Several assertions below are on SOURCE ORDER rather than behaviour. That is
 * deliberate and not laziness: the bugs these lock are orderings — refund before
 * re-throw, quota before charge, LKG before error — and a behavioural test of an
 * ordering needs the whole service constructed, which is what made the original
 * call sites untested in the first place. Where the property is behavioural (the
 * predicates), it is tested behaviourally.
 */

describe('S4 wiring — every spend path consumes quota', () => {
  it('bazi.service guards all five spend paths', () => {
    // create (sync), stream/regenerate, compat stream, recalculate, generate-ai.
    expect(count(src('src/bazi/bazi.service.ts'), /quota\.consume\('reading'/g)).toBe(5);
  });

  it('fortune guards all six — three sync, three stream', () => {
    expect(count(src('src/fortune/fortune.service.ts'), /quota\.consume\('fortune'/g)).toBe(3);
    expect(count(src('src/fortune/fortune-stream.service.ts'), /quota\.consume\('fortune'/g)).toBe(3);
  });

  it('chat guards both surfaces', () => {
    expect(count(src('src/chat/chat.service.ts'), /quota\.consume\('chat'/g)).toBe(1);
    expect(count(src('src/chat/chat-stream.service.ts'), /quota\.consume\('chat'/g)).toBe(1);
  });

  it('the compat STREAM reveal consumes before the 3-credit charge', () => {
    const s = src('src/bazi/bazi.service.ts');
    const q = s.indexOf("quota.consume('reading', user.id)", s.indexOf('_setupComparisonStream'));
    const charge = s.indexOf('_chargeForReveal(user.id', q);
    expect(q).toBeGreaterThan(-1);
    expect(charge).toBeGreaterThan(q);
  });

  it('the compat NON-STREAM reveal refunds before it re-throws', () => {
    // The twin of the test above, and the one that was missing — which is how
    // the bug survived: `generateComparisonAI` charges 3 credits, and the
    // re-throw guard was added ABOVE the refund six lines below it. An
    // over-quota user lost 3 credits, got a 429, and kept `paidAt`, so the retry
    // the 429 invites was a free no-op returning nothing.
    const s = src('src/bazi/bazi.service.ts');
    const gen = s.indexOf('async generateComparisonAI');
    expect(gen).toBeGreaterThan(-1);
    const refund = s.indexOf("refundComparisonCredit(comparisonId, 'reveal-generate-failed')", gen);
    const rethrow = s.indexOf('if (isSelfRefusal(err)) throw err;', gen);
    expect(refund).toBeGreaterThan(-1);
    expect(rethrow).toBeGreaterThan(-1);
    expect(rethrow).toBeGreaterThan(refund);
  });
});

describe('S1/S2/S4 — the typed refusals', () => {
  const quota = new HttpException({ code: QUOTA_EXCEEDED_CODE, message: 'over' }, 429);
  const cap = new HttpException({ code: AI_SPEND_CAP_CODE, message: 'budget' }, 503);
  const busy = new HttpException({ code: AI_BUSY_CODE, message: 'busy' }, 503);

  it('each predicate matches only its own refusal', () => {
    expect([isQuotaError(quota), isQuotaError(cap), isQuotaError(busy)]).toEqual([true, false, false]);
    expect([isSpendCapError(quota), isSpendCapError(cap), isSpendCapError(busy)]).toEqual([false, true, false]);
    expect([isAiBusyError(quota), isAiBusyError(cap), isAiBusyError(busy)]).toEqual([false, false, true]);
  });

  it('isSelfRefusal matches all three and nothing else', () => {
    expect([quota, cap, busy].every(isSelfRefusal)).toBe(true);
    // Deliberately narrow — over-matching would stop the degrade catches doing
    // their real job, which is absorbing genuine AI failures so the user still
    // gets their chart.
    expect(isSelfRefusal(new Error('anthropic 429'))).toBe(false);
    expect(isSelfRefusal(new HttpException('string body', 429))).toBe(false);
    expect(isSelfRefusal(new HttpException({ code: 'SOMETHING_ELSE' }, 503))).toBe(false);
    expect(isSelfRefusal(undefined)).toBe(false);
  });
});

describe('S1/S2/S4 — no degrade path swallows a refusal we issued', () => {
  it('every degrade catch guards all three, not a hand-picked subset', () => {
    // ⚠️ Why `isSelfRefusal` and not three enumerated guards: each site listed
    // whichever subset its author knew about, so `AI_BUSY` — the cheapest of the
    // three to trigger, at three seconds of queue pressure — was guarded
    // NOWHERE, and it arms a 24-hour fortune breaker.
    for (const [file, n] of [
      ['src/bazi/bazi.service.ts', 3],
      ['src/fortune/fortune.service.ts', 3],
    ] as const) {
      expect(count(src(file), /if \(isSelfRefusal\(err\)\) throw err;/g)).toBe(n);
    }
    // The stream paths return an SSE frame instead of throwing.
    expect(count(src('src/fortune/fortune-stream.service.ts'), /if \(isSelfRefusal\(err\)\) [{]/g)).toBe(3);
  });

  it('the provider failover loop does not retry them', () => {
    // `isRetryableError` refuses to retry AI_BUSY/AI_SPEND_CAP, but that governs
    // the INNER loop only; the outer per-provider loop caught everything and
    // tried the next provider, so one request queued once per provider and the
    // typed 503 was finally rethrown as a plain Error with no code.
    expect(count(src('src/ai/ai.service.ts'), /if \(isSelfRefusal\(err\)\) throw err;/g)).toBe(6);
  });

  it('the old per-code guards are gone, so no site can drift back to a subset', () => {
    for (const file of [
      'src/bazi/bazi.service.ts',
      'src/fortune/fortune.service.ts',
      'src/fortune/fortune-stream.service.ts',
    ]) {
      expect(src(file)).not.toMatch(/if \(isQuotaError\(err\)\) throw err;/);
      expect(src(file)).not.toMatch(/if \(isSpendCapError\(err\)\) [{t]/);
    }
  });
});

describe('S2 before S4 — a refusal we issue must not spend the daily allowance', () => {
  // Quota was consumed first everywhere, so a global budget event — which
  // refuses EVERY user at once — let one person burn their whole day's
  // allowance on 503s and stay locked out for the rest of the Taipei day after
  // the budget was raised. One incident became a day-long per-user outage,
  // contradicting QuotaService's own promise that "a request we refuse
  // ourselves before spending anything never reaches `consume`".
  const SITES = [
    ['src/bazi/bazi.service.ts', 5],
    ['src/fortune/fortune.service.ts', 3],
    ['src/fortune/fortune-stream.service.ts', 3],
    ['src/chat/chat.service.ts', 1],
    ['src/chat/chat-stream.service.ts', 1],
  ] as const;

  it.each(SITES)('%s checks the cap before every quota consume', (file, n) => {
    const s = src(file);
    let from = 0;
    let checked = 0;
    for (;;) {
      const q = s.indexOf('this.quota.consume(', from);
      if (q === -1) break;
      const cap = s.lastIndexOf('this.aiSpend.assertUnderCap(', q);
      expect(cap).toBeGreaterThan(-1);

      // ⚠️ The property is not "few lines apart" — it is that nothing which
      // SPENDS or CHARGES happens in between. A line budget was the first
      // version and it broke the moment the correct fix (slot acquisition
      // between the two) landed, which is a test dictating shape rather than
      // behaviour.
      const between = stripComments(s.slice(cap, q));
      expect(between).not.toContain('this.quota.consume(');
      const awaited = [...between.matchAll(/await this\.([A-Za-z0-9_.]+)\(/g)].map((m) => m[1]);
      const ALLOWED = new Set([
        // Acquiring a slot between the cap and the quota is the correct order:
        // global budget, then capacity, then this user's share.
        'aiGovernor.acquire',
        'aiGovernor.run',
        'aiGovernor.runGenerator',
      ]);
      expect(awaited.filter((a) => !ALLOWED.has(a))).toEqual([]);
      checked += 1;
      from = q + 1;
    }
    expect(checked).toBe(n);
  });

  it('every stream-path cap check can still reach the LKG fallback', () => {
    // ⚠️ The regression this locks, found by audit: hoisting the cap check up
    // into the CALLER did order it before the quota — and threw into a catch
    // that only emits an error, stranding the last-known-good narrative the
    // inner method serves. A budget event would have replaced "yesterday's
    // reading" with an error banner on all three scopes, defeating LKG for one
    // of the two failures its own comment names as its primary use.
    const s = src('src/fortune/fortune-stream.service.ts');
    const caps = [...s.matchAll(/assertUnderCap\('fortune:stream-(daily|monthly|yearly)'\)/g)];
    expect(caps).toHaveLength(3);
    for (const m of caps) {
      // From the check to the end of its method, the refusal must be caught and
      // offered the preserved narrative.
      const rest = s.slice(m.index ?? 0, (m.index ?? 0) + 6000);
      expect(rest).toContain('isSelfRefusal(err)');
      expect(rest).toContain('_serveLkg(response, lkgRow');
    }
  });

  it('the compat reveal checks the cap AFTER the shared-cache read', () => {
    // The opposite of the obvious placement, and the audit caught it: hoisting
    // the check above `_chargeForReveal` also put it above the global AI-cache
    // read, so a budget event declined reveals that would have been served for
    // $0. `assertUnderCap` promises cached reads keep working. The
    // charge-then-refund round trip on a genuine miss is the cheaper mistake —
    // and the refund ordering is locked by its own test above.
    const s = src('src/bazi/bazi.service.ts');
    const gen = s.indexOf('async generateComparisonAI');
    const cache = s.indexOf('getCachedInterpretation(', gen);
    const cap = s.indexOf("assertUnderCap('compat:reveal-generate')", gen);
    expect(cache).toBeGreaterThan(-1);
    expect(cap).toBeGreaterThan(cache);
  });

  it('the LLM judge consults the cap it already counts toward', () => {
    // It records spend, so it counts TOWARD the cap while ignoring it — during
    // a budget event the only thing still calling the provider would have been
    // our own QA sampler.
    expect(src('src/chat/chat-validators.service.ts')).toContain(
      "assertUnderCap('chat:llm-judge')",
    );
  });
});
