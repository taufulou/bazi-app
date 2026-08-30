/**
 * S2 — the realistic mix at 100 concurrent users: 40% browse, 30% fortune,
 * 20% chat, 10% readings.
 *
 * This is the scenario L6's tuning numbers come from. S1 proves the substrate
 * is fast; this one puts AI work on top of it and asks whether the pools, the
 * breaker and the quotas hold at the shape of traffic we actually expect.
 *
 * ## Reading the results
 *
 * Three outcomes look like failures and are not:
 *
 *   - **429** from the throttler or a daily quota. S4 rations readings at
 *     20/user/day; a long run WILL hit that and it is the system working.
 *   - **503 AI_BUSY** below 5%. That is S1's governor shedding, which is its
 *     job. Above 5% it becomes a real finding — over-throttling is a failure
 *     mode too, and L5 says so explicitly.
 *   - **503 AI_SPEND_CAP**. The mock reports fabricated token usage that drives
 *     the REAL spend ledger. With MOCK_USAGE_SCALE=1 the breaker trips after
 *     ~165 readings. Run the main scenarios at 0.01 and prove the breaker in a
 *     separate short run, or every number after the trip is meaningless.
 *
 * `lib.js` gives each its own metric so they can be told apart afterwards.
 *
 * ## ⚠️ The first live run passed every threshold and measured no AI at all
 *
 * Green across the board, 0 AI_BUSY, 0 spend — because all three AI arms were
 * doing something other than AI work. Each cause is a property of the system,
 * not a typo, so they are documented at their call sites:
 *
 *   - `POST /api/bazi/readings` CHARGES but does not generate. Generation is
 *     driven by `@Sse('readings/:id/stream')`. The arm posted and moved on, so
 *     rows appeared with `aiProvider: null` and no interpretation.
 *   - `POST /api/chat/sessions` is throttled at 5 per HOUR per user. Creating a
 *     session per iteration burned all 90 users' quota inside two minutes; the
 *     rest of the run was 429s.
 *   - Fortune is cached per (profile, date), and these users are FREE tier so
 *     only today is in range. That caps generation at one per user, ever.
 *
 * The last one does not have a fix, and is the most interesting: AI load scales
 * with DISTINCT work, not with request volume, because the caches absorb the
 * repeats. L6 should say so.
 *
 *   k6 run load-test/k6/s2-mix.js
 */
import { sleep, check } from 'k6';
import { actor, aiTurn, assertEnoughTokens, get, post, sseFirstByte, L5_THRESHOLDS } from './lib.js';

// Every AI surface here generates INLINE. k6's 60s default abandons the request
// while the server keeps working — full load applied, nothing measured.
const AI_TIMEOUT = { timeout: '300s' };

export const options = {
  stages: [
    { duration: '1m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: L5_THRESHOLDS,
};

const today = () => new Date().toISOString().slice(0, 10);

function browse(token) {
  const tags = { kind: 'browse' };
  get('/api/users/me', token, tags);
  get('/api/users/me/birth-profiles', token, tags);
  get('/api/users/me/readings', token, tags);
}

// Rotated so a user can generate more than once: readings are cached per
// (birth data, type), so a single type caps the whole run at 90 generations.
const READING_TYPES = ['LIFETIME', 'CAREER', 'LOVE'];

// ⚠️ Per-VU, module scope. Each k6 VU gets its own JS context, so this is a
// per-user session — which is what a real user has, and what keeps us under the
// 5-per-hour cap. A session also has a 10-message initial allowance, so it is
// rotated before it runs out rather than after.
let session = { id: null, messages: 0, exhausted: false };

function fortune(token, profileId) {
  const tags = { kind: 'fortune' };
  // ⚠️ The STREAM route, not `/api/fortune/daily`. Both cost the same upstream,
  // but only this one has a meaningful first byte: it emits `engine_ready` in
  // ~100ms and the AI sections after. On the JSON route TTFB is the entire
  // generation, so measuring it as "first byte" would put a ~145s sample
  // against L5's 1.5s criterion and quietly redefine what that criterion means.
  const res = get(
    `/api/fortune/daily/stream?profileId=${profileId}&date=${today()}`,
    token,
    tags,
    AI_TIMEOUT,
  );
  sseFirstByte.add(res.timings.waiting, tags);
  check(res, { 'fortune not 5xx': (r) => r.status < 500 || r.status === 503 });
}

function chat(token, profileId) {
  const tags = { kind: 'chat' };
  if (session.exhausted) return;

  // ⚠️ REUSE. `POST /api/chat/sessions` is @Throttle({ limit: 5, ttl: 1h }) per
  // user. Creating one per iteration spent every user's hourly quota in about
  // two minutes and 429'd the rest of the run — which is also why the arm never
  // reached messages-sync and never did any AI work.
  //
  // Reuse is the realistic shape anyway: a person opens one conversation and
  // sends several messages into it.
  if (!session.id || session.messages >= 9) {
    // A FORTUNE-scoped session needs no paid reading to exist first, which makes
    // it the cheapest realistic way to exercise the chat path.
    const created = post('/api/chat/sessions', token, {
      readingType: 'FORTUNE',
      fortune: { profileId, fortuneScope: 'DAY', fortuneAnchorDate: today() },
    }, tags);
    if (created.status !== 201 && created.status !== 200) {
      // 429 here means the hourly cap is genuinely spent. Stop asking — retrying
      // would inflate `throttled` with requests we know will be refused.
      if (created.status === 429) session.exhausted = true;
      return;
    }
    try { session = { id: created.json('id'), messages: 0, exhausted: false }; } catch (e) { return; }
    if (!session.id) return;
  }

  // messages-sync, not the SSE route: k6 cannot consume an event stream
  // usefully, and the upstream cost — the thing being load-tested — is
  // identical either way.
  const msg = post(`/api/chat/sessions/${session.id}/messages-sync`, token, {
    content: '今天適合談重要的事嗎？',
  }, tags, AI_TIMEOUT);
  session.messages += 1;
  // Full turn, not a first byte — messages-sync returns once generation ends.
  aiTurn.add(msg.timings.waiting, tags);
}

function reading(token, profileId) {
  const tags = { kind: 'reading' };
  const readingType = READING_TYPES[__ITER % READING_TYPES.length];

  // Step 1 CHARGES and returns a row. It does NOT generate — verified against
  // production: a row created by this call alone has aiProvider=null, no
  // interpretation, isDegraded=false, and stays that way indefinitely.
  const res = post('/api/bazi/readings', token, {
    birthProfileId: profileId,
    readingType,
  }, tags, AI_TIMEOUT);
  if (res.status !== 201 && res.status !== 200) return;

  let id = null;
  try { id = res.json('id'); } catch (e) { return; }
  if (!id) return;

  // Step 2 is what actually calls the model. Skipping it was why the first run
  // reported 0 AI_BUSY and $0 of spend while looking entirely healthy.
  //
  // k6 has no streaming client, so it buys the whole stream: `waiting` is a
  // true time-to-first-event and `duration` is the full generation.
  const stream = get(`/api/bazi/readings/${id}/stream`, token, tags, AI_TIMEOUT);
  sseFirstByte.add(stream.timings.waiting, tags);
  aiTurn.add(stream.timings.duration, tags);
}

export function setup() {
  return assertEnoughTokens(100);
}

export default function () {
  const { token } = actor();

  // One profile lookup per iteration, outside the weighting, so every arm has
  // a profile id to work with.
  const profiles = get('/api/users/me/birth-profiles', token, { kind: 'browse' });
  let profileId = null;
  try { profileId = profiles.json()[0]?.id ?? null; } catch (e) { /* fall through */ }
  if (!profileId) { sleep(2); return; }

  const roll = Math.random();
  if (roll < 0.40) browse(token);
  else if (roll < 0.70) fortune(token, profileId);
  else if (roll < 0.90) chat(token, profileId);
  else reading(token, profileId);

  sleep(Math.random() * 4 + 2);
}
