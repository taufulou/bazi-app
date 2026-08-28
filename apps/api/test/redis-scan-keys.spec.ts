import { RedisService } from '../src/redis/redis.service';

/**
 * Ob2 — `scanKeys` is the only key-enumeration primitive in the codebase, so
 * the properties that keep it from being an outage are worth pinning: it must
 * use SCAN, and it must terminate.
 */

/** A fake ioredis SCAN that hands back one page per call. */
function fakeClient(pages: Array<[string, string[]]>) {
  const scan = jest.fn(async () => pages.shift() ?? ['0', []]);
  return { scan, mget: jest.fn(async (...keys: string[]) => keys.map((k) => `v:${k}`)) };
}

function withClient(client: unknown): RedisService {
  const svc = Object.create(RedisService.prototype) as RedisService;
  (svc as unknown as { client: unknown }).client = client;
  return svc;
}

describe('scanKeys', () => {
  it('walks every cursor page', async () => {
    const client = fakeClient([
      ['17', ['a', 'b']],
      ['42', ['c']],
      ['0', ['d']],
    ]);
    const out = await withClient(client).scanKeys('quota:*');
    expect(out).toEqual({ keys: ['a', 'b', 'c', 'd'], truncated: false });
    expect(client.scan).toHaveBeenCalledTimes(3);
  });

  it('issues SCAN, not KEYS', async () => {
    // KEYS is O(keyspace) and blocks the single-threaded server for the whole
    // walk — an outage triggered by opening an admin page.
    const client = fakeClient([['0', ['a']]]);
    await withClient(client).scanKeys('quota:*', { count: 250 });
    expect(client.scan).toHaveBeenCalledWith('0', 'MATCH', 'quota:*', 'COUNT', 250);
    expect(client).not.toHaveProperty('keys');
  });

  it('stops at the key limit and says so', async () => {
    const client = fakeClient([['9', ['a', 'b', 'c', 'd']]]);
    expect(await withClient(client).scanKeys('*', { limit: 2 })).toEqual({
      keys: ['a', 'b'],
      truncated: true,
    });
  });

  it('terminates on a keyspace that never finishes', async () => {
    // SCAN only guarantees termination on a keyspace that is not growing faster
    // than it is read. Without the iteration cap this is an infinite loop
    // inside a request handler.
    const client = {
      scan: jest.fn(async () => ['1', ['k']] as [string, string[]]),
      mget: jest.fn(),
    };
    const out = await withClient(client).scanKeys('*', { maxIterations: 5, limit: 1000 });
    expect(client.scan).toHaveBeenCalledTimes(5);
    expect(out.truncated).toBe(true);
  });

  it('reports truncated=false when the cap coincides with a finished cursor', async () => {
    const client = { scan: jest.fn(async () => ['0', ['k']] as [string, string[]]), mget: jest.fn() };
    expect(await withClient(client).scanKeys('*', { maxIterations: 1 })).toEqual({
      keys: ['k'],
      truncated: false,
    });
  });
});

describe('mget', () => {
  it('short-circuits an empty list rather than calling MGET with no arguments', async () => {
    // `MGET` with zero keys is a syntax error in Redis.
    const client = fakeClient([]);
    expect(await withClient(client).mget([])).toEqual([]);
    expect(client.mget).not.toHaveBeenCalled();
  });

  it('spreads the keys as separate arguments', async () => {
    const client = fakeClient([]);
    expect(await withClient(client).mget(['a', 'b'])).toEqual(['v:a', 'v:b']);
    expect(client.mget).toHaveBeenCalledWith('a', 'b');
  });
});
