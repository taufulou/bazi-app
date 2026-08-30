#!/usr/bin/env node
/**
 * L3 — mint the bearer tokens k6 needs.
 *
 * ## The problem the plan posed, and why its two answers were both wrong here
 *
 * Clerk session JWTs live 60 seconds. L3 offered two ways round that: a
 * raised-lifetime JWT template on the **dev** instance, or a sidecar refreshing
 * tokens every minute.
 *
 * The first cannot work. L2 says the load test runs against PRODUCTION, and a
 * dev-instance token cannot authenticate against prod — different issuer,
 * different JWKS. The second is a service that mints valid production
 * credentials on demand, which is a serious thing to deploy and then remember
 * to delete.
 *
 * Neither is necessary. `sessions.getToken()` takes a per-token
 * `expiresInSeconds`, so a long-enough-lived token can be minted WITHOUT
 * touching any JWT template and without deploying anything. Measured against
 * @clerk/backend 2.33.5: 60s, 3600s and 14400s were all honoured exactly.
 *
 * ## ⚠️ These are live production credentials. Two properties, both measured.
 *
 * 1. **Revoking the session does NOT invalidate a token already minted from
 *    it.** Verified: mint → revoke → wait → `verifyToken` still ACCEPTS. The
 *    guard checks signature and expiry; it does not make a network call to ask
 *    whether the session still exists. So "revoke afterwards" is not a control,
 *    it is a comfort. **The only real control is a short lifetime** — hence
 *    `--ttl`, which defaults to just over an hour rather than a day.
 *
 * 2. The minted token carries **no `azp` claim**, so Clerk's
 *    `authorizedParties` check short-circuits and passes. That is why these
 *    work against production even though `CLERK_AUTHORIZED_PARTIES` is set —
 *    and it is the kind of thing that would otherwise be discovered at the
 *    start of a booked load-test window.
 *
 * `tokens.json` is written 0600 and is gitignored. Treat it like an SSH key
 * until it expires; deleting it is the disposal, not revocation.
 *
 * ## Usage
 *
 *   # the secret must ALREADY be in your shell — never paste it into a chat
 *   export CLERK_SECRET_KEY=sk_live_...
 *   node load-test/mint-tokens.mjs --match '+loadtest' --ttl 4200 \
 *        --verify https://bazi-app-production-5e54.up.railway.app
 *
 * Flags:
 *   --match <s>   only users whose primary email contains this (default: +loadtest)
 *   --ids a,b,c   explicit Clerk user ids instead of a match
 *   --ttl <sec>   token lifetime (default 4200 = 70 min)
 *   --limit <n>   max users (default 100)
 *   --verify <url>  call <url>/api/users/me with the first token and report
 *   --out <path>  default load-test/tokens.json
 */

import { writeFileSync, chmodSync } from 'node:fs';
import { createClerkClient } from '@clerk/backend';
import { mintForUser, resolveFapiHost } from './clerk-auth.mjs';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const SECRET = process.env.CLERK_SECRET_KEY;
if (!SECRET) {
  console.error('CLERK_SECRET_KEY is not set. Export it in YOUR shell — do not paste it anywhere else.');
  process.exit(1);
}

const MATCH = arg('match', '+loadtest');
const IDS = arg('ids');
const TTL = Number(arg('ttl', '4200'));
const LIMIT = Number(arg('limit', '100'));
const VERIFY = arg('verify');
const OUT = arg('out', new URL('./tokens.json', import.meta.url).pathname);

// A lifetime long enough to be forgotten is the failure mode. 12h is well past
// any scenario in L4 (the longest is a 60-minute soak).
if (!Number.isFinite(TTL) || TTL < 60 || TTL > 43_200) {
  console.error(`--ttl must be 60..43200 seconds (got ${TTL}). These are live credentials that revocation cannot recall.`);
  process.exit(1);
}

const live = SECRET.startsWith('sk_live_');
console.log(`Clerk instance: ${live ? 'PRODUCTION (sk_live)' : 'development (sk_test)'} · ttl=${TTL}s`);

const clerk = createClerkClient({ secretKey: SECRET });

const users = [];
if (IDS) {
  for (const id of IDS.split(',').map((s) => s.trim()).filter(Boolean)) {
    users.push(await clerk.users.getUser(id));
  }
} else {
  // Paginate rather than assuming one page covers it.
  let offset = 0;
  while (users.length < LIMIT) {
    const page = await clerk.users.getUserList({ limit: 100, offset });
    if (!page.data.length) break;
    for (const u of page.data) {
      const email = u.emailAddresses?.[0]?.emailAddress ?? '';
      if (email.includes(MATCH)) users.push(u);
      if (users.length >= LIMIT) break;
    }
    offset += page.data.length;
    if (page.data.length < 100) break;
  }
}

if (!users.length) {
  console.error(
    `No users matched ${IDS ? `ids=${IDS}` : `--match '${MATCH}'`}.\n` +
      `Seed them first, or pass --ids. Refusing to mint for arbitrary accounts: a\n` +
      `match that silently falls back to "everyone" would hand out live tokens for\n` +
      `real users.`,
  );
  process.exit(1);
}

const FAPI = resolveFapiHost({ flag: arg('fapi'), publishableKey: process.env.CLERK_PUBLISHABLE_KEY });
console.log(`frontend API: ${FAPI}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const minted = [];
const mintFailures = [];
let anyShort = false;
for (const u of users) {
  try {
    // ⚠️ NOT createSession — dev-instance only. See clerk-auth.mjs.
    const r = await mintForUser(clerk, u.id, { ttl: TTL, fapi: FAPI });
    if (!r.extended) anyShort = true;
    minted.push({
      userId: u.id,
      email: u.emailAddresses?.[0]?.emailAddress ?? null,
      sessionId: r.sessionId,
      ttlSeconds: r.ttlSeconds,
      token: r.jwt,
    });
  } catch (e) {
    // ⚠️ Do NOT abort the run. The first version threw, which discarded five
    // successfully minted tokens because the sixth was rate limited. Ninety
    // tokens are perfectly usable; zero are not.
    mintFailures.push({ email: u.emailAddresses?.[0]?.emailAddress ?? u.id, why: e instanceof Error ? e.message : String(e) });
  }
  process.stdout.write(`\rminted ${minted.length}/${users.length}${mintFailures.length ? ` (${mintFailures.length} failed)` : ''}`);
  // The Frontend API is browser-shaped and tightly limited. Pacing keeps the
  // retry path in clerk-auth.mjs as a backstop rather than the normal case.
  await sleep(250);
}
process.stdout.write('\n');

if (!minted.length) {
  console.error('\nEvery mint failed. First error:', mintFailures[0]?.why);
  process.exit(1);
}
if (mintFailures.length) {
  console.warn(`\n⚠️  ${mintFailures.length} of ${users.length} could not be minted; continuing with ${minted.length}.`);
  for (const f of mintFailures.slice(0, 5)) console.warn(`   ${f.email}: ${f.why}`);
}
if (anyShort) {
  console.warn('\n⚠️  Lifetime could not be extended — some tokens expire in 60s.');
  console.warn('   k6 must refresh them mid-run, or re-run this between scenarios.');
}
process.stdout.write('\n');

const expiresAt = new Date(Date.now() + TTL * 1000).toISOString();
writeFileSync(OUT, JSON.stringify({ mintedAt: new Date().toISOString(), expiresAt, ttlSeconds: TTL, tokens: minted }, null, 2));
chmodSync(OUT, 0o600);
console.log(`wrote ${minted.length} tokens -> ${OUT} (0600), all expire ${expiresAt}`);

if (VERIFY) {
  const url = VERIFY.replace(/\/$/, '') + '/api/users/me';
  const res = await fetch(url, { headers: { Authorization: `Bearer ${minted[0].token}` } });
  const ok = res.status === 200;
  console.log(`verify ${url} -> ${res.status} ${ok ? 'OK — tokens authenticate against this API' : 'FAILED'}`);
  if (!ok) {
    console.error(await res.text());
    console.error(
      '\nIf this is 401 against production, the secret is probably the DEV one:\n' +
        'a dev-instance token cannot authenticate against the production instance.',
    );
    process.exit(1);
  }
}

console.log(
  `\n⚠️  ${OUT} now holds ${minted.length} live credentials.\n` +
    `   Revoking the sessions will NOT invalidate them (measured) — they are\n` +
    `   valid until ${expiresAt} no matter what. Delete the file when done.`,
);
