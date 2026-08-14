/**
 * C2 (web) — strip personal data from Sentry events before they leave the browser.
 *
 * ⚠️ KEEP IN SYNC with `apps/api/src/common/sentry-scrub.ts`, which is the
 * canonical copy and carries the full reasoning. This is a deliberate
 * duplication, not an oversight: `apps/web` cannot import from `apps/api`, and
 * the shared package is off-limits to the NestJS runtime (see the `@repo/shared`
 * note in CLAUDE.md), so there is no single home both can use.
 * `test/sentry-scrub-parity.spec.ts` in apps/api fails if the two key lists drift.
 *
 * Why the web side matters at least as much as the API's: this SDK runs on the
 * pages where birth data is TYPED. The first version of C2 configured the API
 * init only, and left this one — which loads today — with no PII settings at all.
 */

export const REDACTED = '[redacted:pii]';

const PII_KEYS = new Set(
  [
    'birthdate', 'birthtime', 'birthcity', 'birthtimezone', 'birthlongitude',
    'birthlatitude', 'lunarbirthdate', 'birth_date', 'birth_time', 'birth_city',
    'birth_timezone', 'birth_longitude', 'birth_latitude',
    'email', 'email_address', 'emailaddress', 'phone', 'phonenumber',
    'devicefingerprint', 'device_fingerprint',
    'authorization', 'cookie', 'token', 'accesstoken', 'access_token',
    'apikey', 'api_key', 'secret', 'password',
    'questiontext', 'question_text', 'content',
    'gender', 'name',
    'profilebirthdate', 'profilebirthtime',
    'lunardate', 'lunar_birth_date',
    'yearganzhi', 'monthganzhi', 'dayganzhi', 'hourganzhi',
    'solardate', 'timerange', 'targetday',
  ].map((k) => k.toLowerCase()),
);

const PII_SUBTREE_KEYS = new Set(
  [
    'fourpillars', 'four_pillars', 'pillars', 'yearpillar', 'monthpillar',
    'daypillar', 'hourpillar', 'chartdata', 'chart_data', 'calculationdata',
    'calculation_data', 'calculationjson', 'calculation_json',
    'aiinterpretation', 'ai_interpretation', 'interpretationjson',
    'interpretation_json', 'engineoutputjson', 'engine_output_json',
    'ainarrativejson', 'ai_narrative_json', 'birthprofile', 'birth_profile',
    'ganzhi', 'chart', 'chartcontext', 'chart_context', 'charta', 'chartb',
    'natalchart', 'luckperiods', 'annualstars', 'truesolartime',
    'engineoutput', 'narrative',
  ].map((k) => k.toLowerCase()),
);

/** Exported for the cross-package parity test. */
export const PII_KEY_LIST = [...PII_KEYS].sort();
export const PII_SUBTREE_KEY_LIST = [...PII_SUBTREE_KEYS].sort();

const MAX_DEPTH = 8;

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const k = key.toLowerCase();
    out[key] = PII_SUBTREE_KEYS.has(k) || PII_KEYS.has(k) ? REDACTED : scrubValue(v, depth + 1);
  }
  return out;
}

export function redactFreeText(text: string): string {
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, REDACTED)
    .replace(/\b([01]?\d|2[0-3]):[0-5]\d\b/g, REDACTED)
    .replace(/[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]/g, REDACTED)
    .replace(/\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED)
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, REDACTED);
}

interface ScrubbableEvent {
  request?: Record<string, unknown>;
  user?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: Array<Record<string, unknown>>;
  spans?: unknown[];
  message?: unknown;
  exception?: unknown;
  [k: string]: unknown;
}

export function scrubSentryEvent<T>(event: T): T {
  const scrubbed = { ...(event as ScrubbableEvent) } as ScrubbableEvent;

  if (scrubbed.request) {
    const req = { ...scrubbed.request };
    if ('data' in req) req.data = REDACTED;
    if ('cookies' in req) req.cookies = REDACTED;
    if (req.headers) req.headers = scrubValue(req.headers) as Record<string, unknown>;
    if ('query_string' in req && req.query_string) req.query_string = REDACTED;
    scrubbed.request = req;
  }

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
  if (Array.isArray(scrubbed.spans)) scrubbed.spans = scrubValue(scrubbed.spans) as unknown[];

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
