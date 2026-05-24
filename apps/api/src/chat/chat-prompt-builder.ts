/**
 * Chat prompt builder — assembles the system prompt + slim chat context +
 * doctrine injectors for the Anthropic call.
 *
 * **Phase 1.4 PRODUCTION**: imports `buildChatV1SystemPromptHeader()` from
 * prompts.ts which provides the verbatim ports + 10 few-shots + chat clauses.
 *
 * The cached system block is composed of:
 *   1. Production system prompt header (cached, ~3.5k tokens)
 *   2. Doctrine injectors (variable per chart, included in cache)
 *   3. Slim chat context as JSON (variable per chart, included in cache)
 *
 * The messages array contains:
 *   - Recent conversation history (filtered for failed/refunded msgs)
 *   - At turn 4+: synthetic <system-reminder> as user-role for re-grounding
 *   - The new user question
 */

import type { ReadingType } from '@prisma/client';
import {
  type ChatContext,
  interpolateFortuneV1Fields,
} from './chat-context.service';
import {
  buildChatV1SystemPromptHeader,
  buildChatV1SystemPromptForType,
} from '../ai/prompts';

export interface BuildPromptArgs {
  chatContext: ChatContext;
  recentMessages: { role: 'user' | 'assistant'; content: string }[];
  newUserMessage: string;
  /** Phase 2 — reading type drives per-type prompt routing (topic scope,
   *  refuse template, refuse few-shots). Optional for backward compat
   *  with any caller that doesn't yet thread it; defaults to LIFETIME
   *  (Phase 1 behavior). */
  readingType?: ReadingType;
  /** Section the user clicked the InlineAskCard from. METADATA only — does
   *  NOT filter the slim payload (per plan Issue 19). */
  sectionContextHint?: string;
  /** Layer 5: from session.messageCount >= 3 the server inserts a
   *  <system-reminder> as user-role msg before the new user question. */
  shouldInjectRegrounding: boolean;
}

export interface AnthropicMessageBlock {
  role: 'user' | 'assistant';
  content: string;
}

export interface BuiltPrompt {
  systemPromptText: string;
  messages: AnthropicMessageBlock[];
}

export function buildPrompt(args: BuildPromptArgs): BuiltPrompt {
  const {
    chatContext,
    recentMessages,
    newUserMessage,
    readingType,
    sectionContextHint,
    shouldInjectRegrounding,
  } = args;

  // Phase 2 / Phase Fortune — pick per-type prompt assembler when readingType
  // is one of the chat-enabled set; fall back to Phase 1 LIFETIME header
  // otherwise.
  //
  // ⚠️ CRITICAL — FORTUNE must be in this union. The line-audit caught a
  // bug where omitting 'FORTUNE' caused every FORTUNE chat session to fall
  // back to the GENERIC Phase 1 prompt header, silently dropping FORTUNE's
  // hybrid refuse policy, soft-trigger doctrine, folk-content prohibition,
  // refuse template, cross-sell lines, and F-1/F-2/F-3 few-shots. The
  // regression spec at the bottom of `prompts.fortune.spec.ts` (assembly
  // test) only verified `buildChatV1SystemPromptForType` directly — NOT
  // the path through `buildPrompt`. Belt + suspenders: keep this union
  // mirror-aligned with `buildChatV1SystemPromptForType`'s signature.
  const isChatEnabledType = (
    rt?: ReadingType,
  ): rt is 'LIFETIME' | 'LOVE' | 'CAREER' | 'ANNUAL' | 'COMPATIBILITY' | 'FORTUNE' =>
    rt === 'LIFETIME' ||
    rt === 'LOVE' ||
    rt === 'CAREER' ||
    rt === 'ANNUAL' ||
    rt === 'COMPATIBILITY' ||
    rt === 'FORTUNE';
  const promptHeader = isChatEnabledType(readingType)
    ? buildChatV1SystemPromptForType(readingType)
    : buildChatV1SystemPromptHeader();

  // Phase 2 (round-3 NEW#7) — `{crossSellPivotHint}` placeholder substitution
  // happens HERE in the service layer after `buildChatV1SystemPromptForType`
  // returns the template-with-placeholder. The hint is per-chart deterministic
  // (LOVE → top romance candidate; CAREER → top career year; ANNUAL → top
  // auspicious month). Null-fallback (round-3 NEW#10): when the engine helper
  // returned null, strip the «根據您…，{crossSellPivotHint}。您想了解…？»
  // sentence so we don't print «根據您…，null。」 OR (worse) leave the
  // literal `{crossSellPivotHint}` placeholder in the prompt for the AI
  // to copy verbatim.
  //
  // CAREER audit fix (2026-05-12): the strip is now scoped to JUST the
  // second sentence («根據您…，{X}。您想…？»). Earlier we stripped the
  // entire two-sentence «回到您的XX解讀——根據您…，{X}。您想…？» phrase,
  // but that:
  // - missed ANNUAL's «根據您今年的命盤資料» variant (hard-coded
  //   «您的命盤» wouldn't match)
  // - missed few-shot C-2's «回到 2027 對您事業的意義——根據您...」
  //   variant (preamble doesn't start «回到您的XX解讀——»)
  //
  // Matching just `根據您[^，]*，\{crossSellPivotHint\}。[^？]+？`:
  // - Tolerates ANNUAL's «根據您今年的命盤資料» phrasing
  // - Tolerates few-shot C-2/L-2-style variant preambles
  // - Preserves the reading-type word in the preceding «回到您的事業
  //   解讀——» sentence (more natural fallback than the old generic
  //   «回到您的解讀——»)
  // - Anchored on the `{crossSellPivotHint}` placeholder + trailing `？`
  //   so it can't over-strip into in-topic narrative
  // M2 (Phase 3 follow-up) — `crossSellPivotHint` now declared on the
  // ChatContext interface (chat-context.service.ts), so direct access
  // is type-safe. No duck-typing needed.
  const pivotHint = chatContext.crossSellPivotHint;
  const promptHeaderWithPivot = pivotHint
    ? promptHeader.replace(/\{crossSellPivotHint\}/g, pivotHint)
    : promptHeader.replace(
        /根據您[^，]*，\{crossSellPivotHint\}。[^？]+？/g,
        '您還有其他想了解的嗎？',
      );

  // Compose the cached system block: production prompt header + slim context + doctrine injectors
  const sections: string[] = [promptHeaderWithPivot];

  if (sectionContextHint) {
    sections.push(
      `\n[focusHint]: 用戶從「${sectionContextHint}」區塊發起此問題，請優先使用該區塊相關資料，但仍可引用其他區塊事實作交叉佐證`,
    );
  }

  // Doctrine injectors — pre-formatted Chinese sentences that AI must splice verbatim
  const injectors = chatContext.doctrineInjectors || {};
  const injectorBlocks = Object.entries(injectors)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([, v]) => v as string);

  if (injectorBlocks.length > 0) {
    sections.push('\n【教義旗標 — 必須引用以下文字作為主敘述基礎】\n');
    sections.push(injectorBlocks.join('\n\n'));
  }

  // Phase Fortune — day-pillar TRANSIENT doctrine injector (Issue 14).
  // Mirrors Phase 12g.6 Gap 2 pattern: pre-formats Chinese sentences for the
  // day's transient findings (傷官見官 valence / 比劫奪財 valence / 沖日支 /
  // 紅鸞 / 配偶星透干 / 官殺日) from `dailyFortune.dimensions[].signals[]`.
  // Anti-hallucination via deterministic phrasing — AI consumes verbatim.
  //
  // Only fires when readingType === 'FORTUNE' (FORTUNE-specific layer; for
  // other reading types `dailyFortune` is absent so the injector returns
  // null anyway, but the explicit gate keeps the cache key tight on the
  // shared injector pipeline).
  if (readingType === 'FORTUNE') {
    const fortuneInjector = interpolateFortuneV1Fields(chatContext);
    if (fortuneInjector) {
      sections.push('\n【今日流日教義事件 — 必須引用以下文字】\n');
      sections.push(fortuneInjector);
    }
  }

  // Slim chat context as JSON
  sections.push('\n【命盤資料】\n');
  sections.push('```json\n' + JSON.stringify(chatContext, null, 2) + '\n```');

  const systemPromptText = sections.join('\n');

  // Build messages array with optional regrounding
  const slice = ensureSliceEndsOnAssistantOrEmpty(recentMessages);
  const messages: AnthropicMessageBlock[] = [...slice];

  if (shouldInjectRegrounding) {
    // Layer 5.1: <system-reminder> injected as user-role msg
    const flagsBlock = formatRotatingDoctrineFlagsBlock(chatContext, newUserMessage);
    messages.push({
      role: 'user',
      content: `<system-reminder>
重新讀取以下命盤事實。前述對話僅作參考，回答必須以此處事實為依據。
${flagsBlock}
</system-reminder>`,
    });
  }

  messages.push({ role: 'user', content: newUserMessage });

  return { systemPromptText, messages };
}

/**
 * Slice prior conversation history. Anthropic requires alternating user/
 * assistant roles, so if the slice ends on a user role, drop the trailing
 * user message (it's the previous turn's question, already captured in the
 * next assistant reply that follows).
 */
function ensureSliceEndsOnAssistantOrEmpty(
  messages: AnthropicMessageBlock[],
): AnthropicMessageBlock[] {
  const filtered = [...messages];
  while (filtered.length > 0 && filtered[filtered.length - 1].role === 'user') {
    filtered.pop();
  }
  return filtered;
}

/**
 * Build the rotating doctrine-flags block for <system-reminder> injection.
 * Deterministic — same chart + same question = same block, for test
 * reproducibility (per Phase 1.4 plan Issue I).
 *
 * Selects (a) all flags with non-null injectors for THIS chart,
 *         (b) any flag whose Chinese name appears in the user's question.
 */
function formatRotatingDoctrineFlagsBlock(
  ctx: ChatContext,
  userMessage: string,
): string {
  // Phase 3 — COMPATIBILITY chat has dual-chart slim. Detect via presence
  // of chartA + chartB; collect doctrine injectors from both parties +
  // include compat-level cross-chart findings.
  // M2 (Phase 3 follow-up): `chartA`/`chartB` are now declared optional on
  // `ChatContext` — typed detection check replaces previous duck-typing.
  const isCompat = ctx.chartA != null && ctx.chartB != null;

  if (isCompat) {
    return formatCompatDoctrineFlagsBlock(ctx, userMessage);
  }

  const allInjectors = ctx.doctrineInjectors || {};
  const triggeredKeys: string[] = [];

  // Path (a): all triggered flags
  for (const [key, value] of Object.entries(allInjectors)) {
    if (value !== null && value !== undefined && value !== '') {
      triggeredKeys.push(key);
    }
  }

  // Path (b): flag-name in user message — defensive, matches Chinese substring
  const FLAG_KEYWORDS: Record<string, string[]> = {
    shangguanJianGuan: ['傷官見官', '傷官', '見官'],
    biJieDuoCai: ['比劫奪財', '奪財'],
    guanShaHunZa: ['官殺混雜', '官殺'],
    spousePalaceFrictions: ['配偶宮', '婚姻宮', '日支', '半刑', '六害'],
  };
  for (const [key, keywords] of Object.entries(FLAG_KEYWORDS)) {
    if (triggeredKeys.includes(key)) continue;
    const value = allInjectors[key];
    if (!value) continue;
    if (keywords.some((kw) => userMessage.includes(kw))) {
      triggeredKeys.push(key);
    }
  }

  if (triggeredKeys.length === 0) {
    // Fallback: include core favorability + strength as universal anchors.
    // M2 (Phase 3 follow-up): favorability/strength now optional on
    // ChatContext (since compat payloads don't set them at top level);
    // single-chart payloads always populate them so the `?? {}` fallback
    // is defensive-only.
    const fav = (ctx.favorability ?? {}) as Record<string, unknown>;
    const str = (ctx.strength ?? {}) as Record<string, unknown>;
    return [
      `用神=${fav.yongShen ?? '?'}`,
      `喜神=${fav.xiShen ?? '?'}`,
      `忌神=${fav.jiShen ?? '?'}`,
      `仇神=${fav.chouShen ?? '?'}`,
      `日主強度=${str.classification ?? '?'}`,
    ].join(' | ');
  }

  return triggeredKeys.map((k) => allInjectors[k] as string).join('\n\n');
}

/**
 * Phase 3 — re-grounding block for COMPATIBILITY chat. Pulls doctrine
 * injectors from both chartA and chartB, plus overall compat score/label.
 * The `<system-reminder>` block fires at turn 4+ to keep AI grounded.
 */
function formatCompatDoctrineFlagsBlock(
  ctx: ChatContext,
  userMessage: string,
): string {
  // M2 (Phase 3 follow-up) — typed access via ChatContext optional compat fields.
  const chartA = ctx.chartA ?? {};
  const chartB = ctx.chartB ?? {};
  const overallScore = ctx.overallScore;
  const adjustedScore = ctx.adjustedScore;
  const verbalLabel = ctx.verbalLabel;

  const lines: string[] = [];
  lines.push(`【合盤總分】${adjustedScore ?? overallScore ?? '?'} 分（${verbalLabel ?? '?'}）`);

  // Party A facts (favorability + strength)
  const favA = chartA.favorability as Record<string, unknown> | undefined;
  const strA = chartA.strength as Record<string, unknown> | undefined;
  lines.push(
    `【您 (A)】用神=${favA?.yongShen ?? '?'} / 忌神=${favA?.jiShen ?? '?'} / 強度=${strA?.classification ?? '?'}`,
  );

  // Party B facts
  const favB = chartB.favorability as Record<string, unknown> | undefined;
  const strB = chartB.strength as Record<string, unknown> | undefined;
  lines.push(
    `【對方 (B)】用神=${favB?.yongShen ?? '?'} / 忌神=${favB?.jiShen ?? '?'} / 強度=${strB?.classification ?? '?'}`,
  );

  // Doctrine injectors from both parties — collect triggered ones
  const injectorsA = (chartA.doctrineInjectors as Record<string, string | null>) || {};
  const injectorsB = (chartB.doctrineInjectors as Record<string, string | null>) || {};
  for (const [side, injs] of [['A', injectorsA], ['B', injectorsB]] as const) {
    for (const [key, value] of Object.entries(injs)) {
      if (value) {
        lines.push(`【${side} ${key}】\n${value}`);
      }
    }
  }

  // Cross-chart findings (Phase 12i 三刑/半刑/etc.)
  // M2 (Phase 3 follow-up) — typed access via ChatContext optional compat field.
  const crossFindings = ctx.crossChartFindings as
    | Array<Record<string, unknown>>
    | undefined;
  if (crossFindings && crossFindings.length > 0) {
    lines.push('【跨命盤教義】');
    for (const f of crossFindings) {
      lines.push(`- ${f.type}: ${f.narrativeHint ?? f.description ?? JSON.stringify(f)}`);
    }
  }

  return lines.join('\n');
}
