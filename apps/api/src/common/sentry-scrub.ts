/**
 * C2 — strip personal data from Sentry events before they leave the process.
 *
 * `Sentry.init` was called with a DSN, an environment and a sample rate, and
 * nothing else. Whether the installed SDK attaches request bodies by default is
 * a version-dependent question, and answering it by reading `node_modules` is
 * exactly the kind of conclusion that silently stops being true on the next
 * upgrade. So this does not depend on the answer: `sendDefaultPii: false` states
 * the intent, and this scrubber enforces it on the way out regardless.
 *
 * ⚠️ THE DOMAIN RULE — the four pillars / 干支 are NOT an anonymisation.
 *
 * They read like opaque symbols, so someone debugging a doctrine bug will
 * reasonably think 「it's just 甲子, that isn't personal data」. It is: year +
 * month + day pillars pin a birth date to about one candidate per 60-year cycle
 * — within a plausible lifespan, usually exactly one — and the hour pillar
 * narrows to a two-hour window. Add the city and gender already in the same
 * payload and it identifies a person. A single low-entropy field
 * (`dayMasterStem`, 1-of-10) is fine; the SET is not, which is why whole pillar
 * objects are dropped rather than individual keys.
 *
 * Correlate with a request id or `chartHash` and look the chart up inside the
 * trust boundary instead.
 */

/** Replacement marker — visible in Sentry, so the redaction is obvious. */
export const REDACTED = '[redacted:pii]';

/**
 * Keys whose VALUE is personal data wherever it appears, at any depth.
 * Matched case-insensitively against the exact key name.
 */
const PII_KEYS = new Set(
  [
    // Birth data — the sensitive core of this product.
    'birthdate',
    'birthtime',
    'birthcity',
    'birthtimezone',
    'birthlongitude',
    'birthlatitude',
    'lunarbirthdate',
    'birth_date',
    'birth_time',
    'birth_city',
    'birth_timezone',
    'birth_longitude',
    'birth_latitude',
    // Identity.
    'email',
    'email_address',
    'emailaddress',
    'phone',
    'phonenumber',
    'devicefingerprint',
    'device_fingerprint',
    // Credentials / bearer material.
    'authorization',
    'cookie',
    'token',
    'accesstoken',
    'access_token',
    'apikey',
    'api_key',
    'secret',
    'password',
    // Free text the user wrote.
    'questiontext',
    'question_text',
  ].map((k) => k.toLowerCase()),
);

/**
 * Keys whose whole SUBTREE is dropped — the 干支 set and the generated content
 * derived from it. Dropping the container is deliberate: redacting pillar keys
 * one by one invites a future field being added and missed.
 */
const PII_SUBTREE_KEYS = new Set(
  [
    'fourpillars',
    'four_pillars',
    'pillars',
    'yearpillar',
    'monthpillar',
    'daypillar',
    'hourpillar',
    'chartdata',
    'chart_data',
    'calculationdata',
    'calculation_data',
    'calculationjson',
    'calculation_json',
    'aiinterpretation',
    'ai_interpretation',
    'interpretationjson',
    'interpretation_json',
    'engineoutputjson',
    'ainarrativejson',
    'birthprofile',
    'birth_profile',
  ].map((k) => k.toLowerCase()),
);

const MAX_DEPTH = 8;

/** Recursively redact in place-safe fashion (returns a new value). */
function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const k = key.toLowerCase();
    if (PII_SUBTREE_KEYS.has(k)) {
      out[key] = REDACTED;
    } else if (PII_KEYS.has(k)) {
      out[key] = REDACTED;
    } else {
      out[key] = scrubValue(v, depth + 1);
    }
  }
  return out;
}

/**
 * Minimal shape of the Sentry event fields this touches. Deliberately
 * structural rather than importing Sentry's `Event` type, so the scrubber stays
 * unit-testable without the SDK and doesn't break on a type rename.
 */
export interface ScrubbableEvent {
  request?: {
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, unknown>;
    query_string?: unknown;
    url?: unknown;
    [k: string]: unknown;
  };
  user?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

/**
 * `beforeSend` / `beforeSendTransaction` hook.
 *
 * Returns a NEW event; never mutates the caller's object, because Sentry reuses
 * it and a mutated scope would leak the redaction back into application state.
 */
export function scrubSentryEvent<T>(event: T): T {
  // Structurally typed rather than tied to Sentry's `ErrorEvent` /
  // `TransactionEvent`: those are unions whose field types shift between SDK
  // majors, and a signature that tracks them would make this file a recurring
  // upgrade chore for no safety gain. The cast is contained here; everything
  // below works off `ScrubbableEvent`.
  const scrubbed = { ...(event as ScrubbableEvent) } as ScrubbableEvent;

  if (scrubbed.request) {
    const req = { ...scrubbed.request };
    // The request BODY is where birth data actually arrives (every reading POST
    // carries it). Never useful enough in a stack trace to justify shipping it.
    if ('data' in req) req.data = REDACTED;
    if ('cookies' in req) req.cookies = REDACTED;
    if (req.headers) req.headers = scrubValue(req.headers) as Record<string, unknown>;
    // A query string can carry a date or a profile id.
    if ('query_string' in req && req.query_string) req.query_string = REDACTED;
    scrubbed.request = req;
  }

  // Keep `id` — that's the whole point of having a user on the event — and drop
  // everything else the SDK may have attached.
  if (scrubbed.user) {
    scrubbed.user = { ...(scrubbed.user.id ? { id: scrubbed.user.id } : {}) };
  }

  if (scrubbed.extra) scrubbed.extra = scrubValue(scrubbed.extra) as Record<string, unknown>;
  if (scrubbed.contexts) {
    scrubbed.contexts = scrubValue(scrubbed.contexts) as Record<string, unknown>;
  }
  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubValue(scrubbed.breadcrumbs) as Array<Record<string, unknown>>;
  }

  return scrubbed as T;
}
