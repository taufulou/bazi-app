import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';

/**
 * A self-test for `scripts/check-ai-spend-metering.mjs`.
 *
 * The engine-caller guard has had one since it shipped; this one did not — and
 * an audit then produced five working bypasses of its delegating-spender rule
 * plus a presence-check that stayed green after 4 of 5 quota calls were deleted.
 * A guard nobody has watched FAIL is indistinguishable from one that passes
 * unconditionally, and this guard is the only thing standing behind the ~20
 * spend controls that jest cannot reach (they are call sites, not logic).
 *
 * Each case plants a specific violation in a fixture tree and asserts the guard
 * catches it. The last two lock the two exemption TRIGGERS — the conditions
 * under which an allowlist entry stops being true.
 */

const GUARD = join(__dirname, '..', '..', '..', 'scripts', 'check-ai-spend-metering.mjs');

function run(root: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [GUARD, '--root', root], { encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function write(root: string, rel: string, body: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/**
 * A tree the guard passes.
 *
 * Every allowlisted file has to exist, because the guard sweeps its own
 * exemptions for staleness — an entry pointing at a deleted file is itself a
 * violation. So the fixture mirrors the real allowlist shape: two provider
 * callers (one fully metered, one exempt), and two delegators.
 */
function cleanTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'ai-spend-guard-'));

  // COUNT_EXEMPT + BREAKER_EXEMPT + QUOTA_EXEMPT — meters at a choke point.
  write(
    root,
    'apps/api/src/ai/ai.service.ts',
    'export class AIService {\n' +
      '  async go() {\n' +
      '    await this.aiSpend.assertUnderCap("x");\n' +
      '    return this.aiGovernor.run("reading", "x", () => this.claude.messages.create({}));\n' +
      '  }\n' +
      '  private done() { this.logUsage(); }\n' +
      '}\n',
  );

  // BREAKER_EXEMPT + QUOTA_EXEMPT — the sampled LLM judge.
  write(
    root,
    'apps/api/src/chat/chat-validators.service.ts',
    'export class V { async judge() { const r = await this.anthropic.messages.create({});' +
      ' void this.aiSpend.record({}); return r; } }\n',
  );

  // QUOTA_EXEMPT — hash helpers only.
  write(
    root,
    'apps/api/src/users/users.service.ts',
    'export class U { constructor(private readonly aiService: AIService) {}' +
      ' hash(b: unknown) { return this.aiService.generateBirthDataHash(b); } }\n',
  );

  // QUOTA_EXEMPT — unreachable while the controller exposes no write route.
  write(
    root,
    'apps/api/src/zwds/zwds.service.ts',
    'export class Z { constructor(private readonly aiService: AIService) {}' +
      ' go() { return this.aiService.generateZwds({}); } }\n',
  );
  write(root, 'apps/api/src/zwds/zwds.controller.ts', "export class ZC { @Get('readings/:id') one() {} }\n");

  // A fully compliant provider caller — the shape every new one should copy.
  write(
    root,
    'apps/api/src/fortune/fortune.service.ts',
    'export class F {\n' +
      '  async go(u: string) {\n' +
      '    await this.quota.consume("fortune", u);\n' +
      '    await this.aiSpend.assertUnderCap("f");\n' +
      '    const releaseSlot = await this.aiGovernor.acquire("interactive", "f");\n' +
      '    try { await this.client.messages.create({}); } finally { releaseSlot(); }\n' +
      '    void this.aiSpend.record({});\n' +
      '  }\n}\n',
  );

  return root;
}

describe('S1/S2/S4 metering guard — self-test', () => {
  const roots: string[] = [];
  const tree = () => {
    const r = cleanTree();
    roots.push(r);
    return r;
  };
  afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

  it('passes on a compliant tree', () => {
    const { code, out } = run(tree());
    expect(out).toContain('every provider call is metered');
    expect(code).toBe(0);
  });

  it('catches a provider call that records no spend', () => {
    const root = tree();
    write(root, 'apps/api/src/rogue/a.service.ts', 'export class A { go(){ return this.anthropic.messages.create({}); } }\n');
    const { code, out } = run(root);
    expect(code).toBe(1);
    expect(out).toContain('never records spend');
  });

  it('catches PARTIAL removal, not just total removal', () => {
    // The regression both Phase-2A auditors found: a presence check passes when
    // 2 of 3 calls are deleted, and partial removal — a new branch added beside
    // an existing metered one — is the realistic mistake.
    const root = tree();
    write(
      root,
      'apps/api/src/fortune/fortune.service.ts',
      'export class F {\n' +
        '  async a(u: string){ await this.quota.consume("fortune", u); await this.aiSpend.assertUnderCap("a");' +
        ' await this.aiGovernor.run("interactive","a", () => this.client.messages.create({}));' +
        ' void this.aiSpend.record({}); }\n' +
        '  async b(){ return this.client.messages.create({}); }\n' +
        '}\n',
    );
    const { code, out } = run(root);
    expect(code).toBe(1);
    expect(out).toContain('2 provider call(s) but only 1');
  });

  it('catches an acquire with no matching release', () => {
    // A leaked slot shrinks the pool for the life of the process, and neither
    // jest nor a presence-based rule sees it.
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/leak.service.ts',
      'export class L { async go(u: string){ await this.quota.consume("chat", u);' +
        ' await this.aiSpend.assertUnderCap("l");' +
        ' const releaseSlot = await this.aiGovernor.acquire("interactive","l");' +
        ' await this.client.messages.create({}); void this.aiSpend.record({}); } }\n',
    );
    const { code, out } = run(root);
    expect(code).toBe(1);
    expect(out).toContain('releaseSlot');
  });

  it('catches a provider call with no per-user quota', () => {
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/global.service.ts',
      'export class G { async go(){ await this.aiSpend.assertUnderCap("g");' +
        ' await this.aiGovernor.run("reading","g", () => this.client.messages.create({}));' +
        ' void this.aiSpend.record({}); } }\n',
    );
    const { code, out } = run(root);
    expect(code).toBe(1);
    expect(out).toContain('quota consume');
  });

  // --- the five bypasses an audit demonstrated against the name-based rule ---

  it.each([
    ['a renamed receiver', 'constructor(private readonly ai: AIService) {} go(u: string){ return this.ai.generateLifetimeV2Interpretation({}, u); }'],
    ['a different verb', 'constructor(private readonly aiService: AIService) {} go(u: string){ return this.aiService.interpret({}, u); }'],
    ['a name ending in Hash', 'constructor(private readonly aiService: AIService) {} go(u: string){ return this.aiService.generateNarrativeHash({}, u); }'],
    ['a local alias', 'constructor(private readonly aiService: AIService) {} go(u: string){ const s = this.aiService; return s.generateX({}, u); }'],
    ['bracket access', 'constructor(private readonly aiService: AIService) {} go(u: string){ return this.aiService["generateX"]({}, u); }'],
  ])('catches a delegating spender using %s', (_label, body) => {
    // Detection is by INJECTION (`: AIService`), which none of these renames
    // away — a class cannot spend through AIService without being handed it.
    const root = tree();
    write(root, 'apps/api/src/rogue/delegate.service.ts', `export class D { ${body} }\n`);
    const { code, out } = run(root);
    expect(code).toBe(1);
    expect(out).toContain('injects AIService');
  });

  it('does NOT flag a delegator that consumes quota', () => {
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/ok.service.ts',
      'export class O { constructor(private readonly ai: AIService) {}' +
        ' async go(u: string){ await this.quota.consume("reading", u); return this.ai.generateX({}, u); } }\n',
    );
    expect(run(root).code).toBe(0);
  });

  // --- the exemption triggers, which used to be prose ---

  it('fails when an exemption stops being true: ZWDS regains a write route', () => {
    // The exemption rests on the generation paths being unreachable. Re-adding
    // `@Post('readings')` left the guard green and ZWDS generation unrationed.
    const root = tree();
    write(root, 'apps/api/src/zwds/zwds.controller.ts', "export class ZC { @Post('readings') create() {} }\n");
    const { code, out } = run(root);
    expect(code).toBe(1);
    expect(out).toContain('exposes a write route');
  });

  it('fails when an exemption stops being true: users.service starts generating', () => {
    // Exempt as "hash helpers only" — so a generate call revokes the premise.
    const root = tree();
    write(
      root,
      'apps/api/src/users/users.service.ts',
      'export class U { constructor(private readonly aiService: AIService) {}' +
        ' go(u: string) { return this.aiService.generateLifetimeV2Interpretation({}, u); } }\n',
    );
    const { code, out } = run(root);
    expect(code).toBe(1);
    expect(out).toContain('hash helpers only');
  });

  it('fails when an exemption goes stale', () => {
    // A stale allowlist is how a real exemption gets granted by accident later.
    const root = tree();
    write(root, 'apps/api/src/chat/chat-validators.service.ts', 'export class V { nothing() { return 1; } }\n');
    const { code, out } = run(root);
    expect(code).toBe(1);
    expect(out).toContain('no longer');
  });
});
