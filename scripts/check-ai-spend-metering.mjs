#!/usr/bin/env node
/**
 * S2 CI guard — every AI provider call must be metered and capped.
 *
 * WHY THIS EXISTS. Before S2 there were 15 provider call sites and only 6 were
 * metered: all of chat (including the LLM judge) and all of fortune called
 * Anthropic directly and wrote no usage row at all. The spend figure was
 * therefore blind to both interactive surfaces — and a breaker wired to the same
 * 6 sites would have been worse than no breaker, because it would have reported
 * a comfortable number while the unmetered half ran free.
 *
 * The rule is per FILE, not per call: a file that calls a provider must both
 * record spend and consult the breaker. Per-call proximity matching would be
 * defeated by any helper extraction, and the file-level rule is the one that
 * survives refactoring.
 *
 * ⚠️ WHAT IT CANNOT DO. It is a lexical scan. It cannot prove the `record` call
 * is on the same path as the provider call, or that the token counts passed are
 * the right ones. It catches the realistic mistake — a new caller that never
 * thought about spend — not a determined bypass.
 *
 * Run: `npm run guard:ai-spend`
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootFlag = process.argv.indexOf('--root');
const ROOT =
  rootFlag !== -1 && process.argv[rootFlag + 1]
    ? process.argv[rootFlag + 1]
    : fileURLToPath(new URL('..', import.meta.url));

const SCAN_ROOT = 'apps/api/src';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);
const IS_TEST = /\.(spec|test)\.[a-z]+$/;

/** The service that owns metering — it is the thing being called, not a caller. */
const SELF = 'apps/api/src/ai/ai-spend.service.ts';

/** Any call that spends money at a model provider. */
const PROVIDER_CALL =
  /\.messages\s*\.\s*(create|stream)\s*\(|\.chat\s*\.\s*completions\s*\.\s*create\s*\(|\.generateContent(Stream)?\s*\(/;

const RECORDS_SPEND = /aiSpend\s*\.\s*record\s*\(|this\.logUsage\s*\(/;
const CHECKS_BREAKER = /assertUnderCap\s*\(/;
/** S1 — a provider call must also hold a concurrency slot. */
const HOLDS_SLOT = /aiGovernor\s*\.\s*(acquire|run|runGenerator)\s*\(/;
/** S1 — every hand-rolled `acquire` must have a matching release. */
const ACQUIRES = /aiGovernor\s*\.\s*acquire\s*\(/;
const RELEASES = /releaseSlot\s*\(\s*\)/;
/** S4 — per-user quota. */
const CONSUMES_QUOTA = /quota\s*\.\s*consume\s*\(/;

/** Global twins, for counting rather than testing. */
const PROVIDER_CALL_G = new RegExp(PROVIDER_CALL.source, 'g');
const RECORDS_SPEND_G = new RegExp(RECORDS_SPEND.source, 'g');
const CHECKS_BREAKER_G = new RegExp(CHECKS_BREAKER.source, 'g');
const HOLDS_SLOT_G = new RegExp(HOLDS_SLOT.source, 'g');
const ACQUIRES_G = new RegExp(ACQUIRES.source, 'g');
const RELEASES_G = new RegExp(RELEASES.source, 'g');
const CONSUMES_QUOTA_G = new RegExp(CONSUMES_QUOTA.source, 'g');

const countMatches = (src, re) => {
  re.lastIndex = 0;
  return (src.match(re) || []).length;
};

/**
 * Files where per-call counting does not apply, with the reason.
 *
 * `ai.service.ts` is the only entry: it routes ALL SIX of its provider adapters
 * through two choke points — `callProviderWithTimeout` and `streamProvider` —
 * which is strictly stronger than one check per call site, and is what closed
 * the hole where five of six reading paths were uncapped. Counting would demand
 * six of each and push it back toward per-site wiring.
 */
const COUNT_EXEMPT = new Map([
  [
    'apps/api/src/ai/ai.service.ts',
    'meters and caps at two shared choke points (callProviderWithTimeout, streamProvider) rather than per adapter',
  ],
]);

/**
 * Files allowed to call a provider without consulting the breaker themselves,
 * with the reason. Recording is NEVER exempt — an unmetered call is invisible
 * spend regardless of who checked the cap.
 */
/**
 * Files that legitimately do not spend a per-user quota, with the reason.
 * Kept SEPARATE from BREAKER_EXEMPT: reusing one list would silently grant a
 * second, unrelated exemption to anything on it.
 */
const QUOTA_EXEMPT = new Map([
  [
    'apps/api/src/ai/ai.service.ts',
    'a shared generation layer — its callers (bazi, zwds) own the per-user quota, and quota needs a userId this layer is not always given',
  ],
  [
    'apps/api/src/chat/chat-validators.service.ts',
    'the sampled LLM judge is internal work, not a user action; it records spend but is not rationed per user',
  ],
]);

const BREAKER_EXEMPT = new Map([
  [
    'apps/api/src/ai/ai.service.ts',
    'checks once at the top of the fallback chain, not per adapter (see the comment there)',
  ],
  [
    'apps/api/src/chat/chat-validators.service.ts',
    'the LLM judge is a sampled internal check wrapped in its own try/catch; it records spend but must not be the thing that fails a chat turn',
  ],
]);

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
    else if (/\.ts$/.test(entry) && !IS_TEST.test(entry)) out.push(full);
  }
  return out;
}

const violations = [];

for (const file of walk(join(ROOT, SCAN_ROOT))) {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (rel === SELF) continue;
  const source = readFileSync(file, 'utf8');
  if (!PROVIDER_CALL.test(source)) continue;

  const line = source.split('\n').findIndex((l) => PROVIDER_CALL.test(l)) + 1;

  // ⚠️ COUNT, don't just test-for-presence. Both Phase-2A auditors showed the
  // same bypass: delete 2 of 3 `assertUnderCap` calls from a file with three
  // provider calls and the file-level rule still passed. Partial removal is the
  // realistic mistake — a new branch added next to an existing metered one.
  const providerCalls = countMatches(source, PROVIDER_CALL_G);
  const records = countMatches(source, RECORDS_SPEND_G);
  const caps = countMatches(source, CHECKS_BREAKER_G);
  const slots = countMatches(source, HOLDS_SLOT_G);
  const acquires = countMatches(source, ACQUIRES_G);
  const releases = countMatches(source, RELEASES_G);
  const quotas = countMatches(source, CONSUMES_QUOTA_G);

  // ⚠️ A hand-rolled `acquire` needs its own release. Deleting a
  // `releaseSlot()` from a `finally` was invisible to both jest and this guard,
  // and a leaked slot shrinks the pool permanently and silently — the exact
  // failure the governor's docblock calls out. `run`/`runGenerator` own their
  // release, so only bare `acquire` is counted. Two releases per acquire (a
  // guard clause plus the finally) is fine; fewer is not.
  if (acquires > 0 && releases < acquires) {
    violations.push({
      file: rel,
      line,
      message:
        `calls aiGovernor.acquire() ${acquires} time(s) but releaseSlot() only ` +
        `${releases} — an unreleased slot shrinks the pool for the life of the ` +
        `process. Use aiGovernor.run()/runGenerator(), or release in a finally.`,
    });
  }

  // S4 — a user-facing generation path must also spend the caller's daily
  // quota. Exempted files are internal or already gated by their caller.
  if (!QUOTA_EXEMPT.has(rel) && quotas < providerCalls) {
    violations.push({
      file: rel,
      line,
      message:
        `has ${providerCalls} provider call(s) but only ${quotas} quota consume(s) — ` +
        'S1 and S2 are ' +
        'GLOBAL, so without this one account can exhaust the budget for everyone. ' +
        'Add `await this.quota.consume(<kind>, <userId>)`, or add a QUOTA_EXEMPT entry.',
    });
  }

  if (!COUNT_EXEMPT.has(rel)) {
    if (records < providerCalls) {
      violations.push({
        file: rel,
        line,
        message: `has ${providerCalls} provider call(s) but only ${records} record() call(s) — at least one path spends without being counted.`,
      });
    }
    if (!BREAKER_EXEMPT.has(rel) && slots < providerCalls) {
      violations.push({
        file: rel,
        line,
        message:
          `has ${providerCalls} provider call(s) but only ${slots} concurrency-slot ` +
          `acquisition(s) — an ungoverned call is unbounded in-flight spend, which is ` +
          `what S1 exists to prevent. Wrap it in aiGovernor.run()/acquire().`,
      });
    }
    if (!BREAKER_EXEMPT.has(rel) && caps < providerCalls) {
      violations.push({
        file: rel,
        line,
        message: `has ${providerCalls} provider call(s) but only ${caps} assertUnderCap() call(s) — at least one path spends without consulting the breaker.`,
      });
    }
  }

  if (!RECORDS_SPEND.test(source)) {
    violations.push({
      file: rel,
      line,
      message:
        'calls an AI provider but never records spend — this call would be invisible ' +
        'to both AIUsageLog and the S2 breaker. Inject AiSpendService and call record().',
    });
  }
  if (!CHECKS_BREAKER.test(source) && !BREAKER_EXEMPT.has(rel)) {
    violations.push({
      file: rel,
      line,
      message:
        'calls an AI provider without consulting the spend breaker — add ' +
        '`await this.aiSpend.assertUnderCap(<context>)` before the call, or add an ' +
        'entry to BREAKER_EXEMPT in this script with the reason.',
    });
  }
}

// An exemption for a file that no longer calls a provider is stale, and a stale
// allowlist is how a real exemption gets granted by accident later.
for (const [rel, reason] of BREAKER_EXEMPT) {
  const full = join(ROOT, rel);
  if (!existsSync(full) || !PROVIDER_CALL.test(readFileSync(full, 'utf8'))) {
    violations.push({
      file: rel,
      line: 0,
      message: `is exempt from the breaker check ("${reason}") but no longer calls a provider — remove the exemption.`,
    });
  }
}

if (violations.length > 0) {
  console.error('\n✖ S2 AI-spend metering guard failed:\n');
  for (const v of violations) console.error(`  ${v.file}:${v.line}\n    ${v.message}\n`);
  console.error(`${violations.length} violation(s).\n`);
  process.exit(1);
}

console.log('✓ S2 AI-spend guard: every provider call is metered and capped');
