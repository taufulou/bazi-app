import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as ts from 'typescript';
import { KNOWN_LOCK_PREFIXES } from '../src/redis/redis.service';

/**
 * todo #23 — nobody may hand-roll a Redis lock outside `RedisService`.
 *
 * The lock primitive used to be `SET key '1' EX ttl NX` + a bare `DEL`, which
 * let an expired holder delete its successor's lock. `RedisService` now writes a
 * per-holder token and releases with a compare-and-delete. The compiler forces
 * every `releaseLock` caller to pass a token — but it cannot see a NEW caller
 * that copies the old primitive with the raw client. This guard can.
 *
 * It walks the TypeScript AST rather than text, so comments, strings containing
 * `//`, multi-line calls and nested parentheses all come out right. Because
 * there are ZERO `nx` literals outside `redis.service.ts` today, the rule can be
 * broad and still be green:
 *
 *   (a) any string / no-substitution template literal whose value is `nx`
 *       (any case), anywhere — catches `'NX' as const`, `const NX = 'NX'`,
 *       spread arrays and `client.call('set', …, 'NX')`, not only `.set(…)`;
 *   (b) any string or template text matching `\bSET\b … \bNX\b` — a Lua
 *       `SET … NX` inside an `eval` script (including template head/middle/tail
 *       parts around `${}`);
 *   (c) a CALL to a property named `setnx` (any case). Prose that merely
 *       mentions "SETNX" in a comment or a description string stays legal.
 *   (d) a `.del(…)` / `.unlink(…)` whose first argument names a lock — its
 *       text matches /lock/i, or it starts with a known lock prefix. Acquiring
 *       through RedisService and then deleting the key by hand re-arms exactly
 *       the delete-your-successor bug; the compiler only forces a token on
 *       `releaseLock`, not on `del`.
 *
 * ⚠️ A ratchet against the plausible copy-paste, not a proof: an `NX` value
 * BUILT AT RUNTIME (string concatenation) is invisible to a static check.
 */

const SRC = join(__dirname, '..', 'src');
const EXEMPT = new Set([join('redis', 'redis.service.ts')]);
const SET_NX_TEXT = /\bSET\b[^\n]*\bNX\b/i;
const LOCK_WORD = /(^|[^A-Za-z])(?:lock|LOCK)|Lock/;

export interface LockViolation {
  rule: 'nx-literal' | 'lua-set-nx' | 'setnx-call' | 'del-lock-key';
  line: number;
  text: string;
}

/** Pure: find lock-primitive violations in one source text. */
export function findLockViolations(source: string, fileName = 'x.ts'): LockViolation[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: LockViolation[] = [];
  const at = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const visit = (node: ts.Node): void => {
    // (a) + (b) on plain strings and substitution-free templates
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (node.text.trim().toLowerCase() === 'nx') {
        out.push({ rule: 'nx-literal', line: at(node), text: node.getText(sf) });
      } else if (SET_NX_TEXT.test(node.text)) {
        out.push({ rule: 'lua-set-nx', line: at(node), text: node.getText(sf).slice(0, 80) });
      }
    }
    // (b) on the literal parts of a template WITH substitutions
    if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' ');
      if (SET_NX_TEXT.test(text)) {
        out.push({ rule: 'lua-set-nx', line: at(node), text: node.getText(sf).slice(0, 80) });
      }
    }
    // (c) a call to `.setnx(...)`
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text.toLowerCase() === 'setnx'
    ) {
      out.push({ rule: 'setnx-call', line: at(node), text: node.getText(sf).slice(0, 80) });
    }
    // (d) a hand-rolled release: `.del(lockKey)` / `.unlink(\`stream:reading:${id}\`)`
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['del', 'unlink'].includes(node.expression.name.text.toLowerCase()) &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0].getText(sf);
      const literal = arg.replace(/^[`'"]/, '');
      // `lock` as a word or camel-case part (lockKey, readingLockKey, stream:lock,
      // LOCK_KEY) — NOT inside another word (blockKey, blocked, clock).
      if (LOCK_WORD.test(arg) || KNOWN_LOCK_PREFIXES.some((p) => literal.startsWith(`${p}:`))) {
        out.push({ rule: 'del-lock-key', line: at(node), text: node.getText(sf).slice(0, 80) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) files.push(...sourceFiles(p));
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.d.ts')) files.push(p);
  }
  return files;
}

describe('redis lock ownership guard', () => {
  describe('self-test — the guard must be SEEN to fail', () => {
    it.each([
      ['multi-line lowercase set', `client.set(\n  k,\n  '1',\n  'ex',\n  30,\n  'nx',\n);`],
      ['nested parentheses', `client.set(k, String(x), 'EX', 30, 'NX');`],
      ['as const', `client.set(k, v, 'EX', 30, 'NX' as const);`],
      ['parenthesised', `client.set(k, v, 'EX', 30, ('NX'));`],
      ['hoisted constant', `const NX = 'NX';\nclient.set(k, v, 'EX', 30, NX);`],
      ['spread array', `const A = ['EX', 30, 'NX'];\nclient.set(k, v, ...A);`],
      ['generic call', `client.call('set', k, v, 'EX', 30, 'NX');`],
      ['backtick literal', 'client.set(k, v, `EX`, 30, `NX`);'],
      ['Lua string', `client.eval("redis.call('SET', KEYS[1], ARGV[1], 'NX')", 1, k, v);`],
      ['interpolated Lua template', "client.eval(`redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ${ms})`, 1, k, v);"],
      ['setnx call', `client.setnx(k, v);`],
      ['SETNX call, any case', `client.SETNX(k, v);`],
      ['del of a lock variable', `await this.redis.del(lockKey);`],
      ['del of an UPPER_CASE lock key', `await this.redis.del(LOCK_KEY);`],
      ['unlink of a lock variable', `await client.unlink(readingLockKey);`],
      ['del of a known lock-key template', 'await this.redis.del(`stream:reading:${id}`);'],
      ['del of a known lock-key string', `await client.del('chat-extend:' + id);`],
    ])('fails on: %s', (_name, src) => {
      expect(findLockViolations(src)).not.toEqual([]);
    });

    it.each([
      ['a comment mentioning SETNX', `// Redis SETNX is the dedup boundary\nconst x = 1;`],
      ['a block comment', `/* uses SET … NX under the hood */ const x = 1;`],
      ['a description string mentioning SETNX', `const d = 'deduplicated via Redis SETNX — a second call returns 409';`],
      ["the throttler's SET … PX Lua", "const S = `redis.call('SET', blockKey, '1', 'PX', blockMs)`;"],
      ['a Map / cache set', `cache.set(k, v); map.set('a', 1);`],
      ['URLSearchParams set', `searchParams.set('pool_timeout', '20');`],
      ['a string containing //', `const u = 'https://example.com/a//b'; client.get(u);`],
      ['a cache-key del', `await this.redis.del('services:active'); await this.redis.del(\`admin:role:\${id}\`);`],
      ['releaseLock itself', `await this.redis.releaseLock(lockKey, lockToken);`],
      ['del of a key that merely contains "lock" inside a word', 'await r.del(blockKey); await r.del(`${hitsKey}:blocked`); await r.del(clockKey);'],
    ])('passes on: %s', (_name, src) => {
      expect(findLockViolations(src)).toEqual([]);
    });
  });

  it('apps/api/src contains no lock primitive outside RedisService', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      if (EXEMPT.has(rel)) continue;
      for (const v of findLockViolations(readFileSync(file, 'utf8'), file)) {
        offenders.push(`${rel.split(sep).join('/')}:${v.line} [${v.rule}] ${v.text}`);
      }
    }
    // If this fails: use RedisService.acquireLock / releaseLock (token-based),
    // never a raw SET … NX + DEL. See the docblock above and CLAUDE.md.
    expect(offenders).toEqual([]);
  });

  it('the exempt file really does hold the one sanctioned primitive', () => {
    // Guards the exemption itself: if the lock ever moves out of
    // redis.service.ts, this list must move with it.
    const src = readFileSync(join(SRC, 'redis', 'redis.service.ts'), 'utf8');
    expect(findLockViolations(src).some((v) => v.rule === 'nx-literal')).toBe(true);
  });
});
