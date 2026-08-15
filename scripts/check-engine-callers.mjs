#!/usr/bin/env node
/**
 * B3-a CI guard — every call to the Python engine must go through a keyed helper.
 *
 * WHY THIS IS STATIC AND NOT A RUNTIME CHECK. The engine counts requests by
 * `<path><-<caller>`, so it can tell you that *some* caller of `/calculate` was
 * keyed. It cannot tell you that *all* of them were: `/calculate` is reached
 * from three NestJS sites plus one Next.js route, and `bazi.passthrough` shares
 * paths with the others by design. Completeness is a property of the source, so
 * it is answered by reading the source.
 *
 * The rule: no raw `fetch(` whose URL mentions the engine, outside the two
 * helpers. Plus a standing ban on `NEXT_PUBLIC_BAZI_ENGINE_URL`, which would
 * inline the engine's URL into the browser bundle.
 *
 * Run: `npm run guard:engine-callers`
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `--root <dir>` points the scan at a fixture tree. Used by the guard's own
 *  spec to prove it still fails on a planted violation — a guard nobody has
 *  seen fail is indistinguishable from a guard that passes unconditionally. */
const rootFlag = process.argv.indexOf('--root');
const ROOT =
  rootFlag !== -1 && process.argv[rootFlag + 1]
    ? process.argv[rootFlag + 1]
    : fileURLToPath(new URL('..', import.meta.url));

/** The only files permitted to call `fetch` at the engine. */
const HELPERS = [
  'apps/api/src/common/engine-client.ts',
  'apps/web/app/lib/engine-client.ts',
];

const SCAN_ROOTS = ['apps/api/src', 'apps/web/app', 'apps/mobile/src'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '__pycache__']);
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;
/** Specs may stub `fetch` freely — they are not a deployed path. */
const IS_TEST = /\.(spec|test)\.[a-z]+$/;

const ENGINE_URL_TOKENS = ['baziEngineUrl', 'BAZI_ENGINE_URL'];
/** How far past `fetch(` to look for the URL. Covers the multi-line call in
 *  `chat-context.service.ts`, where the URL sits on the following line. */
const URL_LOOKAHEAD = 240;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE_EXT.test(entry) && !IS_TEST.test(entry)) out.push(full);
  }
  return out;
}

const violations = [];

for (const scanRoot of SCAN_ROOTS) {
  for (const file of walk(join(ROOT, scanRoot))) {
    const rel = relative(ROOT, file).split(sep).join('/');
    const source = readFileSync(file, 'utf8');
    const isHelper = HELPERS.includes(rel);

    // A raw `fetch(` — `engineFetch(` and `.fetch(` are excluded by the boundary.
    const fetchCall = /(?<![.\w])fetch\s*\(/g;
    let match;
    while ((match = fetchCall.exec(source)) !== null) {
      const window = source.slice(match.index, match.index + URL_LOOKAHEAD);
      if (!ENGINE_URL_TOKENS.some((t) => window.includes(t))) continue;
      if (isHelper) continue;
      const line = source.slice(0, match.index).split('\n').length;
      violations.push({
        file: rel,
        line,
        message: 'raw fetch() at the Bazi engine — use engineFetch() so the call is keyed',
      });
    }

    if (source.includes('NEXT_PUBLIC_BAZI_ENGINE_URL')) {
      const line = source.slice(0, source.indexOf('NEXT_PUBLIC_BAZI_ENGINE_URL')).split('\n').length;
      violations.push({
        file: rel,
        line,
        message:
          'NEXT_PUBLIC_BAZI_ENGINE_URL inlines the engine URL into the browser bundle — ' +
          'proxy through a server route instead',
      });
    }
  }
}

// A guard whose allowlist has drifted off disk silently permits everything.
for (const helper of HELPERS) {
  if (!existsSync(join(ROOT, helper))) {
    violations.push({
      file: helper,
      line: 0,
      message: 'allowlisted engine helper is missing — the guard cannot be trusted until it is restored',
    });
  }
}

if (violations.length > 0) {
  console.error('\n✖ B3-a engine-caller guard failed:\n');
  for (const v of violations) console.error(`  ${v.file}:${v.line}\n    ${v.message}\n`);
  console.error(
    `${violations.length} violation(s). Route the call through engineFetch() ` +
      `(apps/api/src/common/engine-client.ts or apps/web/app/lib/engine-client.ts).\n`,
  );
  process.exit(1);
}

console.log('✓ B3-a engine-caller guard: every engine call goes through a keyed helper');
