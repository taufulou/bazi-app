import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';

/**
 * #11(c) — a self-test for `scripts/check-ci-docker-install-parity.mjs`.
 *
 * The guard keeps CI's Build job installing exactly as the production
 * Dockerfiles do (a bare `npm ci` hoists everything and hides a dependency only
 * a sibling workspace declares — the launch-day `iztro` bug). A guard nobody has
 * watched FAIL is indistinguishable from one that passes unconditionally, so
 * each case plants one drift in a fixture tree.
 */

const GUARD = join(__dirname, '..', '..', '..', 'scripts', 'check-ci-docker-install-parity.mjs');

const API_NPM_CI = 'npm ci --workspace=api --workspace=@repo/shared --include-workspace-root';
const WEB_NPM_CI = 'npm ci --workspace=web --workspace=@repo/shared --workspace=@repo/ui --include-workspace-root';

const DOCKERFILE_API = `FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN ${API_NPM_CI}
COPY . .
`;

// Split across a backslash continuation, exactly like the real Dockerfile.web.
const DOCKERFILE_WEB = `FROM node:22-slim AS builder
WORKDIR /app
RUN npm ci --workspace=web --workspace=@repo/shared --workspace=@repo/ui \\
      --include-workspace-root
COPY . .
`;

/** `workflowLevel` is inserted before `jobs:` — e.g. a top-level `env:` block (with its own newline). */
function ciYml(buildSteps: string, lintExtra = '', workflowLevel = ''): string {
  return `name: CI
${workflowLevel}jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci${lintExtra}
      - run: npx turbo lint

  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${buildSteps}
`;
}

const IN_SYNC_STEPS = `      - name: Install — API scope
        run: ${API_NPM_CI}
      - name: Build API
        run: cd apps/api && npx nest build
      - name: Install — Web scope
        run: ${WEB_NPM_CI}
      - name: Build Web
        run: cd apps/web && npx next build`;

function write(root: string, rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
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

describe('CI/Docker install-parity guard', () => {
  const roots: string[] = [];
  function tree(opts: { ci?: string; api?: string; web?: string } = {}): string {
    const root = mkdtempSync(join(tmpdir(), 'install-parity-'));
    roots.push(root);
    write(root, 'docker/Dockerfile.api', opts.api ?? DOCKERFILE_API);
    write(root, 'docker/Dockerfile.web', opts.web ?? DOCKERFILE_WEB);
    write(root, '.github/workflows/ci.yml', opts.ci ?? ciYml(IN_SYNC_STEPS));
    return root;
  }

  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it('passes when the Build job mirrors both Dockerfiles (incl. a \\ continuation)', () => {
    const r = runGuard(tree());
    expect(r.output).toContain('✓');
    expect(r.code).toBe(0);
  });

  it('passes on the REAL repository', () => {
    expect(runGuard(join(__dirname, '..', '..', '..')).code).toBe(0);
  });

  it('a bare npm ci in the LINT job is fine — only the build job is checked', () => {
    // The default tree already has one; make it unmistakable with two.
    expect(runGuard(tree({ ci: ciYml(IN_SYNC_STEPS, '\n      - run: npm ci') })).code).toBe(0);
  });

  it('fails when a flag is added to one Dockerfile only', () => {
    const r = runGuard(tree({ web: DOCKERFILE_WEB.replace('--include-workspace-root', '--include-workspace-root --omit=dev') }));
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/Dockerfile\.web and the .*install differently/);
  });

  it('fails when a workspace flag changes in a Dockerfile only', () => {
    const r = runGuard(tree({ web: DOCKERFILE_WEB.replace('--workspace=@repo/ui', '--workspace=@repo/eslint-config') }));
    expect(r.code).toBe(1);
  });

  it('fails when the build job MISSES the web scoped install', () => {
    const steps = IN_SYNC_STEPS.replace(`        run: ${WEB_NPM_CI}`, '        run: echo skipped');
    const r = runGuard(tree({ ci: ciYml(steps) }));
    expect(r.code).toBe(1);
    expect(r.output).toContain('MISSING the scoped install that mirrors docker/Dockerfile.web');
  });

  it('fails when the bare npm ci is restored in the build job', () => {
    const r = runGuard(tree({ ci: ciYml(`      - run: npm ci\n${IN_SYNC_STEPS}`) }));
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/bare `npm ci`/);
  });

  it('fails when the build job has ONLY a bare npm ci (the pre-#11(c) shape)', () => {
    const steps = `      - run: npm ci
      - name: Build API
        run: cd apps/api && npx nest build
      - name: Build Web
        run: cd apps/web && npx next build`;
    const r = runGuard(tree({ ci: ciYml(steps) }));
    expect(r.code).toBe(1);
    expect(r.output).toContain('MISSING');
  });

  it('a 2-space comment divider INSIDE the build block does not end it', () => {
    const steps = IN_SYNC_STEPS.replace(
      '      - name: Install — Web scope',
      '  # ---- web ----\n      - name: Install — Web scope',
    );
    expect(runGuard(tree({ ci: ciYml(steps) })).code).toBe(0);
    // …and a drift AFTER that divider is still caught.
    const drifted = steps.replace(WEB_NPM_CI, WEB_NPM_CI.replace(' --workspace=@repo/ui', ''));
    expect(runGuard(tree({ ci: ciYml(drifted) })).code).toBe(1);
  });

  it('a commented-out scoped install does not count as present', () => {
    const steps = IN_SYNC_STEPS.replace(`        run: ${WEB_NPM_CI}`, `        # run: ${WEB_NPM_CI}\n        run: echo nope`);
    const r = runGuard(tree({ ci: ciYml(steps) }));
    expect(r.code).toBe(1);
    expect(r.output).toContain('MISSING');
  });

  it('a commented-out bare npm ci beside in-sync steps is not flagged', () => {
    expect(runGuard(tree({ ci: ciYml(`      # - run: npm ci\n${IN_SYNC_STEPS}`) })).code).toBe(0);
  });

  it('fails when a Dockerfile has no npm ci line', () => {
    const r = runGuard(tree({ api: 'FROM node:22-slim\nRUN echo hi\n' }));
    expect(r.code).toBe(1);
    expect(r.output).toContain('expected exactly one `RUN npm ci');
  });

  describe('branches and bypasses (line audit)', () => {
    it('a job AFTER build with a bare npm ci is outside the block — pass', () => {
      const ci = ciYml(IN_SYNC_STEPS) + `
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: npm ci
`;
      expect(runGuard(tree({ ci })).code).toBe(0);
    });

    it('a `run: |` command split with \\ is parsed as one command', () => {
      const steps = IN_SYNC_STEPS.replace(`        run: ${WEB_NPM_CI}`, `        run: |
          npm ci --workspace=web --workspace=@repo/shared \\
            --workspace=@repo/ui --include-workspace-root`);
      expect(runGuard(tree({ ci: ciYml(steps) })).code).toBe(0);
      const drifted = steps.replace('--workspace=@repo/ui ', '');
      expect(runGuard(tree({ ci: ciYml(drifted) })).code).toBe(1);
    });

    it('a trailing # comment after an in-sync command is ignored', () => {
      const steps = IN_SYNC_STEPS.replace(`        run: ${WEB_NPM_CI}`, `        run: ${WEB_NPM_CI}  # mirrors Dockerfile.web`);
      expect(runGuard(tree({ ci: ciYml(steps) })).code).toBe(0);
    });

    it('two commands carrying the same --workspace fail', () => {
      const steps = `${IN_SYNC_STEPS}
      - run: ${WEB_NPM_CI}`;
      expect(runGuard(tree({ ci: ciYml(steps) })).code).toBe(1);
    });

    it.each([
      ['npm install', '      - run: npm install'],
      ['npm i', '      - run: npm i'],
      ['npm clean-install', '      - run: npm clean-install'],
      ['npm cit', '      - run: npm cit'],
      ['yarn install', '      - run: yarn install'],
      ['bare yarn', '      - run: yarn'],
      ['pnpm install', '      - run: pnpm install'],
      ['chained after a cd', '      - run: cd apps/web && npm install && npx next build'],
    ])('an extra install in the build job fails — %s', (_n, step) => {
      const r = runGuard(tree({ ci: ciYml(`${IN_SYNC_STEPS}
${step}`) }));
      expect(r.code).toBe(1);
      expect(r.output).toContain('installs packages outside the two mirrored');
    });

    it('a FOLDED scalar cannot hide --workspaces on its second line', () => {
      const steps = IN_SYNC_STEPS.replace(`        run: ${WEB_NPM_CI}`, `        run: >-
          ${WEB_NPM_CI}
          --workspaces`);
      expect(runGuard(tree({ ci: ciYml(steps) })).code).toBe(1);
    });

    it('a PLAIN multi-line scalar cannot hide --workspaces either', () => {
      const steps = IN_SYNC_STEPS.replace(`        run: ${WEB_NPM_CI}`, `        run: ${WEB_NPM_CI}
          --workspaces`);
      expect(runGuard(tree({ ci: ciYml(steps) })).code).toBe(1);
    });

    it('an npm_config_* env override in the build job fails', () => {
      const steps = IN_SYNC_STEPS.replace(`        run: ${WEB_NPM_CI}`, `        run: ${WEB_NPM_CI}
        env:
          npm_config_workspaces: 'true'`);
      const r = runGuard(tree({ ci: ciYml(steps) }));
      expect(r.code).toBe(1);
      expect(r.output).toContain('npm_config_workspaces');
    });

    it.each([
      ['--workspaces (a full install)', '      - run: npm ci --workspaces --include-workspace-root'],
      ['-ws', '      - run: npm ci -ws --include-workspace-root'],
      ['path-form workspaces (web + api)', '      - run: npm ci --workspace=apps/web --workspace=apps/api --workspace=packages/shared --workspace=packages/ui --include-workspace-root'],
      ['space-form --workspace', '      - run: npm ci --workspace api --workspace web --include-workspace-root'],
      ['both keys in one command', '      - run: npm ci --workspace=api --workspace=web --include-workspace-root'],
    ])('an extra npm ci that is not one of the mirrored installs fails — %s', (_n, step) => {
      const r = runGuard(tree({ ci: ciYml(`${IN_SYNC_STEPS}\n${step}`) }));
      expect(r.code).toBe(1);
    });

    it.each([
      ['npm inst', '      - run: npm inst'],
      ['npm sit', '      - run: npm sit'],
      ['npm add', '      - run: npm add lunar-typescript'],
      ['aliased npm ci (clean-install) with flags', `      - run: ${WEB_NPM_CI.replace('npm ci', 'npm clean-install')}`],
      ['yarn install with flags', '      - run: yarn install --frozen-lockfile'],
      ['yarn add', '      - run: yarn add lunar-typescript'],
      ['bun install', '      - run: bun install'],
    ])('install aliases and other package managers fail — %s', (_n, step) => {
      expect(runGuard(tree({ ci: ciYml(`${IN_SYNC_STEPS}\n${step}`) })).code).toBe(1);
    });

    it.each([
      ['a GLOBAL npm install (pinning npm)', '      - run: npm install -g npm@10.9.4'],
      ['--global form', '      - run: npm i --global corepack'],
      ['a cosmetic npm config env', `      - name: quiet\n        run: echo hi\n        env:\n          NPM_CONFIG_LOGLEVEL: warn`],
      ['npm run (not an install)', '      - run: npm run build --workspace=web'],
    ])('legitimate steps are NOT flagged — %s', (_n, step) => {
      expect(runGuard(tree({ ci: ciYml(`${IN_SYNC_STEPS}\n${step}`) })).code).toBe(0);
    });

    it('a quoted run scalar is parsed without the quotes', () => {
      const steps = IN_SYNC_STEPS.replace(`        run: ${WEB_NPM_CI}`, `        run: "${WEB_NPM_CI}"`);
      expect(runGuard(tree({ ci: ciYml(steps) })).code).toBe(0);
    });

    it('ordinary build commands and env are fine (npx, next build, NEXT_PUBLIC_*)', () => {
      const steps = `${IN_SYNC_STEPS}
        env:
          NEXT_PUBLIC_SITE_URL: 'https://tianmingapp.com'
      - run: npx prisma generate && npx nest build`;
      expect(runGuard(tree({ ci: ciYml(steps) })).code).toBe(0);
    });
  });

  it('flag ORDER does not matter — it compares sets', () => {
    const reordered = 'npm ci --include-workspace-root --workspace=@repo/shared --workspace=api';
    const steps = IN_SYNC_STEPS.replace(API_NPM_CI, reordered);
    expect(runGuard(tree({ ci: ciYml(steps) })).code).toBe(0);
  });

  // PR #74 review — an npm setting can turn a scoped install back into a full
  // one without changing the `npm ci` text the pairing compares, and a comment
  // must be read the way GitHub reads it (YAML's rules for YAML, the shell's for
  // the shell) or the guard either misses a command that runs or reads one that
  // never does.
  describe('npm config, config writes, options-first, and comments (PR #74 review)', () => {
    const WEB_RUN = `        run: ${WEB_NPM_CI}`;
    const withWebStep = (run: string) => ciYml(IN_SYNC_STEPS.replace(WEB_RUN, run));
    const withExtraStep = (step: string, workflowLevel = '') => ciYml(`${IN_SYNC_STEPS}\n${step}`, '', workflowLevel);
    const failsNaming = (ci: string, needle: string) => {
      const r = runGuard(tree({ ci }));
      expect(r.code).toBe(1);
      expect(r.output).toContain(needle);
    };
    const passes = (ci: string) => {
      const r = runGuard(tree({ ci }));
      expect(r.output).toContain('✓');
      expect(r.code).toBe(0);
    };

    describe('npm_config_* being set — every form fails, naming the key', () => {
      it.each([
        ['an inline assignment before npm ci', withWebStep(`        run: npm_config_workspaces=true ${WEB_NPM_CI}`), 'npm_config_workspaces'],
        ['an UPPERCASE inline assignment', withWebStep(`        run: NPM_CONFIG_WORKSPACES=true ${WEB_NPM_CI}`), 'NPM_CONFIG_WORKSPACES'],
        ['an export inside a run: | block', withExtraStep('      - run: |\n          export npm_config_workspaces=true\n          echo ok'), 'npm_config_workspaces'],
        ['an echo into $GITHUB_ENV', withExtraStep('      - run: echo "npm_config_workspaces=true" >> $GITHUB_ENV'), 'npm_config_workspaces'],
        ['a $GITHUB_ENV heredoc', withExtraStep("      - run: echo 'npm_config_workspaces<<EOF' >> $GITHUB_ENV"), 'npm_config_workspaces'],
        ['a dash-form YAML key', withExtraStep('      - name: x\n        run: echo hi\n        env:\n          npm_config_include-workspace-root: true'), 'npm_config_include-workspace-root'],
        ['a quoted YAML key', withExtraStep(`      - name: x\n        run: echo hi\n        env:\n          "npm_config_workspaces": 'true'`), 'npm_config_workspaces'],
        ['a flow mapping on a step', withExtraStep('      - name: x\n        run: echo hi\n        env: { npm_config_workspaces: true }'), 'npm_config_workspaces'],
        ['a workflow-level env: block', withExtraStep('      - run: echo hi', "env:\n  npm_config_workspaces: 'true'\n"), 'workflow level: `npm_config_workspaces`'],
        ['a workflow-level flow mapping', withExtraStep('      - run: echo hi', 'env: { npm_config_workspaces: true }\n'), 'npm_config_workspaces'],
        ['a += assignment', withWebStep(`        run: npm_config_workspaces+=true ${WEB_NPM_CI}`), 'npm_config_workspaces'],
        ['an export with +=', withExtraStep('      - run: export npm_config_workspaces+=true'), 'npm_config_workspaces'],
        ['a JSON-style flow pair before the key', withExtraStep('      - name: x\n        run: echo hi\n        env: {"a":"b # c", npm_config_workspaces: true}'), 'npm_config_workspaces'],
      ])('%s', (_n, ci, needle) => failsNaming(ci, needle));
    });

    it.each([
      ['npm config set', 'npm config set workspaces true'],
      ['npm c set', 'npm c set workspaces true'],
      ['npm set', 'npm set workspaces true'],
      ['npm config delete', 'npm config delete registry'],
      ['npm pkg set', 'npm pkg set workspaces[0]=apps/web'],
      ['an option before set', 'npm --location=project set workspaces=true'],
      ['a GLOBAL config write — the global npmrc is read by project installs too', 'npm -g config set workspaces true'],
      ['--global config write', 'npm --global config set workspaces true'],
      ['npm config rm', 'npm config rm registry'],
      ['npm config del', 'npm config del registry'],
      ['an abbreviated config command', 'npm conf delete registry'],
      ['an option between config and the verb', 'npm config -g delete registry'],
      ['an option with a value before config', 'npm --location project config delete workspaces'],
      ['pkg delete behind a workspace option', 'npm -w api pkg delete workspaces'],
    ])('npm config writes fail — %s', (_n, cmd) => failsNaming(withExtraStep(`      - run: ${cmd}`), 'writes npm config'));

    it.each([
      ['npm -ws ci', 'npm -ws ci'],
      ['npm --workspaces ci', 'npm --workspaces ci'],
      ['an option with a separate value', 'npm -w api ci'],
      ['--prefix', 'npm --prefix . ci'],
      ['behind a VAR=value prefix', 'CI=1 npm -ws ci'],
      ['behind env', 'env CI=1 npm -ws ci'],
      ['behind time', 'time npm -w api ci'],
      ['in a subshell', '(npm -ws ci)'],
      ['in an if', 'if npm -ws ci; then echo ok; fi'],
      ['negated', '! npm -ws ci'],
      ['in a brace group', '{ npm -ws ci; }'],
      ['behind a quoted VAR value with a space', 'FOO="a b" npm -ws ci'],
    ])('options BEFORE the install subcommand fail — %s', (_n, cmd) =>
      failsNaming(withExtraStep(`      - run: ${cmd}`), 'BEFORE the install subcommand'));

    describe('comments are read the way GitHub reads them', () => {
      it('a run: | line with a quoted # still runs its npm_config assignment — fails naming the key', () => {
        // Asserting the KEY, not just exit 1: a quote-blind strip would cut the
        // web install too and fail with MISSING, masking a broken key scan.
        failsNaming(withWebStep(`        run: |\n          echo " # note" && npm_config_workspaces=true ${WEB_NPM_CI}`), 'npm_config_workspaces');
      });

      it.each([
        ['a run: | block', '      - run: |\n          echo " # x" && npm install'],
        ['a double-quoted scalar', `      - run: "echo ' # x' && npm install"`],
        ['a double-quoted scalar spanning two lines, # inside the still-open quote', `      - run: "echo ok\n          && echo ' # x' && npm install"`],
        ['a YAML-escaped quote', String.raw`      - run: "echo \" # x\" && npm install"`],
        ['a shell-escaped quote in a run: | block', String.raw`      - run: |` + '\n' + String.raw`          echo "a \" # b" && npm install`],
      ])('an install after a quoted # is NOT commented out — fails (%s)', (_n, step) =>
        failsNaming(withExtraStep(step), 'installs packages outside'));

      // Each of these runs `npm install` as its own command in GitHub; js-yaml
      // agrees on every one (line audit, 2026-10-02).
      it.each([
        ['a blank line inside a double-quoted scalar is a NEWLINE, not a space', '      - run: "echo # x\n\n          npm install"'],
        ['a blank line inside a plain scalar is a newline too', '      - run: echo x;#y\n\n          npm install'],
        ['a folded scalar: comment line, blank line, install', '      - run: >-\n          # install web deps\n\n          npm install'],
        ['a folded scalar: a more-indented line keeps its line break', '      - run: >\n          echo start # c\n            npm install'],
        ['a comment-only run: header — the scalar is on the next line', '      - run: # install deps\n          npm install'],
        ['a block scalar with an indentation indicator', '      - run: |2\n          echo " # x"\n          npm install'],
        ['a !tag before a quoted scalar', `      - run: !!str "echo ' # x' && npm install"`],
        ['an &anchor before a quoted scalar', `      - run: &a "echo ' # x' && npm install"`],
        ['a shell double-quoted string spanning lines', '      - run: |\n          echo "line one\n          # not a comment" && npm install'],
        ['a shell comment ending in a backslash does not continue', '      - run: |\n          echo build # see docs \\\n          npm install'],
        ['npm update re-installs the whole tree', '      - run: npm update'],
        ['a camelCase install alias', '      - run: npm cleanInstall'],
        // Re-audit of the fixes, 2026-10-02:
        ['an &anchor before a literal block — the comment line must not hide the install', '      - run: &install-deps |\n          # deps for the build\n          npm install'],
        ['a !tag before a literal block', '      - run: !!str |\n          echo a # x\n          npm install'],
        ['an indentation indicator: deeper lines keep their breaks', '      - run: >2\n            echo build # deps\n            npm install'],
        ['a heredoc with an apostrophe, then a quoted # before an install', "      - run: |\n          cat <<EOF\n          it's done\n          EOF\n          echo 'Step #2' && npm install"],
        ['a quoted "run" key', '      - "run": npm install'],
        ['npm dedupe reifies the whole tree', '      - run: npm dedupe'],
        ['npm prune', '      - run: npm prune'],
        ['npm uninstall', '      - run: npm uninstall left-pad'],
        ['an abbreviated npm update', '      - run: npm upd'],
      ])('%s — fails', (_n, step) => failsNaming(withExtraStep(step), 'installs packages outside'));

      it('a PLAIN scalar ends at its first " #" whatever quotes it holds — GitHub never runs the rest, so MISSING', () => {
        // js-yaml: `run: echo " # x" && npm ci …` is the command `echo "`.
        failsNaming(withWebStep(`        run: echo " # x" && ${WEB_NPM_CI}`), 'MISSING');
      });
    });

    describe('legitimate uses are NOT flagged', () => {
      it.each([
        ['an inline cosmetic npm_config', withWebStep(`        run: npm_config_loglevel=warn ${WEB_NPM_CI}`)],
        ['a dash-form cosmetic key', withExtraStep('      - run: npm_config_update-notifier=false npm --version')],
        ['workflow-level env with ordinary and cosmetic keys', withExtraStep('      - run: echo hi', "env:\n  NODE_VERSION: '22'\n  NPM_CONFIG_LOGLEVEL: warn\n")],
        ['a trailing YAML comment that mentions an npm_config key', withExtraStep('      - run: echo hi', "env:\n  NODE_VERSION: '22'  # npm_config_workspaces: never set here\n")],
        ["a plain scalar with an apostrophe, then a comment", withExtraStep('      - run: echo hi', "env:\n  NOTE: it's  # npm_config_workspaces: x\n")],
        ['npm --version', withExtraStep('      - run: npm --version')],
        ['npm config get', withExtraStep('      - run: npm config get registry')],
        ['npm config list', withExtraStep('      - run: npm config list')],
        ['options before run (a script, not an install)', withExtraStep('      - run: npm -w web run build')],
        ['a global install with the option first', withExtraStep('      - run: npm -g install corepack')],
        ['an in-sync install after a quoted # in a run: | block', withWebStep(`        run: |\n          echo " # x" && ${WEB_NPM_CI}`)],
        ['an in-sync install under a comment-only run: header', withWebStep(`        run: # mirrors Dockerfile.web\n          ${WEB_NPM_CI}`)],
        ['a parameter-expansion READ of an npm_config var', withExtraStep('      - run: echo "${npm_config_cache:-none}"')],
        ['npm ls of a package named set', withExtraStep('      - run: npm ls set')],
        ['"npm config set" inside a quoted string', withExtraStep('      - run: echo "build; npm config set later"')],
        ['a folded in-sync install followed by a LESS-indented comment line', withWebStep(
          '        run: >\n            npm ci --workspace=web --workspace=@repo/shared --workspace=@repo/ui\n            --include-workspace-root\n          # mirrors Dockerfile.web')],
        ["a heredoc body with an apostrophe, then a real comment", withExtraStep("      - run: |\n          cat <<EOF\n          it's done\n          EOF\n          # do not use npm install here")],
        ['a test script with arguments after --', withExtraStep('      - run: npm -w api test -- --grep up')],
        ['npm config get of a key named fix', withExtraStep('      - run: npm config get fix')],
        // js-yaml: `echo 'a\` — `\\` is an escaped backslash, so the quote closes
        // and the install sits in a YAML COMMENT. The `'` is what makes this bite:
        // a YAML reader that took `\\"` for an escaped quote would keep the quote
        // open, and the shell would then see `' && npm install` inside a string
        // it never strips — reading the comment as a command.
        ['an escaped backslash closes the YAML quote — the install is in a COMMENT', withExtraStep(String.raw`      - run: "echo 'a\\" # ' && npm install"`)],
      ])('%s', (_n, ci) => passes(ci));
    });
  });
});
