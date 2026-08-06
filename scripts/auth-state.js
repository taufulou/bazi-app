#!/usr/bin/env node
/**
 * Mint a real Clerk session and save it as a Playwright storageState.
 *
 *   node scripts/auth-state.js --base http://localhost:3100 \
 *        --email taufulou@gmail.com --out /tmp/clerk-state.json
 *
 * WHY THIS EXISTS
 * ---------------
 * `apps/web/middleware.ts` runs Clerk's server-side `auth.protect()` on every
 * non-public route. The repo's `__e2e_auth=1` cookie is read CLIENT-side only
 * (SignedOutRedirect / auth-redirect) and therefore CANNOT satisfy it — so
 * without a real session a sweep reaches only /reading/*, /sign-in and /sign-up,
 * and even those render just the birth-data form. The reading result,
 * AIReadingDisplay, BaziChart and the AI-narrated CJK prose — the surfaces the
 * typography migration exists for — are invisible.
 *
 * HOW
 * ---
 * Clerk's Backend API mints a short-lived sign-in TICKET for a user id; the
 * frontend SDK exchanges it via `signIn.create({ strategy: 'ticket' })`. No
 * password is handled, and nothing is written to the user's account.
 *
 * ⚠️ SESSIONS EXPIRE, AND EXPIRY IS SILENT. When it lapses mid-run the reading
 * page falls back to the birth-data form and a naive sweep reports the FORM's
 * numbers under a reading route's name. Run this IMMEDIATELY before a sweep, and
 * keep `type-sweep.js`'s content-render assertion — that is what turns a silent
 * wrong answer into a loud failure.
 *
 * ⚠️ DEV INSTANCE ONLY. Refuses to run against a live Clerk key.
 */
const fs = require('fs');
const path = require('path');

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};

const BASE = arg('--base', 'http://localhost:3100');
const EMAIL = arg('--email', null);
const OUT = arg('--out', '/tmp/clerk-state.json');
const ENV = arg('--env', path.resolve(__dirname, '../apps/web/.env.local'));

function readEnv(file, key) {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(key + '='));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') : null;
}

(async () => {
  const sk = readEnv(ENV, 'CLERK_SECRET_KEY');
  if (!sk) {
    console.error(`No CLERK_SECRET_KEY in ${ENV}`);
    process.exit(2);
  }
  if (!sk.startsWith('sk_test_')) {
    console.error('Refusing to run: CLERK_SECRET_KEY is not a dev (sk_test_) key.');
    process.exit(2);
  }

  const api = (p, init) =>
    fetch('https://api.clerk.com/v1' + p, {
      ...init,
      headers: { Authorization: `Bearer ${sk}`, 'Content-Type': 'application/json', ...(init?.headers) },
    }).then((r) => r.json());

  const users = await api('/users?limit=20');
  if (!Array.isArray(users)) {
    console.error('Clerk API error:', JSON.stringify(users).slice(0, 200));
    process.exit(2);
  }
  const user = EMAIL
    ? users.find((u) => (u.email_addresses || []).some((e) => e.email_address === EMAIL))
    : users[0];
  if (!user) {
    console.error(`No user${EMAIL ? ` matching ${EMAIL}` : ''} on this dev instance.`);
    process.exit(2);
  }
  const who = (user.email_addresses || [{}])[0].email_address;

  const tok = await api('/sign_in_tokens', {
    method: 'POST',
    body: JSON.stringify({ user_id: user.id, expires_in_seconds: 3600 }),
  });
  if (!tok.token) {
    console.error('Ticket mint failed:', JSON.stringify(tok).slice(0, 200));
    process.exit(2);
  }

  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Clerk && window.Clerk.loaded, { timeout: 30000 });

  const res = await page.evaluate(async (t) => {
    try {
      const si = await window.Clerk.client.signIn.create({ strategy: 'ticket', ticket: t });
      if (si.status !== 'complete') return { ok: false, status: si.status };
      await window.Clerk.setActive({ session: si.createdSessionId });
      return { ok: true };
    } catch (e) {
      return { ok: false, err: String(e.message || e).slice(0, 200) };
    }
  }, tok.token);

  if (!res.ok) {
    console.error('Ticket exchange failed:', JSON.stringify(res));
    await browser.close();
    process.exit(2);
  }
  await page.waitForTimeout(2500);

  // Prove the session actually works against a PROTECTED route before saving —
  // a storageState that does not authenticate is worse than none, because the
  // sweep then silently measures signed-out pages.
  await page.goto(`${BASE}/dashboard/profiles`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const landed = new URL(page.url()).pathname;
  if (landed !== '/dashboard/profiles') {
    console.error(`Session did not authenticate: /dashboard/profiles -> ${landed}`);
    await browser.close();
    process.exit(2);
  }

  await ctx.storageState({ path: OUT });
  await browser.close();
  console.log(`session for ${who} -> ${OUT}  (verified against /dashboard/profiles)`);
  console.log('Run the sweep NOW — Clerk sessions lapse, and expiry is silent.');
})();
