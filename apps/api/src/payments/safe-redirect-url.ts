/**
 * M9 — where Stripe is allowed to send the user back to.
 *
 * `successUrl` / `cancelUrl` / `returnUrl` arrive from the browser and are
 * handed to Stripe verbatim as `success_url` / `cancel_url` / `return_url`.
 * Stripe then 302s the user there after checkout. So this list is the answer
 * to "which origins may we bounce a paying customer to", and nothing else
 * should widen it.
 *
 * It replaces a hardcoded regex:
 *
 *   /^(https?:\/\/(localhost(:\d+)?|[a-z0-9-]+\.bazi-platform\.com)\/|\/)/
 *
 * which had three problems.
 *
 * 1. **`bazi-platform.com` is not a domain we own.** The domain is
 *    `tianmingapp.com`. The regex hardcoded a placeholder that appears nowhere
 *    in our DNS — so it allowlisted a host under someone else's control while
 *    rejecting our own.
 * 2. **The relative-path branch was an open redirect.** `//evil.com/x` and
 *    `/\evil.com` both start with `/`, so both matched — and both are read by
 *    browsers as `https://evil.com/x`. (Stripe's own URL validation blunted
 *    this in practice, since it rejects a non-absolute `success_url`; the hole
 *    was in our check, and depending on a third party's validation to cover it
 *    is not a control.)
 * 3. **Relative paths never actually worked.** Stripe requires an absolute
 *    URL, so every relative value that passed validation failed one hop later.
 *
 * The fix is to resolve first and check the RESULT, rather than pattern-match
 * the input. `new URL(input, base).origin` normalises protocol-relative forms,
 * backslash variants, userinfo (`https://ours.com@evil.com` → origin
 * `https://evil.com`), case, and default ports — so one comparison against the
 * allowlist covers a family of tricks that a regex has to enumerate. Relative
 * paths resolve against the canonical origin and reach Stripe as absolute URLs,
 * which is what Stripe wanted all along.
 */

export const WEB_ORIGINS_ENV = 'WEB_ORIGINS';

/**
 * Fallback when `WEB_ORIGINS` is unset — the local dev server, and only it.
 *
 * Deliberately NOT keyed on `NODE_ENV` (see CLAUDE.md: a security decision may
 * not read it, because `@nestjs/config` writes Joi's `'development'` default
 * back into `process.env`, so `undefined` never arrives). This fallback is safe
 * in production for the reason that matters: it fails CLOSED. A deployed web
 * origin is not `http://localhost:3000`, so checkout returns 400 rather than
 * quietly redirecting somewhere unintended, and `reportWebOrigins` says so at
 * boot.
 *
 * Narrower than the regex it replaces, which allowed localhost on ANY port.
 */
export const DEFAULT_WEB_ORIGIN = 'http://localhost:3000';

export interface WebOriginsParse {
  /** Allowlisted origins, normalised and deduped. Never empty. */
  origins: string[];
  /** Base for resolving relative paths — `origins[0]`, so ORDER MATTERS. */
  canonical: string;
  /** True when the env var was absent/empty and `DEFAULT_WEB_ORIGIN` was used. */
  usedFallback: boolean;
  /** Entries rewritten during normalisation: `[original, normalised]`. */
  normalised: Array<[string, string]>;
  /** Entries dropped as unusable: `[original, why]`. */
  rejected: Array<[string, string]>;
}

/**
 * Parse a comma-separated origin list into normalised origins.
 *
 * Normalises via `new URL(...).origin` rather than string surgery, so that what
 * we store is exactly the shape `resolveRedirectUrl` will compare against:
 * lowercased scheme + host, default port dropped, no path, no trailing slash.
 * An operator who writes `HTTPS://App.Example.com/` gets a working entry
 * instead of one that matches nothing.
 *
 * Anything that is not an absolute http(s) URL is dropped and reported —
 * a `javascript:` or `data:` entry here would be an allowlisted XSS sink.
 */
export function parseWebOrigins(raw: string | undefined): WebOriginsParse {
  const normalised: Array<[string, string]> = [];
  const rejected: Array<[string, string]> = [];
  const origins: string[] = [];

  for (const entry of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      rejected.push([entry, 'not an absolute URL']);
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      rejected.push([entry, `unsupported scheme ${url.protocol}`]);
      continue;
    }
    // `origin` is `null` for opaque origins; http(s) never produces one, but
    // the check keeps the invariant local rather than implied.
    if (url.origin === 'null') {
      rejected.push([entry, 'opaque origin']);
      continue;
    }
    if (url.origin !== entry) normalised.push([entry, url.origin]);
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }

  const usedFallback = origins.length === 0;
  if (usedFallback) origins.push(DEFAULT_WEB_ORIGIN);

  return { origins, canonical: origins[0]!, usedFallback, normalised, rejected };
}

/** Read + parse `WEB_ORIGINS` from the environment. */
export function webOriginsFromEnv(env: NodeJS.ProcessEnv = process.env): WebOriginsParse {
  return parseWebOrigins(env[WEB_ORIGINS_ENV]);
}

export type RedirectResolution =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/**
 * Resolve a caller-supplied redirect target to an absolute, allowlisted URL.
 *
 * Order is the whole point: **resolve, then check the resolved origin.**
 * Checking the input string instead is what lets `//evil.com` through.
 */
export function resolveRedirectUrl(
  input: unknown,
  parsed: WebOriginsParse,
): RedirectResolution {
  if (typeof input !== 'string') return { ok: false, reason: 'must be a string' };

  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: 'must not be empty' };

  // Shape gate before resolution. Not a security control on its own — the
  // origin check below is — but it rejects inputs that would resolve to
  // something surprising rather than to what the caller clearly meant
  // (`https:evil.com`, with no `//`, resolves to `<canonical>/evil.com`).
  const looksRelative = trimmed.startsWith('/');
  const looksAbsolute = /^https?:\/\//i.test(trimmed);
  if (!looksRelative && !looksAbsolute) {
    return { ok: false, reason: 'must be a relative path or an absolute http(s) URL' };
  }

  let url: URL;
  try {
    url = new URL(trimmed, parsed.canonical);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'only http(s) is allowed' };
  }
  if (!parsed.origins.includes(url.origin)) {
    return { ok: false, reason: 'origin is not allowlisted' };
  }

  return { ok: true, url: url.href };
}

/**
 * One-line boot summary. Called from `main.ts` so a misconfigured allowlist is
 * announced once at startup instead of being discovered as a 400 at checkout —
 * the failure it produces (payment declined) is both the loudest to a customer
 * and the quietest to us.
 */
export function reportWebOrigins(
  parsed: WebOriginsParse,
  log: (msg: string) => void,
  warn: (msg: string) => void,
): void {
  for (const [original, why] of parsed.rejected) {
    warn(`${WEB_ORIGINS_ENV}: ignoring "${original}" — ${why}.`);
  }
  for (const [original, fixed] of parsed.normalised) {
    warn(`${WEB_ORIGINS_ENV}: normalised "${original}" → "${fixed}".`);
  }
  if (parsed.usedFallback) {
    warn(
      `${WEB_ORIGINS_ENV} is not set — falling back to ${DEFAULT_WEB_ORIGIN}. ` +
        'Stripe checkout from any other origin will be rejected with 400.',
    );
  } else {
    log(
      `${WEB_ORIGINS_ENV}: ${parsed.origins.join(', ')} ` +
        `(relative redirects resolve against ${parsed.canonical}).`,
    );
  }
}
