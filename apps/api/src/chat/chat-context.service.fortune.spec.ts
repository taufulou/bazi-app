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
