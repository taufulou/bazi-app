#!/usr/bin/env node
/**
 * B3-a CI guard — every call to the Python engine must go through a keyed helper.
 *
 * WHY STATIC AND NOT RUNTIME. The engine counts requests by `<path><-<caller>`,
 * so it can tell you that *some* caller of `/calculate` was keyed. It cannot
 * tell you that *all* of them were: `/calculate` is reached from three NestJS
 * sites plus one Next.js route.
 *
 * ⚠️ WHAT THIS GUARD CANNOT DO. It is a lexical scan, not a type-aware one, so
 * it is a ratchet against the plausible mistake — not a proof. A determined
 * bypass is always possible (build the URL in one file, import it into another,
 * call it through a dynamic property). The rules below are ordered by how
 * likely the mistake is, and the residual gaps are listed in
 * `docs/security/audit-2026-08.md` under B3-a rather than left implied.
 *
 * Rules:
 *   A. A raw HTTP call whose URL expression mentions an engine URL token.
 *   B. A file that mentions an engine URL token at all may not contain any raw
 *      HTTP call. Catches URL-into-a-variable indirection, which Rule A's
 *      lookahead window misses.
 *   C. A raw HTTP call whose URL expression mentions one of the engine's route
 *      paths. Catches a caller that imports the base URL from elsewhere and so
 *      never names the env var.
 *   D. `NEXT_PUBLIC_`-prefixed engine URL anywhere — that inlines the engine's
 *      address into the browser bundle.
 *   E. The allowlisted helpers must exist on disk.
 *
 * Run: `npm run guard:engine-callers`
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `--root <dir>` points the scan at a fixture tree, so the guard's own spec can
 *  prove it still fails on a planted violation. A guard nobody has seen fail is
 *  indistinguishable from one that passes unconditionally. */
const rootFlag = process.argv.indexOf('--root');
const ROOT =
  rootFlag !== -1 && process.argv[rootFlag + 1]
    ? process.argv[rootFlag + 1]
    : fileURLToPath(new URL('..', import.meta.url));

/** The only files permitted to make a raw HTTP call at the engine. */
const HELPERS = [
  'apps/api/src/common/engine-client.ts',
  'apps/web/app/lib/engine-client.ts',
];

/** This file necessarily contains every token and route name it searches for. */
const SELF = 'scripts/check-engine-callers.mjs';

/** Everything that ships or runs. Deliberately broad: the previous version
 *  scanned three `src` directories and missed `middleware.ts`, `prisma/seed.ts`,
 *  `scripts/` and `e2e/`. */
const SCAN_ROOTS = ['apps', 'packages', 'scripts', 'e2e'];
const SKIP_DIRS = new Set([
  'node_modules', '.next', '.expo', 'dist', 'build', 'coverage',
  '__pycache__', '.venv', 'ios', 'android', '.turbo', '.git',
]);
const CODE_EXT = /\.(m|c)?(ts|js)x?$/;
/** Specs may stub `fetch` freely — they are not a deployed path. */
const IS_TEST = /\.(spec|test)\.[a-z]+$/;

const ENGINE_URL_TOKENS = ['baziEngineUrl', 'BAZI_ENGINE_URL'];

/** Literal addresses of the engine. Checked ONLY inside a URL expression, never
 *  at file level: a comment saying "port 5001" must not make every unrelated
 *  fetch in that file a violation. `engine.railway.internal` is the hostname
 *  Railway private networking actually hands you, so a hardcoded call is the
 *  realistic bypass of a scan that only knows the env-var name. */
const ENGINE_HOST_LITERALS = ['engine.railway.internal', 'bazi-engine', ':5001', ':5000'];

/** Every route the engine serves. A caller must name one of these. */
const ENGINE_ROUTES = [
  '/calculate', '/compatibility', '/explain-element',
  '/daily-fortune', '/monthly-fortune', '/yearly-fortune',
  '/build-chat-context', '/build-chat-context-compat', '/build-chat-context-fortune',
];

/**
 * Raw HTTP calls. `fetch(` is matched even behind a property access, so
 * `globalThis.fetch(` is caught; `engineFetch(` is excluded by name, and so is a
 * hyphenated word — prose like "post-fetch (TS-side)" appears in real comments
 * here and matched on the first pass.
 */
const HTTP_CALL =
  /(?<!engine)(?<![A-Za-z-])fetch\s*\(|\baxios\s*[.(]|\bgot\s*[.(]|\bundici\b|\bhttps?\.request\s*\(/g;

/** How far past the call to look for the URL. Covers the multi-line form in
 *  `chat-context.service.ts`, where the URL sits on the following line. */
const URL_LOOKAHEAD = 400;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // a broken symlink is not a finding
    }
    if (st.isDirectory()) walk(full, out);
    else if (CODE_EXT.test(entry) && !IS_TEST.test(entry)) out.push(full);
  }
  return out;
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

const violations = [];
const add = (file, line, message) => violations.push({ file, line, message });

for (const scanRoot of SCAN_ROOTS) {
  for (const file of walk(join(ROOT, scanRoot))) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (HELPERS.includes(rel) || rel === SELF) continue;
    const source = readFileSync(file, 'utf8');

    const mentionsEngineUrl = ENGINE_URL_TOKENS.some((t) => source.includes(t));

    HTTP_CALL.lastIndex = 0;
    let match;
    while ((match = HTTP_CALL.exec(source)) !== null) {
      const window = source.slice(match.index, match.index + URL_LOOKAHEAD);
      const line = lineOf(source, match.index);

      // Rule A — the URL expression names the engine, by variable or by address.
      if (
        ENGINE_URL_TOKENS.some((t) => window.includes(t)) ||
        ENGINE_HOST_LITERALS.some((t) => window.includes(t))
      ) {
        add(rel, line, 'raw HTTP call at the Bazi engine — use engineFetch() so the call is keyed');
        continue;
      }
      // Rule B — the file knows the engine's address, so any raw call here is suspect.
      if (mentionsEngineUrl) {
        add(
          rel,
          line,
          'raw HTTP call in a file that references the engine URL — route it through ' +
            'engineFetch(), or move the unrelated call to another module',
        );
        continue;
      }
      // Rule C — the URL expression names an engine route, directly after an
      // interpolated base. Requiring the `}` matters: `${API_URL}/api/bazi/
      // explain-element` is the NestJS proxy in `app/api/explain-element/route.ts`
      // and must NOT be flagged, while `${ENGINE}/build-chat-context` must.
      const route = ENGINE_ROUTES.find((r) =>
        ['`', "'", '"'].some((q) => window.includes(`}${r}${q}`)),
      );
      if (route) {
        add(rel, line, `raw HTTP call at the engine route ${route} — use engineFetch()`);
      }
    }

    // Rule D — report every occurrence, not just the first.
    const banned = 'NEXT_PUBLIC_BAZI_ENGINE_URL';
    let at = source.indexOf(banned);
    while (at !== -1) {
      add(
        rel,
        lineOf(source, at),
        `${banned} inlines the engine URL into the browser bundle — proxy through a server route instead`,
      );
      at = source.indexOf(banned, at + banned.length);
    }
  }
}

// Rule E — an allowlist that has drifted off disk silently permits everything.
for (const helper of HELPERS) {
  if (!existsSync(join(ROOT, helper))) {
    add(helper, 0, 'allowlisted engine helper is missing — the guard cannot be trusted until it is restored');
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
