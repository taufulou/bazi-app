/**
 * 時辰未知 (unknown birth hour) — Phase 2d regression lock for the chat
 * suppression gate in buildPrompt.
 *
 * Locks: the 【時辰未知 — 嚴格限制】 directive is prepended into the chat system
 * prompt ONLY when chatContext.hourKnown === false (strict). Hour-known /
 * undefined → not present → hour-known chat prompts unaffected.
 */

import { buildPrompt } from './chat-prompt-builder';
import type { ChatContext } from './chat-context.service';

const MARKER = '【時辰未知 — 嚴格限制';

function makeCtx(hourKnown?: boolean): ChatContext {
  return {
    hourKnown,
    chart: { fourPillars: { hour: { stem: '', branch: '' } } },
    doctrineInjectors: {},
    doctrineFlags: {},
  } as unknown as ChatContext;
}

function build(hourKnown?: boolean): string {
  return buildPrompt({
    chatContext: makeCtx(hourKnown),
    recentMessages: [],
    newUserMessage: '我的個性如何？',
    readingType: 'LIFETIME',
    shouldInjectRegrounding: false,
  }).systemPromptText;
}

describe('chat 時辰未知 suppression gate (buildPrompt)', () => {
  it('prepends the suppression directive when hourKnown === false', () => {
    const out = build(false);
    expect(out).toContain(MARKER);
    expect(out).toContain('禁止斷言「命中無某神煞」');
    expect(out).toContain('日後得知時辰，可另建新的命盤查看完整分析');
  });

  it('does NOT prepend when hourKnown === true', () => {
    expect(build(true)).not.toContain(MARKER);
  });

  it('does NOT prepend when hourKnown is undefined (hour-known chat unaffected)', () => {
    expect(build(undefined)).not.toContain(MARKER);
  });
});

// ── Phase 3c — COMPATIBILITY per-party directive (本人/對方/雙方) ──
// Compat chat is a dual-chart slim; per-party hourKnown rides inside
// chartA/chartB (NOT the top-level flag). Gated so a both-known compat
// never fires it.

function buildCompat(aUnknown: boolean, bUnknown: boolean): string {
  const ctx = {
    chartA: { hourKnown: !aUnknown, doctrineInjectors: {}, doctrineFlags: {} },
    chartB: { hourKnown: !bUnknown, doctrineInjectors: {}, doctrineFlags: {} },
    doctrineInjectors: {},
    doctrineFlags: {},
  } as unknown as ChatContext;
  return buildPrompt({
    chatContext: ctx,
    recentMessages: [],
    newUserMessage: '我們合不合？',
    readingType: 'COMPATIBILITY',
    shouldInjectRegrounding: false,
  }).systemPromptText;
}

describe('compat 時辰未知 per-party directive (buildPrompt)', () => {
  it('A unknown → 您（本人）', () => {
    const out = buildCompat(true, false);
    expect(out).toContain(MARKER);
    expect(out).toContain('本合盤中，您（本人）未提供出生時辰');
    expect(out).toContain('禁止斷言您（本人）「命中無某神煞」');
  });

  it('B unknown → 對方', () => {
    expect(buildCompat(false, true)).toContain('本合盤中，對方未提供出生時辰');
  });

  it('both unknown → 雙方', () => {
    expect(buildCompat(true, true)).toContain('本合盤中，雙方未提供出生時辰');
  });

  it('both known → no compat 時辰未知 directive', () => {
    expect(buildCompat(false, false)).not.toContain('本合盤中');
  });
});
