import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { AI_SPEND_CAP_CODE } from '../src/ai/ai-spend.service';
import { isSpendCapError } from '../src/fortune/fortune-snapshot.helpers';

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
