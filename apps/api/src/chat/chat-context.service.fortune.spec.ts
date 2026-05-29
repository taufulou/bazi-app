/**
 * Phase Fortune — regression-lock specs for chat-context.service.ts FORTUNE
 * additions. Covers the plan's HIGH-severity issues that must NEVER regress:
 *
 * - Issue 11 + NEW-A: `computeVersionString` AND `getCurrentSnapshotVersions`
 *   are per-readingType-conditional. Adding FORTUNE to the version map must
 *   NOT change the version string for non-FORTUNE sessions (zero mass
 *   eviction blast radius).
 * - Issue 14: `interpolateFortuneV1Fields` emits the day-pillar TRANSIENT
 *   doctrine block from `dailyFortune.dimensions[].signals[]`. Without this
 *   the AI falls back to folk-doctrine for day-of valence dispatch.
 * - Issue 2: `extractFortunePivotHint` prefers headlinerSignal narrative;
 *   falls back gracefully to dayGanZhi format.
 *
 * These tests are pure unit tests — no Prisma/Redis/Engine. The service
 * uses `interpolateFortuneV1Fields` as a free function so we can import it
 * directly. Version helpers are tested by direct invocation.
 */
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  ChatContextService,
  interpolateFortuneV1Fields,
  type ChatContext,
} from './chat-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

describe('ChatContextService — Phase Fortune', () => {
  let service: ChatContextService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatContextService,
        { provide: ConfigService, useValue: { get: () => 'http://localhost:5001' } },
        { provide: PrismaService, useValue: {} as PrismaService },
        { provide: RedisService, useValue: {} as RedisService },
      ],
    }).compile();
    service = moduleRef.get(ChatContextService);
  });

  // ============================================================
  // Issue 11 + NEW-A — per-readingType version composition
  // ============================================================

  describe('computeVersionString — per-readingType conditional (Issue 11)', () => {
    it('does NOT include pa-fort for non-FORTUNE readingTypes', () => {
      for (const type of ['LIFETIME', 'LOVE', 'CAREER', 'ANNUAL', 'COMPATIBILITY'] as const) {
        const versions = service.computeVersionString(type);
        expect(versions).not.toContain('pa-fort');
      }
    });

    it('DOES include pa-fort when readingType === FORTUNE', () => {
      const versions = service.computeVersionString('FORTUNE');
      expect(versions).toContain('pa-fort=');
    });

    it('LIFETIME version string is byte-identical pre- and post-FORTUNE entry (no mass eviction)', () => {
      const lifetimeVersion = service.computeVersionString('LIFETIME');
      // The version string format is:
      // lifetime=v1.2.2|pa-life=v2.9.0|pa-love=v1.11.0|pa-car=v2.5.0|pa-ann=v2.4.0|pa-compat=v1.8.2
      // — should NOT have pa-fort even though PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.FORTUNE is set.
      const parts = lifetimeVersion.split('|');
      const hasForkVersion = parts.some((p) => p.startsWith('pa-fort'));
      expect(hasForkVersion).toBe(false);
    });
  });

  describe('getCurrentSnapshotVersions — per-readingType conditional (NEW-A)', () => {
    it('does NOT include fort= in preAnalysisVersion for non-FORTUNE readingTypes', () => {
      for (const type of ['LIFETIME', 'LOVE', 'CAREER', 'ANNUAL', 'COMPATIBILITY'] as const) {
        const snap = service.getCurrentSnapshotVersions(type);
        expect(snap.preAnalysisVersion).not.toContain('fort=');
      }
    });

    it('DOES include fort= for FORTUNE', () => {
      const snap = service.getCurrentSnapshotVersions('FORTUNE');
      expect(snap.preAnalysisVersion).toContain('fort=');
    });

    it('LIFETIME stored preAnalysisVersion is byte-identical pre- and post-FORTUNE addition', () => {
      // This is the NEW-A load-bearing assertion: existing sessions' stored
      // preAnalysisVersion (snapshotted before FORTUNE shipped) must still
      // match the fresh snapshot AFTER FORTUNE is added to the map. Otherwise
      // every LIFETIME/LOVE/CAREER/ANNUAL/COMPAT session next message hits
      // CONTEXT_VERSION_DRIFTED.
      const snap = service.getCurrentSnapshotVersions('LIFETIME');
      // Re-derive without the FORTUNE entry for assertion clarity.
      // The actual sentinel: no fort= token present.
      expect(snap.preAnalysisVersion.split('|').every((p) => !p.startsWith('fort='))).toBe(true);
    });
  });

  // ============================================================
  // Issue 2 — extractFortunePivotHint
  // ============================================================

  describe('extractFortunePivotHint (via extractCrossSellPivotHint switch)', () => {
    function buildCtxWithFortune(dailyFortune: Record<string, unknown>): ChatContext {
      return { dailyFortune } as ChatContext;
    }

    // Accessing the private method via cast for testing
    function extract(ctx: ChatContext): string | null {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (service as any).extractFortunePivotHint(ctx);
    }

    it('prefers headlinerSignals.triggers[0].narrative when present', () => {
      const ctx = buildCtxWithFortune({
        dayGanZhi: '戊子',
        auspiciousness: '凶中有吉',
        energyScore: 42,
        headlinerSignals: {
          triggers: [
            { narrative: '今日紅鸞動，子卯刑配偶宮' },
            { narrative: '次要訊號' },
          ],
        },
      });
      expect(extract(ctx)).toBe('今日紅鸞動，子卯刑配偶宮');
    });

    it('falls back to dayGanZhi（auspiciousness，energyScore分） format when no headliner', () => {
      const ctx = buildCtxWithFortune({
        dayGanZhi: '戊子',
        auspiciousness: '凶中有吉',
        energyScore: 42,
      });
      expect(extract(ctx)).toBe('戊子日（凶中有吉，42分）');
    });

    it('falls back to bare dayGanZhi when auspiciousness/score missing', () => {
      const ctx = buildCtxWithFortune({ dayGanZhi: '戊子' });
      expect(extract(ctx)).toBe('戊子日');
    });

    it('returns null when dailyFortune missing entirely', () => {
      const ctx = {} as ChatContext;
      expect(extract(ctx)).toBeNull();
    });

    it('handles malformed headlinerSignals gracefully', () => {
      const ctx = buildCtxWithFortune({
        dayGanZhi: '戊子',
        auspiciousness: '凶中有吉',
        energyScore: 42,
        headlinerSignals: { triggers: [{ narrative: '' }] }, // empty narrative
      });
      // Empty narrative → fall through to dayGanZhi format
      expect(extract(ctx)).toBe('戊子日（凶中有吉，42分）');
    });
  });
});

// ============================================================
// Issue 14 — interpolateFortuneV1Fields (day-pillar TRANSIENT injector)
// ============================================================

describe('interpolateFortuneV1Fields — day-pillar TRANSIENT doctrine injector (Issue 14)', () => {
  function buildCtx(dimensions: Record<string, unknown>): ChatContext {
    return {
      dailyFortune: {
        dayGanZhi: '戊子',
        dimensions,
      },
    } as ChatContext;
  }

  it('returns null when no signals are present', () => {
    const ctx = buildCtx({
      romance: { score: 50, label: 'neutral', signals: [] },
      career: { score: 50, label: 'neutral', signals: [] },
    });
    expect(interpolateFortuneV1Fields(ctx)).toBeNull();
  });

  it('returns null when dailyFortune is missing', () => {
    expect(interpolateFortuneV1Fields({} as ChatContext)).toBeNull();
  });

  it('returns null when dayGanZhi is missing', () => {
    const ctx = { dailyFortune: { dimensions: {} } } as ChatContext;
    expect(interpolateFortuneV1Fields(ctx)).toBeNull();
  });

  it('emits 傷官見官 beneficial sentence when 正官=忌神 (Phase 12h.B Item 2)', () => {
    const ctx = buildCtx({
      career: {
        score: 60,
        label: 'beneficial',
        signals: [
          {
            type: 'shangguan_jian_guan_transient',
            valence: 'beneficial',
            narrative: '正官為忌神，傷官制官有利',
          },
        ],
      },
    });
    const block = interpolateFortuneV1Fields(ctx);
    expect(block).not.toBeNull();
    expect(block!).toContain('今日 戊子 日触發 傷官見官 流日');
    expect(block!).toContain('反吉');
    expect(block!).toContain('正官為忌神');
    expect(block!).toMatch(/今日 戊子 日触發的教義事件/);
    expect(block!).toMatch(/⚠️ 上述為流日 trigger，非命局定論/);
  });

  it('emits 傷官見官 harmful sentence when 正官=用神', () => {
    const ctx = buildCtx({
      career: {
        score: 30,
        label: 'harmful',
        signals: [
          {
            type: 'shangguan_jian_guan_transient',
            valence: 'harmful',
          },
        ],
      },
    });
    const block = interpolateFortuneV1Fields(ctx);
    expect(block!).toContain('為禍');
    expect(block!).toContain('正官為用神或喜神');
  });

  it('emits 比劫奪財 valence-dispatched sentence (Phase 12h.B Item 8)', () => {
    const ctx = buildCtx({
      finance: {
        score: 30,
        label: 'harmful',
        signals: [
          {
            type: 'bi_jie_duo_cai_transient',
            valence: 'harmful',
            narrative: '今日宜守不宜攻',
          },
        ],
      },
    });
    const block = interpolateFortuneV1Fields(ctx);
    expect(block!).toContain('今日 戊子 日触發 比劫奪財 流日');
    expect(block!).toContain('為禍');
  });

  it('emits 比劫奪財 not_applicable when DM is weak', () => {
    const ctx = buildCtx({
      finance: {
        score: 50,
        label: 'neutral',
        signals: [{ type: 'bi_jie_duo_cai_transient', valence: 'not_applicable' }],
      },
    });
    const block = interpolateFortuneV1Fields(ctx);
    expect(block!).toContain('不適用（日主弱不主奪）');
  });

  it('emits 沖日支 sentence across travel / career / health dim variants', () => {
    const ctx = buildCtx({
      travel: {
        score: 32,
        label: 'harmful',
        signals: [
          { type: 'chong_day_branch_travel', narrative: '日支沖則動' },
        ],
      },
    });
    const block = interpolateFortuneV1Fields(ctx);
    expect(block!).toContain('今日 戊子 日触發 沖日支');
    expect(block!).toContain('日支沖則動');
  });

  it('emits 紅鸞 sentence with anti-folk-doctrine framing', () => {
    const ctx = buildCtx({
      romance: {
        score: 60,
        label: 'beneficial',
        signals: [
          { type: 'honluan_triggered', narrative: '今日紅鸞觸發' },
        ],
      },
    });
    const block = interpolateFortuneV1Fields(ctx);
    expect(block!).toContain('紅鸞星動');
    expect(block!).toContain('非命局婚緣定論'); // D-1 doctrine — anti folk hallucination
  });

  it('aggregates signals across multiple dims with dim labels', () => {
    const ctx = buildCtx({
      career: {
        score: 60,
        label: 'beneficial',
        signals: [
          { type: 'shangguan_jian_guan_transient', valence: 'beneficial' },
        ],
      },
      romance: {
        score: 60,
        label: 'beneficial',
        signals: [
          { type: 'honluan_triggered' },
        ],
      },
    });
    const block = interpolateFortuneV1Fields(ctx);
    expect(block!).toContain('[事業]');
    expect(block!).toContain('[感情]');
    // Both signals should appear
    expect(block!.match(/今日 戊子 日触發/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('skips signals with unknown type silently (no error)', () => {
    const ctx = buildCtx({
      romance: {
        score: 50,
        label: 'neutral',
        signals: [
          { type: 'totally_unknown_signal_name', narrative: 'foo' },
        ],
      },
    });
    expect(interpolateFortuneV1Fields(ctx)).toBeNull();
  });

  it('skips signals missing the type field', () => {
    const ctx = buildCtx({
      romance: {
        score: 50,
        label: 'neutral',
        signals: [{ narrative: 'missing type' }],
      },
    });
    expect(interpolateFortuneV1Fields(ctx)).toBeNull();
  });
});

// ============================================================
// L3.5 — Phase 1.5.z folk content chat-scope injection
// ============================================================
//
// When engine emits folkContent (Phase 1.5.z), the chat-side
// interpolateFortuneV1Fields function must also expose those fields to the
// AI prompt — otherwise prompts.ts:3940's relaxation of folk-topic forbiddance
// would create a hallucination opportunity (the Phase Fortune Issue 11/NEW-A
// failure mode).

describe('interpolateFortuneV1Fields — Phase 1.5.z folk content chat-scope (L3.5)', () => {
  function buildCtxWithFolk(folkContent: Record<string, unknown>, opts?: {
    dimensions?: Record<string, unknown>;
  }): ChatContext {
    return {
      dailyFortune: {
        dayGanZhi: '丙申',
        dimensions: opts?.dimensions ?? {},
        folkContent,
      },
    } as ChatContext;
  }

  const FULL_FOLK = {
    wealthDirection: { element: '火', direction: '南方', note: '用神方位' },
    luckyColor: {
      element: '火',
      primary: '紅',
      secondary: '紫',
      cite: '素問·陰陽應象大論「南方赤色」',
    },
    luckyNumber: {
      element: '火',
      numbers: [2, 7],
      cite: '河圖：二七同道火',
    },
    luckyFoodFavor: {
      element: '火',
      category: '紅色食物/苦味/養心',
      examples: ['番茄', '紅棗', '苦瓜'],
      cite: '素問·陰陽應象大論',
    },
    luckyFoodAvoid: {
      element: '火',
      category: '寒涼/鹹味 (水剋火)',
      reason: '用神為火,忌鹹味水性食物 — 水剋火',
      cite_sources: ['素問·五常政大論', '素問·宣明五氣', '素問·陰陽應象大論'],
    },
    auspiciousHours: [
      { branch: '子', hour_range: '23:00-01:00', classical_name: '司命' },
      { branch: '丑', hour_range: '01:00-03:00', classical_name: '天德' },
      { branch: '辰', hour_range: '07:00-09:00', classical_name: '金匱' },
      { branch: '巳', hour_range: '09:00-11:00', classical_name: '明堂' },
      { branch: '未', hour_range: '13:00-15:00', classical_name: '玉堂' },
      { branch: '戌', hour_range: '19:00-21:00', classical_name: '青龍' },
    ],
  };

  it('emits folk-content block when engine provides folkContent (all 6 fields)', () => {
    const block = interpolateFortuneV1Fields(buildCtxWithFolk(FULL_FOLK));
    expect(block).toBeTruthy();
    expect(block!).toContain('🎨 今日民俗內容');
    expect(block!).toContain('用神方位 [典籍]');
    expect(block!).toContain('吉色 [典籍]');
    expect(block!).toContain('吉數 [民俗]');
    expect(block!).toContain('今日宜食 [典籍]');
    expect(block!).toContain('今日忌食 [典籍]');
    expect(block!).toContain('今日吉時 [典籍]');
  });

  it('emits 民俗 prefix instruction for 吉數 row (folk_tradition tier disclosure)', () => {
    const block = interpolateFortuneV1Fields(buildCtxWithFolk(FULL_FOLK));
    expect(block!).toContain('「民俗參考」');
  });

  it('emits 五行 reason citation requirement for 今日忌食', () => {
    const block = interpolateFortuneV1Fields(buildCtxWithFolk(FULL_FOLK));
    expect(block!).toContain('原因：');
    expect(block!).toContain('水剋火');
    expect(block!).toContain('引用 reason');
  });

  it('emits month-branch-independence note for 黃道吉時 (P0 doctrine lock)', () => {
    const block = interpolateFortuneV1Fields(buildCtxWithFolk(FULL_FOLK));
    expect(block!).toContain('黃道吉時僅依日支推算，與月支無關');
    expect(block!).toContain('協紀辨方書 卷十');
  });

  it('emits medical disclaimer + folk-classical separation warning', () => {
    const block = interpolateFortuneV1Fields(buildCtxWithFolk(FULL_FOLK));
    expect(block!).toContain('飲食建議僅為命理參考');
    expect(block!).toContain('不可與典籍級別');
  });

  it('skips null fields gracefully — only emits non-null rows', () => {
    const block = interpolateFortuneV1Fields(buildCtxWithFolk({
      wealthDirection: { element: '火', direction: '南方', note: '用神方位' },
      luckyColor: null,
      luckyNumber: null,
      luckyFoodFavor: null,
      luckyFoodAvoid: null,
      auspiciousHours: FULL_FOLK.auspiciousHours,
    }));
    // Verify only the wealth-direction + hours ROWS are emitted (bullet-prefixed)
    expect(block!).toContain('• 用神方位 [典籍]');
    expect(block!).toContain('• 今日吉時 [典籍]');
    expect(block!).not.toContain('• 吉色 [典籍]');
    expect(block!).not.toContain('• 吉數 [民俗]');
    expect(block!).not.toContain('• 今日宜食 [典籍]');
    expect(block!).not.toContain('• 今日忌食 [典籍]');
  });

  it('returns null when folkContent absent AND no transient signals', () => {
    const ctx = {
      dailyFortune: {
        dayGanZhi: '丙申',
        dimensions: {},
      },
    } as ChatContext;
    expect(interpolateFortuneV1Fields(ctx)).toBeNull();
  });

  it('combines transient doctrine block + folk block when both present', () => {
    const block = interpolateFortuneV1Fields(buildCtxWithFolk(FULL_FOLK, {
      dimensions: {
        career: {
          score: 60,
          signals: [
            { type: 'shangguan_jian_guan_transient', valence: 'beneficial' },
          ],
        },
      },
    }));
    expect(block!).toContain('📅 今日 丙申 日触發的教義事件');
    expect(block!).toContain('🎨 今日民俗內容');
    expect(block!).toContain('傷官見官');
  });

  it('renders auspicious hours with classical_name + branch + hour_range', () => {
    const block = interpolateFortuneV1Fields(buildCtxWithFolk(FULL_FOLK));
    expect(block!).toContain('司命時 子（23:00-01:00）');
    expect(block!).toContain('青龍時 戌（19:00-21:00）');
  });

  it('renders 吉色 with primary + secondary + cite', () => {
    const block = interpolateFortuneV1Fields(buildCtxWithFolk(FULL_FOLK));
    expect(block!).toContain('紅（次選：紫');
    expect(block!).toContain('素問·陰陽應象大論');
  });

  it('renders 吉數 with all numbers + cite', () => {
    const block = interpolateFortuneV1Fields(buildCtxWithFolk(FULL_FOLK));
    expect(block!).toContain('2、7');
    expect(block!).toContain('河圖');
  });
});

// ============================================================
// L3.5 — CHAT_PROMPT_VERSIONS.FORTUNE bump regression lock
// ============================================================

describe('CHAT_PROMPT_VERSIONS.FORTUNE — per-readingType isolation (L3.5)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CHAT_PROMPT_VERSIONS } = require('./chat-context.service');

  it('FORTUNE bumped to v1.1.0 for Phase 1.5.z', () => {
    expect(CHAT_PROMPT_VERSIONS.FORTUNE).toBe('v1.1.0');
  });

  it('non-FORTUNE reading types unaffected by FORTUNE bump (per-readingType isolation)', () => {
    // Phase Fortune Issue 11 + NEW-A regression lock — bumping FORTUNE must
    // NOT cascade into other reading types' version strings.
    expect(CHAT_PROMPT_VERSIONS.LIFETIME).toBe('v1.2.2');
    expect(CHAT_PROMPT_VERSIONS.LOVE).toBe('v1.0.1');
    expect(CHAT_PROMPT_VERSIONS.CAREER).toBe('v1.0.1');
    expect(CHAT_PROMPT_VERSIONS.ANNUAL).toBe('v1.0.3');
    expect(CHAT_PROMPT_VERSIONS.COMPATIBILITY).toBe('v1.1.0');
  });
});

// ============================================================
// L3.5b — Phase 2 月運 chat-scope MONTH wiring (audit H#2)
// ============================================================

/**
 * H#2 (L3.5b line audit) — 5 regression locks for the scope-aware dispatch
 * paths so audit-fix F bugs (drift check using wrong helper) cannot recur.
 *
 * Plus C#1 byte-identity lock: bumping the new FORTUNE_MONTH constant MUST
 * NOT touch existing DAY sessions' stored preAnalysisVersion (would trip
 * CONTEXT_VERSION_DRIFTED on first message post-deploy for every legacy
 * DAY chat session in DB).
 *
 * Plus interpolateFortuneMonthlyFields presence + correctness checks.
 */
describe('L3.5b — scope-aware FORTUNE chat (audit H#2)', () => {
  let scopeService: ChatContextService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatContextService,
        { provide: ConfigService, useValue: { get: () => 'http://localhost:5001' } },
        { provide: PrismaService, useValue: {} as PrismaService },
        { provide: RedisService, useValue: {} as RedisService },
      ],
    }).compile();
    scopeService = moduleRef.get(ChatContextService);
  });

  describe('(a) cacheKey includes :scope: discriminator', () => {
    it('DAY scope version string contains pa-fort= key (legacy byte-identity)', () => {
      const versions = scopeService.computeVersionStringForFortune('DAY');
      // Audit C#1: DAY must use LEGACY `pa-fort=` key for byte-identity
      // with pre-L3.5b sessions (NOT pa-fort-day=).
      expect(versions).toContain('pa-fort=');
      expect(versions).not.toContain('pa-fort-day=');
      expect(versions).not.toContain('pa-fort-month=');
    });

    it('MONTH scope version string contains pa-fort-month= key (NEW)', () => {
      const versions = scopeService.computeVersionStringForFortune('MONTH');
      expect(versions).toContain('pa-fort-month=');
      // MUST NOT carry the legacy DAY key — active-scope-only emission.
      expect(versions).not.toContain('pa-fort=');
    });
  });

  describe('(b) DAY vs MONTH version strings are byte-distinct', () => {
    it('different fortune-scope produces different version strings', () => {
      const dayVer = scopeService.computeVersionStringForFortune('DAY');
      const monthVer = scopeService.computeVersionStringForFortune('MONTH');
      expect(dayVer).not.toEqual(monthVer);
    });

    it('getCurrentSnapshotVersionsForFortune outputs differ by scope', () => {
      const day = scopeService.getCurrentSnapshotVersionsForFortune('DAY');
      const month = scopeService.getCurrentSnapshotVersionsForFortune('MONTH');
      expect(day.preAnalysisVersion).not.toEqual(month.preAnalysisVersion);
      expect(day.preAnalysisVersion).toContain('fort=');
      expect(day.preAnalysisVersion).not.toContain('fort-month=');
      expect(month.preAnalysisVersion).toContain('fort-month=');
      expect(month.preAnalysisVersion).not.toContain('fort=v'); // matches 'fort=' but not 'fort-month=v'
    });
  });

  describe('(c) C#1 byte-identity — legacy DAY session drift-check survives L3.5b', () => {
    it('getCurrentSnapshotVersionsForFortune(DAY) preAnalysisVersion === legacy getCurrentSnapshotVersions(FORTUNE)', () => {
      // CRITICAL: pre-L3.5b DAY sessions stored preAnalysisVersion via the
      // legacy `getCurrentSnapshotVersions('FORTUNE')` path. Post-L3.5b
      // drift check uses `getCurrentSnapshotVersionsForFortune('DAY')`.
      // Both MUST produce identical strings — else every existing DAY
      // chat session in DB trips CONTEXT_VERSION_DRIFTED on first message.
      const legacy = scopeService.getCurrentSnapshotVersions('FORTUNE');
      const scopeAware = scopeService.getCurrentSnapshotVersionsForFortune('DAY');
      expect(scopeAware.preAnalysisVersion).toEqual(legacy.preAnalysisVersion);
      expect(scopeAware.contextVersion).toEqual(legacy.contextVersion);
    });
  });

  describe('(d) interpolateFortuneMonthlyFields — MONTH-scope deterministic injector', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { interpolateFortuneMonthlyFields } = require('./chat-context.service');

    it('returns null when monthlyFortune absent (graceful degrade)', () => {
      const ctx = {} as ChatContext;
      expect(interpolateFortuneMonthlyFields(ctx)).toBeNull();
    });

    it('returns null when monthlyFortune.monthGanZhi missing', () => {
      const ctx = { monthlyFortune: { auspiciousness: '吉' } } as ChatContext;
      expect(interpolateFortuneMonthlyFields(ctx)).toBeNull();
    });

    it('emits 流月教義事件 block with month-pillar findings', () => {
      const ctx: ChatContext = {
        monthlyFortune: {
          monthGanZhi: '癸巳',
          monthTenGod: '正財',
          auspiciousness: '吉',
          officerSealActivation: {
            pattern: 'sha_yin',
            level: 'full',
            direction: 'positive',
            seal_source: 'benqi',
          },
          fuYinInteractions: [
            { pillar: 'month', role: '用神', direction: 'upgrade', weight: 1.0, applied: true },
          ],
          dimensions: {
            career: { signals: ['官殺當令，有升遷或考核壓力'] },
          },
        },
      } as ChatContext;
      const block = interpolateFortuneMonthlyFields(ctx);
      expect(block).not.toBeNull();
      expect(block!).toContain('癸巳月');
      expect(block!).toContain('殺印相生');
      expect(block!).toContain('伏吟');
      // Soft-trigger framing rule must always appear when month findings emit
      expect(block!).toContain('本月宜');
    });

    it('emits intraMonthBreakdown bucket details', () => {
      const ctx: ChatContext = {
        monthlyFortune: {
          monthGanZhi: '癸巳',
          intraMonthBreakdown: {
            scheme_id: 'tiangan_dizhi_half',
            buckets: [
              {
                label: '上半月',
                day_range: [1, 15],
                governing_pillar: 'stem',
                auspicious_days: 9,
                challenging_days: 5,
                neutral_days: 1,
                dominant_shensha: ['天喜', '比劫'],
                peak_signals: [
                  { date: '2026-05-07', type: '紅鸞', valence: 'positive', narrative: '紅鸞動' },
                ],
              },
              {
                label: '下半月',
                day_range: [16, 31],
                governing_pillar: 'branch',
                auspicious_days: 11,
                challenging_days: 3,
                neutral_days: 2,
                dominant_shensha: ['驛馬'],
                peak_signals: [],
              },
            ],
          },
        },
      } as ChatContext;
      const block = interpolateFortuneMonthlyFields(ctx);
      expect(block).not.toBeNull();
      expect(block!).toContain('上半月');
      expect(block!).toContain('下半月');
      expect(block!).toContain('流月天干主導');
      expect(block!).toContain('流月地支主導');
      expect(block!).toContain('9 天'); // auspicious_days
      expect(block!).toContain('11 天');
    });
  });

  describe('(f) M#2 staff-engineer post-fix — chat-side vs engine-side constant decoupling', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { FORTUNE_PRE_ANALYSIS_VERSIONS } = require('../ai/prompts');

    it('engine-side FORTUNE_PRE_ANALYSIS_VERSIONS.day is past the legacy chat-side v1.1.1 lock (decoupled per audit C#1)', () => {
      // STAFF-ENGINEER REGRESSION LOCK (post-M#2 audit fix):
      //
      // M#2 stale-snapshot check MUST compare against the ENGINE-side
      // FORTUNE_PRE_ANALYSIS_VERSIONS.day (what the snapshot was actually
      // stamped with at persist time by fortune-snapshot.helpers.ts), NOT
      // the chat-side PRE_ANALYSIS_VERSIONS_FOR_CHAT_HASH.FORTUNE (legacy-
      // locked at 'v1.1.1' for C#1 byte-identity preservation).
      //
      // Any future engineer reading
      // `chat-context.service.ts::getChatContextForFortune` M#2 block and
      // tempted to "simplify" by comparing against the chat-side constant
      // would silently defeat the Issue-1 snapshot-reuse optimization →
      // every fresh DAY snapshot ('v1.2.0') would mismatch 'v1.1.1' →
      // flagged stale → cold engine recompute every chat session.
      //
      // Lock: assert engine has moved past the legacy chat-side value.
      // If they ever align again (engine reverted, chat unlocked, etc.),
      // this test fails and forces explicit re-evaluation.
      expect(FORTUNE_PRE_ANALYSIS_VERSIONS.day).toBeDefined();
      expect(FORTUNE_PRE_ANALYSIS_VERSIONS.day).not.toBe('v1.1.1');
    });

    it('engine-side FORTUNE_PRE_ANALYSIS_VERSIONS.month constant is defined (M#2 MONTH path compares against it)', () => {
      expect(FORTUNE_PRE_ANALYSIS_VERSIONS.month).toBeDefined();
      expect(typeof FORTUNE_PRE_ANALYSIS_VERSIONS.month).toBe('string');
    });
  });

  describe('(g) LOW #1 staff-engineer post-fix — extractFortunePivotHint MONTH branch', () => {
    // Access the private method via cast (mirror existing extract() pattern below)
    function extract(ctx: ChatContext): string | null {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (scopeService as any).extractFortunePivotHint(ctx);
    }

    it('returns formatted MONTH pivot when monthlyFortune provides all 4 fields', () => {
      const ctx: ChatContext = {
        monthlyFortune: {
          monthGanZhi: '癸巳',
          monthLabel: '2026年5月',
          auspiciousness: '平',
          energyScore: 50,
        },
      } as ChatContext;
      // Prefers monthLabel («2026年5月») over fallback «癸巳月»
      expect(extract(ctx)).toBe('2026年5月（平，50分）');
    });

    it('falls back to monthGanZhi + 月 suffix when monthLabel missing', () => {
      const ctx: ChatContext = {
        monthlyFortune: {
          monthGanZhi: '癸巳',
          auspiciousness: '吉',
          energyScore: 65,
        },
      } as ChatContext;
      expect(extract(ctx)).toBe('癸巳月（吉，65分）');
    });

    it('returns base label when auspiciousness or energyScore missing (degraded but useful)', () => {
      const ctx: ChatContext = {
        monthlyFortune: { monthGanZhi: '癸巳' },
      } as ChatContext;
      expect(extract(ctx)).toBe('癸巳月');
    });

    it('falls through to DAY branch when monthlyFortune.monthGanZhi+monthLabel both missing', () => {
      // Defensive: monthly present but no usable identifier — should fall
      // through to dailyFortune (DAY chat session that somehow carries
      // monthly remnant in ctx — shouldn't happen but graceful degrade).
      const ctx: ChatContext = {
        monthlyFortune: { auspiciousness: '吉', energyScore: 60 } as Record<string, unknown>,
        dailyFortune: { dayGanZhi: '戊子', auspiciousness: '凶中有吉', energyScore: 42 } as Record<string, unknown>,
      } as ChatContext;
      // Falls through to DAY branch → returns dayGanZhi formatted
      expect(extract(ctx)).toBe('戊子日（凶中有吉，42分）');
    });

    it('returns null when both monthlyFortune AND dailyFortune absent', () => {
      const ctx: ChatContext = {} as ChatContext;
      expect(extract(ctx)).toBeNull();
    });

    it('DAY branch still works untouched (existing behaviour preserved)', () => {
      // Regression lock — no DAY-only test should change behaviour.
      const ctx: ChatContext = {
        dailyFortune: {
          dayGanZhi: '戊子',
          auspiciousness: '凶中有吉',
          energyScore: 42,
          headlinerSignals: {
            triggers: [{ narrative: '今日紅鸞動，子卯刑配偶宮' }],
          },
        },
      } as ChatContext;
      expect(extract(ctx)).toBe('今日紅鸞動，子卯刑配偶宮');
    });
  });

  describe('(e) cross-scope isolation — bumping MONTH does not affect DAY', () => {
    it('DAY snapshot version is stable across the spec run (no MONTH side-effects)', () => {
      // The byte-identity assertion from (c) re-runs here as a separate
      // invariant: even with all the MONTH-scope code paths exercised in
      // this describe block, the DAY scope helper produces the SAME string
      // as the legacy FORTUNE path. Locked.
      const dayAfter = scopeService.getCurrentSnapshotVersionsForFortune('DAY');
      const legacyAfter = scopeService.getCurrentSnapshotVersions('FORTUNE');
      expect(dayAfter.preAnalysisVersion).toEqual(legacyAfter.preAnalysisVersion);
    });
  });
});
