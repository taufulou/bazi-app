/**
 * Tier C — owned-cross-sell OUTPUT safety-net regression specs.
 *
 * `rewriteOwnedCrossSell` is the paraphrase-proof backstop: the prompt-level
 * replaceAll only catches exact-constant cross-sell occurrences, but refuse
 * few-shots / topic-scope clauses paraphrase the cross-sell line, so the AI can
 * still emit a "go-buy 《X》" pitch for a reading the user OWNS. This pass
 * rewrites any clause that mentions an OWNED reading NAME + a go-unlock verb
 * into the owned reword.
 *
 * Locks the staff-reviewed contract:
 * - All 8 real paraphrase variants (captured from the live prompt scan) rewrite.
 * - No double-punctuation (「。。」) — review MEDIUM-1.
 * - Idempotent f(f(x))===f(x) — the «(?<!已)解鎖» gate stops self-re-match.
 * - Unowned / empty-set / COMPAT (empty) → untouched.
 * - Verb-gate (not name-absence) protects the refuse opener — review LOW-1.
 * - Neutral mention (name, no verb) → untouched.
 */
import { ConfigService } from '@nestjs/config';
import { ChatValidatorsService } from './chat-validators.service';
import { CHAT_CROSS_SELL_OWNED_LINES } from '../ai/prompts';

const svc = new ChatValidatorsService({ get: () => undefined } as unknown as ConfigService);
const rw = (text: string, owned: string[]) =>
  svc.rewriteOwnedCrossSell(text, new Set(owned));

describe('Tier C — rewriteOwnedCrossSell (output safety-net)', () => {
  // The 8 real paraphrase variants from the comprehensive prompt scan + their target.
  const VARIANTS: Array<{ name: string; target: string; text: string }> = [
    { name: 'LOVE/DAY career', target: 'career', text: '建議您解鎖《八字事業詳批》獲取完整分析。' },
    { name: 'CAREER/DAY annual', target: 'annual', text: '《八字流年運勢》提供 12 個月分析。' },
    { name: 'ANNUAL/DAY lifetime', target: 'lifetime', text: '想了解整體命格、大運序列與一生趨勢，《八字終身運》提供完整解讀。' },
    { name: 'ANNUAL/DAY love', target: 'love', text: '《八字愛情姻緣》提供專屬分析。' },
    { name: 'FORTUNE/DAY annual', target: 'annual', text: '想看每月細節變化與當年事業節奏，《八字流年運勢》提供 12 個月詳細預測。' },
    { name: 'FORTUNE/MONTH annual', target: 'annual', text: '想看 12 個月詳細變化與全年事業節奏，《八字流年運勢》提供整年詳細預測。' },
    { name: 'FORTUNE/YEAR annual (topic-scope)', target: 'annual', text: '想看逐月細節，《八字流年運勢》提供 12 個月詳細預測。' },
    { name: 'FORTUNE/YEAR annual (Y-2)', target: 'annual', text: '想看逐月細節與當年沖刑害動態，《八字流年運勢》提供 12 個月詳細預測。' },
  ];

  describe('all 8 paraphrase variants rewrite to the owned line', () => {
    for (const v of VARIANTS) {
      it(`${v.name} → owned reword`, () => {
        const { text, rewritten } = rw(v.text, [v.target]);
        expect(rewritten).toBe(true);
        expect(text).toContain(CHAT_CROSS_SELL_OWNED_LINES[v.target]); // full owned line incl 。
        expect(text).toContain('您已解鎖');
        // the go-buy tail is gone
        expect(/提供完整解讀|提供完整分析|提供深入解讀|提供.{0,4}個月.{0,6}預測|提供 ?12 個月分析|提供整年詳細預測|提供專屬分析|獲取完整分析|可解鎖|建議您解鎖/.test(text)).toBe(false);
      });
    }
  });

  it('MEDIUM-1 — no double-punctuation in any rewritten output', () => {
    for (const v of VARIANTS) {
      const { text } = rw(v.text, [v.target]);
      expect(text).not.toContain('。。');
      expect(text).not.toContain('！。');
      expect(text).not.toContain('？。');
    }
  });

  it('idempotent — f(f(x)) === f(x) (the (?<!已)解鎖 gate stops self-re-match)', () => {
    for (const v of VARIANTS) {
      const once = rw(v.text, [v.target]).text;
      const twice = rw(once, [v.target]).text;
      expect(twice).toBe(once);
      // feeding an already-owned line is a no-op
      const ownedOnly = rw(CHAT_CROSS_SELL_OWNED_LINES[v.target], [v.target]);
      expect(ownedOnly.rewritten).toBe(false);
      expect(ownedOnly.text).toBe(CHAT_CROSS_SELL_OWNED_LINES[v.target]);
    }
  });

  it('unowned target → untouched (original go-buy preserved)', () => {
    const text = '想了解整體命格、大運序列與一生趨勢，《八字終身運》提供完整解讀。';
    const { text: out, rewritten } = rw(text, ['career']); // lifetime NOT owned
    expect(rewritten).toBe(false);
    expect(out).toBe(text);
  });

  it('empty owned-set (incl. COMPATIBILITY no-op) → untouched', () => {
    const text = '想了解整體命格…《八字終身運》提供完整解讀。';
    expect(rw(text, []).rewritten).toBe(false);
    expect(rw(text, []).text).toBe(text);
  });

  it('LOW-1 — verb-gate (not name-absence) protects the refuse opener', () => {
    // LOVE-chat refuse opener NAMES 《八字愛情姻緣》 (which IS in the map) but has
    // NO go-unlock verb (解讀≠解鎖, no 提供/獲取) → must be preserved even when love is OWNED.
    const opener =
      '謝謝您的提問。關於職場升遷的詳細分析，超出本《八字愛情姻緣》解讀的範圍——這需要結合命局事業格局的專業分析。';
    const { text, rewritten } = rw(opener, ['love']);
    expect(rewritten).toBe(false);
    expect(text).toBe(opener);
  });

  it('neutral mention (name, NO verb) → untouched', () => {
    const text = '根據《八字流年運勢》的資料，今年整體順遂。';
    const { text: out, rewritten } = rw(text, ['annual']);
    expect(rewritten).toBe(false);
    expect(out).toBe(text);
  });

  it('multi-clause refuse — only the go-buy cross-sell clause is rewritten; opener + pivot preserved', () => {
    const refuse =
      '謝謝您的提問。關於命格定性與終身格局的詳細分析，超出本《八字年運》解讀的範圍——這需要結合八字格局、大運序列等專業命局分析。' +
      '想了解整體命格、大運序列與一生趨勢，《八字終身運》提供完整解讀。' +
      '回到您今年的年運解讀——根據您今年命盤資料，丙午年（大吉，88分）。';
    const { text, rewritten } = rw(refuse, ['lifetime']);
    expect(rewritten).toBe(true);
    expect(text).toContain('超出本《八字年運》解讀的範圍'); // opener (current reading, no verb) preserved
    expect(text).toContain('回到您今年的年運解讀'); // pivot preserved
    expect(text).toContain(CHAT_CROSS_SELL_OWNED_LINES.lifetime); // cross-sell reworded
    expect(text).not.toContain('提供完整解讀');
    expect(text).not.toContain('。。');
  });
});
