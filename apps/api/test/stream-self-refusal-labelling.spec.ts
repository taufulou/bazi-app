import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpException, HttpStatus } from '@nestjs/common';
import { selfRefusalMessage } from '../src/ai/typed-refusals';
import { AI_SPEND_CAP_CODE } from '../src/ai/ai-spend.service';
import { AI_BUSY_CODE } from '../src/ai/ai-governor.service';
import { QUOTA_EXCEEDED_CODE } from '../src/ai/quota.service';

/**
 * PR#71 F1+F2 — a refusal WE issued must be LABELLED as one.
 *
 * ⚠️ What this deliberately does NOT change: the money. Today an AI_BUSY with
 * nothing delivered already reaches `status='failed'` → refund → the row nulled
 * → a `final` event. Two earlier drafts of the fix overstated that and tried to
 * restructure it; the second would have overridden `call2Critical` and kept
 * Call-1-only content WITHOUT refunding — full price for half a reading on four
 * paid reading types. The status machine is untouched here on purpose.
 */
const SRC = readFileSync(join(__dirname, '..', 'src/ai/ai.service.ts'), 'utf8');
const refusal = (code: string) =>
  new HttpException({ code, message: 'x' }, HttpStatus.SERVICE_UNAVAILABLE);

describe('selfRefusalMessage', () => {
  it('does not tell a quota-exhausted user to try again shortly', () => {
    // The old single message sent them into a retry loop that cannot succeed.
    const m = selfRefusalMessage(refusal(QUOTA_EXCEEDED_CODE));
    expect(m).toMatch(/limit for today/i);
    expect(m).not.toMatch(/shortly/i);
  });

  it('distinguishes the platform budget from user quota', () => {
    const cap = selfRefusalMessage(refusal(AI_SPEND_CAP_CODE));
    expect(cap).not.toBe(selfRefusalMessage(refusal(QUOTA_EXCEEDED_CODE)));
    expect(cap).toMatch(/service/i);
  });

  it('keeps the busy copy for AI_BUSY, where it is accurate', () => {
    expect(selfRefusalMessage(refusal(AI_BUSY_CODE))).toMatch(/temporarily busy/i);
  });

  it('falls back to the busy copy for an ordinary AI failure', () => {
    // Preserves today's message for the non-refusal case.
    expect(selfRefusalMessage(new Error('provider exploded'))).toMatch(/temporarily busy/i);
  });
});

describe('_executeStreamV2Common — refusal capture', () => {
  const body = (() => {
    const start = SRC.indexOf('let selfRefusal: unknown;');
    return SRC.slice(start, SRC.indexOf('  private async _streamV2Call2Loop', start));
  })();

  it('CAPTURES the refusal rather than rethrowing it', () => {
    // ⚠️ Rethrowing escapes past `finally { subscriber.complete() }`, so the
    // Observable wrapper's `.catch()` would call `next()` on a stopped
    // subscriber — the user would be refunded and told NOTHING. Verified
    // empirically against this repo's rxjs during review.
    expect(body).toContain('if (isSelfRefusal(err)) selfRefusal ??= err;');
    expect(body).not.toMatch(/if \(isSelfRefusal\(err\)\) throw err;/);
  });

  it('leaves the status machine — and call2Critical — untouched', () => {
    // The regression a previous draft would have shipped: overriding
    // `call2Critical: true` (set for CAREER/LIFETIME/ANNUAL/DEFAULT) to keep
    // Call-1-only content without refunding.
    expect(body).toContain('cfg.call2Critical && call2Got === 0');
    expect(body).toContain("status = 'failed'");
  });

  it('labels the refund with the refusal, not ai-failed-', () => {
    expect(body).toContain('`self-refusal:${selfRefusalCode(selfRefusal)');
    expect(body).toContain('ai-failed-${readingType}');   // still there for real failures
  });

  it('exits the provider loop AFTER the Call 2 await, not from the Call 1 catch', () => {
    // Breaking inside the Call 1 catch jumps past `await call2Promise`, so its
    // token accounting and `call_complete` never run while its sections survive
    // by reference — accounting desyncs from content.
    const awaitAt = body.indexOf('const call2Result = await call2Promise;');
    const completeAt = body.indexOf("type: 'call_complete',", awaitAt);
    const breakAt = body.indexOf('if (selfRefusal !== undefined) break;');
    expect(awaitAt).toBeGreaterThan(-1);
    expect(breakAt).toBeGreaterThan(completeAt);
  });
});

describe('_streamV2Call2Loop — the refusal must travel as a VALUE', () => {
  const body = (() => {
    const start = SRC.indexOf('  private async _streamV2Call2Loop');
    return SRC.slice(start, start + 9000);
  })();

  it('RETURNS the refusal instead of throwing it', () => {
    // ⚠️ The call site does `.catch(() => null)`, so a throw here is swallowed
    // and the caller can never tell a refusal from a provider failure. A guard
    // added at the raise point with the swallow point untouched is a no-op.
    expect(body).toContain('refusal: err,');
    expect(body).toMatch(/if \(isSelfRefusal\(err\)\) \{\s*\n\s*return \{/);
  });

  it('the call-site .catch() is NOT what carries refusal state', () => {
    const at = SRC.indexOf('Call 2 loop failure provider=');
    const around = SRC.slice(at - 200, at + 300);
    expect(around).toContain('return null;');
    expect(around).not.toContain('refusal');
  });
});
