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
 *   k6 run load-test/k6/s2-mix.js
 */
import { sleep, check } from 'k6';
import { actor, get, post, sseFirstByte, L5_THRESHOLDS } from './lib.js';

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

function fortune(token, profileId) {
  const tags = { kind: 'fortune' };
  const res = get(`/api/fortune/daily?profileId=${profileId}&date=${today()}`, token, tags);
  // `waiting` is time-to-first-byte, which for the streaming surfaces is the
  // number a user actually feels — L5's "SSE first event p95 < 1.5s".
  sseFirstByte.add(res.timings.waiting, tags);
  check(res, { 'fortune not 5xx': (r) => r.status < 500 || r.status === 503 });
}

function chat(token, profileId) {
  const tags = { kind: 'chat' };
  // A FORTUNE-scoped session needs no paid reading to exist first, which makes
  // it the cheapest realistic way to exercise the chat path.
  const session = post('/api/chat/sessions', token, {
    readingType: 'FORTUNE',
    fortune: { profileId, fortuneScope: 'DAY', fortuneAnchorDate: today() },
  }, tags);
  if (session.status !== 201 && session.status !== 200) return;

  let sessionId = null;
  try { sessionId = session.json('id'); } catch (e) { return; }
  if (!sessionId) return;

  // messages-sync, not the SSE route: k6 cannot consume an event stream
  // usefully, and the upstream cost — the thing being load-tested — is
  // identical either way.
  const msg = post(`/api/chat/sessions/${sessionId}/messages-sync`, token, {
    content: '今天適合談重要的事嗎？',
  }, tags);
  sseFirstByte.add(msg.timings.waiting, tags);
}

function reading(token, profileId) {
  const tags = { kind: 'reading' };
  const res = post('/api/bazi/readings', token, {
    birthProfileId: profileId,
    readingType: 'LIFETIME',
  }, tags);
  sseFirstByte.add(res.timings.waiting, tags);
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
