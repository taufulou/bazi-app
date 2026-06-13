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
