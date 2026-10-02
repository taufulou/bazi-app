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
 * Verdicts: 🟠 ARMED (every replica points at the mock — the only safe state to
 * start k6), 🟢 NOT ARMED (every replica answered, none is armed, and each has a
 * built client on api.anthropic.com — the only passing teardown), 🟠 PARTIALLY
 * ARMED, 🟡 INCONCLUSIVE (a replica never answered, or a deploy is mid-roll), 🟡
 * NOT CONFIRMED (a replica has not built an Anthropic client yet — make AI calls
 * until each replica has served one, then re-run). Run it AFTER the redeploy that applies a variable change has
 * finished — Railway stages variable edits until deployed.
 *
 * #24 — `rateLimit`, `pools` and `aiBaseUrlEffective` are what ONE replica
 * observed, so the answers are grouped by `instance.replicaId`. By DEFAULT the
 * script keeps sampling (paced, at most 20 — the admin controller is throttled
 * at 30/min) until every expected replica has answered; `--samples N` takes
 * exactly N instead, e.g. to watch the counters over time.
 *
 * All decisions and output live in `ops-report.mjs` (pure, tested by
 * apps/api/test/ops-report.spec.ts); this file only fetches and prints.
 */
import { createClerkClient } from '@clerk/backend';
import { mintForUser, resolveFapiHost } from './clerk-auth.mjs';
import { SAMPLES_MAX, needMoreSamples, render } from './ops-report.mjs';

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

// No --samples → AUTO (sample until every replica has answered); --samples N → exactly N.
const samplesArg = arg('samples');
const samplesRaw = samplesArg === null ? null : Number.parseInt(samplesArg, 10);
const explicit = samplesArg === null ? null : Math.max(1, Number.isFinite(samplesRaw) ? samplesRaw : 1);
if (explicit !== null && explicit > SAMPLES_MAX) {
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
while (needMoreSamples(samples, { explicit })) {
  if (samples.length > 0) await new Promise((r) => setTimeout(r, 250));
  const r = await readOps();
  if (r.ok) { samples.push(r.body); continue; }
  if (samples.length === 0) { console.error(`GET /api/admin/ops -> ${r.status}`, r.text); process.exit(1); }
  console.log(r.status === 429
    ? `  ⚠️  Throttled (429) after ${samples.length} sample(s) — the admin endpoint allows 30/min.` +
      ' Reporting what was collected; wait 60s before running again.'
    : `  ⚠️  Sample ${samples.length + 1} failed (${r.status}); reporting the ${samples.length} collected.`);
  break;
}

for (const line of render(samples)) console.log(line);
