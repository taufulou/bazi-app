# Security review brief — Bazi SaaS (tianmingapp.com)

You are doing an **independent, adversarial security review** of what is
currently deployed to production. A previous session did the security
implementation work. **You are not that session, and that is the point.**

Your job is to find what that work missed. Read this brief, then choose your own
angles — it deliberately does NOT hand you a checklist of areas to cover,
because a checklist written by the implementer reproduces the implementer's
blind spots.

---

## 1. ⚠️ The most important instruction: the docs are CLAIMS, not findings

`CLAUDE.md` is very long and was written largely by the sessions that did the
work being reviewed. So were `docs/security/audit-2026-08.md`,
`docs/ops/*.md`, and `.claude/plans/launch-security-phase1-session-handoff.md` (in this repo).

**Treat every security assertion in them as a claim to falsify, not as
ground truth.** A review that trusts those documents inherits exactly the
blind spots it exists to find.

A useful distinction while reading:

| Shape of claim | What to do |
|---|---|
| "Measured 2026-08-27: 25 requests, 20×201 then 429" | Checkable. Re-derive if cheap; otherwise accept and note you accepted it. |
| "Verified in production on <date>" | Checkable. Re-probe if it is a live endpoint. |
| "This is safe" / "this is correct" / "covered" | **A conclusion. Re-derive from the code. Do not accept.** |

If you find a doc claim that is wrong, that is itself a finding — the docs
drive future work.

---

## 2. Scope

**IN — everything on `main`, which is what is deployed:**

- `apps/api` — NestJS. The bulk of the surface. 15 controllers:
  `admin`, `ads`, `banner`, `bazi`, `chat` (×3), `fortune`, `health`, `legal`,
  `payments`, `users`, and webhooks (`clerk`, `revenuecat`, `stripe`).
- `apps/web` — Next.js. Middleware lockdown, CSP, client auth handling.
- `apps/mobile` — Expo React Native. **IS merged into main and IS in scope.**
  (Some docs still say "47 commits, not pushed" — that is stale, corrected
  2026-09-26.) Not publicly released: Android is in Play Internal Testing,
  iOS awaits Apple. Review it anyway; it ships soon.
- `packages/bazi-engine` — Python FastAPI. Private, no public domain, keyed
  auth in enforce mode.

**OUT:**

- **The Stripe payment path's CONFIGURATION.** Stripe is still in TEST mode, so
  live webhook endpoint, live signing secret and the live-mode portal config
  do not exist yet and cannot be reviewed. Review payment *code paths* if you
  wish, but do not conclude "payments are fine" from a test-mode setup — flag
  config as unverified and out of scope.
- **Unmerged branches** — `claude/elastic-pascal-cc5187` (+34, fortune work),
  `claude/deps-security-patches` (+2), and several small ones. Not deployed.
- **ZWDS** — deleted 2026-08-16. Docs still describe it in places; it is gone.

---

## 3. Production facts you need

| | |
|---|---|
| Web | `https://tianmingapp.com` (Railway, port 8080) |
| API | `https://bazi-app-production-5e54.up.railway.app` — an API, `GET /` 404s correctly. Health: `/health`, `/health/ready`. Everything else under `/api/...`. Legal pages at `/privacy`, `/terms` (outside the `/api` prefix). |
| Engine | Private, no public domain. Keyed auth, `ENGINE_REQUIRE_KEY=1`. |
| Auth | Clerk production instance. Google sign-in live. |
| Replicas | API runs **2**. Several pieces of state are per-process — a single probe may hit either replica. |
| Users | **Zero real users.** Production doubles as the test environment. |

---

## 4. Rules of engagement

1. **Production doubles as the test environment, but that ends the moment one
   real user exists.** Assume it could end at any time. Nothing you do should be
   something you would regret if a real account existed.
2. **Read-only by default.** Anything that writes, deletes, spends money
   (Anthropic calls cost real money), or changes configuration needs the user's
   explicit go-ahead first. Say what it will cost.
3. **Never disable a control in production to prove it works.** Reason about it,
   or test it locally.
4. **Secrets must never enter the transcript.** The production
   `CLERK_SECRET_KEY` (`sk_live_`) and the Postgres connection string are the
   user's to handle — if a check needs one, write the command and have the user
   run it in their own shell, then read their pasted output.
   (A DB password was leaked into a chat this way on 2026-09-21 and had to be
   rotated. Do not repeat it.)
5. **Do not run `npm audit fix` from a worktree** — `node_modules` is a symlink
   into the main checkout and the install writes through it.
6. There may be an in-app browser with a live signed-in production session.
   If so it is useful for probing authenticated endpoints read-only. Check
   whether the session is actually signed in before drawing conclusions from
   what a page renders — an anonymous-looking result may just be a signed-in
   one, and vice versa.

---

## 5. A domain rule that is easy to miss

**The four pillars (四柱 / 干支) are personal data.** They look like opaque
symbols, so the instinct is to treat them as harmless. Year + month + day
pillars pin a birth date to roughly one candidate per 60-year cycle; the hour
pillar narrows to a two-hour window. With the city and gender that travel in
the same payload, the set identifies a person.

A single low-entropy field (e.g. `dayMasterStem`, 1-of-10) is fine. **The set is
not.** Anywhere they could reach logs, telemetry, error reports, analytics, URLs
or a third party is a finding.

---

## 6. Already known — do NOT spend your signal rediscovering these

These are recorded as open items. Reporting them again is noise; finding
something *adjacent* to them is valuable.

| Known gap | State |
|---|---|
| **No database backups exist.** No restore has ever been performed. | Open, acknowledged |
| Redis-down, engine-down and Postgres-restore drills | Never run |
| **HEALTH readings requested with `stream: true` deliver LIFETIME content** — the streaming dispatcher has no HEALTH case and falls through to `default: streamLifetimeV2`. Latent: current clients send HEALTH inline. | Open (#3) |
| Stripe in test mode | Open (#4) |
| `redis.acquireLock` stores constant `'1'`, `releaseLock` is a bare `DEL` — no ownership token, so an expired holder can delete a successor's lock. TTL fix removed the trigger, not the hazard. | Open (#23) |
| `/api/admin/ops` → `rateLimit.*` read `null` after a real streamed reading | Open (#24), probably the replica split |
| **Mobile `Sentry.init` has no `beforeSend`/`beforeSendTransaction`/`sendDefaultPii`** unlike api/web/engine. Currently inert — the DSN is empty — arms at M7. | Open (#25) |

The full list is `.claude/plans/launch-security-phase1-session-handoff.md` (in this repo)
→ section `## ✅ THE TODO LIST`. Read it so you do not re-report; do not treat
its reasoning as verified.

---

## 7. Standard of evidence

The single most repeated failure in this codebase's history is **a well-covered
helper behind untested wiring** — the pure function has thorough tests, and the
thing that calls it has none. A second recurring shape is **a sibling path doing
the same thing, unfixed.** When you find a control, ask *per call site* whether
it is actually reached, and check whether a twin path exists.

For each finding, state:

- **CONFIRMED** — you observed it (ran it, probed it, read the value), or
- **PLAUSIBLE** — you reasoned it from the code but did not observe it.

Do not blur the two. A plausible finding is still worth reporting; mislabelling
it as confirmed is not.

A finding needs a **concrete failure scenario**: what input, state, actor or
timing makes it go wrong, and what the attacker or unlucky user gets. "This
looks risky" is not a finding.

---

## 8. What to produce

1. **Findings**, ranked most severe first. Each with: `file:line`, one-sentence
   claim, concrete failure scenario, CONFIRMED/PLAUSIBLE, and suggested fix.
2. **Coverage** — what you actually examined and found clean. A review that
   reports only findings does not tell the reader what was looked at, so a
   clean area and an unexamined area are indistinguishable. List both.
3. **What you could not check, and why** — needed a secret, needed prod
   mutation, needed live Stripe, ran out of scope.
4. **Doc corrections** — any claim in `CLAUDE.md` / `docs/security/` /
   the handoff that you found to be wrong or stale.

Do not fix anything unless the user asks. Report first.

---

## 9. Getting the environment right

- Node: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`
- Lint runs from the **repo root** across five workspaces:
  `./node_modules/.bin/turbo run lint --force` (check the `Cached:` line —
  `0 cached` is the only proof it ran).
- Jest runs from **each app's own directory** with `npx --no-install jest`.
  The root-hoisted jest is two majors behind `apps/web`'s and mixing them
  corrupts the shared ts-jest cache.
- `CLAUDE.md` has a long Worktree Development Guide. Read the parts you need;
  remember the caveat in §1 about what else it says.
