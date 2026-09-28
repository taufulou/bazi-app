import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIService } from '../src/ai/ai.service';

/**
 * #6 — the standing guard against the silent cache invalidator.
 *
 * The V2 reading system prompt is cached at the 5-minute TTL, and the cache is
 * a PREFIX match: a single byte that differs between two readings makes every
 * reading a cache MISS. Requests still succeed, the reading still looks right,
 * the bill just goes up — and nothing announces it. The typical cause is a
 * later, well-meant edit that interpolates something chart-specific (a name, a
 * date, the day master) into the system prompt instead of the user prompt.
 *
 * So: build every V2 prompt from an EMPTY input and from two full, entirely
 * different charts, and require the system prompt to be byte-identical across
 * all of them. Comparing against `{}` is what makes this strong — a system
 * prompt that reads ANY field present in the fixtures differs from the empty
 * build, whichever field it is. Comparing two charts only catches the fields in
 * which those two charts happen to differ (the first version of this spec built
 * one chart by spreading the other and missed five fields that way). The
 * chart-specific part belongs in the user prompt, and that is asserted too, so
 * the test cannot pass vacuously.
 *
 * Measured system-prompt sizes when #6 shipped (chars; ~1 token per CJK char):
 *   LIFETIME 15,527 · LOVE 10,525 · COMPAT 7,844 · CAREER 5,853 · ANNUAL 3,589
 * Sonnet 4.5 will not cache a prefix under 1,024 tokens (silently — no error,
 * just `cache_creation_input_tokens: 0`). The 2,000-char floor below keeps a
 * wide margin for all five without sitting one edit away from a false failure,
 * as a 3,000 floor would for ANNUAL.
 */

const MIN_SYSTEM_PROMPT_CHARS = 2_000;

function makeService(): AIService {
  const config = { get: jest.fn().mockReturnValue(undefined) };
  return new AIService(
    config as never,
    { aIUsageLog: { create: jest.fn() } } as never,
    {} as never,
    {} as never,
    { record: jest.fn(), recordFailure: jest.fn(), assertUnderCap: jest.fn(), estimateCostUsd: jest.fn(() => 0.01) } as never,
    { run: (_p: unknown, _c: unknown, fn: () => unknown) => fn(), acquire: async () => () => undefined, runGenerator: (_p: unknown, _c: unknown, g: () => unknown) => g(), snapshot: () => ({}) } as never,
  );
}

/** Two charts that differ in every field a builder interpolates. */
const ROGER = {
  gender: 'male',
  birthDate: '1987-09-06',
  birthTime: '16:11',
  hourKnown: true,
  fourPillars: {
    year: { stem: '丁', branch: '卯', tenGod: '正印', hiddenStems: ['乙'], naYin: '爐中火' },
    month: { stem: '戊', branch: '申', tenGod: '比肩', hiddenStems: ['庚', '壬', '戊'], naYin: '大驛土' },
    day: { stem: '戊', branch: '午', tenGod: null, hiddenStems: ['丁', '己'], naYin: '天上火' },
    hour: { stem: '庚', branch: '申', tenGod: '食神', hiddenStems: ['庚', '壬', '戊'], naYin: '石榴木' },
  },
  dayMaster: {
    element: '土', yinYang: '陽', strength: 'neutral', strengthScore: 42,
    pattern: '食神格', favorableGod: '土', usefulGod: '火', idleGod: '金', tabooGod: '木', enemyGod: '水',
  },
  dayMasterStem: '戊',
  fiveElementsBalanceZh: { '木': 8, '火': 18, '土': 32, '金': 27, '水': 15 },
  luckPeriods: [{ startAge: 5, endAge: 14, startYear: 1992, endYear: 2001, stem: '己', branch: '酉', tenGod: '劫財', isCurrent: false }],
  annualStars: [{ year: 2026, stem: '丙', branch: '午', tenGod: '偏印', isCurrent: true }],
  allShenSha: [{ name: '天乙貴人', pillar: 'year', branch: '卯' }],
  preAnalysis: '日主戊土生於申月',
  currentYear: 2026,
  targetYear: 2026,
  lifetimeEnhancedInsights: {
    patternNarrative: { patternName: '食神格', patternLogic: '月令申金藏庚為食神', dominantTenGods: ['食神', '比肩'] },
    childrenInsights: { hourPillarTenGod: '食神', hourBranchLifeStage: '病' },
    parentsInsights: { fatherStar: '偏財', motherStar: '正印', yearPillarFavorability: '喜神' },
    deterministic: { favorable_direction: '南方', romance_years: [2027, 2030], partner_zodiac: ['羊'] },
    narrativeAnchors: { personality: '穩重踏實' },
  },
  careerEnhancedInsights: { careerPattern: '食神生財', deterministic: { favorable_industries: ['教育'] } },
  loveEnhancedInsights: { spouseStar: { star: '正財' }, deterministic: { romance_years: [2027] } },
  annualEnhancedInsights: { flowYear: { stem: '丙', branch: '午', tenGod: '偏印' } },
};

const LAOPO = {
  ...ROGER,
  gender: 'female',
  birthDate: '1987-01-25',
  birthTime: '12:00',
  fourPillars: {
    year: { stem: '丙', branch: '寅', tenGod: '食神', hiddenStems: ['甲', '丙', '戊'], naYin: '爐中火' },
    month: { stem: '辛', branch: '丑', tenGod: '正官', hiddenStems: ['己', '癸', '辛'], naYin: '壁上土' },
    day: { stem: '甲', branch: '戌', tenGod: null, hiddenStems: ['戊', '辛', '丁'], naYin: '山頭火' },
    hour: { stem: '壬', branch: '申', tenGod: '偏印', hiddenStems: ['庚', '壬', '戊'], naYin: '劍鋒金' },
  },
  dayMaster: {
    element: '木', yinYang: '陽', strength: 'weak', strengthScore: 20.6,
    pattern: '正官格', favorableGod: '木', usefulGod: '水', idleGod: '火', tabooGod: '土', enemyGod: '金',
  },
  dayMasterStem: '甲',
  fiveElementsBalanceZh: { '木': 20, '火': 15, '土': 30, '金': 25, '水': 10 },
  preAnalysis: '日主甲木生於丑月',
  luckPeriods: [{ startAge: 8, endAge: 17, startYear: 1995, endYear: 2004, stem: '庚', branch: '子', tenGod: '七殺', isCurrent: false }],
  annualStars: [{ year: 2027, stem: '丁', branch: '未', tenGod: '傷官', isCurrent: true }],
  allShenSha: [{ name: '紅鸞', pillar: 'month', branch: '丑' }],
  currentYear: 2027,
  targetYear: 2027,
  lifetimeEnhancedInsights: {
    patternNarrative: { patternName: '正官格', patternLogic: '月令丑土藏辛為正官', dominantTenGods: ['正官', '偏財'] },
    childrenInsights: { hourPillarTenGod: '偏印', hourBranchLifeStage: '絕' },
    parentsInsights: { fatherStar: '偏財', motherStar: '正印', yearPillarFavorability: '忌神' },
    deterministic: { favorable_direction: '北方', romance_years: [2031, 2033], partner_zodiac: ['豬'] },
    narrativeAnchors: { personality: '細膩敏感' },
  },
  careerEnhancedInsights: { careerPattern: '官印相生', deterministic: { favorable_industries: ['金融'] } },
  loveEnhancedInsights: { spouseStar: { star: '正官' }, deterministic: { romance_years: [2031] } },
  annualEnhancedInsights: { flowYear: { stem: '丁', branch: '未', tenGod: '傷官' } },
};

/** Same person as LAOPO, birth hour unknown — the one input that changes a prompt's SHAPE. */
const LAOPO_HOUR_UNKNOWN = {
  ...LAOPO,
  hourKnown: false,
  birthTime: null,
  fourPillars: { ...LAOPO.fourPillars, hour: { stem: '', branch: '', tenGod: null, hiddenStems: [], naYin: '' } },
};

type Built = { systemPrompt: string; userPromptCall1: string; userPromptCall2: string };

const SINGLE_CHART_BUILDERS = [
  'buildLifetimeV2Prompts',
  'buildCareerV2Prompts',
  'buildAnnualV2Prompts',
  'buildLoveV2Prompts',
] as const;

describe('#6 — every V2 system prompt is identical across charts (the prompt-cache prefix)', () => {
  const svc = makeService() as unknown as Record<string, (d: unknown) => Built>;

  it.each(SINGLE_CHART_BUILDERS)('%s: the system prompt does not depend on the input at all', (builder) => {
    const empty = svc[builder]!.call(svc, {});
    const a = svc[builder]!.call(svc, ROGER);
    const b = svc[builder]!.call(svc, LAOPO);
    expect(a.systemPrompt).toBe(empty.systemPrompt);
    expect(b.systemPrompt).toBe(empty.systemPrompt);
    expect(empty.systemPrompt.length).toBeGreaterThanOrEqual(MIN_SYSTEM_PROMPT_CHARS);
    // Not vacuous: the charts DID reach the builder — just the user prompts.
    expect(b.userPromptCall1).not.toBe(a.userPromptCall1);
  });

  it.each(SINGLE_CHART_BUILDERS)(
    '%s: an hour-unknown chart changes the USER prompt, never the cached system prompt',
    (builder) => {
      const empty = svc[builder]!.call(svc, {});
      const known = svc[builder]!.call(svc, LAOPO);
      const unknown = svc[builder]!.call(svc, LAOPO_HOUR_UNKNOWN);
      expect(unknown.systemPrompt).toBe(empty.systemPrompt);
      expect(unknown.userPromptCall1).not.toBe(known.userPromptCall1);
    },
  );

  describe('COMPATIBILITY', () => {
    type Compat = { systemPrompt: string; call1User: string; call2User: string; call3User: string };
    const compat = (a: unknown, b: unknown): Compat =>
      (svc as unknown as { buildCompatibilityRomanceV2Prompts: (d: unknown) => Compat })
        .buildCompatibilityRomanceV2Prompts({
          chartA: a,
          chartB: b,
          birthDateA: (a as { birthDate: string }).birthDate,
          birthDateB: (b as { birthDate: string }).birthDate,
          currentYear: 2026,
        });

    it('two hour-known pairs share one system prompt — the same one an empty input builds', () => {
      const empty = (svc as unknown as { buildCompatibilityRomanceV2Prompts: (d: unknown) => Compat })
        .buildCompatibilityRomanceV2Prompts({});
      const p1 = compat(ROGER, LAOPO);
      const p2 = compat(LAOPO, ROGER);
      expect(p1.systemPrompt).toBe(empty.systemPrompt);
      expect(p2.systemPrompt).toBe(empty.systemPrompt);
      expect(p1.systemPrompt.length).toBeGreaterThanOrEqual(MIN_SYSTEM_PROMPT_CHARS);
      expect(p2.call1User).not.toBe(p1.call1User);
    });

    it('an hour-unknown pair gets a DIFFERENT prefix — expected, and still one prefix for all three calls', () => {
      // The per-party suppression block is prepended to the SYSTEM prompt here
      // (unlike the single-chart types), because it governs all three calls.
      // That makes an hour-unknown reveal a separate cache entry, which is
      // correct. Its three calls still share it, since the builder returns ONE
      // systemPrompt string that every call is sent with.
      const known = compat(ROGER, LAOPO);
      const unknown = compat(ROGER, LAOPO_HOUR_UNKNOWN);
      expect(unknown.systemPrompt).not.toBe(known.systemPrompt);
      expect(unknown.systemPrompt.endsWith(known.systemPrompt)).toBe(true);
    });
  });
});

describe('#6 — the streaming adapter carries a 5-MINUTE cache marker', () => {
  const SRC = readFileSync(join(__dirname, '..', 'src/ai/ai.service.ts'), 'utf8');
  const streamClaude = (() => {
    const start = SRC.indexOf('  private async *streamClaude(');
    return SRC.slice(start, SRC.indexOf('// ---- GPT ----', start));
  })();

  it('marks the system block as ephemeral', () => {
    expect(streamClaude).toContain("cache_control: { type: 'ephemeral' }");
  });

  it('never with the 1-hour TTL — one-shot readings would pay 2x to write a cache nobody reads', () => {
    // Chat uses `ttl: '1h'` legitimately (its turns repeat), which is exactly
    // why this is the shape most likely to be copied in here by mistake.
    // Scoped to the cache_control object literal: the warning comment above the
    // call names `ttl: '1h'` on purpose, and must not trip the assertion.
    expect(streamClaude).not.toMatch(/cache_control:\s*\{[^}]*\bttl\b/);
  });
});
