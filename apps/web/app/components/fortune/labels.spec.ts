/**
 * UX Sprint R1.8 + Round-2 N3 — locks the exact Intl.DateTimeFormat output
 * for the date band so the rendered string stays consistent across Node
 * runtimes (ICU subset variance) and across SSR/CSR boundaries.
 */
import {
  formatFortuneDate,
  friendlyExplanationFromLabel,
  ringTierFromLabel,
  dimTierFromScore,
} from './labels';

describe('labels.ts', () => {
  describe('formatFortuneDate', () => {
    // Note: zh-TW Intl.DateTimeFormat outputs date + weekday with NO space
    // between them (e.g. '2026年5月17日週日'). The EnergyScoreRing component
    // adds visual separation via flexbox gap; test asserts the raw Intl output.
    it('formats 2026-05-17 as 「2026年5月17日週日」 (raw Intl output)', () => {
      const result = formatFortuneDate('2026-05-17');
      // 2026-05-17 is a Sunday → 週日 in zh-TW Intl.DateTimeFormat
      expect(result.dateLine).toBe('2026年5月17日週日');
      expect(result.short).toBe('5/17');
    });

    it('formats 2026-05-14 as 「2026年5月14日週四」 (raw Intl output)', () => {
      const result = formatFortuneDate('2026-05-14');
      // 2026-05-14 is a Thursday → 週四
      expect(result.dateLine).toBe('2026年5月14日週四');
      expect(result.short).toBe('5/14');
    });

    it('returns iso string unchanged on malformed input', () => {
      expect(formatFortuneDate('bogus').dateLine).toBe('bogus');
    });

    it('handles month/day without leading zeros in short form', () => {
      const result = formatFortuneDate('2026-01-05');
      expect(result.short).toBe('1/5');
    });
  });

  describe('friendlyExplanationFromLabel', () => {
    it('returns warm advisor copy for known labels', () => {
      expect(friendlyExplanationFromLabel('大吉')).toContain('能量充沛');
      expect(friendlyExplanationFromLabel('凶中有吉')).toContain('有挑戰');
      // Fixed copy per Round-2 N9 / #5 Nit — uses 「整體傾向順遂」 not 「整體偏好」
      expect(friendlyExplanationFromLabel('吉中有凶')).toBe(
        '整體傾向順遂，但留意潛在波動',
      );
    });

    it('falls back to a safe default for unknown labels', () => {
      expect(friendlyExplanationFromLabel('未知')).toBe('今日宜以平常心面對');
    });
  });

  describe('ringTierFromLabel (R1.3 — 2-tier simplification)', () => {
    it('returns positive for 大吉 / 吉', () => {
      expect(ringTierFromLabel('大吉')).toBe('positive');
      expect(ringTierFromLabel('吉')).toBe('positive');
    });
    it('returns default for everything else', () => {
      expect(ringTierFromLabel('吉中有凶')).toBe('default');
      expect(ringTierFromLabel('平')).toBe('default');
      expect(ringTierFromLabel('凶中有吉')).toBe('default');
      expect(ringTierFromLabel('小凶')).toBe('default');
      expect(ringTierFromLabel('凶')).toBe('default');
      expect(ringTierFromLabel('大凶')).toBe('default');
      expect(ringTierFromLabel('凶上加凶')).toBe('default');
    });
  });

  describe('dimTierFromScore (S2.F per-dim chip) — aligned to 65/50 label bands', () => {
    it('returns good for ≥65 (順遂/極佳)', () => {
      expect(dimTierFromScore(65)).toBe('good');
      expect(dimTierFromScore(75)).toBe('good');
      expect(dimTierFromScore(100)).toBe('good');
    });
    it('returns mid for 50-64 (平穩) — incl. the 60-64 band the baseline now hits', () => {
      expect(dimTierFromScore(50)).toBe('mid');
      expect(dimTierFromScore(60)).toBe('mid');
      expect(dimTierFromScore(64)).toBe('mid');
    });
    it('returns low for <50 (需謹慎/不利)', () => {
      expect(dimTierFromScore(0)).toBe('low');
      expect(dimTierFromScore(35)).toBe('low');
      expect(dimTierFromScore(49)).toBe('low');
    });
  });
});
