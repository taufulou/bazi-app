import { HttpException } from '@nestjs/common';
import { isQuotaError, QUOTA_EXCEEDED_CODE } from '../src/ai/quota.service';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const count = (s: string, re: RegExp) => (s.match(re) || []).length;

/**
 * S4 — the WIRING, not the service.
 *
 * `quota.service.spec.ts` has 20 tests on the helper and every call site had
 * none: both specs that build a `BaziService` stubbed the quota inline and
 * never captured the mock, so deleting any of the five calls was green in jest
 * AND in CI. That is instance eleven of this project's recurring defect, and the
 * audit that found it also found the guard rule I added to prevent it had
 * regressed to a presence check.
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

  it('the compat reveal consumes BEFORE the 3-credit charge', () => {
    // Placed after it, an over-quota user was debited and had `paidAt` set,
    // and the throw had no refund path.
    const s = src('src/bazi/bazi.service.ts');
    const q = s.indexOf("quota.consume('reading', user.id)", s.indexOf('_setupComparisonStream'));
    const charge = s.indexOf('_chargeForReveal(user.id', q);
    expect(q).toBeGreaterThan(-1);
    expect(charge).toBeGreaterThan(q);
  });
});

describe('S4 wiring — a quota refusal is never reported as something else', () => {
  const quotaErr = new HttpException({ code: QUOTA_EXCEEDED_CODE, message: 'over' }, 429);

  it('isQuotaError matches only our own refusal', () => {
    expect(isQuotaError(quotaErr)).toBe(true);
    expect(isQuotaError(new HttpException({ code: 'AI_SPEND_CAP' }, 503))).toBe(false);
    expect(isQuotaError(new Error('anthropic 429'))).toBe(false);
    expect(isQuotaError(new HttpException('string body', 429))).toBe(false);
  });

  it('every catch that swallows AI failures re-throws it', () => {
    // Four catches converted the typed 429 into: a bare SSE string, HTTP 200
    // with an un-generated comparison, a 500, and — worst — an AI-failure that
    // arms a 24h breaker OUTLIVING the quota window that caused it.
    expect(count(src('src/bazi/bazi.service.ts'), /if \(isQuotaError\(err\)\) throw err;/g)).toBe(3);
    expect(count(src('src/fortune/fortune.service.ts'), /if \(isQuotaError\(err\)\) throw err;/g)).toBe(3);
  });

  it('the fortune guard sits beside its spend-cap sibling', () => {
    // Same catch, same reasoning; they must not drift apart.
    const s = src('src/fortune/fortune.service.ts');
    expect(count(s, /if \(isSpendCapError\(err\)\) throw err;/g)).toBe(3);
  });
});
