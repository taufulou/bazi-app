# 1D — secret scan & dependency audit

Run 2026-08-14. Scope: full git history (399 commits, all branches) + `npm audit` across the workspace + the Python engine's installed set.

---

## D1 — secrets in history: CLEAN

**No live secret found in any commit.** Two matches, both verified benign:

| Match | Where | Verdict |
|---|---|---|
| `whsec_…` | `apps/api/test/webhook-hardening.spec.ts:26` | `rc_whsec_0123456789abcdef0123456789abcdef` — a sequential test fixture |
| `postgres://…:…@` | `.env.example:7` | ⚠️ **NOT a placeholder — see the correction below.** Byte-identical to the real `apps/api/.env`, and it authenticates against the running local Postgres |

Also verified:

- **No `.env`, `.pem`, `.key`, `.p12`, `.keystore` or credential file was ever added**, on any branch, at any point in history (`--diff-filter=A` over `--all`).
- **No JWTs** in any added line.
- `.gitignore` now covers **every** `.env*` variant at the root and in all three apps. It previously listed literal filenames (`.env`, `.env.local`) at the root, `apps/api` and `apps/mobile` — so **`.env.production` and `.env.staging` were NOT ignored**, which is the variant most likely to hold live credentials. Only `apps/web` had the glob. Fixed; verified with `git check-ignore`.

**One thing to rotate** — see the correction below. Everything else is clean.

### ⚠️ What this scan is NOT

`gitleaks` is **not installed on this machine**, and I did not install it — that is a system change on the owner's box, and their call. What ran instead is a pattern scan over every added line in `git log -p --all`, covering: Stripe/Clerk `sk_`/`rk_`, Anthropic `sk-ant-`, OpenAI, Google `AIza`, AWS `AKIA`, `whsec_`, GitHub tokens, RevenueCat `appl_`/`goog_`, private-key blocks, DB URLs with inline passwords, Slack/Discord webhooks, and JWTs.

That covers the high-value shapes but **misses what gitleaks is actually good at**: entropy analysis on values that match no known prefix — a bare 32-char hex API key, a base64 blob, a vendor format not in the list above. To close it properly:

```bash
brew install gitleaks && gitleaks detect --source . --log-opts="--all" --redact
```

`--redact` matters: without it the report prints the secrets it finds, and then the report is the leak.

---

## D2 — dependencies

**`npm audit`: 0 critical, 72 high, 18 moderate** (re-verified 2026-08-14; an earlier run in this same session reported 32 high — the advisory DB is fetched live, so any count here is a dated snapshot, not a property of the lockfile). The plan's gate is "zero unaddressed criticals" — **met**. The highs need triage rather than a blanket fix, because most cannot reach production.

### ⚠️ `npm audit fix` MUST NOT be run from a worktree

`node_modules` here is a **symlink into the main checkout** (the documented worktree setup). A workspace install writes *through* it and mutates main. Every fix below has to be applied in `/Users/roger/Documents/Python/Bazi_Plotting`, on a branch, with the suite re-run afterwards.

### Triage by reachability

| Package | Issue | Reaches prod? | Action |
|---|---|---|---|
| `next` | **12 HIGH advisories**, incl. App-Router segment-prefetch **middleware bypass** (GHSA-26hh, GHSA-267c) and dynamic-route param injection (GHSA-492v) | **Yes, and it lands on the auth control.** `middleware.ts` `auth.protect()` IS the signed-out lockdown, this app is App-Router-only, and dynamic segments are present | **URGENT — upgrade to 16.3.1.** Carries `sharp` + `postcss` with it |
| `sharp` | 4 libvips CVEs | Yes — Next image optimization | Rides the `next` upgrade |
| `postcss` | XSS via unescaped `</style>` in stringify | Build-time CSS processing, not a runtime path | Rides the `next` upgrade |
| `@nestjs/swagger` | (advisory) | **No** — `SwaggerModule.setup` is inside `if (NODE_ENV !== 'production')` (`main.ts:79`). The module is imported but never mounted in prod. | Upgrade at convenience |
| `fast-uri` | Host confusion via literal backslash authority delimiter | **No** — chain is `@nestjs/cli → @angular-devkit → ajv`, a build tool. NestJS's runtime `ValidationPipe` uses class-validator | Dev-only |
| `nanoid` | Non-secure generator loops on negative size | Transitive; no call site passes a negative size | Upgrade |
| `js-yaml` | Quadratic CPU on `!!omap` | **Prod dep** via `@nestjs/swagger` (loads at module scope regardless of the Swagger guard), plus dev/coverage. Usage is dump-only, which is what actually saves it — not the guard | Upgrade |
| `brace-expansion` | DoS via unbounded expansion | Build tooling — 5 of 10 nodes are `@expo/*`, the rest `@nestjs/cli`, Sentry bundler, typescript-eslint, glob | Dev-only |
| `image-size` | ICNS parser infinite loop | Expo tooling | Dev-only |
| `@clerk/clerk-expo` | **Authorization bypass** combining organization / billing / reverification checks | Mobile, **not shipped yet**. This app uses no Clerk organizations, billing or reverification, so the specific combination is not exercised | **Must be fixed before mobile ships.** ⚠️ The advisory range is ≤2.19.35 and the manifest pin `^2.19.31` is **also in range** — bumping to the pin does not fix it |

The remaining ~64 highs trace to `metro → image-size` and propagate outward by severity. The flagged list therefore *includes shipped runtime libraries* (`react-native`, `react-native-purchases`, async-storage, Sentry) that carry no advisory of their own — the conclusion (build tooling) holds, but the package names are misleading. `@solana-mobile` arrives via Clerk Web3, not React Native.

**Recommended, in the main checkout:**

```bash
npm audit fix
```

⚠️ **This will NOT clear the ~64-package cluster**: `image-size`'s fix is `expo@53`, a semver-major that plain `audit fix` skips by design. Expect the count to barely move.

⚠️ **The installed tree is not the manifest tree.** `react-native` 0.76.9 is installed against a `0.86.0` pin; `expo` 52.0.49 against `^57.0.4`. Every number above describes a tree `npm ci` would not reproduce — re-audit after a clean install.

Then re-run the full suite. `next` 16.3.1 is a patch bump within 16.x, but it moves `sharp` and `postcss` too, so the web build wants a real check. `npm audit fix --force` is **not** recommended — it would take the Expo/RN tree through major bumps that the mobile app is not ready for.

### Python engine

`pip-audit` is **not installed**, so the engine's dependency scan did not run. Installed versions are current as of this date (`fastapi 0.128.2`, `starlette 0.50.0`, `pydantic 2.12.5`, `uvicorn 0.40.0`, `httpx 0.28.1`, `certifi 2026.1.4`) — no obviously stale package — but **"looks current" is not an audit**, and I am not recording this half as passed.

```bash
cd packages/bazi-engine && .venv/bin/pip install pip-audit && .venv/bin/pip-audit
```

Note the engine pins with `>=` rather than `==` (`requirements.txt`), so the deployed set is whatever resolved at build time on Railway and can differ from this venv. The audit that matters is the one run against the deployed image.

---

## Corrections from the line audit

This report's *conclusion* survived independent re-verification; its bookkeeping did not. Recorded rather than silently edited.

- **`.env.example:7` was not a placeholder.** It was byte-identical to the real `apps/api/.env` and authenticated against the running local Postgres — a real credential, published in a committed file. Now an obvious `CHANGE_ME`.

  **ROTATED 2026-08-15 — and the rotation revealed the finding underneath it.** The password was changed via `ALTER USER`, and `apps/api/.env` (both checkouts), `docker/docker-compose.yml` and the two `settings.local.json` files were updated; the new password works and all 96 birth profiles are intact. But the verification step — confirming the *old* password was now rejected — **failed**: the old password still connects. So does `totally-wrong-password-xyz`.

  **Local Postgres does not check passwords at all.** `pg_hba.conf` is on Homebrew's default `trust` for host connections. That reframes the original finding: the string in git was never a usable credential on its own, because possessing it granted nothing that being on the machine didn't already grant. Rotating was still right — a dead string is better than a live-looking one, and the file should never have held a real value — but it bought less than it appeared to.

  Exposure is bounded: `listen_addresses = localhost`, bound to `127.0.0.1:5432` and `[::1]:5432` only, so this is not reachable off-machine. The practical meaning is that **any process running on the owner's Mac can read the dev database**, which holds 96 real birth profiles. That is a local-posture issue, not a remote one, and it is the Homebrew default rather than a misconfiguration anyone made.

  **Optional hardening, owner's call** (a system change outside the repo, so not done): set `scram-sha-256` in place of `trust` for the `host` lines in `/opt/homebrew/var/postgresql@15/pg_hba.conf`, then `brew services restart postgresql@15`. Worth doing only if other local tooling that connects without a password is checked first — several project scripts may rely on it.
- **The high count was wrong** — 32 reported, 72 actual. Two runs of the same command an hour apart disagreed, because `npm audit` fetches advisories live. A count is only meaningful with a date attached.
- **The `next` row inverted the risk.** It argued away one *moderate* (rewrites smuggling) while `next@16.1.5` carries 12 HIGH advisories, three of which are App-Router **middleware bypasses** — landing squarely on the `auth.protect()` call that enforces the signed-out lockdown shipped earlier in Phase 1. Re-rated urgent.
- **The scan printed 2 matches but found 4.** `.github/workflows/ci.yml` (a Postgres URL) and `stripe.service.ts:78` (`sk_test_placeholder`) also matched the declared patterns and went unmentioned. Both benign — no conclusion changes — but the report should say what the scan actually returned.
- Several reachability calls were wrong in detail: `fast-uri` is a build tool (not runtime validation), `js-yaml` IS a prod dep via `@nestjs/swagger` (what saves it is dump-only usage, not the `NODE_ENV` guard), and `brace-expansion` is only half `@expo/*`.
- **Four structural gaps in the scan method**, all independently re-scanned and all empty: dangling objects (28 commits), a reflog-only commit invisible to both `log --all` and `fsck`, merge commits (`-p` emits nothing for them — needs `--cc`), and 57 binary blobs a line regex cannot see.

## Status against the plan's acceptance

| Item | Acceptance | Result |
|---|---|---|
| D1 gitleaks full history; rotate hits | Report | **Partial** — no third-party credential in history; ONE local credential found and placeholder'd (rotation is the owner's, below); entropy scan still owed (gitleaks not installed) |
| D2 npm audit + pip-audit; fix criticals/highs | Zero unaddressed criticals | **npm: met** (0 critical; highs triaged, fixes deferred to the main checkout because a worktree install corrupts main). **pip-audit: NOT RUN** |
