#!/usr/bin/env node
/**
 * B3-b pre-flight — decide whether ENGINE_REQUIRE_KEY may be flipped to 1.
 *
 * Reads Railway log text (stdin, or --file) and evaluates the flip conditions
 * from `docs/security/audit-2026-08.md` against the ENGINE-AUTH-ROLLUP lines
 * the engine emits. Turns "read the logs carefully" into something that fails.
 *
 *   railway logs --service <engine> | node scripts/b3b-preflight.mjs
 *   node scripts/b3b-preflight.mjs --file engine.log
 *
 * ⚠️ IT DOES NOT MANUFACTURE EVIDENCE, deliberately. A script that hit the
 * engine directly with the key would turn every condition green while proving
 * nothing about whether the REAL callers are keyed — which is the only thing
 * the flip actually depends on. Traffic has to come from driving the product.
 *
 * ⚠️ STRICTER THAN THE DOC on one point. The doc asks for `keyed >= 1` per
 * endpoint; this requires keyed from a RECOGNISED caller name. `keyed` from
 * `unknown` means somebody held the key, not that the API path is wired — and
 * the whole failure this gate exists to catch is one un-keyed call site.
 */
import { readFileSync } from 'node:fs';

/** Engine path → the caller names `apps/api/src/common/engine-client.ts` uses. */
const REQUIRED = {
  '/calculate': ['bazi.reading', 'bazi.passthrough'],
  '/explain-element': ['bazi.passthrough'],
  '/compatibility': ['bazi.compatibility'],
  '/daily-fortune': ['fortune.daily'],
  '/monthly-fortune': ['fortune.monthly'],
  '/yearly-fortune': ['fortune.yearly'],
  '/build-chat-context': ['chat.context'],
  '/build-chat-context-compat': ['chat.context-compat'],
  '/build-chat-context-fortune': ['chat.context-fortune'],
};

const ROLLUP = 'ENGINE-AUTH-ROLLUP ';
const BOOKKEEPING_FAILURE = 'engine-auth bookkeeping failed';

export function evaluate(logText) {
  const rollups = [];
  let bookkeepingFailures = 0;

  for (const line of logText.split('\n')) {
    if (line.includes(BOOKKEEPING_FAILURE)) bookkeepingFailures++;
    const at = line.indexOf(ROLLUP);
    if (at === -1) continue;
    try {
      rollups.push(JSON.parse(line.slice(at + ROLLUP.length)));
    } catch {
      // A truncated line is not evidence; ignore it rather than guess.
    }
  }

  const keyedBy = new Map(); // path -> Set(caller)
  const bad = { absent: 0, invalid: 0, unconfigured: 0 };
  let windowSeconds = 0;
  let sawUnconfiguredWarning = false;

  for (const r of rollups) {
    windowSeconds += Number(r.window_s) || 0;
    if (r.warning) sawUnconfiguredWarning = true;
    for (const k of Object.keys(bad)) bad[k] += Number(r.totals?.[k]) || 0;
    for (const [pathAndCaller, n] of Object.entries(r.by_path?.keyed || {})) {
      if (!n) continue;
      const [path, caller] = pathAndCaller.split('<-');
      if (!keyedBy.has(path)) keyedBy.set(path, new Set());
      keyedBy.get(path).add(caller);
    }
  }

  const missing = [];
  for (const [path, callers] of Object.entries(REQUIRED)) {
    const seen = keyedBy.get(path) || new Set();
    const recognised = callers.filter((c) => seen.has(c));
    if (recognised.length === 0) {
      missing.push({ path, expected: callers, seen: [...seen] });
    }
  }

  const conditions = [
    { id: 1, label: 'every endpoint keyed by a recognised caller', pass: missing.length === 0 },
    { id: 2, label: 'zero absent / invalid / unconfigured', pass: bad.absent + bad.invalid + bad.unconfigured === 0 },
    { id: 3, label: 'zero bookkeeping failures', pass: bookkeepingFailures === 0 },
  ];

  return { rollups: rollups.length, conditions, missing, bad, bookkeepingFailures, windowSeconds, sawUnconfiguredWarning };
}

function main() {
  const fileFlag = process.argv.indexOf('--file');
  const text =
    fileFlag !== -1 && process.argv[fileFlag + 1]
      ? readFileSync(process.argv[fileFlag + 1], 'utf8')
      : readFileSync(0, 'utf8');

  const r = evaluate(text);
  console.log(`B3-b pre-flight — ${r.rollups} rollup window(s), ~${Math.round(r.windowSeconds)}s covered\n`);

  if (r.rollups === 0) {
    console.error('✗ No ENGINE-AUTH-ROLLUP lines found. Either the window is empty (the engine\n' +
      '  emits nothing when it sees no traffic) or you are reading the wrong service.\n' +
      '  An empty window is NOT a pass.');
    process.exit(1);
  }

  for (const c of r.conditions) console.log(`  ${c.pass ? '✓' : '✗'} ${c.id}. ${c.label}`);

  if (r.missing.length) {
    console.log('\n  Endpoints with no keyed call from a recognised caller:');
    for (const m of r.missing) {
      console.log(`    ${m.path}  expected ${m.expected.join(' or ')}, saw ${m.seen.length ? m.seen.join(', ') : 'nothing'}`);
    }
    console.log('  Drive these through the product — see the pre-flight table in docs/security/audit-2026-08.md.');
  }
  if (r.bad.absent + r.bad.invalid + r.bad.unconfigured > 0) {
    console.log(`\n  Unkeyed traffic: absent=${r.bad.absent} invalid=${r.bad.invalid} unconfigured=${r.bad.unconfigured}`);
  }
  if (r.sawUnconfiguredWarning) {
    console.log('\n  ⚠️ A window reported ENGINE_KEYS/ENGINE_KEY unset. That window proves NOTHING —\n' +
      '     with no keys configured the engine cannot tell a keyed caller from an unkeyed one.');
  }
  if (r.bookkeepingFailures) console.log(`\n  ⚠️ ${r.bookkeepingFailures} bookkeeping failure(s) — the counter may be under-reporting.`);

  console.log(
    `\n  Condition 4 (window = exercise + 1h settle) is NOT machine-checkable from log text.\n` +
      `  Observed span ≈ ${Math.round(r.windowSeconds)}s across ${r.rollups} window(s); judge it yourself.\n` +
      `  ⚠️ flush_counter only fires on GRACEFUL shutdown — a redeploy-truncated window is not a clean one.`,
  );

  const failed = r.conditions.filter((c) => !c.pass);
  console.log(failed.length ? `\n✗ DO NOT FLIP — ${failed.length} condition(s) unmet.` : `\n✓ Conditions 1-3 met. Judge condition 4, then flip.`);
  process.exit(failed.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
