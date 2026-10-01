import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as ts from 'typescript';

/**
 * #6 follow-up — ONE reader of Anthropic's cache counters and TTL split.
 *
 * `stream-usage.ts::absorbInputSideUsage` is the only code allowed to read
 * `cache_read_input_tokens`, `cache_creation_input_tokens` and the
 * `cache_creation.ephemeral_*` split. The claim was first written as a comment
 * while six call sites in chat and fortune still read the counters by hand and
 * ignored the split entirely — prices were right only because none of those
 * requests happened to use the 5-minute TTL. A comment cannot hold that line;
 * this does.
 *
 * Built on the TypeScript AST, not a regex. Comment-stripping regexes fail OPEN
 * on a string containing `//` or `/*` (see `scripts/check-ai-spend-metering.mjs`
 * `stripNonCode` for the documented failure); comments are not AST nodes, and
 * property access, bracket access, destructuring and cast type-literal members
 * are all Identifier or StringLiteral nodes.
 *
 * Fix for a failure here: call `readInputSideUsage` (a completed response) or
 * `absorbInputSideUsage` / `absorbStreamUsage` (a stream) instead.
 */

const SRC = join(__dirname, '..', 'src');
const ALLOWED = ['ai', 'stream-usage.ts'].join(sep);

const BANNED = new Set([
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
  'cache_creation',
  'ephemeral_5m_input_tokens',
  'ephemeral_1h_input_tokens',
]);

interface Hit {
  line: number;
  name: string;
}

/** Every Identifier / string literal naming a banned field. Comments and JSDoc
 *  are not visited: `forEachChild` skips them, unlike `getChildren()`. */
function findRawCacheReads(fileName: string, text: string): Hit[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, /* setParentNodes */ true);
  const hits: Hit[] = [];
  const visit = (node: ts.Node): void => {
    const name =
      ts.isIdentifier(node) ||
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : undefined;
    if (name !== undefined && BANNED.has(name)) {
      hits.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, name });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('usage reader guard — cache counters are read only by stream-usage.ts', () => {
  const files = sourceFiles(SRC);

  it('scans the real source tree (a scanner that reads nothing proves nothing)', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => relative(SRC, f) === ALLOWED)).toBe(true);
  });

  it('finds the fields in stream-usage.ts itself when not exempted — the detector can fire', () => {
    const own = findRawCacheReads(ALLOWED, readFileSync(join(SRC, ALLOWED), 'utf8'));
    expect(own.map((h) => h.name)).toEqual(
      expect.arrayContaining(['cache_read_input_tokens', 'cache_creation_input_tokens', 'cache_creation']),
    );
  });

  it('no other file in apps/api/src reads a cache counter or the TTL split', () => {
    const offenders: string[] = [];
    const exempted: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file);
      if (rel === ALLOWED) {
        exempted.push(rel);
        continue;
      }
      for (const hit of findRawCacheReads(rel, readFileSync(file, 'utf8'))) {
        offenders.push(`${rel}:${hit.line} reads \`${hit.name}\` — use readInputSideUsage()`);
      }
    }
    // Exactly ONE file is exempt. A widened exemption (a prefix match on `ai`
    // would silently cover ai.service.ts, home of streamClaude and callClaude)
    // must fail here rather than pass quietly.
    expect(exempted).toEqual([ALLOWED]);
    expect(offenders).toEqual([]);
  });

  describe('the detector itself', () => {
    const names = (src: string) => findRawCacheReads('fixture.ts', src).map((h) => h.name);

    it('flags a raw read that follows strings containing /* and a URL', () => {
      // A regex comment-stripper would treat `/*` as a comment opener and hide
      // everything after it — the fail-open this guard exists to avoid.
      const src = [
        "const url = 'https://example.com/a';",
        "const opener = '/*';",
        'const n = usage.cache_read_input_tokens;',
      ].join('\n');
      expect(names(src)).toEqual(['cache_read_input_tokens']);
    });

    it('flags bracket access, destructuring and a cast type-literal member', () => {
      expect(names("const a = usage['cache_creation'];")).toEqual(['cache_creation']);
      expect(names('const { cache_creation_input_tokens } = usage;')).toEqual(['cache_creation_input_tokens']);
      expect(names('const b = (u as { ephemeral_5m_input_tokens?: number }).x;')).toEqual([
        'ephemeral_5m_input_tokens',
      ]);
    });

    it('does NOT flag comments or JSDoc that merely name the fields', () => {
      const src = [
        '// usage.cache_read_input_tokens is read elsewhere',
        '/** @param cache_creation the split */',
        'function f(split: number) { return split; }',
        '/* cache_creation_input_tokens */ const x = 1;',
      ].join('\n');
      expect(names(src)).toEqual([]);
    });

    it('reports the line of the offending read', () => {
      const hits = findRawCacheReads('fixture.ts', '\n\nconst t = u.cache_creation_input_tokens;');
      expect(hits).toEqual([{ line: 3, name: 'cache_creation_input_tokens' }]);
    });
  });
});
