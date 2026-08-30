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

const { jwt } = await mintForUser(clerk, admin.id, { ttl: 600, fapi: FAPI });
const res = await fetch(`${API}/api/admin/ops`, { headers: { Authorization: `Bearer ${jwt}` } });
if (!res.ok) { console.error(`GET /api/admin/ops -> ${res.status}`, await res.text()); process.exit(1); }
const ops = await res.json();

const eff = ops.aiBaseUrlEffective;
const armed = !!eff && !eff.includes('api.anthropic.com');

console.log('');
console.log(armed
  ? '  🟠 ARMED — AI traffic is going to the MOCK, not to Anthropic.'
  : '  🟢 NOT ARMED — AI traffic is going to the real Anthropic API.');
console.log('');
console.log(`  aiBaseUrlEffective : ${eff ?? '(no client built yet on this replica)'}`);
console.log(`  aiBaseUrlOverride  : ${ops.aiBaseUrlOverride ?? 'null'}`);
console.log('');
console.log(`  replicas           : ${ops.replicas}`);
console.log(`  pools.reading      : inFlight=${ops.pools.reading.inFlight} limit=${ops.pools.reading.limit} peak=${ops.pools.reading.peak}`);
console.log(`  pools.interactive  : inFlight=${ops.pools.interactive.inFlight} limit=${ops.pools.interactive.limit} peak=${ops.pools.interactive.peak}`);
console.log(`  spend today        : $${ops.spend.dayUsd ?? '?'} / $${ops.spend.dayLimitUsd} (${ops.spend.dayPct ?? '?'}%)`);
console.log(`  breaker            : ${ops.breaker.trippedOn ?? 'healthy'}`);
console.log(`  rate limit         : ${ops.rateLimit.outputTokensRemaining ?? '(not yet observed)'} output tokens left`);
console.log('');

if (eff === null) {
  console.log('  ⚠️  Null means no Anthropic client has been built on the replica that');
  console.log('     served this request — not that nothing is overridden. There are');
  console.log(`     ${ops.replicas} replicas; run this again, or after one AI call, to be sure.`);
  console.log('');
}
