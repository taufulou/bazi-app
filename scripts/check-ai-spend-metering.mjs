#!/usr/bin/env node
/**
 * S1/S2/S4 CI guard — every AI provider call must be governed, metered and capped.
 *
 * WHY THIS EXISTS. Before S2 there were 15 provider call sites and only 6 were
 * metered: all of chat (including the LLM judge) and all of fortune called
 * Anthropic directly and wrote no usage row at all. The spend figure was
 * therefore blind to both interactive surfaces — and a breaker wired to the same
 * 6 sites would have been worse than no breaker, because it would have reported
 * a comfortable number while the unmetered half ran free.
 *
 * The rule is per FILE, not per call: a file that calls a provider must record
 * spend, consult the breaker, hold a concurrency slot, and spend the caller's
 * daily quota. Per-call proximity matching would be defeated by any helper
 * extraction, and the file-level rule is the one that survives refactoring.
 *
 * ⚠️ WHAT IT CANNOT DO. It is a lexical scan over code with comments and string
 * literals removed. It cannot prove the `record` call is on the same PATH as the
 * provider call — metering that only runs inside a `catch`, or behind a dead
 * `if (false)`, still satisfies the count. It cannot see a spender that reaches
 * AIService through a base class it extends. It catches the realistic mistake —
 * a new caller that never thought about spend — not a determined bypass.
 *
 * ⚠️ EVERY RULE CARRIES AN ID (`[R-xxx]`). `apps/api/test/ai-spend-guard.spec.ts`
 * asserts on those ids rather than on exit status, because an audit found the
 * partial-removal case passing while THREE unrelated rules carried it, and six
 * rules with no test at all. The ids make "which rule fired" checkable, and the
 * spec's coverage meta-test asserts every id below is exercised by some fixture.
 * If you add a rule, give it an id and add a case — the meta-test will fail
 * until you do.
 *
 * Run: `npm run guard:ai-spend`  ·  `--list-rules` prints the id registry.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootFlag = process.argv.indexOf('--root');
const ROOT =
  rootFlag !== -1 && process.argv[rootFlag + 1]
    ? process.argv[rootFlag + 1]
    : fileURLToPath(new URL('..', import.meta.url));

/**
 * Every rule this guard can emit. The spec asserts on these ids, and its
 * coverage meta-test fails if any id is never produced by a fixture.
 */
const RULES = {
  RECORDS_COUNT: 'at least one provider call is unmetered',
  SLOTS_COUNT: 'at least one provider call holds no concurrency slot',
  CAPS_COUNT: 'at least one provider call skips the breaker',
  RECORDS_PRESENT: 'file calls a provider and never records spend',
  BREAKER_PRESENT: 'file calls a provider and never consults the breaker',
  QUOTA_COUNT: 'provider calls outnumber per-user quota consumes',
  SLOT_LEAK: 'acquire() without a matching releaseSlot()',
  DELEGATE_NO_QUOTA: 'delegates to AIService with no per-user quota',
  DELEGATE_RATCHET: 'a pinned quota-consume count has dropped',
  IMPORT_UNMETERED: 'imports a provider SDK with no spend controls at all',
  EXEMPT_STALE_QUOTA: 'a QUOTA_EXEMPT entry no longer reaches AI',
  EXEMPT_STALE_BREAKER: 'a BREAKER_EXEMPT entry no longer calls a provider',
  EXEMPT_MISSING: 'an exempt or watched file is missing',
  TRIGGER_USERS: 'users.service calls a spending AIService method',
  TRIGGER_CHOKEPOINT: "ai.service.ts's provider-call count changed",
  CHOKEPOINT_UNRECORDED: 'a choke-point call site with no matching logUsage',
  TRIGGER_CLIENT_FACTORY: 'a client-factory file started calling a provider',
};

if (process.argv.includes('--list-rules')) {
  console.log(Object.keys(RULES).join('\n'));
  process.exit(0);
}

/**
 * Deliberately broad, and identical to the sibling engine-caller guard. That
 * guard's own history is the argument: its first version scanned three `src`
 * directories and missed `middleware.ts`, `prisma/seed.ts`, `scripts/` and
 * `e2e/`. `@anthropic-ai/sdk` is hoisted to the root `node_modules`, so an
 * `apps/web` route can import it and resolve today.
 */
const SCAN_ROOTS = ['apps', 'packages', 'scripts', 'e2e'];
const SKIP_DIRS = new Set([
  'node_modules', '.next', '.expo', 'dist', 'build', 'coverage',
  '__pycache__', '.venv', 'ios', 'android', '.turbo', '.git', '.claude',
]);
const CODE_EXT = /\.(m|c)?(ts|js)x?$/;
const IS_TEST = /\.(spec|test)\.[a-z]+$/;

/** The guards themselves quote these patterns; scanning them is self-reference. */
const SELF_SCRIPTS = new Set([
  'scripts/check-ai-spend-metering.mjs',
  'scripts/check-engine-callers.mjs',
]);

/** The service that owns metering — it is the thing being called, not a caller. */
const SELF = 'apps/api/src/ai/ai-spend.service.ts';
const AI_SERVICE = 'apps/api/src/ai/ai.service.ts';

/**
 * Any call that spends money at a model provider.
 *
 * ⚠️ The three shapes after the first two are NOT hypothetical future SDKs —
 * every one exists in the versions installed right now. `responses.create` is
 * OpenAI's current recommended surface (`openai@6`) and chat-completions is its
 * legacy path, so the natural next OpenAI edit lands on the shape the first
 * version of this regex could not see. `messages.batches.create` is a plausible
 * cost optimisation (50% off) that spends real money.
 */
const PROVIDER_CALL = new RegExp(
  [
    /\.messages\s*\.\s*batches\s*\.\s*create\s*\(/, //  anthropic batch
    /\.messages\s*\.\s*(create|stream)\s*\(/, //        anthropic
    /\.chat\s*\.\s*completions\s*\.\s*(create|stream)\s*\(/, // openai legacy
    /\.responses\s*\.\s*(create|stream)\s*\(/, //       openai current
    /\.generateContent(Stream)?\s*\(/, //               gemini
  ]
    .map((r) => r.source)
    .join('|'),
);

/**
 * A second, independent net. Call-shape matching is a game of enumeration the
 * guard cannot win — `const { create } = client.messages` defeats all of the
 * above. Importing the SDK does not, and it is import-level so it survives every
 * rename.
 */
const PROVIDER_IMPORT =
  /['"]@anthropic-ai\/sdk['"]|['"]openai['"]|['"]@google\/(generative-ai|genai)['"]|api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com/;

const RECORDS_SPEND = /aiSpend\s*\.\s*record\s*\(/;
/**
 * ⚠️ `this.logUsage(` is ai.service.ts's own metering helper and is accepted
 * ONLY there. Anywhere else it lets a file self-certify: define a no-op
 * `private logUsage() {}`, call it, and both the presence and count checks pass.
 */
const RECORDS_SPEND_SELF = /aiSpend\s*\.\s*record\s*\(|this\.logUsage\s*\(/;
const CHECKS_BREAKER = /assertUnderCap\s*\(/;
/** S1 — a provider call must also hold a concurrency slot. */
const HOLDS_SLOT = /aiGovernor\s*\.\s*(acquire|run|runGenerator)\s*\(/;
/** S1 — every hand-rolled `acquire` must have a matching release. */
const ACQUIRES = /aiGovernor\s*\.\s*acquire\s*\(/;
const RELEASES = /releaseSlot\s*\(\s*\)/;
/** S4 — per-user quota. */
const CONSUMES_QUOTA = /quota\s*\.\s*consume\s*\(/;

/**
 * A file can spend without calling a provider directly, by delegating to
 * `AIService`.
 *
 * ⚠️ Detected by INJECTION, not by receiver name. The first version matched the
 * literal identifier `aiService` plus a `generate`/`stream` prefix, and an audit
 * produced five working bypasses in minutes: rename the property (`this.ai.…`),
 * use a different verb (`.interpret(…)`), end the method in `Hash`, alias it
 * locally (`const svc = …`), or reach it by bracket. A class cannot spend
 * through `AIService` without having it handed to it, so the injection is the
 * signal that cannot be renamed away.
 *
 * A second audit then found eight ways to be handed it without the literal text
 * `: AIService` — a namespace-qualified type, a `Pick<>`, `InstanceType<>`, an
 * `@Inject()` token, `ModuleRef.get()`, and an aliased type import. All are
 * covered below except `extends SomeBaseThatHasIt`, which needs a type graph;
 * that limit is stated in the file docblock rather than papered over.
 */
const INJECTS_AI_SERVICE = new RegExp(
  [
    /:\s*(?:[A-Za-z0-9_$]+\.)?AIService\b/, //            : AIService · : NS.AIService
    /:\s*(?:Pick|Omit|InstanceType)\s*<[^>]*\bAIService\b/, // mapped/derived types
    /@Inject\(\s*AIService\s*\)/, //                       token DI
    /\.\s*get\s*\(\s*AIService\s*\)/, //                   ModuleRef.get(AIService)
  ]
    .map((r) => r.source)
    .join('|'),
);

/** `import { AIService as A }` then `: A` — the annotation never says AIService. */
function injectsViaAlias(source) {
  const m = source.match(/import\s+(?:type\s+)?\{[^}]*\bAIService\s+as\s+([A-Za-z0-9_$]+)/);
  return m ? new RegExp(`:\\s*${m[1]}\\b`).test(source) : false;
}

const injectsAiService = (source) => INJECTS_AI_SERVICE.test(source) || injectsViaAlias(source);

/** Global twins, for counting rather than testing. */
const g = (re) => new RegExp(re.source, 'g');
const PROVIDER_CALL_G = g(PROVIDER_CALL);
const RECORDS_SPEND_G = g(RECORDS_SPEND);
const RECORDS_SPEND_SELF_G = g(RECORDS_SPEND_SELF);
const CHECKS_BREAKER_G = g(CHECKS_BREAKER);
const HOLDS_SLOT_G = g(HOLDS_SLOT);
const ACQUIRES_G = g(ACQUIRES);
const RELEASES_G = g(RELEASES);
const CONSUMES_QUOTA_G = g(CONSUMES_QUOTA);

const countMatches = (src, re) => {
  re.lastIndex = 0;
  return (src.match(re) || []).length;
};

/**
 * Blank out comments and string literals, preserving line count and offsets.
 *
 * ⚠️ NOT cosmetic. Before this, the guard's own remediation text was a working
 * bypass: a file with one unmetered `messages.create()` and a docblock pasting
 * "Add `await this.quota.consume(<kind>, <userId>)`", "call `this.aiSpend.record()`"
 * and "Wrap it in `aiGovernor.run()`" exited 0. So did a `// FIXME(spend): needs
 * quota.consume()` left behind while deferring the work, and a `releaseSlot()`
 * that existed only inside a block comment. Pasting the error message must not
 * silence the error.
 *
 * `{ strings: false }` keeps string literals (still removing comments). Two
 * rules NEED them: an SDK import IS a string literal, and a bracket-access
 * method name is one too — blanking those made both rules silently unfirable,
 * which my own spec caught. Counting rules keep the default, since a string
 * containing `messages.create(` should not inflate a count.
 *
 * Regex literals are left as code. Getting that wrong is a FAIL-OPEN — a
 * character-class regex containing a quote, misread as a string start, would
 * swallow the rest of the file including its provider call — so the standard
 * preceding-token heuristic is applied.
 */
function stripNonCode(src, { strings = true } = {}) {
  const REGEX_MAY_FOLLOW = new Set([...'(,=:[!&|?{};+-*%~^<>', '\n']);
  let out = '';
  let state = 'code';
  let lastSignificant = '\n';
  let i = 0;

  const blank = (ch) => (ch === '\n' ? '\n' : ' ');

  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];

    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === '/' && REGEX_MAY_FOLLOW.has(lastSignificant)) {
        state = 'regex'; out += c; i++; continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        state = c; out += strings ? ' ' : c; i++; continue;
      }
      out += c;
      if (!/\s/.test(c)) lastSignificant = c;
      else if (c === '\n') lastSignificant = '\n';
      i++;
      continue;
    }

    if (state === 'line') {
      if (c === '\n') { state = 'code'; lastSignificant = '\n'; out += '\n'; i++; continue; }
      out += ' '; i++; continue;
    }

    if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += blank(c); i++; continue;
    }

    if (state === 'regex') {
      // A regex literal is kept verbatim; only its terminator matters here.
      if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === '\n') { state = 'code'; lastSignificant = '\n'; out += '\n'; i++; continue; }
      out += c;
      if (c === '/') { state = 'code'; lastSignificant = '/'; }
      i++;
      continue;
    }

    // Inside a string literal (state is the quote char).
    // ⚠️ `blank(c2)` on the escaped character, not a second space: a backslash
    // before a real line break is a line continuation, and swallowing that
    // newline shifts every line number after it. Verified — the first version
    // lost 12 lines of prompts.ts.
    if (c === '\\') { out += strings ? ' ' + blank(c2 ?? ' ') : src.slice(i, i + 2); i += 2; continue; }
    if (c === state) { state = 'code'; lastSignificant = c; out += strings ? ' ' : c; i++; continue; }
    out += strings ? blank(c) : c;
    i++;
  }
  return out;
}

/**
 * Read a file as code, and refuse to proceed if the stripper mangled it.
 *
 * ⚠️ A stripper bug is a FAIL-OPEN, and the quietest kind: if it swallows a
 * file's provider call the file is simply skipped and the guard stays green.
 * Line count is the cheap invariant that catches it — the first version of the
 * escape handling dropped 12 lines of `prompts.ts`, and nothing would have said
 * so.
 */
function readCode(file, rel, opts) {
  const raw = readFileSync(file, 'utf8');
  const code = stripNonCode(raw, opts);
  const a = raw.split('\n').length;
  const b = code.split('\n').length;
  if (a !== b) {
    console.error(
      `\n✖ internal error: comment/string stripping changed ${rel} from ${a} to ${b} ` +
        `lines. That silently hides code from every rule below — fix stripNonCode ` +
        `rather than suppressing this.\n`,
    );
    process.exit(2);
  }
  return code;
}

/**
 * Files where per-call counting does not apply, with the reason.
 *
 * `ai.service.ts` is the only entry: it routes ALL of its provider adapters
 * through two choke points — `callProviderWithTimeout` and `streamProvider` —
 * which is strictly stronger than one check per call site, and is what closed
 * the hole where five of six reading paths were uncapped. Counting would demand
 * one of each per adapter and push it back toward per-site wiring.
 *
 * ⚠️ That premise is ENFORCED by TRIGGER_CHOKEPOINT below, which pins the
 * provider-call count. Unpinned, this exemption plus BREAKER_EXEMPT left the
 * file holding most of the repo's provider calls with only a presence check on
 * it, and three extra adapters that skipped both choke points passed.
 */
const COUNT_EXEMPT = new Map([
  [
    AI_SERVICE,
    'meters and caps at two shared choke points (callProviderWithTimeout, streamProvider) rather than per adapter',
  ],
]);

/** Pinned provider-call count for the choke-point exemption. Bump ONLY together
 *  with a check that the new call routes through a choke point. */
const CHOKEPOINT_PROVIDER_CALLS = 6;

/**
 * Files that legitimately do not spend a per-user quota, with the reason.
 * Kept SEPARATE from BREAKER_EXEMPT: reusing one list would silently grant a
 * second, unrelated exemption to anything on it.
 */
const QUOTA_EXEMPT = new Map([
  [
    'apps/api/src/users/users.service.ts',
    'injects AIService only for `generateBirthDataHash`, a pure hash helper used to scope the account-deletion cache purge — it spends nothing. TRIGGER enforced by TRIGGER_USERS.',
  ],
  [
    AI_SERVICE,
    'a shared generation layer — its callers own the per-user quota, and quota needs a userId this layer is not always given',
  ],
  [
    'apps/api/src/chat/chat-validators.service.ts',
    'the sampled LLM judge is internal work, not a user action; it records spend but is not rationed per user',
  ],
]);

const BREAKER_EXEMPT = new Map([
  [
    AI_SERVICE,
    'checks once at the top of the fallback chain, not per adapter (see the comment there)',
  ],
  [
    'apps/api/src/chat/chat-validators.service.ts',
    'the LLM judge is a sampled internal check wrapped in its own try/catch; it records spend but must not be the thing that fails a chat turn',
  ],
]);

/**
 * Files that import a provider SDK to CONSTRUCT a client without calling it —
 * they hand the client to a caller that owns the controls. TRIGGER enforced by
 * TRIGGER_CLIENT_FACTORY: the moment one calls a provider, the exemption ends.
 */
const CLIENT_FACTORY_EXEMPT = new Map([
  [
    'apps/api/src/fortune/fortune-snapshot.helpers.ts',
    '`ensureClaudeClient` builds the Anthropic client; the calls live in fortune.service.ts and fortune-stream.service.ts, which carry the controls',
  ],
]);

/**
 * Expected `quota.consume` count per delegating spender. A ratchet: the guard
 * fails when the count DROPS. Raise it when you add a spend path.
 *
 * Counting against delegations does not work here — `bazi.service.ts` has 14
 * `aiService.*` calls across mutually exclusive `switch` arms, and only five of
 * them are distinct user actions that spend: `createReading`, `streamReading`,
 * `streamComparisonAI`, `recalculateComparison`, `generateComparisonAI`. (A
 * sixth entry point, `regenerateReading`, flips flags and re-enters
 * `streamReading`, so it must NOT consume a second time.) So the expected count
 * is pinned per file rather than derived.
 */
const QUOTA_COUNT_RATCHET = new Map([['apps/api/src/bazi/bazi.service.ts', 5]]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (CODE_EXT.test(entry) && !IS_TEST.test(entry)) out.push(full);
  }
  return out;
}

const violations = [];
const fail = (rule, file, line, message) => violations.push({ rule, file, line, message });

/** Read a watched file, or record a violation. A missing watched file used to be
 *  a silent skip — a fail-open in a control whose whole value is failing closed. */
function readWatched(rel, why, opts) {
  const full = join(ROOT, rel);
  if (!existsSync(full)) {
    fail('EXEMPT_MISSING', rel, 0, `${why} but the file no longer exists — remove the entry or repoint it.`);
    return null;
  }
  return readCode(full, rel, opts);
}

const files = [];
for (const root of SCAN_ROOTS) walk(join(ROOT, root), files);

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (rel === SELF || SELF_SCRIPTS.has(rel)) continue;

  const source = readCode(file, rel);
  // Imports are string literals, so this one rule reads a strings-preserving cut.
  const withStrings = readCode(file, rel, { strings: false });
  const recordsRe = rel === AI_SERVICE ? RECORDS_SPEND_SELF : RECORDS_SPEND;
  const recordsReG = rel === AI_SERVICE ? RECORDS_SPEND_SELF_G : RECORDS_SPEND_G;

  const hasProviderCall = PROVIDER_CALL.test(source);

  // The import-level net: an SDK in the imports with none of the four controls
  // is a spender the call-shape regex could not see.
  if (!hasProviderCall && PROVIDER_IMPORT.test(withStrings) && !CLIENT_FACTORY_EXEMPT.has(rel)) {
    const anyControl =
      recordsRe.test(source) || CHECKS_BREAKER.test(source) || HOLDS_SLOT.test(source);
    if (!anyControl) {
      fail(
        'IMPORT_UNMETERED',
        rel,
        withStrings.split('\n').findIndex((l) => PROVIDER_IMPORT.test(l)) + 1,
        'imports a model-provider SDK but has no spend controls at all. If it only ' +
          'constructs a client, add a CLIENT_FACTORY_EXEMPT entry; otherwise meter it.',
      );
    }
  }

  // A delegating spender (calls AIService rather than a provider SDK) still
  // needs a per-user quota — it just has no provider call for the rules below
  // to key off. Checked separately, then the file is done.
  if (!hasProviderCall) {
    if (injectsAiService(source) && !QUOTA_EXEMPT.has(rel)) {
      const consumed = countMatches(source, CONSUMES_QUOTA_G);
      // ⚠️ A RATCHET, not a presence check. `consumed === 0` was the first
      // version, and it is exactly the shape the comment further down forbids:
      // deleting 4 of 5 quota calls stayed green. A simple `consumed <
      // delegations` is wrong too — 14 delegations sit in mutually exclusive
      // `switch` arms, so the counts legitimately differ. So the expected count
      // is PINNED per file, and any drop is a failure.
      const expected = QUOTA_COUNT_RATCHET.get(rel);
      if (expected !== undefined && consumed < expected) {
        fail(
          'DELEGATE_RATCHET',
          rel,
          Math.max(1, source.split('\n').findIndex((l) => CONSUMES_QUOTA.test(l)) + 1),
          `has ${consumed} quota consume(s) but ${expected} are expected — a spend ` +
            `path lost its per-user bound. If the drop is intentional, update ` +
            `QUOTA_COUNT_RATCHET in this script with the reason.`,
        );
      }
      if (expected === undefined && consumed === 0) {
        fail(
          'DELEGATE_NO_QUOTA',
          rel,
          Math.max(1, source.split('\n').findIndex((l) => INJECTS_AI_SERVICE.test(l)) + 1),
          'injects AIService but consumes no per-user quota — S1 and S2 are global, ' +
            'so one account can exhaust the budget for everyone. Add ' +
            '`await this.quota.consume(<kind>, <userId>)`, or pin a count in ' +
            'QUOTA_COUNT_RATCHET.',
        );
      }
    }
    continue;
  }

  const line = Math.max(1, source.split('\n').findIndex((l) => PROVIDER_CALL.test(l)) + 1);

  // ⚠️ COUNT, don't just test-for-presence. Both Phase-2A auditors showed the
  // same bypass: delete 2 of 3 `assertUnderCap` calls from a file with three
  // provider calls and the file-level rule still passed. Partial removal is the
  // realistic mistake — a new branch added next to an existing metered one.
  const providerCalls = countMatches(source, PROVIDER_CALL_G);
  const records = countMatches(source, recordsReG);
  const caps = countMatches(source, CHECKS_BREAKER_G);
  const slots = countMatches(source, HOLDS_SLOT_G);
  const acquires = countMatches(source, ACQUIRES_G);
  const releases = countMatches(source, RELEASES_G);
  const quotas = countMatches(source, CONSUMES_QUOTA_G);

  // ⚠️ A hand-rolled `acquire` needs its own release. Deleting a
  // `releaseSlot()` from a `finally` was invisible to both jest and this guard,
  // and a leaked slot shrinks the pool permanently and silently. `run`/
  // `runGenerator` own their release, so only bare `acquire` is counted.
  if (acquires > 0 && releases < acquires) {
    fail(
      'SLOT_LEAK',
      rel,
      line,
      `calls aiGovernor.acquire() ${acquires} time(s) but releaseSlot() only ` +
        `${releases} — an unreleased slot shrinks the pool for the life of the ` +
        `process. Use aiGovernor.run()/runGenerator(), or release in a finally.`,
    );
  }

  // S4 — a user-facing generation path must also spend the caller's daily quota.
  if (!QUOTA_EXEMPT.has(rel) && quotas < providerCalls) {
    fail(
      'QUOTA_COUNT',
      rel,
      line,
      `has ${providerCalls} provider call(s) but only ${quotas} quota consume(s) — ` +
        'S1 and S2 are GLOBAL, so without this one account can exhaust the budget ' +
        'for everyone. Add `await this.quota.consume(<kind>, <userId>)`, or add a ' +
        'QUOTA_EXEMPT entry.',
    );
  }

  if (!COUNT_EXEMPT.has(rel)) {
    if (records < providerCalls) {
      fail(
        'RECORDS_COUNT',
        rel,
        line,
        `has ${providerCalls} provider call(s) but only ${records} record() call(s) — at least one path spends without being counted.`,
      );
    }
    if (!BREAKER_EXEMPT.has(rel) && slots < providerCalls) {
      fail(
        'SLOTS_COUNT',
        rel,
        line,
        `has ${providerCalls} provider call(s) but only ${slots} concurrency-slot ` +
          `acquisition(s) — an ungoverned call is unbounded in-flight spend, which ` +
          `is what S1 exists to prevent. Wrap it in aiGovernor.run()/acquire().`,
      );
    }
    if (!BREAKER_EXEMPT.has(rel) && caps < providerCalls) {
      fail(
        'CAPS_COUNT',
        rel,
        line,
        `has ${providerCalls} provider call(s) but only ${caps} assertUnderCap() call(s) — at least one path spends without consulting the breaker.`,
      );
    }
  }

  if (!recordsRe.test(source)) {
    fail(
      'RECORDS_PRESENT',
      rel,
      line,
      'calls an AI provider but never records spend — this call would be invisible ' +
        'to both AIUsageLog and the S2 breaker. Inject AiSpendService and call record().',
    );
  }
  if (!CHECKS_BREAKER.test(source) && !BREAKER_EXEMPT.has(rel)) {
    fail(
      'BREAKER_PRESENT',
      rel,
      line,
      'calls an AI provider without consulting the spend breaker — add ' +
        '`await this.aiSpend.assertUnderCap(<context>)` before the call, or add an ' +
        'entry to BREAKER_EXEMPT in this script with the reason.',
    );
  }
}

// ── Exemption premises, ENFORCED rather than described ───────────────────────
//
// Every entry above carries a reason, and a reason is not a control: re-adding
// `@Post('readings')` to the (since-deleted) ZWDS controller left the guard
// green and ZWDS generation unrationed. These check the actual preconditions.

for (const [rel, reason] of QUOTA_EXEMPT) {
  const source = readWatched(rel, `is quota-exempt ("${reason}")`);
  if (source === null) continue;
  if (!injectsAiService(source) && !PROVIDER_CALL.test(source)) {
    fail('EXEMPT_STALE_QUOTA', rel, 0, `is quota-exempt ("${reason}") but no longer reaches AI at all — remove the exemption.`);
  }
}

for (const [rel, reason] of BREAKER_EXEMPT) {
  const source = readWatched(rel, `is exempt from the breaker check ("${reason}")`);
  if (source === null) continue;
  if (!PROVIDER_CALL.test(source)) {
    fail('EXEMPT_STALE_BREAKER', rel, 0, `is exempt from the breaker check ("${reason}") but no longer calls a provider — remove the exemption.`);
  }
}

// TRIGGER_USERS — the exemption rests on users.service using ONLY hash helpers.
//
// ⚠️ Keyed on the METHOD NAME, derived from AIService itself. The first version
// matched `aiService.(generate|stream)…` — the same receiver-name shape whose
// five bypasses INJECTS_AI_SERVICE was rewritten to close, left behind in the
// sibling location. Worse, its `(?!…Hash\b)` lookahead had the semantics
// backwards: a real spender named `generateReadingHash` was waved through.
// Matching the callee cannot be defeated by renaming the receiver, aliasing it,
// or reaching it by bracket.
{
  const rel = 'apps/api/src/users/users.service.ts';
  const HASH_ONLY_ALLOWED = new Set(['generateBirthDataHash', 'generateComparisonHash']);
  // Strings preserved: `this.aiService['generateX']` is a string literal, and
  // that was one of the bypasses this trigger exists to catch.
  const users = QUOTA_EXEMPT.has(rel)
    ? readWatched(rel, 'is quota-exempt as "hash helpers only"', { strings: false })
    : null;
  const ai = users === null ? null : readWatched(AI_SERVICE, 'is the AIService this guard derives method names from');
  if (users && ai) {
    const spendingMethods = [...ai.matchAll(/^\s{2}(?:public\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)]
      .map((m) => m[1])
      .filter((n) => /^(generate|stream)/.test(n) && !HASH_ONLY_ALLOWED.has(n));
    for (const name of new Set(spendingMethods)) {
      if (new RegExp(`\\b${name}\\s*\\(|['"\`]${name}['"\`]`).test(users)) {
        fail(
          'TRIGGER_USERS',
          rel,
          0,
          `is quota-exempt as "hash helpers only", but calls AIService.${name}() — ` +
            'it spends, so it needs a quota.',
        );
      }
    }
  }
}

// TRIGGER_CHOKEPOINT — the count exemption rests on every adapter routing
// through the two shared choke points. Pinning the count is the closest a
// lexical scan gets: a new adapter has to be justified rather than merely added.
{
  const ai = readWatched(AI_SERVICE, 'is exempt from per-call counting');
  if (ai) {
    const n = countMatches(ai, PROVIDER_CALL_G);
    if (n !== CHOKEPOINT_PROVIDER_CALLS) {
      fail(
        'TRIGGER_CHOKEPOINT',
        AI_SERVICE,
        0,
        `has ${n} provider call(s) but the choke-point exemption is pinned at ` +
          `${CHOKEPOINT_PROVIDER_CALLS}. Confirm the new call routes through ` +
          `callProviderWithTimeout or streamProvider, then update ` +
          `CHOKEPOINT_PROVIDER_CALLS.`,
      );
    }
  }
}

// CHOKEPOINT_UNRECORDED — the choke points cap and govern, but they do NOT
// record. Recording is per-generator, via `logUsage`.
//
// ⚠️ This is the rule that should have caught the worst live bug S2 shipped
// with. `generateCompatibilityRomanceV2` fires THREE `callProviderWithTimeout`
// calls and never logs one — ~$0.72 of the app's single most expensive action,
// invisible to the counter `assertUnderCap` reads — while the file-level rules
// above marked ai.service.ts compliant, because its OTHER generators record.
// COUNT_EXEMPT's premise ("everything routes through two choke points") is true
// of the cap and the slot and false of the record, and nothing said so.
{
  const ai = readWatched(AI_SERVICE, 'is the choke-point generation layer');
  if (ai) {
    const sites = countMatches(ai, /this\.callProviderWithTimeout\s*\(/g);
    // A local helper that wraps `this.logUsage` counts as a recording site at
    // each of ITS call sites. Without this the rule punishes exactly the
    // refactor it should encourage — three `recordCall(r)` calls collapse to one
    // textual `logUsage(` — and the file docblock's whole claim is that these
    // rules survive helper extraction.
    let logs = countMatches(ai, /this\.logUsage\s*\(/g);
    for (const m of ai.matchAll(/const\s+([A-Za-z0-9_$]+)\s*=\s*\([^)]*\)\s*=>/g)) {
      const body = ai.slice(m.index, m.index + 1200);
      if (!/this\.logUsage\s*\(/.test(body)) continue;
      // Its own definition already counted once via the literal above.
      logs += Math.max(0, countMatches(ai, new RegExp(`\\b${m[1]}\\s*\\(`, 'g')) - 1);
    }
    if (logs < sites) {
      fail(
        'CHOKEPOINT_UNRECORDED',
        AI_SERVICE,
        Math.max(1, ai.split('\n').findIndex((l) => /this\.callProviderWithTimeout\s*\(/.test(l)) + 1),
        `has ${sites} callProviderWithTimeout() call site(s) but only ${logs} ` +
          `logUsage() call(s). The choke point checks the cap and holds the slot ` +
          `but does NOT record — each generator logs its own usage, so a generator ` +
          `that forgets spends invisibly. Add a logUsage() per fulfilled result.`,
      );
    }
  }
}

// TRIGGER_CLIENT_FACTORY — a factory that starts calling the provider is no
// longer a factory.
for (const [rel, reason] of CLIENT_FACTORY_EXEMPT) {
  const source = readWatched(rel, `is exempt as a client factory ("${reason}")`);
  if (source === null) continue;
  if (PROVIDER_CALL.test(source)) {
    fail('TRIGGER_CLIENT_FACTORY', rel, 0, `is exempt as a client factory ("${reason}") but now calls a provider — it must carry the controls.`);
  }
}

if (violations.length > 0) {
  console.error('\n✖ S1/S2/S4 AI-spend metering guard failed:\n');
  for (const v of violations) console.error(`  [R-${v.rule}] ${v.file}:${v.line}\n    ${v.message}\n`);
  console.error(`${violations.length} violation(s).\n`);
  process.exit(1);
}

console.log('✓ S2 AI-spend guard: every provider call is metered and capped');
