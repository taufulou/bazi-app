/**
 * Shared harness for the Phase 3 scenarios.
 *
 * ## The tokens
 *
 * `tokens.json` comes from `mint-tokens.mjs` and holds REAL production bearer
 * tokens. k6 reads it at init time with `open()`, which runs once per VU before
 * the test starts — a file read inside the default function would happen on
 * every iteration.
 *
 * ## Why the metrics are custom
 *
 * k6's built-in `http_req_failed` counts anything non-2xx, which would fold
 * three very different outcomes into one number:
 *
 *   - a 5xx, which is a genuine failure and is what L5 caps at 0.5%
 *   - a 503 `AI_BUSY`, which is the S1 governor deliberately shedding load. L5
 *     caps that at 5% because OVER-throttling is also a failure — but it is not
 *     a crash, and counting it as one would make a working guard look broken
 *   - a 429 from the throttler or a quota, which is the system working exactly
 *     as designed
 *
 * Conflating them is how a load test concludes the wrong thing, so each gets
 * its own Rate and its own threshold.
 */
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';

export const serverErrors = new Rate('server_errors');       // 5xx only
export const aiBusy = new Rate('ai_busy');                   // deliberate shed (S1)
export const throttled = new Rate('throttled');              // 429 — working as designed
export const spendCapped = new Rate('spend_capped');         // AI_SPEND_CAP (S2 breaker)
export const sseFirstByte = new Trend('sse_first_byte', true);

export const API = __ENV.API_URL || 'https://bazi-app-production-5e54.up.railway.app';

const raw = JSON.parse(open('../tokens.json'));
export const TOKENS = raw.tokens;
if (!TOKENS || !TOKENS.length) throw new Error('tokens.json has no tokens — run mint-tokens.mjs');

/** One VU sticks to one user, so per-user throttling and quotas behave as they would in life. */
export function actor() {
  return TOKENS[(__VU - 1) % TOKENS.length];
}

export function headers(token) {
  return { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

/**
 * Wraps a request and classifies the outcome.
 *
 * ⚠️ Classification reads the typed `code` field, not the status alone. A 503
 * is `AI_BUSY` (shed) or `AI_SPEND_CAP` (breaker) or a real fault, and those
 * mean completely different things about whether the run passed.
 */
export function classify(res, tags) {
  const is5xx = res.status >= 500;
  let code = null;
  try { code = res.json('code'); } catch (e) { /* not JSON — fine */ }

  const shed = res.status === 503 && code === 'AI_BUSY';
  const capped = res.status === 503 && code === 'AI_SPEND_CAP';

  aiBusy.add(shed, tags);
  spendCapped.add(capped, tags);
  throttled.add(res.status === 429, tags);
  // A deliberately shed or capped request is NOT a server error. Counting it as
  // one would fail the run for the guard doing its job.
  serverErrors.add(is5xx && !shed && !capped, tags);
  return { shed, capped, code };
}

export function get(path, token, tags) {
  const res = http.get(`${API}${path}`, { headers: headers(token), tags });
  classify(res, tags);
  return res;
}

export function post(path, token, body, tags) {
  const res = http.post(`${API}${path}`, JSON.stringify(body ?? {}), { headers: headers(token), tags });
  classify(res, tags);
  return res;
}

/**
 * L5's pass criteria, expressed so k6 itself decides pass/fail.
 *
 * `abortOnFail` is deliberately NOT set: a run that stops at the first breach
 * tells you it broke, while a run that finishes tells you how badly and at what
 * concurrency. The second is the one that produces L6's tuning numbers.
 */
export const L5_THRESHOLDS = {
  // Non-AI reads only. AI endpoints are seconds by nature and would bury this.
  'http_req_duration{kind:browse}': ['p(95)<400', 'p(99)<1000'],
  'server_errors': ['rate<0.005'],
  // Over-throttling is a failure too — the pool exists to protect us, not to
  // refuse a fifth of legitimate traffic.
  'ai_busy': ['rate<0.05'],
  'sse_first_byte': ['p(95)<1500'],
};
