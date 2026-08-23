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
 * ⚠️ RESIDUAL LIMITATION, not fixable in a script: nothing binds these lines to
 * the production stream. Anyone with the key could curl a local engine using
 * the (public) caller names and produce a fully-passing rollup. The freshness
 * check raises the cost of replaying an old log; it cannot prove provenance.
 * Read the logs from Railway yourself.
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
/**
 * BOTH of the engine's failure lines. `engine_auth.py` logs
 * "engine-auth bookkeeping failed" on the request path (:408) and
 * "engine-auth final flush failed" on shutdown (:450) — an earlier version of
 * this gate matched only the first and passed a log containing the second,
 * which is precisely the broken-counter-reads-zero case condition 3 exists for.
 */
const COUNTER_FAILURES = ['engine-auth bookkeeping failed', 'engine-auth final flush failed'];

/** Leading timestamp on a log line, in the shapes Python's formatter and Railway emit. */
const TIMESTAMP = /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/;
const DEFAULT_MAX_AGE_HOURS = 24;

export function evaluate(logText, opts = {}) {
  const maxAgeHours = opts.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const now = opts.now ?? Date.now();
  const rollups = [];
  let bookkeepingFailures = 0;
  const timestamps = [];

  for (const line of logText.split('\n')) {
    if (COUNTER_FAILURES.some((m) => line.includes(m))) bookkeepingFailures++;
    const at = line.indexOf(ROLLUP);
    if (at === -1) continue;
    try {
      rollups.push(JSON.parse(line.slice(at + ROLLUP.length)));
    } catch {
      // A truncated line is not evidence; ignore it rather than guess.
      continue;
    }
    // ⚠️ The rollup payload carries only a window DURATION, no absolute time, so
    // a saved log from months ago parses exactly like a fresh one. `--file` mode
    // has no other protection against replaying stale evidence.
    const m = TIMESTAMP.exec(line.slice(0, at));
    if (m) timestamps.push(Date.parse(`${m[1]}T${m[2]}Z`));
  }

  const newest = timestamps.length ? Math.max(...timestamps) : null;
  const ageHours = newest === null ? null : (now - newest) / 3_600_000;
  const stale = ageHours !== null && ageHours > maxAgeHours;
  const undated = rollups.length > 0 && timestamps.length === 0;

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
    // EVERY listed caller, not any one of them. `/calculate` is reached by both
    // `bazi.reading` (the paid reading, cache-gated so it does not fire on a
    // repeated birth date) and `bazi.passthrough` (the free preview) — they are
    // separate call sites, and "any" let the gate pass while the paid path had
    // never been exercised.
    const absent = callers.filter((c) => !seen.has(c));
    if (absent.length > 0) {
      missing.push({ path, expected: absent, seen: [...seen] });
    }
  }

  const conditions = [
    { id: 1, label: 'every call site keyed by its own recognised caller', pass: missing.length === 0 },
    { id: 2, label: 'zero absent / invalid / unconfigured', pass: bad.absent + bad.invalid + bad.unconfigured === 0 },
    { id: 3, label: 'zero counter failures (request path AND shutdown flush)', pass: bookkeepingFailures === 0 },
    { id: 5, label: `evidence is fresh (< ${maxAgeHours}h) and dated`, pass: !stale && !undated },
  ];

  return {
    rollups: rollups.length, conditions, missing, bad, bookkeepingFailures,
    windowSeconds, sawUnconfiguredWarning, ageHours, stale, undated,
  };
}

function main() {
  const fileFlag = process.argv.indexOf('--file');
  const text =
    fileFlag !== -1 && process.argv[fileFlag + 1]
      ? readFileSync(process.argv[fileFlag + 1], 'utf8')
      : readFileSync(0, 'utf8');

  const ageFlag = process.argv.indexOf('--max-age-hours');
  const r = evaluate(text, {
    maxAgeHours: process.argv.includes('--allow-undated')
      ? Number.POSITIVE_INFINITY
      : ageFlag !== -1 && process.argv[ageFlag + 1]
        ? Number(process.argv[ageFlag + 1])
        : undefined,
  });
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
  if (r.bookkeepingFailures) console.log(`\n  ⚠️ ${r.bookkeepingFailures} counter failure(s) — the counter may be under-reporting.`);
  if (r.undated) {
    console.log('\n  ⚠️ No timestamp found on any rollup line, so freshness cannot be checked and\n' +
      '     a saved log from any date would look identical. Pass --allow-undated only if\n' +
      '     you are certain of the source.');
  }
  if (r.stale) {
    console.log(`\n  ⚠️ Newest rollup is ~${Math.round(r.ageHours)}h old — this looks like a replayed or saved log.`);
  }

  console.log(
    `\n  Condition 4 (window = exercise + 1h settle) is NOT machine-checkable from log text.\n` +
      `  Observed span ≈ ${Math.round(r.windowSeconds)}s across ${r.rollups} window(s); judge it yourself.\n` +
      `  ⚠️ flush_counter only fires on GRACEFUL shutdown — a redeploy-truncated window is not a clean one.`,
  );

  const failed = r.conditions.filter((c) => !c.pass);
  console.log(failed.length ? `\n✗ DO NOT FLIP — ${failed.length} condition(s) unmet.` : `\n✓ All machine-checkable conditions met. Judge condition 4 (the settle window), then flip.`);
  process.exit(failed.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
