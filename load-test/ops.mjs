#!/usr/bin/env node
/**
 * Read `GET /api/admin/ops` and say plainly whether the load-test mock is armed.
 *
 * This is the arm-time AND teardown-time safety check, which is why it is a
 * script and not an incantation: the teardown one matters more, and a check
 * that is annoying to run is a check that gets skipped.
 *
 * ⚠️ It reports `aiBaseUrlEffective`, not `aiBaseUrlOverride`. The Anthropic SDK
 * honours a bare `ANTHROPIC_BASE_URL` on its own, so traffic can be redirected
 * by a variable the app does not own — in which case the override reads `null`
 * while calls go elsewhere. The effective value is the one that cannot lie.
 *
 *   export CLERK_SECRET_KEY=sk_live_...
 *   node load-test/ops.mjs --api https://<api-host> --fapi clerk.tianmingapp.com
 *
 * #24 — `--samples N` (default 1, max 20) reads the endpoint N times and groups
 * the answers by `instance.replicaId`, because `rateLimit`, `pools` and
 * `aiBaseUrlEffective` are what ONE replica observed. A `null` rate-limit gauge
 * on one replica says nothing about the other; with N samples you can see each
 * replica's own reading, or be told plainly that a replica was never reached.
 * Capped at 20 and paced, because the admin controller is throttled at 30/min.
 */
import { createClerkClient } from '@clerk/backend';
import { mintForUser, resolveFapiHost } from './clerk-auth.mjs';

const arg = (f, d = null) => {
  const i = process.argv.indexOf(`--${f}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const SECRET = process.env.CLERK_SECRET_KEY;
if (!SECRET) { console.error('CLERK_SECRET_KEY is not set.'); process.exit(1); }
const API = (arg('api') || '').replace(/\/$/, '');
if (!API) { console.error('--api <url> is required'); process.exit(1); }
const FAPI = resolveFapiHost({ flag: arg('fapi'), publishableKey: process.env.CLERK_PUBLISHABLE_KEY });

const clerk = createClerkClient({ secretKey: SECRET });

let admin = null;
for (let offset = 0; ; offset += 100) {
  const page = await clerk.users.getUserList({ limit: 100, offset });
  if (!page.data.length) break;
  admin = page.data.find((u) => u.publicMetadata?.role === 'admin');
  if (admin || page.data.length < 100) break;
}
if (!admin) { console.error('No user has publicMetadata.role === "admin".'); process.exit(1); }

const SAMPLES_MAX = 20; // AdminController is @Throttle(30/min) per user
const samplesRaw = Number.parseInt(arg('samples', '1'), 10);
const SAMPLES = Math.min(SAMPLES_MAX, Math.max(1, Number.isFinite(samplesRaw) ? samplesRaw : 1));
if (Number.isFinite(samplesRaw) && samplesRaw > SAMPLES_MAX) {
  console.log(`  (--samples capped at ${SAMPLES_MAX}: the admin endpoint is throttled at 30/min)`);
}

const { jwt } = await mintForUser(clerk, admin.id, { ttl: 600, fapi: FAPI });
// `fetch` handles both http:// (a local API on :4000) and https:// (Railway).
async function readOps() {
  try {
    const res = await fetch(`${API}/api/admin/ops`, { headers: { Authorization: `Bearer ${jwt}` } });
    if (!res.ok) return { ok: false, status: res.status, text: await res.text() };
    const body = await res.json();
    if (typeof body !== 'object' || body === null) return { ok: false, status: 'non-object body', text: '' };
    return { ok: true, body };
  } catch (err) {
    // A network error (reset, DNS) must not throw away the samples in hand.
    return { ok: false, status: `network error: ${err?.cause?.code ?? err?.message ?? err}`, text: '' };
  }
}

// Collect samples. A 429 (or any later failure) STOPS sampling and reports what
// was already collected — it must not throw away the readings in hand.
const samples = [];
for (let i = 0; i < SAMPLES; i++) {
  if (i > 0) await new Promise((r) => setTimeout(r, 250));
  const r = await readOps();
  if (r.ok) { samples.push(r.body); continue; }
  if (samples.length === 0) { console.error(`GET /api/admin/ops -> ${r.status}`, r.text); process.exit(1); }
  console.log(r.status === 429
    ? `  ⚠️  Throttled (429) after ${samples.length} sample(s) — the admin endpoint allows 30/min.` +
      ' Reporting what was collected; wait 60s before running again.'
    : `  ⚠️  Sample ${i + 1} failed (${r.status}); reporting the ${samples.length} collected.`);
  break;
}
// Fleet-wide sections (spend, breaker, replicas) are the same on every replica.
const ops = samples[0];

// ⚠️ A MISSING field is not a null field, and conflating them cost three rounds
// of diagnosis. Production was running code from before `aiBaseUrlEffective`
// existed, so the response simply had no such key — and this script rendered
// that identically to "present, but no client built yet". Both readings were
// honest; both were useless.
//
// Same for the override: if the deployed API predates the rename it reads
// `ANTHROPIC_BASE_URL`, so setting `LOADTEST_ANTHROPIC_BASE_URL` is inert and
// reports null forever, which looks exactly like not having set it.
// Checked on EVERY sample — mid rolling-deploy, replicas run different code.
const missingEffective = samples.some((s) => !('aiBaseUrlEffective' in s));
const missingOverride = samples.some((s) => !('aiBaseUrlOverride' in s));
if (missingEffective || missingOverride) {
  console.log('');
  console.log('  ⚠️  THE DEPLOYED API IS OLDER THAN THIS SCRIPT (on at least one replica).');
  console.log(`     /api/admin/ops did not return ${missingEffective ? 'aiBaseUrlEffective' : ''}` +
    `${missingEffective && missingOverride ? ' or ' : ''}${missingOverride ? 'aiBaseUrlOverride' : ''}.`);
  console.log('     That field ships with the load-test switch, so the running code');
  console.log('     probably predates the rename and reads ANTHROPIC_BASE_URL instead.');
  console.log('     Setting LOADTEST_ANTHROPIC_BASE_URL against it does nothing at all.');
  console.log('     Deploy the current branch before trusting anything below.');
}

// ⚠️ Both signals, because either alone gets it wrong in a dangerous direction.
//
// `effective` is null until a client is built on the replica that served this
// request — clients are lazy and there are 2 replicas. Judging on it alone
// reports NOT ARMED while the variable IS set, which at teardown reads as a
// false all-clear.
//
// `override` alone misses the other case: the SDK honours a bare
// ANTHROPIC_BASE_URL of its own accord, which redirects traffic while our
// override stays null.
//
// #24 — judged over ALL samples: the answer may come from any replica reached.
const redirected = samples.some((s) => !!s.aiBaseUrlEffective && !s.aiBaseUrlEffective.includes('api.anthropic.com'));
const armed = redirected || samples.some((s) => !!s.aiBaseUrlOverride);
const uncertain = !armed && samples.every((s) => !s.aiBaseUrlEffective);

console.log('');
console.log(armed
  ? '  🟠 ARMED — AI traffic is going to the MOCK, not to Anthropic (on at least one replica).'
  : uncertain
    ? '  🟢 NOT ARMED — no override set, and no replica reached had built a client to confirm against.'
    : '  🟢 NOT ARMED — AI traffic is going to the real Anthropic API.');
console.log('');
console.log(`  replicas           : ${ops.replicas}`);
console.log(`  spend today        : $${ops.spend.dayUsd ?? '?'} / $${ops.spend.dayLimitUsd} (${ops.spend.dayPct ?? '?'}%)`);
console.log(`  breaker            : ${ops.breaker.trippedOn ?? 'healthy'}`);
console.log('');

// ── #24 — per-replica sections: which replica answered, and what it observed ──

/** Age of a server timestamp, measured on the SERVER's clock (the sample's generatedAt). */
const ageOn = (sample, ms) => {
  if (ms == null) return '—';
  const ref = Date.parse(sample.generatedAt);
  return `${Math.round(((Number.isFinite(ref) ? ref : Date.now()) - ms) / 1000)}s ago`;
};

/** Plain-language reading of one replica's counters — mirrors the table in
 *  apps/api/src/ai/anthropic-rate-limit.ts and the runbook. Keep them in sync. */
const interpret = (sample) => {
  const rl = sample.rateLimit ?? {};
  if (!('requestsStarted' in rl)) {
    return ['unknown — this replica runs code older than the #24 counters, so a null cannot be explained'];
  }
  const notes = [];
  if (rl.requestsStarted === 0) {
    notes.push('no Anthropic call on this replica since it started — null is expected, NOT a bug');
  } else if (rl.transportErrors > 0 && rl.responsesSeen === 0) {
    notes.push(`🔴 every call (${rl.transportErrors}) got NO HTTP response — network/DNS failure or timeout; ` +
      'check aiBaseUrlEffective (a stale mock URL looks exactly like this) and AI-CALL outcome:error lines');
  } else if (rl.observedAt != null && rl.outputTokensRemaining == null) {
    notes.push('⚠️ PARTIAL — rate-limit headers arrive but the output-token ones do not parse; rlOutRemaining is blind');
  } else if (rl.observedAt != null) {
    notes.push(`working — reading taken ${ageOn(sample, rl.observedAt)}`);
  } else if (rl.okWithoutHeaders > 0) {
    notes.push('🔴 CAPTURE BROKEN — successful responses arrived without the rate-limit headers');
  } else {
    notes.push(`only error responses so far (last status ${rl.lastResponseStatus ?? '?'}) — not a capture bug`);
  }
  if (rl.transportErrors > 0 && rl.responsesSeen > 0) {
    notes.push(`⚠️ ${rl.transportErrors} call(s) got no HTTP response at all (network error / timeout before headers)`);
  }
  if (rl.okWithoutHeaders > 0 && rl.observedAt != null) {
    notes.push(`⚠️ ${rl.okWithoutHeaders} successful response(s) lacked the headers — the reading may be STALE ` +
      `(reading ${ageOn(sample, rl.observedAt)}, last response ${ageOn(sample, rl.lastResponseAt)})`);
  }
  return notes;
};

const val = (obj, key) => (obj && key in obj ? (obj[key] ?? 'null') : 'unknown (field missing)');

const withInstance = samples.filter((s) => s.instance && s.instance.replicaId);
const withoutInstance = samples.filter((s) => !(s.instance && s.instance.replicaId));
const byReplica = new Map();
for (const s of withInstance) {
  const e = byReplica.get(s.instance.replicaId) ?? { count: 0, last: s };
  e.count += 1;
  e.last = s; // latest sample from that replica
  byReplica.set(s.instance.replicaId, e);
}

console.log(`  replicas reached   : ${byReplica.size} of ${ops.replicas} identified` +
  ` (in ${samples.length} sample${samples.length === 1 ? '' : 's'})`);
for (const [id, { count, last }] of byReplica) {
  const rl = last.rateLimit ?? {};
  console.log('');
  console.log(`  ▸ replica ${id}  [${last.instance.replicaIdSource ?? '?'}]  ×${count}`);
  console.log(`      started        : ${last.instance.startedAt ?? '?'}`);
  console.log(`      commit         : ${last.instance.commitSha ?? '(unknown — CLI deploy, or not on Railway)'}`);
  console.log(`      AI base URL    : ${last.aiBaseUrlEffective ?? '(no client built yet on this replica)'}` +
    (last.aiBaseUrlOverride ? `   override: ${last.aiBaseUrlOverride}` : ''));
  if (last.pools) {
    console.log(`      pools.reading  : inFlight=${last.pools.reading?.inFlight} limit=${last.pools.reading?.limit} peak=${last.pools.reading?.peak}` +
      `   interactive: inFlight=${last.pools.interactive?.inFlight} limit=${last.pools.interactive?.limit}`);
  }
  console.log(`      rate limit     : ${val(rl, 'outputTokensRemaining')} output tokens left` +
    (rl.outputTokensReset ? ` (resets ${rl.outputTokensReset})` : ''));
  console.log(`      counters       : started ${val(rl, 'requestsStarted')}   noResponse ${val(rl, 'transportErrors')}` +
    `   responses ${val(rl, 'responsesSeen')}   okWithoutHeaders ${val(rl, 'okWithoutHeaders')}`);
  console.log(`      last response  : ${ageOn(last, rl.lastResponseAt)} (status ${rl.lastResponseStatus ?? '—'})` +
    `   reading taken: ${ageOn(last, rl.observedAt)}`);
  for (const n of interpret(last)) console.log(`      → ${n}`);
}

if (withoutInstance.length > 0) {
  console.log('');
  console.log(`  ⚠️  ${withoutInstance.length} sample(s) came from a replica running code OLDER than this script`);
  console.log('     (no `instance`), so they cannot be attributed to a replica. What they reported:');
  for (const s of withoutInstance) {
    console.log(`       AI base URL ${s.aiBaseUrlEffective ?? '(no client yet)'} · rate limit ` +
      `${val(s.rateLimit, 'outputTokensRemaining')} · ${interpret(s)[0]}`);
  }
}

if (byReplica.size < (ops.replicas ?? 1)) {
  console.log('');
  console.log(`  ⚠️  INCONCLUSIVE about ${(ops.replicas ?? 1) - byReplica.size} of ${ops.replicas ?? 1} replica(s):`);
  console.log('     they never answered with an identity. The load balancer decides routing, so this');
  console.log('     script cannot force a replica — wait 60s (30/min throttle) and run again with --samples.');
}
console.log('');

if (uncertain) {
  console.log('  ⚠️  No replica reached had built an Anthropic client, so "not armed" rests on the override');
  console.log('     alone. Run this again after one AI call to confirm against a built client.');
  console.log('');
}
