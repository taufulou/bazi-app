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
 *      `clean-install`/`cit`/`update`…, `yarn`, `pnpm install`) — each would
 *      quietly restore the hoisted full install. Commands are read from each
 *      step's whole `run:` scalar, folded the way YAML folds it, so a second
 *      line of a folded (`>-`) or plain multi-line scalar is still seen.
 *   6. Fail on any `npm_config_*` setting that can change WHAT is installed —
 *      as a YAML key (plain, quoted, dash-form or in a flow mapping) in the
 *      build job or at workflow level (a top-level `env:` applies to every job),
 *      or assigned in a build-job shell line (`x=y` / `x+=y npm ci`, `export`,
 *      `>> $GITHUB_ENV`, a `<<EOF` heredoc). Six output-only keys
 *      (`COSMETIC_NPM_CONFIG`) are allowed. Also fail on npm config writes
 *      (`npm config set|delete|rm|del|edit|fix` and its abbreviations, `npm set`,
 *      `npm pkg set|delete|fix`) and on options placed BEFORE an install
 *      subcommand (`npm -ws ci`, `npm -w api ci`, also inside `( … )`, `if …`,
 *      `! …`), which the pairing cannot read.
 *
 * Text is read as GitHub reads it, for the shapes a workflow realistically uses:
 * YAML comments and line folding by YAML's rules (`stripYamlComment`, `yamlFold`,
 * `foldBlockScalar` — a PLAIN scalar ends at the first ` #` whatever quotes it
 * contains; a quoted one only after its closing quote; a blank line folds to a
 * newline, not a space), and shell comments by the shell's
 * (`stripShellComments`). Using one language's rules for the other either hides
 * a command that runs or reads one that never does.
 *
 * A ratchet against plausible drift, not adversarial edits — and not a YAML or
 * shell parser. Out of scope: a committed `.npmrc`, a step that writes one, an
 * install hidden in a script file the step calls; a wrapper other than
 * `env`/`time`/`command`/`sudo`/`nice`, or one of those invoked with its own
 * options (`nice -n 10 npm …`); a YAML alias (`- *step`); a whole step written
 * as a flow mapping (`- { run: … }`); an escaped line break inside a
 * double-quoted scalar (`"np\` + newline + `m install"`); quotes nested inside
 * `$( … )` or backticks; and a flow collection spread over several lines, which
 * the key scan reads line by line. A block scalar under a key OTHER than `run:`
 * (e.g. `with: script: |`) is scanned as YAML lines, and a heredoc body is
 * scanned as text — both can only fail safe (a false positive, never a miss).
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
 * npm 10's install-family subcommands other than the paired `npm ci`:
 * install = add/i/in/ins/inst/insta/instal/install/isnt/isnta/isntal/isntall;
 * ci = clean-install/ic/install-clean/isntall-clean (an aliased `ci` is NOT
 * paired, so it fails here — fail-safe); install-ci-test = cit/clean-install-test/
 * sit; install-test = it. Plus the camelCase spellings npm also resolves
 * (`cleanInstall` …), and the commands that re-resolve and reify the WHOLE tree
 * — every workspace — just like a bare install: `update` (up/upgrade/udpate and
 * their unique abbreviations), `dedupe`/`ddp`, `prune`, and `uninstall`
 * (unlink/remove/rm/r/un).
 */
const NPM_INSTALL_ALIASES = [
  'add', 'i', 'in', 'ins', 'inst', 'insta', 'instal', 'install', 'isnt', 'isnta', 'isntal', 'isntall',
  'clean-install', 'ic', 'install-clean', 'isntall-clean',
  'cit', 'clean-install-test', 'sit', 'it', 'install-test', 'install-ci-test',
  'cleanInstall', 'installClean', 'isntallClean', 'cleanInstallTest', 'installTest', 'installCiTest',
  'update', 'up', 'upgrade', 'udpate',
  'upd', 'upda', 'updat', 'upg', 'upgr', 'upgra', 'upgrad', 'ud', 'udp', 'udpa', 'udpat',
  'dedupe', 'ddp', 'prune', 'uninstall', 'unlink', 'remove', 'rm', 'r', 'un',
];

/**
 * Package-manager commands that install into the project, other than the two
 * paired `npm ci`s. A GLOBAL install (`-g` / `--global`, e.g. pinning npm
 * itself) never touches node_modules and is allowed.
 */
const OTHER_INSTALL = new RegExp(
  [
    `\\bnpm\\s+(?:${NPM_INSTALL_ALIASES.join('|')})\\b`,
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

/**
 * An `npm_config_*` name being SET: a YAML key (plain, quoted, dash-form, in a
 * flow mapping), a shell assignment (`x=y`, `x+=y`, `export x=y`, `echo "x=y" >>
 * $GITHUB_ENV`) or a `$GITHUB_ENV` heredoc (`x<<EOF`). npm reads these env vars
 * case-insensitively and in dash form too. NOT a parameter-expansion READ
 * (`${npm_config_cache:-x}`, `$npm_config_x`).
 */
const NPM_CONFIG_KEY = /(?<!\$\{?)\bnpm_config_[A-Za-z0-9_-]+(?=["']?\s*(?:\+?=|:|<<))/gi;
/** Everything after one of these (or after `--`) is a script's own arguments, not npm's. */
const SCRIPT_RUNNERS = new Set(['run', 'run-script', 'rum', 'urn', 'exec', 'x', 'test', 't', 'tst', 'start', 'stop', 'restart', '--']);
/** Words that run the next command; dropped before looking for `npm`. */
const WRAPPERS = new Set(['env', 'time', 'command', 'sudo', 'nice']);
/** Shell syntax that can precede a command; dropped the same way. */
const SHELL_PREFIX_WORDS = new Set(['!', '{', '}', 'if', 'then', 'elif', 'else', 'do', 'while', 'until', 'fi', 'done']);
/** npm resolves unique abbreviations: `npm conf …` is `npm config …`. */
const CONFIG_CMDS = new Set(['c', 'con', 'conf', 'confi', 'config']);
const PKG_CMDS = new Set(['pk', 'pkg']);
const CONFIG_WRITE_VERBS = new Set(['set', 'delete', 'rm', 'del', 'edit', 'fix']);
const PKG_WRITE_VERBS = new Set(['set', 'delete', 'fix']);

const indentOf = (l) => l.length - l.trimStart().length;

/**
 * Strip YAML comments by YAML's rules (what GitHub's parser does).
 *
 * A quote OPENS a quoted scalar only at the START of a node — after the line's
 * indentation or a `- ` sequence marker, after a `: ` mapping indicator (or a
 * `:` right after a quoted key), after `{` `[` `,` inside a flow collection, or
 * after a `!tag` / `&anchor`. Inside a PLAIN scalar quotes are literal, and a `#`
 * preceded by whitespace starts a comment that ENDS the scalar — so
 * `run: echo " # x" && npm install` is the command `echo "` (verified with
 * js-yaml), and GitHub never runs the install. Inside double quotes a `\`
 * escapes the next character, whatever it is (`"a\\" # c` closes after `\\`);
 * inside single quotes the only escape is `''`. Quote state carries across
 * newlines, because a quoted scalar may span lines. A comment truncates the REST
 * of the text: a plain scalar cannot continue past one.
 */
function stripYamlComment(text) {
  let atNodeStart = true;
  let flowDepth = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (atNodeStart && (c === '!' || c === '&')) {
      while (i < text.length && !/\s/.test(text[i])) i += 1; // a tag or anchor: the node starts after it
      continue;
    }
    if (atNodeStart && (c === '"' || c === "'")) {
      let j = i + 1;
      while (j < text.length) {
        if (c === '"' && text[j] === '\\') {
          j += 2; // an escape: skip whatever it escapes
          continue;
        }
        if (text[j] === c) {
          if (c === "'" && text[j + 1] === "'") {
            j += 2; // '' is an escaped quote inside single quotes
            continue;
          }
          break;
        }
        j += 1;
      }
      i = j + 1;
      atNodeStart = text[i] === ':'; // a JSON-style `"key":value` — the value's node starts next
      if (atNodeStart) i += 1;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
    const next = text[i + 1];
    const endOfToken = next === undefined || /\s/.test(next);
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      // whitespace keeps the node-start state either way
    } else if (c === '-' && atNodeStart && endOfToken) {
      // a `- ` sequence marker: the item's node starts next
    } else if (c === ':' && endOfToken) {
      atNodeStart = true; // a mapping indicator: the value's node starts next
    } else if (flowDepth > 0 && c === ',') {
      atNodeStart = true;
    } else if (atNodeStart && (c === '{' || c === '[')) {
      flowDepth += 1;
    } else if (flowDepth > 0 && (c === '}' || c === ']')) {
      flowDepth -= 1;
      atNodeStart = false;
    } else {
      atNodeStart = false;
    }
    i += 1;
  }
  return text;
}

/**
 * YAML line folding for a PLAIN or QUOTED scalar: a single line break becomes a
 * space, each blank line becomes a newline (`a\n\nb` → `a\nb`). Dropping blank
 * lines instead would join two shell commands into one line, and a shell comment
 * on the first would then hide the second — which GitHub runs.
 */
const yamlFold = (t) =>
  t.split('\n').map((l) => l.trim()).join('\n').trim().replace(/\n(\n*)/g, (_m, extra) => extra || ' ');

/**
 * YAML folding for a `>` block scalar: as above, but a MORE-indented line (deeper
 * than the scalar's content indent `base`) keeps its line breaks.
 */
function foldBlockScalar(body, base) {
  let out = '';
  let prev = null;
  let breaks = 0;
  for (const raw of body) {
    if (!raw.trim()) {
      breaks += 1;
      continue;
    }
    const line = raw.slice(base);
    const more = /^\s/.test(line);
    if (prev !== null) {
      out += prev === 'more' || more ? '\n'.repeat(breaks + 1) : breaks ? '\n'.repeat(breaks) : ' ';
    }
    out += line;
    prev = more ? 'more' : 'text';
    breaks = 0;
  }
  return out;
}

/** The content of a quoted YAML scalar, unescaped the way YAML does. */
function unquoteYamlScalar(s) {
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    const named = { n: '\n', t: '\t', '"': '"', '\\': '\\', '/': '/', ' ': ' ', 0: '\0' };
    return s.slice(1, -1).replace(/\\(.)/g, (_m, ch) => named[ch] ?? ch);
  }
  return s;
}

/**
 * Strip shell comments by the shell's rules, over the WHOLE script: a `#` starts
 * a comment only at the START of a word (after whitespace, a newline, or `;` `&`
 * `|` `(` `)`) and never inside quotes; the comment ends at the NEWLINE. Quote
 * state carries across lines (a double-quoted string may span them), and outside
 * single quotes a `\` escapes the next character — `"a \" # b"` is still one
 * string, `\#` is not a comment. This runs BEFORE `\`-continuations are joined:
 * a comment ending in `\` does not continue onto the next line. A heredoc body
 * (`<<EOF` … `EOF`) is data, not shell: it is copied through untouched, so an
 * apostrophe in it (`it's`) cannot open a quote for the rest of the step.
 */
function stripShellComments(script) {
  let out = '';
  let quote = null;
  const heredocs = []; // delimiters whose bodies start at the next newline
  for (let i = 0; i < script.length; i++) {
    const c = script[i];
    if (c === '\n' && quote === null && heredocs.length > 0) {
      out += c;
      while (heredocs.length > 0 && i + 1 < script.length) {
        const nl = script.indexOf('\n', i + 1);
        const line = script.slice(i + 1, nl === -1 ? script.length : nl);
        out += line + (nl === -1 ? '' : '\n');
        i = nl === -1 ? script.length : nl;
        if (line.trim() === heredocs[0]) heredocs.shift();
      }
      continue;
    }
    if (quote === null && c === '<' && script[i + 1] === '<' && script[i + 2] !== '<') {
      const h = script.slice(i).match(/^<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
      if (h) {
        heredocs.push(h[2]);
        out += h[0];
        i += h[0].length - 1;
        continue;
      }
    }
    if (quote === "'") {
      out += c;
      if (c === "'") quote = null;
      continue;
    }
    if (c === '\\') {
      out += c + (script[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (quote === '"') {
      out += c;
      if (c === '"') quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      continue;
    }
    if (c === '#' && (i === 0 || /[\s;&|()]/.test(script[i - 1]))) {
      while (i + 1 < script.length && script[i + 1] !== '\n') i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** Split a shell line on `&&` `||` `;` `|` `&` `(` `)` — outside quotes only. */
function shellSegments(line) {
  const segs = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      cur += c;
      if (c === '\\' && quote === '"') cur += line[++i] ?? '';
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '\\') {
      cur += c + (line[++i] ?? '');
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (';&|()'.includes(c)) {
      segs.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}

/** Whitespace-separated words, keeping a quoted span (`FOO="a b"`) in one word. */
function shellWords(seg) {
  const words = [];
  let cur = '';
  let quote = null;
  for (const c of seg) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (/\s/.test(c)) {
      if (cur) words.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur) words.push(cur);
  return words;
}

/** Fail on every non-cosmetic `npm_config_*` being set in `text`. */
function scanNpmConfigKeys(text, where) {
  for (const m of text.matchAll(NPM_CONFIG_KEY)) {
    if (!COSMETIC_NPM_CONFIG.has(m[0].toLowerCase().replace(/-/g, '_'))) {
      fail(
        `${CI_FILE} ${where}: \`${m[0]}\` can change what npm installs — not allowed ` +
          '(only the output-only npm_config_* keys are)',
      );
    }
  }
}

/**
 * Per shell segment: npm config writes, and options placed BEFORE an install
 * subcommand. A plain `npm ci …` / `npm install …` segment is left to the
 * pairing and to OTHER_INSTALL, so nothing is reported twice.
 */
function checkNpmTokens(line) {
  for (const seg of shellSegments(line)) {
    const tokens = shellWords(seg);
    while (
      tokens.length &&
      (WRAPPERS.has(tokens[0]) || SHELL_PREFIX_WORDS.has(tokens[0]) || /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(tokens[0]))
    ) {
      tokens.shift();
    }
    if (tokens[0] !== 'npm') continue;
    const rest = [];
    for (const t of tokens.slice(1)) {
      if (SCRIPT_RUNNERS.has(t)) break;
      rest.push(t);
    }
    if (rest.length === 0 || rest[0] === 'ci' || NPM_INSTALL_ALIASES.includes(rest[0])) continue;
    // The subcommand is the first non-option word. Options that take a value
    // (`--location project set`) can hide it, so with options first a `set`
    // anywhere counts. Never exempt as "global": `npm -g config set` writes the
    // global npmrc, which project installs read too.
    const sub = rest.find((t) => !t.startsWith('-'));
    // `config` / `pkg` (or an abbreviation) and the first non-option word after it.
    const cmdAt = rest.findIndex((t) => CONFIG_CMDS.has(t) || PKG_CMDS.has(t));
    const verb = cmdAt === -1 ? undefined : rest.slice(cmdAt + 1).find((t) => !t.startsWith('-'));
    const configWrite =
      sub === 'set' ||
      (cmdAt !== -1 && (CONFIG_CMDS.has(rest[cmdAt]) ? CONFIG_WRITE_VERBS : PKG_WRITE_VERBS).has(verb)) ||
      (rest[0].startsWith('-') && rest.includes('set'));
    if (configWrite) {
      fail(
        `${CI_FILE} build job: \`${seg}\` writes npm config — config writes have no place in ` +
          'the Build job (set it in the Dockerfiles first if it is ever needed).',
      );
      continue;
    }
    const installLater = rest.slice(1).some((t) => t === 'ci' || NPM_INSTALL_ALIASES.includes(t));
    if (rest[0].startsWith('-') && installLater && !GLOBAL_INSTALL.test(seg)) {
      fail(
        `${CI_FILE} build job: \`${seg}\` puts options BEFORE the install subcommand — the ` +
          'pairing cannot read them; write `npm ci --flag …`.',
      );
    }
  }
}

/** A block-scalar header: `|` or `>`, with an optional chomping and/or indentation indicator. */
const BLOCK_HEADER = /^([|>])(?:([1-9])[+-]?|[+-]([1-9])?)?$/;
/** Leading `!tag` / `&anchor` tokens before a node. */
const TAGS_ANCHORS = /^(?:[!&]\S*(?:\s+|$))+/;

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
      if (indentOf(l) <= 2) {
        end = i;
        break;
      }
    }
    const block = lines.slice(start + 1, end);

    const runLines = new Set(); // build-block lines that are `run:` scalars — shell, not YAML
    for (let i = 0; i < block.length; i++) {
      const m = block[i].match(/^(\s*)(?:-\s+)?["']?run["']?:\s*(.*)$/);
      if (!m || isComment(block[i])) continue;
      runLines.add(i);
      const keyIndent = indentOf(block[i]) + (block[i].trimStart().startsWith('-') ? 2 : 0);
      const rawHeader = m[2];
      const bodyIdx = [];
      while (i + 1 < block.length && (block[i + 1].trim() === '' || indentOf(block[i + 1]) > keyIndent)) {
        bodyIdx.push(++i);
      }
      let body = bodyIdx.map((k) => block[k]);
      const header = stripYamlComment(rawHeader).trim();
      // A `&anchor` / `!tag` may precede the block indicator (`run: &deps |`).
      const blockHeader = header.replace(TAGS_ANCHORS, '').match(BLOCK_HEADER);
      let script;
      if (blockHeader) {
        // The content indent: from the indentation indicator (relative to the
        // parent, i.e. the `run` key), else from the first non-blank line. The
        // scalar ends at the first non-blank line indented LESS than that — e.g.
        // a trailing comment line; it is not part of the command.
        const digit = blockHeader[2] || blockHeader[3];
        const first = body.find((l) => l.trim());
        const base = digit ? keyIndent + Number(digit) : first ? indentOf(first) : 0;
        const endAt = body.findIndex((l) => l.trim() && indentOf(l) < base);
        if (endAt !== -1) {
          body = body.slice(0, endAt);
          bodyIdx.length = endAt;
        }
        script = blockHeader[1] === '|'
          ? body.join('\n') // literal: newlines kept; a block scalar holds no YAML comments
          : foldBlockScalar(body, base); // folded
      } else {
        // Plain or quoted, possibly multi-line: YAML's comment rules over the WHOLE
        // scalar (quote state carries across lines), then YAML's line folding. A
        // header that is only a comment (`run: # note`) puts the scalar on the
        // next lines.
        const text = header === '' ? body.join('\n') : [rawHeader, ...body].join('\n');
        // A quoted scalar: the content, unescaped — so the last flag is not read
        // as `--include-workspace-root"`, and the shell sees what it will run.
        const folded = yamlFold(stripYamlComment(text.split('\n').map((l) => l.trim()).join('\n')));
        script = unquoteYamlScalar(folded.replace(/^(?:[!&]\S*\s+)+/, '')); // drop a leading !tag / &anchor
      }
      for (const k of bodyIdx) runLines.add(k);
      // Shell lines: drop comments by the shell's rules, then join `\` continuations.
      const shellLines = stripShellComments(script)
        .replace(/\\[ \t]*\n/g, ' ')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of shellLines) {
        scanNpmConfigKeys(line, 'build job');
        checkNpmTokens(line);
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

    // An npm config env var can turn a scoped install back into a full one
    // (`npm_config_workspaces: 'true'`) with no change to the command the pairing
    // compares — on a step, on the job, or at WORKFLOW level, which applies to
    // every job. (Other jobs' own blocks never affect the Build job.) Read line by
    // line: a flow collection spread over several lines is read per line.
    block.forEach((l, i) => {
      if (!runLines.has(i) && !isComment(l)) scanNpmConfigKeys(stripYamlComment(l), 'build job');
    });
    const jobsAt = lines.findIndex((l) => /^jobs:\s*(?:#.*)?$/.test(l));
    let jobsEnd = lines.length;
    if (jobsAt !== -1) {
      for (let i = jobsAt + 1; i < lines.length; i++) {
        const l = lines[i];
        if (l.trim() === '' || isComment(l)) continue;
        if (!/^\s/.test(l)) {
          jobsEnd = i;
          break;
        }
      }
    }
    const workflowLevel = jobsAt === -1 ? [] : [...lines.slice(0, jobsAt), ...lines.slice(jobsEnd)];
    for (const l of workflowLevel) {
      if (!isComment(l)) scanNpmConfigKeys(stripYamlComment(l), 'workflow level');
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
