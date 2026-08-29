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

const mintFor = async (userId, ttl = 3600) => {
  const s = await clerk.sessions.createSession({ userId });
  const t = await clerk.sessions.getToken(s.id, undefined, ttl);
  return t.jwt;
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
  console.log(`Clerk: ${live ? 'PRODUCTION (sk_live)' : 'development (sk_test)'} · api=${API}`);
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

      // Forces the DB row to exist. `ensureUser` auto-creates on this route, so
      // we do NOT race the user.created webhook — whichever wins, the row is
      // there before the profile POST.
      const me = await api('/api/users/me', { token });
      if (!me.ok) throw new Error(`/api/users/me -> ${me.status} ${JSON.stringify(me.body)}`);
      const dbUserId = me.body?.id ?? null;

      const prof = await api('/api/users/me/birth-profiles', { token, method: 'POST', body: birthData(i) });
      if (!prof.ok) throw new Error(`create profile -> ${prof.status} ${JSON.stringify(prof.body)}`);

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
  console.log(`Deleting ${users.length} Clerk users matching ${TAG}+*@${DOMAIN}.`);
  console.log('Each fires user.deleted -> erasePersonalData, which removes profiles,');
  console.log('readings AND the cached reading rows the run fabricated.\n');

  let deleted = 0;
  for (const u of users) {
    try { await clerk.users.deleteUser(u.id); deleted++; } catch (e) {
      console.log(`  failed ${u.emailAddresses?.[0]?.emailAddress}: ${e instanceof Error ? e.message : e}`);
    }
    process.stdout.write(`\rdeleted ${deleted}/${users.length}`);
    await sleep(120);
  }
  process.stdout.write('\n');

  // ⚠️ VERIFY. The deletes returning 200 says Clerk accepted them, not that 100
  // webhooks arrived and 100 erasePersonalData transactions committed. A silent
  // partial failure leaves fabricated readings cached in production.
  console.log('\nwaiting 20s for the deletion webhooks to land…');
  await sleep(20_000);
  const left = await listSeeded();
  if (left.length) {
    console.log(`\n⚠️  ${left.length} still present in Clerk — re-run --cleanup.`);
    process.exit(1);
  }
  console.log('Clerk side clean.');
  console.log(
    '\n⚠️  Verify the DB side too: the webhook is what erases readings and cache\n' +
      '   rows, and a webhook that never arrived leaves them behind. Check the\n' +
      '   admin users list for any remaining ' + TAG + ' account.',
  );
}

// ============================================================
if (has('cleanup')) await cleanup();
else if (has('status')) await status();
else if (has('seed')) await seed();
else {
  console.log('one of --seed | --status | --cleanup is required (all need --api <url>)');
  process.exit(1);
}
