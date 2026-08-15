import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';

/**
 * B3-a — a self-test for `scripts/check-engine-callers.mjs`.
 *
 * The guard is the only thing that makes "every engine call is keyed" a
 * statically answerable question, and a guard nobody has watched FAIL is
 * indistinguishable from one that passes unconditionally. Each case here plants
 * a specific violation in a fixture tree and asserts the guard catches it.
 */

const GUARD = join(__dirname, '..', '..', '..', 'scripts', 'check-engine-callers.mjs');

const API_HELPER = 'apps/api/src/common/engine-client.ts';
const WEB_HELPER = 'apps/web/app/lib/engine-client.ts';

function write(root: string, rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function makeCleanTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'engine-guard-'));
  // Both helpers present, and each is allowed to call fetch at the engine.
  write(root, API_HELPER, 'export const f = () => fetch(`${baziEngineUrl}/x`, {});\n');
  write(root, WEB_HELPER, 'export const f = () => fetch(`${process.env.BAZI_ENGINE_URL}/x`, {});\n');
  write(root, 'apps/api/src/bazi/bazi.service.ts', "import { engineFetch } from '../common/engine-client';\nexport const g = () => engineFetch(`${this.baziEngineUrl}/calculate`, { caller: 'bazi.reading' });\n");
  return root;
}

function runGuard(root: string): { code: number; output: string } {
  try {
    const output = execFileSync('node', [GUARD, '--root', root], { encoding: 'utf8' });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('B3-a engine-caller guard', () => {
  const roots: string[] = [];
  const tree = () => {
    const r = makeCleanTree();
    roots.push(r);
    return r;
  };

  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it('passes on a tree where every engine call goes through the helper', () => {
    expect(runGuard(tree()).code).toBe(0);
  });

  it('fails on a raw fetch at the engine in a service', () => {
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/rogue.service.ts',
      'export const bad = () => fetch(`${this.baziEngineUrl}/calculate`, { method: "POST" });\n',
    );
    const { code, output } = runGuard(root);
    expect(code).toBe(1);
    expect(output).toContain('rogue.service.ts');
    expect(output).toContain('use engineFetch()');
  });

  it('fails on a raw fetch that reads the env var directly', () => {
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/other.service.ts',
      'export const bad = () => fetch(`${process.env.BAZI_ENGINE_URL}/health`);\n',
    );
    expect(runGuard(root).code).toBe(1);
  });

  it('catches a URL on the line AFTER the fetch call', () => {
    // `chat-context.service.ts` is formatted exactly this way. A guard that only
    // looked at the fetch line itself would have missed it.
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/multiline.service.ts',
      'export const bad = () =>\n  fetch(\n    `${this.baziEngineUrl}/build-chat-context`,\n    { method: "POST" },\n  );\n',
    );
    expect(runGuard(root).code).toBe(1);
  });

  it('fails on a raw fetch in a Next.js route', () => {
    const root = tree();
    write(
      root,
      'apps/web/app/api/rogue/route.ts',
      'export const POST = () => fetch(`${process.env.BAZI_ENGINE_URL}/calculate`);\n',
    );
    expect(runGuard(root).code).toBe(1);
  });

  it('bans a browser-exposed engine URL anywhere in app code', () => {
    const root = tree();
    write(
      root,
      'apps/web/app/lib/rogue.ts',
      ['export const u = process.env.NEXT_PUBLIC_BAZI', 'ENGINE_URL;\n'].join('_'),
    );
    const { code, output } = runGuard(root);
    expect(code).toBe(1);
    expect(output).toContain('browser bundle');
  });

  it('fails when an allowlisted helper has been moved or deleted', () => {
    // An allowlist that has drifted off disk silently permits everything it was
    // meant to constrain.
    const root = tree();
    rmSync(join(root, WEB_HELPER));
    const { code, output } = runGuard(root);
    expect(code).toBe(1);
    expect(output).toContain('allowlisted engine helper is missing');
  });

  it('ignores unrelated fetch calls', () => {
    const root = tree();
    write(
      root,
      'apps/api/src/other/thing.service.ts',
      'export const ok = () => fetch("https://api.stripe.com/v1/charges");\n',
    );
    expect(runGuard(root).code).toBe(0);
  });

  it('ignores spec files, which may stub fetch freely', () => {
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/rogue.service.spec.ts',
      'it("x", () => fetch(`${this.baziEngineUrl}/calculate`));\n',
    );
    expect(runGuard(root).code).toBe(0);
  });

  it('does not mistake a method call named fetch for a bare one', () => {
    const root = tree();
    write(
      root,
      'apps/api/src/other/cache.service.ts',
      'export const ok = (c: any) => c.fetch(`${this.baziEngineUrl}/calculate`);\n',
    );
    expect(runGuard(root).code).toBe(0);
  });
});
