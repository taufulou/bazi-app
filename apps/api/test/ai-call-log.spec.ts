import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_CALL_LOG_PREFIX,
  formatAiCallLog,
  hashUserId,
  type AiCallLogFields,
} from '../src/ai/ai-call-log';

const base: AiCallLogFields = {
  route: 'chat:stream',
  provider: 'CLAUDE',
  model: 'claude-sonnet-4-5-20250929',
  ms: 4210,
  inTok: 812,
  outTok: 640,
  cacheReadTok: 9800,
  cacheWriteTok: 0,
  costUsd: 0.0132,
  userIdHash: 'a1b2c3d4e5f6',
  rlOutRemaining: 18000,
  rlOutReset: '2026-08-28T04:05:06Z',
};

const parse = (line: string) => JSON.parse(line.slice(AI_CALL_LOG_PREFIX.length + 1));

describe('hashUserId', () => {
  it('is stable, so calls from one account group together', () => {
    expect(hashUserId('user-abc')).toBe(hashUserId('user-abc'));
  });

  it('distinguishes accounts', () => {
    expect(hashUserId('user-abc')).not.toBe(hashUserId('user-abd'));
  });

  it('never contains the raw id', () => {
    const raw = '3c0c5b50-0b8d-44ca-820b-df10b73d969c';
    const hashed = hashUserId(raw)!;
    expect(hashed).not.toContain(raw);
    expect(hashed).toMatch(/^[0-9a-f]{12}$/);
  });

  it('maps every falsy id to null rather than to a hash of ""', () => {
    // A hash of the empty string is a stable value that would silently become
    // its own "account" in any group-by.
    for (const v of [null, undefined, '']) expect(hashUserId(v)).toBeNull();
  });
});

describe('formatAiCallLog', () => {
  it('emits every field Ob1 specifies', () => {
    const parsed = parse(formatAiCallLog(base));
    for (const key of [
      'route', 'model', 'ms', 'inTok', 'outTok', 'cacheReadTok',
      'userIdHash', 'rlOutRemaining', 'rlOutReset',
    ]) {
      expect(parsed).toHaveProperty(key);
    }
  });

  it('is greppable by the documented prefix', () => {
    expect(formatAiCallLog(base).startsWith(`${AI_CALL_LOG_PREFIX} `)).toBe(true);
  });

  it('keeps a sub-cent cost visible instead of rounding it to zero', () => {
    // At three decimals a Haiku call reads $0.000, which is indistinguishable
    // from "this call was never metered".
    expect(parse(formatAiCallLog({ ...base, costUsd: 0.0000841 })).costUsd).toBe(0.000084);
  });

  it('renders an untimed call as null, not as 0ms', () => {
    expect(parse(formatAiCallLog({ ...base, ms: null })).ms).toBeNull();
  });

  it('cannot be used to forge a log record', () => {
    // `route` is built from a reading type that ultimately arrives in a request
    // body, so a newline here would inject a whole second log line.
    const line = formatAiCallLog({ ...base, route: 'x\nAI-CALL {"costUsd":0}' });
    expect(line.split('\n')).toHaveLength(1);
    expect(parse(line).route).toBe('x\nAI-CALL {"costUsd":0}');
  });
});

/**
 * Ob1's coverage rests on every Anthropic client carrying the rate-limit
 * observer. `createAnthropicClient` is the only thing that installs it, so a
 * bare `new Anthropic(...)` is a client whose traffic is invisible to the gauge
 * — and it is invisible in exactly the way that never breaks a test: the client
 * works perfectly.
 */
describe('every Anthropic client goes through the factory', () => {
  const SRC = join(__dirname, '..', 'src');
  const FACTORY = join(SRC, 'ai', 'anthropic-client.ts');

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
    }
    return out;
  };

  it('finds no bare construction outside anthropic-client.ts', () => {
    const offenders = walk(SRC)
      .filter((f) => f !== FACTORY)
      .filter((f) => /new\s+Anthropic\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it('and the factory itself still constructs one (guard the guard)', () => {
    // Without this, deleting the factory's body would make the sweep above
    // pass vacuously.
    expect(readFileSync(FACTORY, 'utf8')).toMatch(/new\s+Anthropic\s*\(/);
  });
});
