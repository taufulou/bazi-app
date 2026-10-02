import { needRedis } from './support/real-redis';

/**
 * The rule both real-Redis specs depend on (`redis-lock.integration.spec.ts`,
 * `redis-throttler-storage.spec.ts`). Its own file, so toggling the env var here
 * cannot reorder another suite — CI sets `REQUIRE_REDIS_TESTS=1` on the
 * `test-api` job's jest step, so it is saved and restored around every case.
 */
describe('needRedis — fail under REQUIRE_REDIS_TESTS=1, skip loudly otherwise', () => {
  const URL = 'redis://nowhere:6390';
  let saved: string | undefined;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    saved = process.env.REQUIRE_REDIS_TESTS;
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.REQUIRE_REDIS_TESTS;
    else process.env.REQUIRE_REDIS_TESTS = saved;
    warn.mockRestore();
  });

  it('runs the test when Redis is available, whatever the flag', () => {
    process.env.REQUIRE_REDIS_TESTS = '1';
    expect(needRedis(true, URL)).toBe(true);
    delete process.env.REQUIRE_REDIS_TESTS;
    expect(needRedis(true, URL)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('THROWS when Redis is unreachable under REQUIRE_REDIS_TESTS=1, naming the URL', () => {
    process.env.REQUIRE_REDIS_TESTS = '1';
    expect(() => needRedis(false, URL)).toThrow(URL);
  });

  it('skips loudly (false + a warning) when Redis is unreachable and the flag is unset', () => {
    delete process.env.REQUIRE_REDIS_TESTS;
    expect(needRedis(false, URL)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(URL));
  });

  it("only '1' counts — 'true' does not turn a skip into a failure (matches ci.yml)", () => {
    process.env.REQUIRE_REDIS_TESTS = 'true';
    expect(needRedis(false, URL)).toBe(false);
  });
});
