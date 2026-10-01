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

function ciYml(buildSteps: string, lintExtra = ''): string {
  return `name: CI
jobs:
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
});
