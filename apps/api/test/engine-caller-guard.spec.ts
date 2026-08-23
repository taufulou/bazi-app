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
// M10 deleted the web helper: the free-preview route proxies through NestJS
// now, so the web app has no permitted engine door. Kept as a path constant
// because it is exactly the file whose RETURN must be caught as a violation.
const FORMER_WEB_HELPER = 'apps/web/app/lib/engine-client.ts';

function write(root: string, rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function makeCleanTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'engine-guard-'));
  // Both helpers present, and each is allowed to call fetch at the engine.
  write(root, API_HELPER, 'export const f = () => fetch(`${baziEngineUrl}/x`, {});\n');
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
    rmSync(join(root, API_HELPER));
    const { code, output } = runGuard(root);
    expect(code).toBe(1);
    expect(output).toContain('allowlisted engine helper is missing');
  });

  it('now treats a REINSTATED web engine helper as a violation (M10)', () => {
    // Before M10 this exact file was allowlisted. Deleting the route that used
    // it is only half the job: if the helper comes back, the guard has to say
    // so, or the door B3-b assumes is shut quietly reopens.
    const root = tree();
    write(root, FORMER_WEB_HELPER, 'export const f = () => fetch(`${process.env.BAZI_ENGINE_URL}/x`, {});\n');
    expect(runGuard(root).code).toBe(1);
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

  it('catches fetch behind a property access', () => {
    // `globalThis.fetch(...)` was a verified bypass of the first version, which
    // excluded any `fetch` preceded by a non-word character. Property-accessed
    // fetch at the engine is now a violation.
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/global.service.ts',
      'export const bad = () => globalThis.fetch(`${this.baziEngineUrl}/calculate`);\n',
    );
    expect(runGuard(root).code).toBe(1);
  });

  // --- bypasses verified against the first version; each was exit 0 ---

  it('catches a URL hoisted into a variable before the call', () => {
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/hoisted.service.ts',
      'const url = `${this.baziEngineUrl}/calculate`;\n' +
        '// ... a dozen lines of unrelated code ...\n'.repeat(12) +
        'export const bad = () => fetch(url, { method: "POST" });\n',
    );
    expect(runGuard(root).code).toBe(1);
  });

  it('catches a caller that imports the base URL from elsewhere', () => {
    // Never names the env var, so no token match — only the engine's own route
    // name gives it away.
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/imported.service.ts',
      "import { ENGINE } from './constants';\n" +
        'export const bad = () => fetch(`${ENGINE}/build-chat-context`, { method: "POST" });\n',
    );
    expect(runGuard(root).code).toBe(1);
  });

  it('catches a hardcoded Railway private hostname', () => {
    // `engine.railway.internal` is the hostname Railway private networking
    // actually hands you, so this is the realistic hardcoded form.
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/hardcoded.service.ts',
      'export const bad = () => fetch("http://engine.railway.internal:5001/calculate");\n',
    );
    expect(runGuard(root).code).toBe(1);
  });

  it('catches axios and other HTTP clients, not just fetch', () => {
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/axios.service.ts',
      "import axios from 'axios';\n" +
        'export const bad = () => axios.post(`${this.baziEngineUrl}/daily-fortune`, {});\n',
    );
    expect(runGuard(root).code).toBe(1);
  });

  it('scans beyond the three src directories', () => {
    // `middleware.ts`, `prisma/seed.ts`, `scripts/` and `e2e/` were all outside
    // the original scan roots.
    const root = tree();
    write(
      root,
      'apps/web/middleware.ts',
      'export const bad = () => fetch(`${process.env.BAZI_ENGINE_URL}/calculate`);\n',
    );
    expect(runGuard(root).code).toBe(1);
  });

  it('scans .mjs and .cjs, not only .ts', () => {
    const root = tree();
    write(
      root,
      'scripts/rogue.mjs',
      'export const bad = () => fetch(`${process.env.BAZI_ENGINE_URL}/calculate`);\n',
    );
    expect(runGuard(root).code).toBe(1);
  });

  // --- precision: these must NOT fire ---

  it('does not fire on the word "fetch" in prose', () => {
    // "post-fetch (TS-side)" and "full-fetch (issued in parallel" are real
    // comments in files that also name the engine URL; both matched on the
    // first pass of the widened rule.
    const root = tree();
    write(
      root,
      'apps/api/src/other/notes.service.ts',
      '// the hint is computed post-fetch (TS-side) from `${this.baziEngineUrl}` output\n' +
        'export const ok = 1;\n',
    );
    expect(runGuard(root).code).toBe(0);
  });

  it('does not fire on a NestJS route that merely shares a route name', () => {
    // `${API_URL}/api/bazi/explain-element` is the NestJS proxy — the correct
    // pattern, and it must not be mistaken for an engine call.
    const root = tree();
    write(
      root,
      'apps/web/app/api/explain-element/route.ts',
      'export const POST = () => fetch(`${API_URL}/api/bazi/explain-element`, { method: "POST" });\n',
    );
    expect(runGuard(root).code).toBe(0);
  });
});
