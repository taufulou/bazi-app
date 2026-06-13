/**
 * 時辰未知 (unknown birth hour) — Phase FORTUNE regression lock for the AI
 * suppression gate in the FORTUNE prompt injectors.
 *
 * Locks: the 【時辰未知 — 嚴格限制】 block is prepended ONLY when
 * chart.hourKnown === false (strict), so hour-known prompts stay byte-identical
 * (cache-safe). All 3 injectors (daily/monthly/yearly) share the same gate +
 * the buildFortuneHourUnknownBlock helper; daily is tested as the representative.
 */

import {
  interpolateFortuneV1Fields,
  type DailyEngineOutput,
  type FortuneChartContext,
} from './fortune-prompt-builder';

const MARKER = '【時辰未知 — 嚴格限制';

function makeDaily(): DailyEngineOutput {
  const dim = () => ({ score: 50, signals: [] as Array<Record<string, unknown>> });
  return {
    dayStem: '戊',
    dayBranch: '午',
    dayGanZhi: '戊午',
    dayTenGod: '比肩',
    dateIso: '2026-06-13',
    auspiciousness: '平',
    baseAuspiciousness: '平',
    energyScore: 50,
    metaFraming: 'soft_trigger',
    dimensions: {
      romance: dim(),
      career: dim(),
      finance: dim(),
      travel: dim(),
      health: dim(),
    },
  };
}

function makeChart(hourKnown?: boolean): FortuneChartContext {
  return {
    gender: 'male',
    birthDate: '1995-11-08',
    birthTime: '',
    lunarDate: null,
    yearPillar: '乙亥',
    monthPillar: '丁亥',
    dayPillar: '癸卯',
    hourPillar: '',
    yearTenGod: '食神',
    monthTenGod: '劫財',
    hourTenGod: '',
    dayMaster: '癸',
    dayMasterElement: '水',
    dayMasterYinYang: '陰',
    strengthV2: 'neutral',
    usefulGod: '木',
    favorableGod: '金',
    tabooGod: '土',
    enemyGod: '火',
    hourKnown,
  };
}

const TEMPLATE = '今日{{dayGanZhi}}';

describe('FORTUNE 時辰未知 suppression gate (interpolateFortuneV1Fields)', () => {
  it('prepends the suppression block when hourKnown === false', () => {
    const out = interpolateFortuneV1Fields(TEMPLATE, makeDaily(), makeChart(false));
    expect(out).toContain(MARKER);
    // daily-specific extra line + the shared 用神 caveat are present
    expect(out).toContain('流日與年、月、日三柱及大運的互動不受影響');
    expect(out).toContain('用神／五行比重僅供參考');
    // substitution still ran (block is prepended, not replacing)
    expect(out).toContain('今日戊午');
  });

  it('does NOT prepend when hourKnown === true', () => {
    const out = interpolateFortuneV1Fields(TEMPLATE, makeDaily(), makeChart(true));
    expect(out).not.toContain(MARKER);
  });

  it('does NOT prepend when hourKnown is undefined, and is byte-identical to the true case', () => {
    const undef = interpolateFortuneV1Fields(TEMPLATE, makeDaily(), makeChart(undefined));
    const known = interpolateFortuneV1Fields(TEMPLATE, makeDaily(), makeChart(true));
    expect(undef).not.toContain(MARKER);
    expect(undef).toBe(known); // strict === false gate → hour-known byte-identical
  });
});
