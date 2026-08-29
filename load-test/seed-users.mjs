#!/usr/bin/env node
/**
 * L4 — seed (and remove) the test users the k6 scenarios drive.
 *
 * ## Why 100 distinct users and not one user × 100 VUs
 *
 * M1 keys rate limiting per authenticated userId and S4 rations per user per
 * day. A hundred VUs sharing one account would hit one throttle bucket and one
 * 20-reading quota, so the run would measure our own rationing rather than
 * capacity — a pass or fail that says nothing about the system under test.
 *
 * ## Everything here must be reversible, including what the RUN creates
 *
 * The load test leaves fabricated readings behind, and readings are cached by
 * a hash of the birth data — so without cleanup those mock narratives sit in
 * production and would be served, as real, to anyone whose birth data matches.
 *
 * The good news is that the app already solves this: deleting a Clerk user
 * fires the `user.deleted` webhook into `UsersService.erasePersonalData`, which
 * removes fortune snapshots, chat, comparisons, readings, birth profiles AND
 * the content-addressed `ReadingCache` rows. So cleanup is "delete the Clerk
 * users" and the PDPA machinery does the rest.
 *
 * ⚠️ That depends on 100 webhooks each arriving and succeeding, which is not
 * something to assume. `--cleanup` therefore VERIFIES afterwards against the
 * admin API and reports anything left behind, rather than reporting success
 * because the delete calls returned 200.
 *
 * ## Facts established by probing the real Clerk API, not by assumption
 *
 * - Reserved TLDs (`.example`, `.test`) are REJECTED — "must be a valid email
 *   address". So addresses use a real domain: `loadtest+NNN@tianmingapp.com`.
 * - Backend-created users come back `verification: verified`, `strategy: admin`
 *   — no verification email is sent, so seeding 100 does not flood an inbox.
 * - This instance requires an email address; username-only creation fails.
 *
 * ## Usage
 *
 *   export CLERK_SECRET_KEY=sk_live_...        # in YOUR shell, never pasted elsewhere
 *   node load-test/seed-users.mjs --seed --count 100 --api https://<api-host>
 *   node load-test/seed-users.mjs --status     --api https://<api-host>
 *   node load-test/seed-users.mjs --cleanup    --api https://<api-host>
 */

import { writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { createClerkClient } from '@clerk/backend';
import { mintForUser, resolveFapiHost } from './clerk-auth.mjs';

const argv = process.argv;
const has = (f) => argv.includes(`--${f}`);
const arg = (f, d = null) => {
  const i = argv.indexOf(`--${f}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const SECRET = process.env.CLERK_SECRET_KEY;
if (!SECRET) {
  console.error('CLERK_SECRET_KEY is not set. Export it in YOUR shell.');
  process.exit(1);
}
const API = (arg('api') || '').replace(/\/$/, '');
if (!API) { console.error('--api <url> is required'); process.exit(1); }

const COUNT = Number(arg('count', '100'));
const CREDITS = Number(arg('credits', '200'));
const DOMAIN = arg('domain', 'tianmingapp.com');
const TAG = arg('tag', 'loadtest');
const MANIFEST = new URL('./seed-manifest.json', import.meta.url).pathname;

const clerk = createClerkClient({ secretKey: SECRET });
const live = SECRET.startsWith('sk_live_');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const email = (i) => `${TAG}+${String(i).padStart(3, '0')}@${DOMAIN}`;

/**
 * Birth data deliberately far from any plausible real user.
 *
 * Readings are cached by a hash of (date, time, city, gender, type, year), so
 * a fabricated reading is only ever served to someone whose birth data matches
 * exactly. Dates in the 1920s with a distinctive minute make that collision
 * effectively impossible, and 100 DISTINCT dates keep the engine doing real
 * per-chart work instead of hitting its own caches.
 */
function birthData(i) {
  const d = new Date(Date.UTC(1920, 0, 1));
  d.setUTCDate(d.getUTCDate() + i * 3);
  return {
    name: `LoadTest ${String(i).padStart(3, '0')}`,
    birthDate: d.toISOString().slice(0, 10),
    birthTime: '03:37',
    birthCity: '台北市',
    birthTimezone: 'Asia/Taipei',
    gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
    relationshipTag: 'SELF',
    isPrimary: true,
  };
}

const api = async (path, { token, method = 'GET', body } = {}) => {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, body: json ?? text.slice(0, 300) };
};

const FAPI = resolveFapiHost({ flag: arg('fapi'), publishableKey: process.env.CLERK_PUBLISHABLE_KEY });

/**
 * ⚠️ NOT `sessions.createSession()`. That is development-instance ONLY and
 * fails on production with `request_invalid_for_environment` — found by running
 * the seeder against production after it passed against dev. See clerk-auth.mjs.
 */
let warnedShortTtl = false;
const mintFor = async (userId, ttl = 3600) => {
  const r = await mintForUser(clerk, userId, { ttl, fapi: FAPI });
  if (!r.extended && !warnedShortTtl) {
    warnedShortTtl = true;
    console.warn('\n⚠️  Could not extend token lifetime — these expire in 60s.');
  }
  return r.jwt;
};

/** The admin account, for credit top-ups. Found by role, not hardcoded. */
async function findAdmin() {
  let offset = 0;
  for (;;) {
    const page = await clerk.users.getUserList({ limit: 100, offset });
    if (!page.data.length) return null;
    const hit = page.data.find((u) => u.publicMetadata?.role === 'admin');
    if (hit) return hit;
    if (page.data.length < 100) return null;
    offset += page.data.length;
  }
}

async function listSeeded() {
  const out = [];
  let offset = 0;
  for (;;) {
    const page = await clerk.users.getUserList({ limit: 100, offset });
    if (!page.data.length) break;
    for (const u of page.data) {
      const e = u.emailAddresses?.[0]?.emailAddress ?? '';
      if (e.startsWith(`${TAG}+`) && e.endsWith(`@${DOMAIN}`)) out.push(u);
    }
    if (page.data.length < 100) break;
    offset += page.data.length;
  }
  return out;
}

// ============================================================
async function seed() {
  console.log(`Clerk: ${live ? 'PRODUCTION (sk_live)' : 'development (sk_test)'} · api=${API} · fapi=${FAPI}`);
  console.log(`Seeding ${COUNT} users as ${email(0)} … ${email(COUNT - 1)}\n`);

  const admin = await findAdmin();
  if (!admin) {
    console.error('No user has publicMetadata.role === "admin". Credit top-ups need one.');
    process.exit(1);
  }
  const adminToken = await mintFor(admin.id, 7200);
  console.log(`admin for top-ups: ${admin.emailAddresses?.[0]?.emailAddress}\n`);

  const manifest = { createdAt: new Date().toISOString(), api: API, tag: TAG, domain: DOMAIN, users: [] };
  const failures = [];

  for (let i = 0; i < COUNT; i++) {
    const addr = email(i);
    try {
      let user;
      try {
        user = await clerk.users.createUser({
          emailAddress: [addr],
          skipPasswordRequirement: true,
          publicMetadata: { loadTest: true, seededAt: new Date().toISOString() },
        });
      } catch (e) {
        // Idempotent re-run: reuse an existing address rather than aborting.
        const existing = (await clerk.users.getUserList({ emailAddress: [addr], limit: 1 })).data[0];
        if (!existing) throw e;
        user = existing;
      }

      const token = await mintFor(user.id);

      // ⚠️ Profile FIRST, then /me. Not the other way round.
      //
      // `GET /api/users/me` calls `findByClerkId`, which 404s when the DB row
      // does not exist yet — it does NOT auto-create. `createBirthProfile` is
      // one of the six service methods that DO call `ensureUser`, so the POST
      // is what brings the user into existence. Doing `/me` first fails every
      // time for a fresh Clerk user, which is exactly what the 3-user trial
      // run showed: 3/3 failed with 404 User not found.
      //
      // This also means we never race the `user.created` webhook: whichever
      // arrives first, the row exists before we read it back.
      const prof = await api('/api/users/me/birth-profiles', { token, method: 'POST', body: birthData(i) });
      if (!prof.ok) throw new Error(`create profile -> ${prof.status} ${JSON.stringify(prof.body)}`);

      const me = await api('/api/users/me', { token });
      if (!me.ok) throw new Error(`/api/users/me -> ${me.status} ${JSON.stringify(me.body)}`);
      const dbUserId = me.body?.id ?? null;

      manifest.users.push({
        index: i, email: addr, clerkUserId: user.id, dbUserId,
        birthProfileId: prof.body?.id ?? null, birthDate: birthData(i).birthDate,
      });
      process.stdout.write(`\rcreated ${manifest.users.length}/${COUNT}`);
    } catch (e) {
      failures.push({ email: addr, error: e instanceof Error ? e.message : String(e) });
    }
    // Clerk's backend API is rate limited; a tight loop of 100 will trip it.
    await sleep(120);
  }
  process.stdout.write('\n');

  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  chmodSync(MANIFEST, 0o600);
  console.log(`manifest -> ${MANIFEST}`);

  // Credit top-ups last, and paced: the admin routes are throttled at 30/min
  // and every one of these uses the SAME admin token, so they all land in one
  // bucket. 100 calls therefore take ~3.5 minutes no matter how fast we ask.
  console.log(`\ntopping up ${CREDITS} credits each (paced for the 30/min admin throttle)…`);
  let topped = 0;
  for (const u of manifest.users) {
    if (!u.dbUserId) continue;
    const r = await api(`/api/admin/users/${u.dbUserId}/credits`, {
      token: adminToken, method: 'PATCH',
      body: { amount: CREDITS, reason: `Phase 3 load test seed (${TAG})` },
    });
    if (r.ok) topped++;
    else if (r.status === 429) { await sleep(3000); }
    process.stdout.write(`\rcredited ${topped}/${manifest.users.length}`);
    await sleep(2100);
  }
  process.stdout.write('\n');

  console.log(`\nseeded ${manifest.users.length}/${COUNT} · credited ${topped}`);
  if (failures.length) {
    console.log(`\n${failures.length} failed:`);
    for (const f of failures.slice(0, 10)) console.log(`  ${f.email}: ${f.error}`);
  }
  console.log(`\nNext: node load-test/mint-tokens.mjs --match '${TAG}+' --ttl 4200 --verify ${API}`);
}

// ============================================================
async function status() {
  const users = await listSeeded();
  console.log(`Clerk users matching ${TAG}+*@${DOMAIN}: ${users.length}`);
  if (existsSync(MANIFEST)) {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    console.log(`manifest: ${m.users.length} recorded, created ${m.createdAt}`);
  } else {
    console.log('manifest: (none — cleanup will fall back to matching by email)');
  }
}

// ============================================================
async function cleanup() {
  const users = await listSeeded();
  if (!users.length) { console.log('nothing to clean up'); return; }

  console.log(`Removing ${users.length} seeded accounts.\n`);
  console.log('Using the app\'s own DELETE /api/users/me, which calls');
  console.log('erasePersonalData (profiles, readings, chat AND the cached reading');
  console.log('rows the run fabricated), then deletes the Clerk user itself.\n');

  let erased = 0;
  const stubborn = [];
  for (const u of users) {
    const addr = u.emailAddresses?.[0]?.emailAddress ?? u.id;
    try {
      const token = await mintFor(u.id, 600);
      // acknowledgeIap because the route refuses when a store subscription may
      // still be live; seeded users have none, and passing it is harmless.
      const r = await api('/api/users/me?acknowledgeIap=true', { token, method: 'DELETE' });
      if (r.ok) erased++;
      else stubborn.push({ addr, why: `DELETE /me -> ${r.status} ${JSON.stringify(r.body)}` });
    } catch (e) {
      stubborn.push({ addr, why: e instanceof Error ? e.message : String(e) });
    }
    process.stdout.write(`\rerased ${erased}/${users.length}`);
    await sleep(150);
  }
  process.stdout.write('\n');

  // Fallback ONLY for accounts the app-side delete could not handle. This
  // removes the Clerk user without erasing the DB, so it is reported loudly
  // rather than counted as success.
  if (stubborn.length) {
    console.log(`\n${stubborn.length} could not be removed through the app:`);
    for (const s2 of stubborn.slice(0, 10)) console.log(`  ${s2.addr}: ${s2.why}`);
    console.log('\nDeleting their Clerk users directly as a fallback.');
    console.log('⚠️  That does NOT erase their DB rows unless the user.deleted');
    console.log('   webhook arrives — verify below and purge by hand if needed.');
    for (const s2 of stubborn) {
      const hit = users.find((u) => (u.emailAddresses?.[0]?.emailAddress ?? u.id) === s2.addr);
      if (hit) { try { await clerk.users.deleteUser(hit.id); } catch {} }
    }
  }

  // ⚠️ VERIFY — but on the right signal.
  //
  // Two dead ends found while testing this, both of which would have reported
  // a false all-clear:
  //
  // 1. The first version deleted Clerk users and trusted the `user.deleted`
  //    webhook to erase the database. Against a local API that left 3 of 3
  //    profiles behind — the webhook never arrived.
  // 2. The second version queried the admin API and filtered rows on `email`.
  //    The `users` table HAS NO EMAIL COLUMN, so that filter matches nothing
  //    and reports clean no matter what. `deleteAccount` also ANONYMISES the
  //    row rather than removing it, so "does the user still exist" is not the
  //    question either.
  //
  // The sound signal is the DELETE itself: `deleteAccount` runs
  // `erasePersonalData` synchronously inside the request, so a 200 IS the
  // receipt that profiles, readings and cache rows are gone. No webhook, no
  // polling, nothing to race.
  console.log('\nverifying…');
  const leftInClerk = await listSeeded();
  const allErased = erased === users.length;

  console.log(`  erased through the app:   ${erased}/${users.length}${allErased ? '' : '  ← DB residue for the rest'}`);
  console.log(`  Clerk accounts remaining: ${leftInClerk.length}`);

  if (!allErased || leftInClerk.length) {
    console.log('\n⚠️  NOT clean. Re-run --cleanup.');
    if (!allErased) {
      console.log('   Accounts that failed the app-side delete may still hold birth');
      console.log('   profiles, readings and CACHED readings. Confirm with:');
      console.log("     select count(*) from birth_profiles where name like 'LoadTest %';");
    }
    process.exit(1);
  }
  console.log('\nclean — every account erased through the app, Clerk clear.');
}

// ============================================================
if (has('cleanup')) await cleanup();
else if (has('status')) await status();
else if (has('seed')) await seed();
else {
  console.log('one of --seed | --status | --cleanup is required (all need --api <url>)');
  process.exit(1);
}
