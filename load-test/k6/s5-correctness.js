/**
 * S5 — correctness under concurrency. The scenario worth the most.
 *
 * S1–S4 ask "is it fast enough". This asks "is it CORRECT when 20 requests
 * arrive at once", which is where money is lost quietly: a double charge does
 * not show up as an error, a slow response or a 5xx. It shows up as a user
 * being billed twice, discovered later, by them.
 *
 * ## The assertion
 *
 * 20 identical create-reading calls for the SAME user, fired simultaneously.
 * Exactly ONE may charge credits. The rest must either return the same reading
 * or fail cleanly — never charge a second time.
 *
 * Credits are read before and after, so the assertion is on the LEDGER rather
 * than on response codes. Twenty 200s would look like a pass while having
 * charged twenty times.
 *
 *   k6 run load-test/k6/s5-correctness.js
 */
import http from 'k6/http';
import { check } from 'k6';
import { API, TOKENS, headers, classify } from './lib.js';

export const options = {
  scenarios: {
    thundering_herd: { executor: 'shared-iterations', vus: 20, iterations: 20, maxDuration: '5m' },
  },
  thresholds: {
    // Any double charge fails the run outright — unlike a latency breach, there
    // is no "how badly" worth measuring here.
    'checks{assertion:single_charge}': ['rate==1.0'],
  },
};

const READING_TYPE = 'LIFETIME';

export function setup() {
  const { token } = TOKENS[0];
  const me = http.get(`${API}/api/users/me`, { headers: headers(token) });
  const profiles = http.get(`${API}/api/users/me/birth-profiles`, { headers: headers(token) });
  const profile = profiles.json()[0];
  if (!profile) throw new Error('the first seeded user has no birth profile');
  return { token, profileId: profile.id, creditsBefore: me.json('credits') };
}

export default function (data) {
  // Every VU sends the SAME request for the SAME user at the same moment.
  const res = http.post(
    `${API}/api/bazi/readings`,
    JSON.stringify({ birthProfileId: data.profileId, readingType: READING_TYPE }),
    { headers: headers(data.token), tags: { kind: 'reading' } },
  );
  classify(res, { kind: 'reading' });
}

export function teardown(data) {
  const me = http.get(`${API}/api/users/me`, { headers: headers(data.token) });
  const after = me.json('credits');
  const spent = data.creditsBefore - after;

  console.log(`credits ${data.creditsBefore} -> ${after}  (spent ${spent})`);

  // A LIFETIME reading costs 3. Anything above one charge is a real defect;
  // zero is also acceptable (a cache hit costs nothing) — what must never
  // happen is TWO.
  check(
    { spent },
    {
      'exactly one charge (or none, if cached)': (d) => d.spent === 3 || d.spent === 0,
    },
    { assertion: 'single_charge' },
  );

  if (spent > 3) {
    console.error(`⚠️  DOUBLE CHARGE: ${spent} credits for ${spent / 3} readings from 20 identical concurrent requests.`);
  }
}
