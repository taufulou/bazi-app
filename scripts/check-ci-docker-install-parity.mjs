#!/usr/bin/env node
/**
 * #11(c) CI guard — CI's Build job must install EXACTLY the way the production
 * Dockerfiles do.
 *
 * WHY. Lint, typecheck and the test jobs run a bare `npm ci`, which installs
 * every workspace and hoists everything to the root. That hides any package a
 * workspace imports but does not declare, as long as SOME sibling declares it:
 * `iztro` (declared in apps/api, imported by apps/web) passed CI and broke the
 * launch-day web build, and `lunar-typescript` (root + mobile, not web) was the
 * same bug waiting. The Dockerfiles run SCOPED installs, which do not see a
 * sibling's packages. So the Build job now runs the Dockerfiles' own `npm ci`
 * commands — and this guard keeps that mirror from drifting, because a mirror
 * that drifts from its original is how the bug class comes back.
 *
 * Works on TEXT (no YAML parser): it runs in the Lint job BEFORE `npm ci`, with
 * no dependencies, like the other `scripts/check-*.mjs` guards. Rules:
 *
 *   1. Dockerfiles: in `docker/Dockerfile.api` and `docker/Dockerfile.web`, join
 *      `\` continuations, then find EXACTLY ONE `RUN npm ci …` line.
 *   2. CI: take only the `build:` job block of `.github/workflows/ci.yml` — from
 *      `  build:` to the next line that is non-blank, not a comment, and indented
 *      ≤ 2 spaces. Inside it, collect every `npm ci` command, SKIPPING comment
 *      lines (a commented-out command must neither count as present nor be
 *      flagged as bare).
 *   3. Pair each Dockerfile with the build-job command carrying the same
 *      `--workspace=api` / `--workspace=web` flag.
 *   4. Compare each pair as a SET of flags. Fail on a difference, on a MISSING
 *      scoped command, and on any bare `npm ci` (no `--workspace`) inside the
 *      build block.
 *   5. Fail on ANY other install in the build block (`npm install`/`i`/`add`/
 *      `clean-install`/`cit`…, `yarn`, `pnpm install`) and on any `npm_config_*`
 *      env key there — each would quietly restore the hoisted full install.
 *      Commands are read from each step's whole `run:` scalar, so a folded
 *      (`>-`) or plain multi-line scalar cannot hide a second line.
 *
 * Run: `npm run guard:install-parity`
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `--root <dir>` points the guard at a fixture tree, so its spec can prove it
 *  fails on a planted drift. A guard nobody has seen fail proves nothing. */
const rootFlag = process.argv.indexOf('--root');
const ROOT =
  rootFlag !== -1 && process.argv[rootFlag + 1]
    ? process.argv[rootFlag + 1]
    : fileURLToPath(new URL('..', import.meta.url));

const DOCKERFILES = [
  { file: 'docker/Dockerfile.api', key: '--workspace=api' },
  { file: 'docker/Dockerfile.web', key: '--workspace=web' },
];
const CI_FILE = '.github/workflows/ci.yml';

const violations = [];
const fail = (msg) => violations.push(msg);

/** `npm ci --a --b` (any trailing text) → sorted unique flag list. */
function flagsOf(command) {
  const afterCi = command.replace(/^.*?\bnpm\s+ci\b/, '');
  return [...new Set(afterCi.trim().split(/\s+/).filter(Boolean))].sort();
}

const isComment = (line) => /^\s*#/.test(line);

function read(rel) {
  const full = join(ROOT, rel);
  if (!existsSync(full)) {
    fail(`${rel} is missing — the guard cannot check a mirror of a file that does not exist`);
    return null;
  }
  return readFileSync(full, 'utf8');
}

// ── 1. Dockerfiles ──────────────────────────────────────────────────────────
const dockerCommands = [];
for (const { file, key } of DOCKERFILES) {
  const text = read(file);
  if (text === null) continue;
  const joined = text.replace(/\\\r?\n/g, ' ');
  const runs = joined
    .split(/\r?\n/)
    .filter((l) => !isComment(l) && /^\s*RUN\s+npm\s+ci\b/.test(l));
  if (runs.length !== 1) {
    fail(`${file}: expected exactly one \`RUN npm ci …\` line, found ${runs.length}`);
    continue;
  }
  const flags = flagsOf(runs[0]);
  if (!flags.includes(key)) {
    fail(`${file}: its npm ci does not carry ${key}, so it cannot be paired with a CI step`);
    continue;
  }
  dockerCommands.push({ file, key, flags });
}

// ── 2. CI build-job block ───────────────────────────────────────────────────
//
// Commands are read from each step's `run:` SCALAR, not line by line: a folded
// (`>` / `>-`) or plain multi-line scalar is ONE shell command that YAML joins
// with spaces, so `--workspaces` on its second line is part of the install.
// A literal (`|`) scalar keeps its newlines, i.e. one shell command per line.

/**
 * Package-manager commands that install into the project, other than the two
 * paired `npm ci`s. npm 10's full alias list: install = add/i/in/ins/inst/insta/
 * instal/install/isnt/isnta/isntal/isntall; ci = clean-install/ic/install-clean/
 * isntall-clean (an aliased `ci` is NOT paired, so it fails here — fail-safe);
 * install-ci-test = cit/clean-install-test/sit; install-test = it. A GLOBAL install
 * (`-g` / `--global`, e.g. pinning npm itself) never touches node_modules and is
 * allowed.
 */
const OTHER_INSTALL = new RegExp(
  [
    '\\bnpm\\s+(?:add|i|in|ins|inst|insta|instal|install|isnt|isnta|isntal|isntall|' +
      'clean-install|ic|install-clean|isntall-clean|cit|clean-install-test|sit|it|install-test|install-ci-test)\\b',
    '\\byarn(?:\\s+(?:install|add)\\b|\\s*(?:$|&&|;|\\|))',
    '\\b(?:pnpm|bun)\\s+(?:i|install|add)\\b',
  ].join('|'),
);
const GLOBAL_INSTALL = /(?:^|\s)(?:-g|--global)(?:\s|$)/;

/** npm config keys that only change OUTPUT, not what gets installed. */
const COSMETIC_NPM_CONFIG = new Set([
  'npm_config_loglevel',
  'npm_config_progress',
  'npm_config_fund',
  'npm_config_audit',
  'npm_config_update_notifier',
  'npm_config_color',
]);

const ci = read(CI_FILE);
const ciCommands = [];
if (ci !== null) {
  const lines = ci.split(/\r?\n/);
  const start = lines.findIndex((l) => /^ {2}build:\s*$/.test(l));
  if (start === -1) {
    fail(`${CI_FILE}: no \`  build:\` job found`);
  } else {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === '' || isComment(l)) continue; // never end the block
      const indent = l.length - l.trimStart().length;
      if (indent <= 2) {
        end = i;
        break;
      }
    }
    const block = lines.slice(start + 1, end);
    const indentOf = (l) => l.length - l.trimStart().length;

    // An npm config env var on any step can turn a scoped install back into a
    // full one (e.g. `npm_config_workspaces: 'true'`), with no change to the
    // command the pairing below compares.
    for (const l of block) {
      if (isComment(l)) continue;
      const m = l.match(/^\s*(npm_config_[A-Za-z0-9_]+)\s*:/i);
      if (m && !COSMETIC_NPM_CONFIG.has(m[1].toLowerCase())) {
        fail(`${CI_FILE} build job: \`${m[1]}\` can change what npm installs — not allowed in the Build job`);
      }
    }

    for (let i = 0; i < block.length; i++) {
      const m = block[i].match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
      if (!m || isComment(block[i])) continue;
      const keyIndent = indentOf(block[i]) + (block[i].trimStart().startsWith('-') ? 2 : 0);
      const header = m[2].replace(/\s+#.*$/, '').trim();
      const body = [];
      while (i + 1 < block.length && (block[i + 1].trim() === '' || indentOf(block[i + 1]) > keyIndent)) {
        body.push(block[++i]);
      }
      let script;
      if (/^\|[+-]?$/.test(header)) {
        script = body.join('\n'); // literal: newlines kept
      } else if (/^>[+-]?$/.test(header)) {
        script = body.map((l) => l.trim()).filter(Boolean).join(' '); // folded
      } else {
        script = [header, ...body.map((l) => l.trim()).filter(Boolean)].join(' '); // plain multi-line
        // A quoted scalar: drop the surrounding quotes so the last flag is not
        // read as `--include-workspace-root"`.
        const q = script.match(/^(["'])([\s\S]*)\1$/);
        if (q) script = q[2];
      }
      // Shell lines: join `\` continuations, drop comment lines and trailing comments.
      const shellLines = script
        .replace(/\\\s*\n/g, ' ')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => l.replace(/\s+#.*$/, ''));
      for (const line of shellLines) {
        const at = line.search(/\bnpm\s+ci\b/);
        if (at !== -1) ciCommands.push(line.slice(at));
        const rest = line.replace(/\bnpm\s+ci\b[^&;|]*/g, '');
        const other = rest
          .split(/&&|;|\|\|/)
          .some((cmd) => OTHER_INSTALL.test(cmd) && !GLOBAL_INSTALL.test(cmd));
        if (other) {
          fail(
            `${CI_FILE} build job: \`${line}\` installs packages outside the two mirrored ` +
              `\`npm ci\` commands — it brings back the hoisted full install this guard exists to prevent.`,
          );
        }
      }
    }
  }
}

// ── 3 + 4. Pair and compare ─────────────────────────────────────────────────
// Every `npm ci` in the build block must be one of the mirrored commands —
// i.e. carry EXACTLY ONE Dockerfile key. Anything else (bare, `--workspaces`,
// `-ws`, a path-form or space-form `--workspace`, two keys) is an extra install
// the pairing below would otherwise never look at.
const KEYS = DOCKERFILES.map((d) => d.key);
for (const cmd of ciCommands) {
  const flags = flagsOf(cmd);
  const keysHere = KEYS.filter((k) => flags.includes(k));
  if (!flags.some((f) => f.startsWith('--workspace') || f === '-w' || f === '-ws')) {
    fail(
      `${CI_FILE} build job: bare \`${cmd.trim()}\` — a full install hoists every workspace's ` +
        `packages and hides undeclared dependencies. Mirror the Dockerfile's scoped install.`,
    );
  } else if (keysHere.length !== 1) {
    // (`--workspaces` / `-ws` land here too: they carry no Dockerfile key.)
    fail(
      `${CI_FILE} build job: \`${cmd.trim()}\` is not one of the mirrored installs — every npm ci ` +
        `here must carry exactly one of ${KEYS.join(' / ')} and match its Dockerfile.`,
    );
  }
}
for (const { file, key, flags } of dockerCommands) {
  const matches = ciCommands.filter((c) => flagsOf(c).includes(key));
  if (matches.length === 0) {
    fail(
      `${CI_FILE} build job: MISSING the scoped install that mirrors ${file}\n` +
        `      expected flags: ${flags.join(' ')}`,
    );
    continue;
  }
  if (matches.length > 1) {
    fail(`${CI_FILE} build job: ${matches.length} npm ci commands carry ${key}; expected one`);
    continue;
  }
  const ciFlags = flagsOf(matches[0]);
  if (ciFlags.join(' ') !== flags.join(' ')) {
    fail(
      `${file} and the ${CI_FILE} build job install differently:\n` +
        `      Dockerfile: npm ci ${flags.join(' ')}\n` +
        `      CI Build  : npm ci ${ciFlags.join(' ')}`,
    );
  }
}

if (violations.length > 0) {
  console.error('\n✖ CI/Docker install-parity guard failed:\n');
  for (const v of violations) console.error(`  ${v}\n`);
  console.error(
    `${violations.length} violation(s). The Build job must run the SAME scoped \`npm ci\` as ` +
      `each Dockerfile, or CI cannot see a dependency that only a sibling workspace declares.\n`,
  );
  process.exit(1);
}

console.log('✓ CI/Docker install-parity guard: the Build job installs exactly as the Dockerfiles do');
