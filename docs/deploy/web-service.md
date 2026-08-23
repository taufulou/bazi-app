# Deploying the web app (M9) — first-time Railway service

Until M9 the platform was **backend-only**: Railway ran the API, the private
Python engine, Postgres and Redis, and nothing else. `tianmingapp.com` resolved
to nothing but Clerk's subdomains. This document is the recipe for the missing
service, and the list of things that go wrong quietly if you skip a step.

Three other items are blocked on this deploy and unblock the moment it lands:

- **B3-b** (flipping the engine to `ENGINE_REQUIRE_KEY`) needs all nine engine
  endpoints exercised, which needs a website to exercise them from.
- **`CLERK_AUTHORIZED_PARTIES`** has nothing correct to contain until a web
  origin exists — set it only after this, and set it on **both** services with
  the identical value.
- Clerk's post-sign-in redirect currently points at the bare domain, which is
  NXDOMAIN.

---

## 1. Create the service

| Setting | Value |
|---|---|
| Source | this repo, branch `main` |
| Builder | **Dockerfile**, path `docker/Dockerfile.web` |
| Wait for CI | ON (matches the API and engine services) |
| Port | `3000` (the image sets `PORT` and `HOSTNAME=0.0.0.0`) |

⚠️ **Set the builder explicitly.** There is no `railway.json` pinning it. Left
on Nixpacks the web app would appear to build and then run without the
standalone tree — and, as already recorded for the API service, a Nixpacks
switch also unsets `NODE_ENV`.

---

## 2. Variables

### Build-time — `NEXT_PUBLIC_*` is inlined during `next build`

A Dockerfile only receives the variables it declares as `ARG` — see the `ARG`
block in `docker/Dockerfile.web`. Setting these only as runtime variables
produces a browser bundle carrying empty strings, with a server log that says
nothing is wrong.

The three that fail invisibly are asserted in the image: the build **stops and
names them** rather than producing a deploy that looks healthy. So if the build
log says `FATAL: empty build arg(s): …`, the platform did not forward that
variable to the build — set it explicitly rather than assuming it carried over
from the runtime variables.

| Variable | Required? | What breaks if wrong |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | **yes** | **The build fails.** Pages that mount `ClerkProvider` are prerendered, and `@clerk/clerk-react` rejects a malformed key outright. A placeholder is not enough — it must decode. |
| `NEXT_PUBLIC_API_URL` | **yes** | Baked into the CSP `connect-src` by `next.config.js` at build time. Wrong ⇒ the browser blocks **every** API call with nothing in the server logs. |
| `NEXT_PUBLIC_SITE_URL` | **yes** | Canonical + OpenGraph URLs, the sitemap, and `robots.txt`. Falls back to `http://localhost:3000`. |
| `NEXT_PUBLIC_R2_PUBLIC_HOST` | if banners are used | Also baked into the CSP (`img-src`). Empty ⇒ banner images silently blocked despite returning 200. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | for checkout | Stripe.js cannot initialise. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `_SIGN_UP_URL` / `_AFTER_SIGN_IN_URL` / `_AFTER_SIGN_UP_URL` | optional | Clerk falls back to its own defaults. |
| `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | optional | Telemetry off. |
| `SENTRY_AUTH_TOKEN` | optional | Source maps not uploaded; the build still succeeds (the config disables the plugins when it is absent). |

### Runtime — web service

| Variable | Notes |
|---|---|
| `CLERK_SECRET_KEY` | The **production** `sk_live_…`. |
| `CLERK_AUTHORIZED_PARTIES` | ⚠️ Leave **UNSET** for the first deploy. Set it only once the origin is known and stable, to the same value as the API service. A wrong value 401s every web session at once. |

### Runtime — **API service** (change one variable there too)

| Variable | Value |
|---|---|
| `WEB_ORIGINS` | **Every** origin the site is reachable at — the browser sends `window.location.origin`, so a site served at both `https://<service>.up.railway.app` and `https://tianmingapp.com` needs both, or checkout 400s on whichever is missing. Comma-separated; **the first entry is canonical**, because relative redirects resolve against it. |
| `CORS_ORIGINS` | Add the same origin. Separate variable on purpose — see below. |

`WEB_ORIGINS` is the Stripe redirect allowlist: the set of origins Stripe may
bounce a paying customer back to after checkout. It is **not** `CORS_ORIGINS`,
which lists every client permitted to read a response and includes dev tooling
(the Expo dev server on `:8081`). Adding a dev origin for CORS must not widen
where a customer can be sent after paying.

Unset, `WEB_ORIGINS` falls back to `http://localhost:3000` alone. In production
that **fails closed** — checkout returns 400 rather than redirecting somewhere
unintended — and the API says so at boot:

```
WEB_ORIGINS is not set — falling back to http://localhost:3000.
Stripe checkout from any other origin will be rejected with 400.
```

---

## 3. Verify, in this order

1. **Build log** ends with the two `test -f` / `test -d` guards passing. They
   fail the build rather than the boot if Next's standalone layout moves; this
   image cannot be built on the dev machine, so those guards are the only
   local-ish check the COPY paths still line up.
2. `GET /sign-in` → **200**. (`GET /` → a Clerk interstitial for a signed-out
   client; that is the full-lockdown middleware behaving correctly, not a fault.)
3. `GET /robots.txt` and `GET /sitemap.xml` → **200**, and the `Sitemap:` line
   names `NEXT_PUBLIC_SITE_URL`, not some other host. Both were `auth.protect()`ed
   until M9 added them to `isPublicRoute`: the middleware matcher skips a fixed
   list of static extensions and `.txt`/`.xml` are not on it. Nothing had ever
   fetched them, because there was no deployed site.
4. **A real test-mode Stripe checkout round-trip.** Buy a credit pack, land back
   on `/store?credits=success`. This is the acceptance criterion for M9's
   allowlist half — it exercises `successUrl`, `cancelUrl`, and the origin check
   in one pass.
5. **A foreign origin is rejected.** With a session token, post a checkout whose
   `successUrl` is `https://evil.example.com/x` and confirm **400**. Repeat with
   `//evil.example.com/x` — the protocol-relative form, which the regex this
   replaced accepted.
6. Then, and only then, set `CLERK_AUTHORIZED_PARTIES` on both services and
   confirm sign-in still works.

---

## 4. What this deploy does *not* change

- The engine stays private and unkeyed-in-`observe`. B3-b is a separate flip
  with its own gate (`node scripts/b3b-preflight.mjs`).
- The bare domain still needs an A/CNAME record pointing at the new service
  before `tianmingapp.com` resolves. Only Clerk's subdomains exist today.
- Social sign-in (Google/Apple/Facebook/LINE) stays broken until each provider
  has its own OAuth credentials — production Clerk does not lend you its shared
  dev ones. Email works.
