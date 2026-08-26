import {
  buildPooledDatabaseUrl,
  connectionBudgetWarning,
  DEFAULT_CONNECTION_LIMIT,
  DEFAULT_POOL_TIMEOUT,
  ASSUMED_MAX_CONNECTIONS,
  CONNECTION_HEADROOM,
} from './database-url';
import { parseReplicaCount } from './replica-count';

const BASE = 'postgresql://u:p@host:5432/db';

describe('buildPooledDatabaseUrl (M2)', () => {
  it('adds both pool settings to a bare URL', () => {
    const { url, applied } = buildPooledDatabaseUrl(BASE);
    const q = new URL(url!).searchParams;
    expect(applied).toBe(true);
    expect(q.get('connection_limit')).toBe(String(DEFAULT_CONNECTION_LIMIT));
    expect(q.get('pool_timeout')).toBe(String(DEFAULT_POOL_TIMEOUT));
  });

  it('preserves existing query params instead of clobbering them', () => {
    const { url } = buildPooledDatabaseUrl(`${BASE}?sslmode=require&schema=public`);
    const q = new URL(url!).searchParams;
    expect(q.get('sslmode')).toBe('require');
    expect(q.get('schema')).toBe('public');
    expect(q.get('connection_limit')).toBe(String(DEFAULT_CONNECTION_LIMIT));
  });

  it('leaves an operator-set connection_limit alone', () => {
    const explicit = `${BASE}?connection_limit=3`;
    const { url, applied, reason } = buildPooledDatabaseUrl(explicit);
    // The connection string is the operator's lever — someone pointing at
    // pgbouncer or firefighting must be able to set this without a deploy.
    expect(url).toBe(explicit);
    expect(applied).toBe(false);
    expect(reason).toContain('already set');
  });

  it('respects an operator-set pool_timeout while still adding the limit', () => {
    const { url } = buildPooledDatabaseUrl(`${BASE}?pool_timeout=5`);
    const q = new URL(url!).searchParams;
    expect(q.get('pool_timeout')).toBe('5');
    expect(q.get('connection_limit')).toBe(String(DEFAULT_CONNECTION_LIMIT));
  });

  it('honours an explicit limit', () => {
    const { url } = buildPooledDatabaseUrl(BASE, { connectionLimit: 4, poolTimeout: 7 });
    const q = new URL(url!).searchParams;
    expect(q.get('connection_limit')).toBe('4');
    expect(q.get('pool_timeout')).toBe('7');
  });

  it('returns undefined when DATABASE_URL is unset, so the schema env() stands', () => {
    expect(buildPooledDatabaseUrl(undefined)).toEqual({
      url: undefined,
      applied: false,
      reason: 'DATABASE_URL is not set',
    });
  });

  it('hands back an unparseable URL untouched rather than rewriting it', () => {
    const junk = 'this is not a url';
    const { url, applied } = buildPooledDatabaseUrl(junk);
    // Prisma's own error about a malformed connection string is far better
    // than anything we would produce by mangling it first.
    expect(url).toBe(junk);
    expect(applied).toBe(false);
  });
});

describe('connectionBudgetWarning (M2 × M8)', () => {
  const safeCeiling = ASSUMED_MAX_CONNECTIONS - CONNECTION_HEADROOM;

  it('is silent when the arithmetic is comfortable', () => {
    expect(connectionBudgetWarning(10, 2)).toBeNull(); // 20 of 80
  });

  it('is silent exactly AT the ceiling, not one short of it', () => {
    expect(connectionBudgetWarning(safeCeiling, 1)).toBeNull();
  });

  it('warns once the product exceeds the ceiling', () => {
    const w = connectionBudgetWarning(10, 9); // 90 > 80
    expect(w).toContain('9 replica(s)');
    expect(w).toContain('exceeds the safe ceiling');
    expect(w).toContain('SHOW max_connections');
  });

  it('uses the SAME replica parsing as the AI governor', () => {
    // If these ever diverge, one subsystem divides by a number the other does
    // not recognise — the sort of drift that only shows up under load.
    expect(parseReplicaCount('garbage')).toBe(1);
    expect(connectionBudgetWarning(10, 'garbage')).toBeNull(); // treated as 1
    expect(connectionBudgetWarning(10, '9')).not.toBeNull(); // string parses
  });
});
