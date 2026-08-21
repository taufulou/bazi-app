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
    // Free text the user wrote. `content` is ChatMessage.content and
    // SendMessageDto.content — what the user typed and the full AI reply. The
    // first version of this list covered `questionText` (ZWDS Q&A only) and
    // missed the chat field entirely, while C1's own commit message called chat
    // messages "the most obviously personal content we hold".
    'questiontext',
    'question_text',
    'content',
    // Identity-adjacent. The docblock's own argument is "add the city and
    // gender already in the same payload and it identifies" — and `gender` was
    // not on the list.
    'gender',
    'name',
    // The fortune DTOs carry the birth datetime under these exact names on
    // every daily/monthly/yearly response.
    'profilebirthdate',
    'profilebirthtime',
    // A rendered lunar birth date is a birth date. `lunarBirthDate` was
    // covered; the engine emits `lunarDate` on every chartContext.
    'lunardate',
    'lunar_birth_date',
    // Individually these are 1-of-60, but they arrive as a set of four.
    'yearganzhi',
    'monthganzhi',
    'dayganzhi',
    'hourganzhi',
    // ZWDS shapes: solarDate + timeRange together are the birth datetime.
    'solardate',
    'timerange',
    'targetday',
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
    'engine_output_json',
    'ainarrativejson',
    'ai_narrative_json',
    'birthprofile',
    'birth_profile',
    // ⚠️ `ganZhi` is a SECOND copy of all four pillars, emitted alongside
    // `fourPillars` by the engine (`calculator.py`). Dropping `fourPillars`
    // while this sibling sailed through defeated the whole point of the rule
    // this file is built on — the audit reproduced it and got all four back
    // verbatim. Containers, not leaf keys, is exactly why.
    'ganzhi',
    'chart',
    'chartcontext',
    'chart_context',
    'charta',
    'chartb',
    'natalchart',
    'luckperiods',
    'annualstars',
    'truesolartime',
    // The un-suffixed siblings of the two JSON columns above — and these are
    // the names that actually appear on the wire response.
    'engineoutput',
    'narrative',
  ].map((k) => k.toLowerCase()),
);

/**
 * Exported for `sentry-scrub-parity.spec.ts` ONLY.
 *
 * These were private, and the parity test therefore had to derive its key list
 * from the WEB copy's exports and probe this side indirectly — which made the
 * check one-directional. Deleting a key from the web list removed it from the
 * test's own iteration set, so the suite stayed green while the browser SDK
 * started shipping that field. The gate audit reproduced it with `birthCity` and
 * `fourPillars`: green, and all four pillars in the event verbatim. Parity has
 * to be asserted as SET EQUALITY from both sides, which needs both sides
 * enumerable.
 */
export const PII_KEY_LIST = [...PII_KEYS].sort();
export const PII_SUBTREE_KEY_LIST = [...PII_SUBTREE_KEYS].sort();

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
  spans?: unknown[];
  message?: unknown;
  exception?: unknown;
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

  // Transaction events carry their payload in spans, not in `request`. Without
  // this, `request.query_string` was redacted on the error path while the same
  // query survived as span data on the transaction path — and tracing is on.
  if (Array.isArray(scrubbed.spans)) {
    scrubbed.spans = scrubValue(scrubbed.spans) as unknown[];
  }

  // ⚠️ The ERROR TEXT ITSELF. Key-based redaction cannot see this, and Sentry's
  // own normalization doesn't cover `exception` either — so it shipped verbatim
  // and is the most visible field in the UI, being the grouping key.
  //
  // This is not hypothetical: `PrismaClientValidationError` embeds the failing
  // argument object in its message, and a failed `birthProfile.create` puts the
  // birth date, time and city straight into it.
  if (scrubbed.message) scrubbed.message = redactFreeText(String(scrubbed.message));
  const values = (scrubbed.exception as { values?: Array<Record<string, unknown>> })?.values;
  if (Array.isArray(values)) {
    scrubbed.exception = {
      ...(scrubbed.exception as Record<string, unknown>),
      values: values.map((v) => ({
        ...v,
        ...(typeof v.value === 'string' ? { value: redactFreeText(v.value) } : {}),
      })),
    };
  }

  return scrubbed as T;
}

/**
 * Redact PII *shapes* inside a free-text string.
 *
 * Necessarily pattern-based rather than key-based, so it is deliberately
 * conservative: it targets the shapes this product actually leaks into error
 * messages, and accepts that a determined leak in prose could slip through.
 * Better a partial control on the field that was previously untouched than none.
 */
export function redactFreeText(text: string): string {
  return (
    text
      // ISO dates — birth dates arrive as YYYY-MM-DD.
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, REDACTED)
      // HH:MM times.
      .replace(/\b([01]?\d|2[0-3]):[0-5]\d\b/g, REDACTED)
      // Any 干支 pair: one of the 10 stems followed by one of the 12 branches.
      // Four of these identify a birth datetime; even one is worth removing
      // from a string we cannot otherwise reason about.
      .replace(/[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]/g, REDACTED)
      // Bearer tokens / JWTs.
      .replace(/\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED)
      // Email addresses.
      .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, REDACTED)
  );
}
