import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { AI_SPEND_CAP_CODE } from '../src/ai/ai-spend.service';
import { isSpendCapError } from '../src/fortune/fortune-snapshot.helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

const readSource = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const countOf = (src: string, re: RegExp) => (src.match(re) || []).length;

/**
 * S2 follow-up — how a spend cap DEGRADES, as opposed to whether it fires.
 *
 * The breaker working and the breaker being usable are different properties.
 * Two audits found the same shape on both interactive surfaces: the cap threw,
 * and the surrounding error handling then described it as something else.
 *
 *   - chat-stream routed it through `_refundOnError`, which hard-codes
 *     `AI_CALL_FAILED` + «AI 暫時無法回答，已退還點數». That code is not in
 *     `LOCK_ERROR_CODES`, so the composer stayed enabled at 30/min — the breaker
 *     would have saved Anthropic tokens while RAISING our own DB and engine
 *     load, and polluted the AI-failure alerting signal on the way.
 *   - fortune counted it as an AI failure for that chart, arming a 24h circuit
 *     breaker. The cap clears at Taipei midnight; the backoff does not. For a
 *     DAY scope the anchor date passes first, so a two-hour global budget event
 *     permanently blanked that user's daily fortune.
 */

const capError = () =>
  new ServiceUnavailableException({
    code: AI_SPEND_CAP_CODE,
    message: '系統今日的 AI 用量已達上限，請稍後再試。已生成的內容仍可查看。',
  });

describe('isSpendCapError — the predicate both fixes hang off', () => {
  it('recognises the cap', () => {
    expect(isSpendCapError(capError())).toBe(true);
  });

  it('does NOT swallow other HttpExceptions', () => {
    // Over-matching would be worse than the bug: a genuine failure would stop
    // arming the circuit breaker that exists to stop retry storms.
    expect(
      isSpendCapError(new ServiceUnavailableException({ code: 'AI_CALL_FAILED' })),
    ).toBe(false);
    expect(isSpendCapError(new HttpException('plain string body', 503))).toBe(false);
  });

  it('does not match ordinary errors', () => {
    expect(isSpendCapError(new Error('socket hang up'))).toBe(false);
    expect(isSpendCapError(undefined)).toBe(false);
    expect(isSpendCapError({ code: AI_SPEND_CAP_CODE })).toBe(false); // not an HttpException
  });
});

describe('the guards, against the REAL services', () => {
  // ⚠️ The first version of this file re-implemented both branches locally and
  // asserted against its own copy — so all SEVEN production guards (3 fortune
  // sync, 3 fortune stream, 1 chat stream) could be deleted with the suite
  // green. The audit demonstrated every one. These read the shipped source:
  // the guards live inside deep private catch blocks that cannot be driven
  // without booting the whole generation stack, and a COUNT is what a partial
  // deletion — the realistic mistake — actually changes.

  // ⚠️ The guard is now `isSelfRefusal`, which covers the cap AND its two
  // siblings. A later audit found the cap was the only one of the three these
  // catches recognised: a quota refusal and — far worse — an `AI_BUSY` thrown
  // after three seconds of queue pressure both fell through to the degrade
  // path and armed the same 24-hour breaker.
  it('all three fortune sync paths guard every refusal we issue', () => {
    const src = readSource('src/fortune/fortune.service.ts');
    expect(countOf(src, /isSelfRefusal\(err\)/g)).toBe(3); // day, month, year
  });

  it('all three fortune stream paths guard every refusal we issue', () => {
    const src = readSource('src/fortune/fortune-stream.service.ts');
    expect(countOf(src, /isSelfRefusal\(err\)/g)).toBe(3);
  });

  it('the fortune sync guard RETHROWS rather than persisting a failure', () => {
    // Persisting is what armed the 24h breaker and blanked the day.
    const src = readSource('src/fortune/fortune.service.ts');
    expect(src).toMatch(/if \(isSelfRefusal\(err\)\) throw err;/);
  });

  it('the fortune stream guard returns BEFORE _persistAIFailure', () => {
    const src = readSource('src/fortune/fortune-stream.service.ts');
    const guard = src.indexOf('isSelfRefusal(err)');
    const persist = src.indexOf('_persistAIFailure', guard);
    expect(guard).toBeGreaterThan(-1);
    expect(persist).toBeGreaterThan(guard);
  });

  it('every fortune stream cap branch tries LKG before emitting an error', () => {
    // ⚠️ The fix this pins. The cap guard returns before `_persistAIFailure` —
    // right, because a global budget event must not arm this chart's 24h
    // breaker — but that method was ALSO where the LKG row came from, so the
    // early return skipped `_serveLkg` too. A spend cap is the highest-volume
    // AI failure the system will ever see, and it became the one case that
    // never served a preserved narrative: a user who read their 日運 yesterday
    // got an error banner instead.
    const src = readSource('src/fortune/fortune-stream.service.ts');
    expect(countOf(src, /_readLkgRow\(/g)).toBe(4); // 1 definition + 3 cap branches

    // …and each read must be USED, not just performed.
    expect(countOf(src, /if \(this\._serveLkg\(response, lkgRow, '(day|month|year)'\)\) return;/g)).toBe(3);
  });

  it.each(['DAY', 'MONTH', 'YEAR'])(
    'the %s cap branch reads LKG BEFORE emitting the error',
    (scope) => {
      // ⚠️ Per BRANCH, not whole-file. The first version used a bare
      // `indexOf`, so inverting the DAY branch still passed — the search
      // simply found the MONTH occurrence further down. And the inversion is a
      // real regression: `_emitError` calls `response.end()`, so the user gets
      // the error banner and `_serveLkg` then falls into its `writableEnded`
      // guard — exactly the bug this was written to prevent.
      const src = readSource('src/fortune/fortune-stream.service.ts');
      const branch = src.indexOf(`FortuneScope.${scope}, anchorDate`);
      expect(branch).toBeGreaterThan(-1);
      // Slice from the read to the next branch, so the assertion cannot borrow
      // evidence from a sibling.
      const slice = src.slice(branch, branch + 900);
      const serve = slice.indexOf('_serveLkg(response, lkgRow');
      const emit = slice.indexOf("refusalBody?.code ?? 'AI_UNAVAILABLE'");
      expect(serve).toBeGreaterThan(-1);
      expect(emit).toBeGreaterThan(serve);
    },
  );

  it('each cap branch serves LKG under its OWN scope label', () => {
    // A DAY branch serving with the 'month' label survived the first version.
    const src = readSource('src/fortune/fortune-stream.service.ts');
    for (const [scope, label] of [['DAY', 'day'], ['MONTH', 'month'], ['YEAR', 'year']]) {
      const branch = src.indexOf(`FortuneScope.${scope}, anchorDate`);
      const slice = src.slice(branch, branch + 300);
      expect(slice).toContain(`_serveLkg(response, lkgRow, '${label}')`);
    }
  });

  it('_readLkgRow actually returns the row it reads', () => {
    // Hard-returning null kills LKG-on-cap entirely and survived every
    // lexical assertion, because the calls were all still present.
    const body = readSource('src/fortune/fortune-stream.service.ts');
    const fn = body.slice(body.indexOf('private async _readLkgRow'), body.indexOf('private _serveLkg'));
    expect(fn).toMatch(/return await this\.prisma\.dailyFortuneSnapshot\.findUnique/);
    // …and does not short-circuit to null before ever querying.
    expect(fn.indexOf('findUnique')).toBeLessThan(fn.indexOf('return null'));
  });

  it('the LKG read does NOT persist a failure', () => {
    // The whole point of splitting it out of `_persistAIFailure`: reading the
    // row must not arm the breaker.
    const src = readSource('src/fortune/fortune-stream.service.ts');
    const body = src.slice(src.indexOf('private async _readLkgRow'), src.indexOf('private _serveLkg'));
    expect(body).toMatch(/findUnique/);
    expect(body).not.toMatch(/upsert|update|create|aiFailureCount/);
  });

  it('chat-stream branches on HttpException before reaching _refundOnError', () => {
    // `_refundOnError` hard-codes AI_CALL_FAILED; reaching it with a typed
    // refusal is the bug, so the branch has to come first.
    const src = readSource('src/chat/chat-stream.service.ts');
    const guard = src.lastIndexOf('if (err instanceof HttpException)');
    const refund = src.indexOf('_refundOnError(response, sessionId, userId, userMessageId, reason)');
    expect(guard).toBeGreaterThan(-1);
    expect(refund).toBeGreaterThan(guard);
  });
});

describe('chat-stream — a cap reports itself, not AI_CALL_FAILED', () => {
  // The catch is deep inside `streamMessage`, so this exercises the branch's
  // logic against the same shape the handler sees, and asserts the two things
  // that were wrong: the emitted code, and that the refund still happens.
  function handle(err: unknown, emit: jest.Mock, refund: jest.Mock) {
    if (err instanceof HttpException) {
      const body = err.getResponse() as { code?: string; message?: string };
      const code = body?.code ?? 'FORBIDDEN';
      refund(`refused: ${code}`);
      emit(code, body?.message ?? err.message);
      return;
    }
    refund('ai-stream-failed');
    emit('AI_CALL_FAILED', 'AI 暫時無法回答，已退還點數');
  }

  it('emits AI_SPEND_CAP with the real message', () => {
    const emit = jest.fn();
    const refund = jest.fn();
    handle(capError(), emit, refund);
    expect(emit).toHaveBeenCalledWith(AI_SPEND_CAP_CODE, expect.stringContaining('已達上限'));
    expect(emit).not.toHaveBeenCalledWith('AI_CALL_FAILED', expect.anything());
  });

  it('still refunds the message', () => {
    // The user must not pay for a turn we refused to generate.
    const refund = jest.fn();
    handle(capError(), jest.fn(), refund);
    expect(refund).toHaveBeenCalledWith(`refused: ${AI_SPEND_CAP_CODE}`);
  });

  it('leaves a genuine AI failure reported as AI_CALL_FAILED', () => {
    const emit = jest.fn();
    handle(new Error('socket hang up'), emit, jest.fn());
    expect(emit).toHaveBeenCalledWith('AI_CALL_FAILED', expect.any(String));
  });
});

describe('fortune — a cap must not arm the 24h circuit breaker', () => {
  // Mirrors the guard now at the head of each fortune catch.
  function syncCatch(err: unknown): 'rethrown' | 'persisted-as-ai-failure' {
    if (isSpendCapError(err)) throw err;
    return 'persisted-as-ai-failure';
  }

  it('rethrows the cap instead of persisting a failed snapshot', () => {
    expect(() => syncCatch(capError())).toThrow(ServiceUnavailableException);
  });

  it('still degrades gracefully for a real AI failure', () => {
    // The LKG/engine-only behaviour must survive — this fix must not turn every
    // provider blip into a 503.
    expect(syncCatch(new Error('anthropic 529'))).toBe('persisted-as-ai-failure');
  });
});
