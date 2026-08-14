# 1D — secret scan & dependency audit

Run 2026-08-14. Scope: full git history (399 commits, all branches) + `npm audit` across the workspace + the Python engine's installed set.

---

## D1 — secrets in history: CLEAN

**No live secret found in any commit.** Two matches, both verified benign:

| Match | Where | Verdict |
|---|---|---|
| `whsec_…` | `apps/api/test/webhook-hardening.spec.ts:26` | `rc_whsec_0123456789abcdef0123456789abcdef` — a sequential test fixture |
| `postgres://…:…@` | `.env.example:7` | `bazi_user:bazi_dev_password@localhost` — the documented local-dev placeholder |

Also verified:

- **No `.env`, `.pem`, `.key`, `.p12`, `.keystore` or credential file was ever added**, on any branch, at any point in history (`--diff-filter=A` over `--all`).
- **No JWTs** in any added line.
- `.gitignore` covers env files at the root and in all three apps.

Nothing to rotate.

### ⚠️ What this scan is NOT

`gitleaks` is **not installed on this machine**, and I did not install it — that is a system change on the owner's box, and their call. What ran instead is a pattern scan over every added line in `git log -p --all`, covering: Stripe/Clerk `sk_`/`rk_`, Anthropic `sk-ant-`, OpenAI, Google `AIza`, AWS `AKIA`, `whsec_`, GitHub tokens, RevenueCat `appl_`/`goog_`, private-key blocks, DB URLs with inline passwords, Slack/Discord webhooks, and JWTs.

That covers the high-value shapes but **misses what gitleaks is actually good at**: entropy analysis on values that match no known prefix — a bare 32-char hex API key, a base64 blob, a vendor format not in the list above. To close it properly:

```bash
brew install gitleaks && gitleaks detect --source . --log-opts="--all" --redact
```

`--redact` matters: without it the report prints the secrets it finds, and then the report is the leak.

---

## D2 — dependencies

**`npm audit`: 0 critical, 32 high, 19 moderate.** The plan's gate is "zero unaddressed criticals" — **met**. The highs need triage rather than a blanket fix, because most cannot reach production.

### ⚠️ `npm audit fix` MUST NOT be run from a worktree

`node_modules` here is a **symlink into the main checkout** (the documented worktree setup). A workspace install writes *through* it and mutates main. Every fix below has to be applied in `/Users/roger/Documents/Python/Bazi_Plotting`, on a branch, with the suite re-run afterwards.

### Triage by reachability

| Package | Issue | Reaches prod? | Action |
|---|---|---|---|
| `next` | HTTP request smuggling **in rewrites** | Web server — but **no rewrites are configured** (`next.config.js` has none), so the specific vector is unconfigured. Still the prod server. | **Upgrade to 16.3.1.** Carries `sharp` + `postcss` with it. |
| `sharp` | 4 libvips CVEs | Yes — Next image optimization | Rides the `next` upgrade |
| `postcss` | XSS via unescaped `</style>` in stringify | Build-time CSS processing, not a runtime path | Rides the `next` upgrade |
| `@nestjs/swagger` | (advisory) | **No** — `SwaggerModule.setup` is inside `if (NODE_ENV !== 'production')` (`main.ts:79`). The module is imported but never mounted in prod. | Upgrade at convenience |
| `fast-uri` | Host confusion via literal backslash authority delimiter | Yes — pulled by `ajv`, used in validation | Upgrade |
| `nanoid` | Non-secure generator loops on negative size | Transitive; no call site passes a negative size | Upgrade |
| `js-yaml` | Quadratic CPU on `!!omap` | Dev/coverage (`@istanbuljs`) | Dev-only |
| `brace-expansion` | DoS via unbounded expansion | All nodes are `@expo/*` — mobile build tooling | Dev-only |
| `image-size` | ICNS parser infinite loop | Expo tooling | Dev-only |
| `@clerk/clerk-expo` | **Authorization bypass** combining organization / billing / reverification checks | Mobile, **not shipped yet**. This app uses no Clerk organizations, billing or reverification, so the specific combination is not exercised. | **Must be fixed before mobile ships** — it is an auth bypass in the auth library, and "we don't use that feature" is a weaker guarantee than an upgrade |

The remaining ~20 highs are all `react-native` / `expo` / `metro` / `@solana-mobile` transitives — mobile build tooling, not shipped code.

**Recommended, in the main checkout:**

```bash
npm audit fix
```

Then re-run the full suite. `next` 16.3.1 is a patch bump within 16.x, but it moves `sharp` and `postcss` too, so the web build wants a real check. `npm audit fix --force` is **not** recommended — it would take the Expo/RN tree through major bumps that the mobile app is not ready for.

### Python engine

`pip-audit` is **not installed**, so the engine's dependency scan did not run. Installed versions are current as of this date (`fastapi 0.128.2`, `starlette 0.50.0`, `pydantic 2.12.5`, `uvicorn 0.40.0`, `httpx 0.28.1`, `certifi 2026.1.4`) — no obviously stale package — but **"looks current" is not an audit**, and I am not recording this half as passed.

```bash
cd packages/bazi-engine && .venv/bin/pip install pip-audit && .venv/bin/pip-audit
```

Note the engine pins with `>=` rather than `==` (`requirements.txt`), so the deployed set is whatever resolved at build time on Railway and can differ from this venv. The audit that matters is the one run against the deployed image.

---

## Status against the plan's acceptance

| Item | Acceptance | Result |
|---|---|---|
| D1 gitleaks full history; rotate hits | Report | **Partial** — pattern scan clean, nothing to rotate; entropy scan still owed (gitleaks not installed) |
| D2 npm audit + pip-audit; fix criticals/highs | Zero unaddressed criticals | **npm: met** (0 critical; highs triaged, fixes deferred to the main checkout because a worktree install corrupts main). **pip-audit: NOT RUN** |
