/**
 * S5 — correctness under concurrency. The scenario worth the most.
 *
 * S1–S4 ask "is it fast enough". This asks "is it CORRECT when N requests
 * arrive at once", which is where money is lost quietly: a double charge is not
 * an error, not a 5xx and not slow. It is a customer billed twice, discovered
 * later, by them.
 *
 * ## Three things the first live run got wrong, all of which made it pass
 *
 * 1. **20 VUs, but the route is `@Throttle({ limit: 10, ttl: 60000 })`.** Half
 *    the herd was rejected before reaching the code under test. Now 10, so
 *    every request is admitted and the concurrency is real.
 *
 * 2. **`createReading` generates AI INLINE** — the POST blocks for the whole
 *    ~145s generation. k6's default timeout is 60s, so every admitted request
 *    was abandoned mid-flight while the server kept working. Hence `timeout`.
 *
 * 3. **Readings are cached by a hash of the birth data.** Reusing a profile
 *    means the second run onward is a cache hit that charges nothing — so the
 *    assertion would pass forever without ever exercising deduplication. Setup
 *    now creates a FRESH profile with a unique birth date, guaranteeing a miss.
 *
 * The first run reported `spent 0` and PASSED, because the old assertion
 * accepted 0 as "cached". Zero also means "nothing happened", and that is what
 * had happened. The assertion below is strict for exactly that reason.
 */
import http from 'k6/http';
import { check } from 'k6';
import { API, TOKENS, headers, classify } from './lib.js';

const CREDIT_COST = 3;          // a LIFETIME reading
const HERD = 10;                // the route's per-minute limit — see (1)

export const options = {
  scenarios: {
    thundering_herd: { executor: 'shared-iterations', vus: HERD, iterations: HERD, maxDuration: '10m' },
  },
  thresholds: {
    // No "how badly" worth measuring: any double charge fails the run.
    'checks{assertion:single_charge}': ['rate==1.0'],
    'checks{assertion:actually_ran}': ['rate==1.0'],
  },
};

export function setup() {
  const { token } = TOKENS[0];
  const h = headers(token);

  // A birth date nothing else can share, so this is always a cache MISS.
  // Without it the run silently becomes a no-op after the first time.
  const unique = new Date();
  const day = String((unique.getUTCSeconds() % 28) + 1).padStart(2, '0');
  const month = String((unique.getUTCMinutes() % 12) + 1).padStart(2, '0');
  const year = 1900 + (unique.getUTCHours() * 60 + unique.getUTCMinutes()) % 60;
  const profile = http.post(`${API}/api/users/me/birth-profiles`, JSON.stringify({
    name: `S5 ${unique.toISOString().slice(11, 19)}`,
    birthDate: `${year}-${month}-${day}`,
    birthTime: '05:41',
    birthCity: '台北市',
    birthTimezone: 'Asia/Taipei',
    gender: 'MALE',
    relationshipTag: 'FRIEND',
  }), { headers: h });

  if (profile.status !== 201 && profile.status !== 200) {
    throw new Error(`could not create the fresh profile: ${profile.status} ${profile.body}`);
  }
  const profileId = profile.json('id');
  const credits = http.get(`${API}/api/users/me`, { headers: h }).json('credits');
  console.log(`fresh profile ${profileId} (${year}-${month}-${day}) · credits before: ${credits}`);
  return { token, profileId, creditsBefore: credits };
}

export default function (data) {
  const res = http.post(
    `${API}/api/bazi/readings`,
    JSON.stringify({ birthProfileId: data.profileId, readingType: 'LIFETIME' }),
    {
      headers: headers(data.token),
      // Generation is inline and takes ~145s. The default 60s abandons the
      // request while the server is still working — which looks like a failure
      // and measures nothing.
      timeout: '300s',
      tags: { kind: 'reading' },
    },
  );
  classify(res, { kind: 'reading' });
  console.log(`  VU${__VU}: ${res.status} in ${Math.round(res.timings.duration / 1000)}s`);
}

export function teardown(data) {
  const h = headers(data.token);
  const after = http.get(`${API}/api/users/me`, { headers: h }).json('credits');
  const spent = data.creditsBefore - after;
  console.log(`credits ${data.creditsBefore} -> ${after}  (spent ${spent})`);

  // ⚠️ STRICT, and deliberately not tolerant of 0.
  //
  // The profile is fresh, so a correct system MUST charge exactly once. The
  // previous version accepted 0 as "cached" — and 0 is also what you get when
  // every request was throttled or timed out, which is precisely what happened
  // and why that run passed while proving nothing.
  check({ spent }, {
    'something actually ran (a fresh profile must charge)': (d) => d.spent > 0,
  }, { assertion: 'actually_ran' });

  check({ spent }, {
    [`exactly one charge of ${CREDIT_COST}`]: (d) => d.spent === CREDIT_COST,
  }, { assertion: 'single_charge' });

  if (spent > CREDIT_COST) {
    console.error(`⚠️  DOUBLE CHARGE: ${spent} credits = ${spent / CREDIT_COST} readings from ${HERD} identical concurrent requests.`);
  } else if (spent === 0) {
    console.error('⚠️  NOTHING RAN — every request was throttled, timed out or errored. This run proved nothing.');
  }

  // Leave production as we found it.
  const del = http.del(`${API}/api/users/me/birth-profiles/${data.profileId}`, null, { headers: h });
  console.log(`cleanup profile -> ${del.status}`);
}
