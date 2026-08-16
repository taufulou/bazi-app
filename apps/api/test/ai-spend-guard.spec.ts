import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';

/**
 * A self-test for `scripts/check-ai-spend-metering.mjs`.
 *
 * The engine-caller guard has had one since it shipped; this one did not, and
 * the guard is the only control behind the ~20 spend call sites jest cannot
 * reach (they are call sites, not logic, so deleting one leaves every unit test
 * green).
 *
 * ⚠️ EVERY CASE ASSERTS A RULE ID, never just a non-zero exit. The first version
 * of this file asserted `exit === 1` plus a message substring, and an audit
 * showed the "partial removal" case surviving deletion of all THREE count rules
 * — the fixture also tripped the unrelated quota rule, and four rules emit the
 * same "N provider call(s) but only M" phrasing. Six further rules had no case
 * at all. A test that cannot name which rule fired is not testing that rule.
 *
 * The `coverage` test at the bottom closes the loop: it reads the guard's own
 * rule registry and fails if any id is never produced by a fixture here. Adding
 * a rule without adding a case is a failing build.
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

/** A provider caller with all four controls, parameterised so cases can break one. */
function compliant(opts: { calls?: number; records?: number; caps?: number; slots?: number; quotas?: number } = {}) {
  const { calls = 1, records = calls, caps = calls, slots = calls, quotas = calls } = opts;
  const line = (n: number, s: string) => Array.from({ length: n }, () => `    ${s}\n`).join('');
  return (
    'export class S {\n  async go(u: string) {\n' +
    line(quotas, 'await this.quota.consume("reading", u);') +
    line(caps, 'await this.aiSpend.assertUnderCap("c");') +
    line(slots, 'await this.aiGovernor.run("reading", "c", () => 0);') +
    line(calls, 'await this.client.messages.create({});') +
    line(records, 'void this.aiSpend.record({});') +
    '  }\n}\n'
  );
}

/**
 * A tree the guard passes.
 *
 * Every allowlisted and watched file must exist and must still satisfy its own
 * premise — the guard sweeps its exemptions, so a fixture that omits one fails
 * for a reason unrelated to the case under test. That is why this is longer than
 * it looks like it should be.
 */
function cleanTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'ai-spend-guard-'));

  // COUNT_EXEMPT + BREAKER_EXEMPT + QUOTA_EXEMPT. Exactly 6 provider calls
  // (CHOKEPOINT_PROVIDER_CALLS), one choke-point call site, one logUsage.
  write(
    root,
    'apps/api/src/ai/ai.service.ts',
    'export class AIService {\n' +
      '  async generateLifetimeV2Interpretation(d: unknown, u?: string) {\n' +
      '    const r = await this.callProviderWithTimeout(d);\n' +
      '    this.logUsage(u, r);\n' +
      '    return r;\n' +
      '  }\n' +
      '  async streamLifetimeV2(d: unknown) {\n' +
      '    return this.streamProvider(d);\n' +
      '  }\n' +
      '  private async callProviderWithTimeout(d: unknown) {\n' +
      '    await this.aiSpend.assertUnderCap("x");\n' +
      '    return this.aiGovernor.run("reading", "x", async () => {\n' +
      '      const a = await this.claude.messages.create({});\n' +
      '      const b = await this.openai.chat.completions.create({});\n' +
      '      return (await this.gemini.generateContent({})) ?? a ?? b;\n' +
      '    });\n' +
      '  }\n' +
      '  private async streamProvider(d: unknown) {\n' +
      '    await this.aiSpend.assertUnderCap("y");\n' +
      '    return this.aiGovernor.runGenerator("reading", "y", async () => {\n' +
      '      const a = await this.claude.messages.stream({});\n' +
      '      const b = await this.openai.chat.completions.stream({});\n' +
      '      return (await this.gemini.generateContentStream({})) ?? a ?? b;\n' +
      '    });\n' +
      '  }\n' +
      '  private logUsage(u: unknown, r: unknown) { return [u, r]; }\n' +
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

  // CLIENT_FACTORY_EXEMPT — imports the SDK, constructs, never calls.
  write(
    root,
    'apps/api/src/fortune/fortune-snapshot.helpers.ts',
    "export async function ensureClaudeClient() { const { default: A } = await import('@anthropic-ai/sdk'); return new A(); }\n",
  );

  // The pinned delegating spender.
  write(
    root,
    'apps/api/src/bazi/bazi.service.ts',
    'export class B { constructor(private readonly aiService: AIService) {}\n' +
      Array.from({ length: 5 }, (_, i) =>
        `  async go${i}(u: string) { await this.quota.consume("reading", u); return this.aiService.generateInterpretation({}, u); }\n`,
      ).join('') +
      '}\n',
  );

  // A fully compliant provider caller — the shape a new one should copy.
  write(root, 'apps/api/src/fortune/fortune.service.ts', compliant({ calls: 2 }));

  return root;
}

/**
 * One entry per rule the guard can emit. Drives both the individual cases and
 * the coverage assertion, so the two cannot drift.
 */
const CASES: Array<{ rule: string; what: string; plant: (root: string) => void }> = [
  {
    rule: 'RECORDS_COUNT',
    what: 'PARTIAL removal — one of two calls unmetered',
    // ⚠️ The realistic mistake, and the one a presence check misses: a new
    // branch added beside an existing metered one.
    plant: (r) => write(r, 'apps/api/src/fortune/fortune.service.ts', compliant({ calls: 2, records: 1 })),
  },
  {
    rule: 'SLOTS_COUNT',
    what: 'PARTIAL removal — one of two calls ungoverned',
    plant: (r) => write(r, 'apps/api/src/fortune/fortune.service.ts', compliant({ calls: 2, slots: 1 })),
  },
  {
    rule: 'CAPS_COUNT',
    what: 'PARTIAL removal — one of two calls skips the breaker',
    plant: (r) => write(r, 'apps/api/src/fortune/fortune.service.ts', compliant({ calls: 2, caps: 1 })),
  },
  {
    rule: 'RECORDS_PRESENT',
    what: 'a provider call in a file that records nothing at all',
    plant: (r) => write(r, 'apps/api/src/rogue/a.service.ts', compliant({ calls: 1, records: 0 })),
  },
  {
    rule: 'BREAKER_PRESENT',
    what: 'a provider call in a file that never consults the breaker',
    plant: (r) => write(r, 'apps/api/src/rogue/b.service.ts', compliant({ calls: 1, caps: 0 })),
  },
  {
    rule: 'QUOTA_COUNT',
    what: 'a provider call with no per-user quota',
    plant: (r) => write(r, 'apps/api/src/rogue/c.service.ts', compliant({ calls: 1, quotas: 0 })),
  },
  {
    rule: 'SLOT_LEAK',
    what: 'acquire() with no matching releaseSlot()',
    // A leaked slot shrinks the pool for the life of the process, and neither
    // jest nor a presence rule sees it.
    plant: (r) =>
      write(
        r,
        'apps/api/src/rogue/leak.service.ts',
        'export class L { async go(u: string){ await this.quota.consume("chat", u);' +
          ' await this.aiSpend.assertUnderCap("l");' +
          ' const releaseSlot = await this.aiGovernor.acquire("interactive","l");' +
          ' await this.client.messages.create({}); void this.aiSpend.record({}); } }\n',
      ),
  },
  {
    rule: 'DELEGATE_NO_QUOTA',
    what: 'a delegating spender with no quota',
    plant: (r) =>
      write(
        r,
        'apps/api/src/rogue/d.service.ts',
        'export class D { constructor(private readonly ai: AIService) {} go(u: string){ return this.ai.generateX({}, u); } }\n',
      ),
  },
  {
    rule: 'DELEGATE_RATCHET',
    what: 'a pinned quota count that has dropped',
    // The guard's docblock says `consumed === 0` let 4 of 5 be deleted silently;
    // this is the case that proves the ratchet replaced it.
    plant: (r) =>
      write(
        r,
        'apps/api/src/bazi/bazi.service.ts',
        'export class B { constructor(private readonly aiService: AIService) {}\n' +
          Array.from({ length: 4 }, (_, i) =>
            `  async go${i}(u: string) { await this.quota.consume("reading", u); return this.aiService.generateInterpretation({}, u); }\n`,
          ).join('') +
          '}\n',
      ),
  },
  {
    rule: 'IMPORT_UNMETERED',
    what: 'an SDK import the call-shape regex cannot see',
    plant: (r) =>
      write(
        r,
        'apps/api/src/rogue/import.service.ts',
        "import OpenAI from 'openai';\nexport class I { go(){ const { create } = new OpenAI().responses; return create({}); } }\n",
      ),
  },
  {
    rule: 'EXEMPT_STALE_QUOTA',
    what: 'a quota exemption whose file no longer reaches AI',
    plant: (r) => write(r, 'apps/api/src/chat/chat-validators.service.ts', 'export class V { none() { return 1; } }\n'),
  },
  {
    rule: 'EXEMPT_STALE_BREAKER',
    what: 'a breaker exemption whose file no longer calls a provider',
    // Still injects AIService, so the quota sweep stays quiet and this case
    // cannot borrow the other sweep's evidence.
    plant: (r) =>
      write(
        r,
        'apps/api/src/chat/chat-validators.service.ts',
        'export class V { constructor(private readonly ai: AIService) {} none() { return this.ai; } }\n',
      ),
  },
  {
    rule: 'EXEMPT_MISSING',
    what: 'a watched file that has been deleted',
    // `existsSync` used to short-circuit to a skip, which deletes a trigger by
    // renaming a file — a refactor nobody would think to re-audit.
    plant: (r) => rmSync(join(r, 'apps/api/src/users/users.service.ts')),
  },
  {
    rule: 'TRIGGER_USERS',
    what: 'users.service calling a spending AIService method',
    plant: (r) =>
      write(
        r,
        'apps/api/src/users/users.service.ts',
        'export class U { constructor(private readonly aiService: AIService) {}' +
          ' go(u: string) { return this.aiService.generateLifetimeV2Interpretation({}, u); } }\n',
      ),
  },
  {
    rule: 'TRIGGER_CHOKEPOINT',
    what: "a new adapter changing ai.service.ts's provider-call count",
    plant: (r) =>
      write(
        r,
        'apps/api/src/ai/ai.service.ts',
        'export class AIService {\n' +
          '  async generateX(d: unknown) { const r = await this.callProviderWithTimeout(d); this.logUsage(r); return r; }\n' +
          '  private async callProviderWithTimeout(d: unknown) {\n' +
          '    await this.aiSpend.assertUnderCap("x");\n' +
          '    return this.aiGovernor.run("reading", "x", () => this.claude.messages.create({}));\n' +
          '  }\n' +
          '  private logUsage(r: unknown) { return r; }\n' +
          '}\n',
      ),
  },
  {
    rule: 'CHOKEPOINT_UNRECORDED',
    what: 'a generator that reaches the choke point but never logs usage',
    // ⚠️ The live bug this rule was written for: three parallel
    // `callProviderWithTimeout` calls in the compat generator and not one
    // `logUsage` — ~$0.70 a reveal, invisible to the breaker, in a file the
    // file-level rules marked compliant because its OTHER generators record.
    plant: (r) => {
      const base = 'export class AIService {\n' +
        '  async generateOne(d: unknown) { const r = await this.callProviderWithTimeout(d); this.logUsage(r); return r; }\n' +
        '  async generateCompat(d: unknown) {\n' +
        '    return Promise.allSettled([\n' +
        '      this.callProviderWithTimeout(d),\n' +
        '      this.callProviderWithTimeout(d),\n' +
        '    ]);\n' +
        '  }\n' +
        '  private async callProviderWithTimeout(d: unknown) {\n' +
        '    await this.aiSpend.assertUnderCap("x");\n' +
        '    return this.aiGovernor.run("reading", "x", async () => {\n' +
        '      const a = await this.claude.messages.create({});\n' +
        '      const b = await this.openai.chat.completions.create({});\n' +
        '      const c = await this.gemini.generateContent({});\n' +
        '      const d2 = await this.claude.messages.stream({});\n' +
        '      const e = await this.openai.chat.completions.stream({});\n' +
        '      return (await this.gemini.generateContentStream({})) ?? a ?? b ?? c ?? d2 ?? e;\n' +
        '    });\n' +
        '  }\n' +
        '  private logUsage(r: unknown) { return r; }\n' +
        '}\n';
      write(r, 'apps/api/src/ai/ai.service.ts', base);
    },
  },
  {
    rule: 'TRIGGER_CLIENT_FACTORY',
    what: 'a client factory that started calling the provider',
    plant: (r) =>
      write(
        r,
        'apps/api/src/fortune/fortune-snapshot.helpers.ts',
        "import A from '@anthropic-ai/sdk';\nexport async function go() { return new A().messages.create({}); }\n",
      ),
  },
];

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

  it.each(CASES.map((c) => [c.rule, c.what, c] as const))('[R-%s] catches %s', (rule, _what, c) => {
    const root = tree();
    c.plant(root);
    const { code, out } = run(root);
    expect(code).toBe(1);
    // The rule ID, not the exit status and not a shared phrase — four rules
    // emit "N provider call(s) but only M".
    expect(out).toContain(`[R-${rule}]`);
  });

  // --- the five bypasses an audit demonstrated against the name-based rule ---

  it.each([
    ['a renamed receiver', 'constructor(private readonly ai: AIService) {} go(u: string){ return this.ai.generateLifetimeV2Interpretation({}, u); }'],
    ['a different verb', 'constructor(private readonly aiService: AIService) {} go(u: string){ return this.aiService.interpret({}, u); }'],
    ['a name ending in Hash', 'constructor(private readonly aiService: AIService) {} go(u: string){ return this.aiService.generateNarrativeHash({}, u); }'],
    ['a local alias', 'constructor(private readonly aiService: AIService) {} go(u: string){ const s = this.aiService; return s.generateX({}, u); }'],
    ['bracket access', 'constructor(private readonly aiService: AIService) {} go(u: string){ return this.aiService["generateX"]({}, u); }'],
  ])('catches a delegating spender using %s', (_label, body) => {
    // Detection is by INJECTION, which none of these renames away — a class
    // cannot spend through AIService without being handed it.
    const root = tree();
    write(root, 'apps/api/src/rogue/delegate.service.ts', `export class D { ${body} }\n`);
    expect(run(root).out).toContain('[R-DELEGATE_NO_QUOTA]');
  });

  // --- eight ways to be handed AIService without the literal `: AIService` ---

  it.each([
    ['a namespace-qualified type', 'constructor(private readonly ai: AI.AIService) {} go(u: string){ return this.ai.generateX({}, u); }'],
    ['a Pick<> of it', 'constructor(private readonly ai: Pick<AIService, "generateX">) {} go(u: string){ return this.ai.generateX({}, u); }'],
    ['InstanceType<typeof>', 'constructor(private readonly ai: InstanceType<typeof AIService>) {} go(u: string){ return this.ai.generateX({}, u); }'],
    ['an @Inject token', 'constructor(@Inject(AIService) private readonly ai: any) {} go(u: string){ return this.ai.generateX({}, u); }'],
    ['ModuleRef.get', 'go(u: string){ return this.moduleRef.get(AIService).generateX({}, u); }'],
    ['a declared field with !', 'private ai!: AIService; go(u: string){ return this.ai.generateX({}, u); }'],
  ])('catches injection via %s', (_label, body) => {
    const root = tree();
    write(root, 'apps/api/src/rogue/inject.service.ts', `export class D { ${body} }\n`);
    expect(run(root).out).toContain('[R-DELEGATE_NO_QUOTA]');
  });

  it('catches an aliased type import', () => {
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/alias.service.ts',
      "import type { AIService as Gen } from '../ai/ai.service';\n" +
        'export class D { constructor(private readonly ai: Gen) {} go(u: string){ return this.ai.generateX({}, u); } }\n',
    );
    expect(run(root).out).toContain('[R-DELEGATE_NO_QUOTA]');
  });

  // --- the users.service trigger, keyed on the CALLEE ---

  it.each([
    ['a renamed receiver', 'constructor(private readonly ai: AIService) {} go(u: string){ return this.ai.generateLifetimeV2Interpretation({}, u); }'],
    ['a local alias', 'constructor(private readonly aiService: AIService) {} go(u: string){ const s = this.aiService; return s.generateLifetimeV2Interpretation({}, u); }'],
    ['bracket access', 'constructor(private readonly aiService: AIService) {} go(u: string){ return this.aiService["generateLifetimeV2Interpretation"]({}, u); }'],
    ['a stream method', 'constructor(private readonly aiService: AIService) {} go(u: string){ return this.aiService.streamLifetimeV2({}, u); }'],
  ])('the users.service trigger survives %s', (_label, body) => {
    // ⚠️ The first version matched `aiService.(generate|stream)…` — the same
    // receiver-name shape whose bypasses the delegator rule was rewritten to
    // close, left behind in the sibling location. Matching the CALLEE, derived
    // from AIService itself, cannot be renamed around.
    const root = tree();
    write(root, 'apps/api/src/users/users.service.ts', `export class U { ${body} }\n`);
    expect(run(root).out).toContain('[R-TRIGGER_USERS]');
  });

  it('does not fire the users trigger on the permitted hash helper', () => {
    // The old lookahead had this backwards: it exempted anything ENDING in
    // `Hash`, so a spender called `generateReadingHash` was waved through.
    expect(run(tree()).code).toBe(0);
  });

  // --- comments and strings must not satisfy a rule ---

  it('does not accept metering that exists only in a comment', () => {
    // ⚠️ The guard's OWN remediation text used to be a working bypass: paste
    // "Add `await this.quota.consume(<kind>, <userId>)`" into a TODO and the
    // error it describes goes away.
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/commented.service.ts',
      '// FIXME(spend): needs this.quota.consume("reading", u),\n' +
        '// this.aiSpend.assertUnderCap("x"), this.aiGovernor.run() and this.aiSpend.record().\n' +
        'export class C { go(){ return this.client.messages.create({}); } }\n',
    );
    const { out } = run(root);
    expect(out).toContain('[R-RECORDS_PRESENT]');
    expect(out).toContain('[R-QUOTA_COUNT]');
  });

  it('does not accept a releaseSlot that exists only in a comment', () => {
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/commented-leak.service.ts',
      'export class C { async go(u: string){ await this.quota.consume("chat", u);' +
        ' await this.aiSpend.assertUnderCap("c");' +
        ' const releaseSlot = await this.aiGovernor.acquire("interactive","c");' +
        ' /* releaseSlot() */ await this.client.messages.create({});' +
        ' void this.aiSpend.record({}); } }\n',
    );
    expect(run(root).out).toContain('[R-SLOT_LEAK]');
  });

  it('still sees code that merely MENTIONS a provider URL in a string', () => {
    // The stripper must not swallow real code around a string literal — that
    // would be a fail-open, and the quietest kind.
    const root = tree();
    write(
      root,
      'apps/api/src/rogue/url.service.ts',
      'const HOST = "https://api.anthropic.com/v1/messages";\n' +
        'export class U { go(){ return fetch(HOST).then(() => this.client.messages.create({})); } }\n',
    );
    expect(run(root).out).toContain('[R-RECORDS_PRESENT]');
  });

  // --- precision ---

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

  it('does NOT punish extracting the record call into a local helper', () => {
    // The guard's premise is that its rules survive refactoring; a rule that
    // fires when three call sites collapse into one helper contradicts that.
    const root = tree();
    write(
      root,
      'apps/api/src/ai/ai.service.ts',
      'export class AIService {\n' +
        '  async generateCompat(d: unknown) {\n' +
        '    const recordCall = (r: unknown) => this.logUsage(r);\n' +
        '    const [a, b] = await Promise.all([\n' +
        '      this.callProviderWithTimeout(d),\n' +
        '      this.callProviderWithTimeout(d),\n' +
        '    ]);\n' +
        '    recordCall(a);\n' +
        '    recordCall(b);\n' +
        '    return [a, b];\n' +
        '  }\n' +
        '  private async callProviderWithTimeout(d: unknown) {\n' +
        '    await this.aiSpend.assertUnderCap("x");\n' +
        '    return this.aiGovernor.run("reading", "x", async () => {\n' +
        '      const a = await this.claude.messages.create({});\n' +
        '      const b = await this.openai.chat.completions.create({});\n' +
        '      const c = await this.gemini.generateContent({});\n' +
        '      const e = await this.claude.messages.stream({});\n' +
        '      const f = await this.openai.chat.completions.stream({});\n' +
        '      return (await this.gemini.generateContentStream({})) ?? a ?? b ?? c ?? e ?? f;\n' +
        '    });\n' +
        '  }\n' +
        '  private logUsage(r: unknown) { return r; }\n' +
        '}\n',
    );
    expect(run(root).code).toBe(0);
  });

  it('ignores spec files, which may stub anything', () => {
    const root = tree();
    write(root, 'apps/api/src/rogue/x.service.spec.ts', 'it("x", () => client.messages.create({}));\n');
    expect(run(root).code).toBe(0);
  });

  // --- the loop-closer ---

  it('every rule the guard can emit is exercised by a case above', () => {
    // ⚠️ Without this, adding a rule silently adds an untested one — which is
    // how six of thirteen ended up with no case at all.
    const declared = execFileSync('node', [GUARD, '--list-rules'], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
    const covered = new Set(CASES.map((c) => c.rule));
    expect([...declared].filter((r) => !covered.has(r))).toEqual([]);
  });
});
