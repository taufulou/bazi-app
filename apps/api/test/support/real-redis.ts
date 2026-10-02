/**
 * The ONE rule for specs that need a real Redis (todo #23 / PR #74 review).
 *
 * CI's `test-api` job provisions a `redis:7` service and sets
 * `REQUIRE_REDIS_TESTS=1`. Under that flag an unreachable Redis means the
 * service is broken, and a skip would be the worst outcome — green, and testing
 * nothing — so the test FAILS. Anywhere else (a dev machine without Redis, or a
 * sandbox that merely sets the generic `CI` variable) it skips loudly.
 * Deliberately NOT keyed on `CI`.
 *
 * Call at the top of every real-Redis test:
 *
 *   if (!needRedis(available, REDIS_URL)) return;
 *
 * The flag is read at CALL time, not module load, so there is no exported
 * constant that can go stale (and the helper's own spec can toggle it).
 * Only `'1'` counts, matching `.github/workflows/ci.yml`.
 */
export function needRedis(available: boolean, url: string): boolean {
  if (available) return true;
  if (process.env.REQUIRE_REDIS_TESTS === '1') {
    throw new Error(
      `REQUIRE_REDIS_TESTS=1 but no Redis is reachable at ${url} — ` +
        'the CI redis service is broken; a skip here would test nothing.',
    );
  }
  console.warn('SKIPPED: no Redis at ' + url);
  return false;
}
