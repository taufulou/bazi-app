/**
 * S1 — 100 VU browsing. The baseline, and the one that validates the harness.
 *
 * Only non-AI reads: these are the endpoints L5 holds to p95<400ms / p99<1s.
 * If S1 cannot pass, nothing measured in S2 means anything, because the AI
 * numbers would be sitting on top of a slow substrate.
 *
 *   k6 run load-test/k6/s1-browse.js
 */
import { sleep, check } from 'k6';
import { actor, assertEnoughTokens, get, L5_THRESHOLDS } from './lib.js';

export const options = {
  stages: [
    { duration: '30s', target: 100 },   // ramp — a cliff start measures the ramp, not the plateau
    { duration: '2m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: L5_THRESHOLDS,
};

export function setup() {
  return assertEnoughTokens(100);
}

export default function () {
  const { token } = actor();
  const tags = { kind: 'browse' };

  const me = get('/api/users/me', token, tags);
  check(me, { 'me 200': (r) => r.status === 200 });

  const profiles = get('/api/users/me/birth-profiles', token, tags);
  check(profiles, { 'profiles 200': (r) => r.status === 200 });

  get('/api/users/me/readings', token, tags);
  get('/api/bazi/services', token, tags);
  get('/api/bazi/plans', token, tags);

  // Real users read; they do not hammer. Without this the test measures how
  // fast k6 can loop, not how the system behaves under plausible load.
  sleep(Math.random() * 3 + 1);
}
