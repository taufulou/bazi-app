import {
  formatFortuneDate,
  friendlyExplanationFromLabel,
  ringTierFromLabel,
  dimTierFromScore,
} from '../labels';
import { parseBoldSegments } from '../markdown';

describe('labels', () => {
  it('formatFortuneDate formats YYYY-MM-DD with a zh-TW weekday', () => {
    const { dateLine, short } = formatFortuneDate('2026-05-17');
    // Node Intl zh-TW → «2026年5月17日 週日» (2026-05-17 is a Sunday). Assert the
    // stable parts; the weekday glyph is locale-data-dependent.
    expect(dateLine).toContain('2026年5月17日');
    expect(short).toBe('5/17');
  });

  it('formatFortuneDate falls back to the ISO string on malformed input', () => {
    expect(formatFortuneDate('not-a-date').dateLine).toBe('not-a-date');
  });

  it('friendlyExplanationFromLabel covers labels + fallback', () => {
    expect(friendlyExplanationFromLabel('大吉')).toBe('整體能量充沛，是把握機會的好日子');
    expect(friendlyExplanationFromLabel('凶上加凶')).toBe('整體挑戰深重，建議內省休養');
    expect(friendlyExplanationFromLabel('???')).toBe('今日宜以平常心面對');
  });

  it('ringTierFromLabel is 2-tier (positive for 大吉/吉)', () => {
    expect(ringTierFromLabel('大吉')).toBe('positive');
    expect(ringTierFromLabel('吉')).toBe('positive');
    expect(ringTierFromLabel('吉中有凶')).toBe('default');
    expect(ringTierFromLabel('平')).toBe('default');
    expect(ringTierFromLabel('凶')).toBe('default');
  });

  it('dimTierFromScore aligns to the 5-band cutoffs (65 / 50)', () => {
    expect(dimTierFromScore(80)).toBe('good');
    expect(dimTierFromScore(65)).toBe('good');
    expect(dimTierFromScore(64)).toBe('mid');
    expect(dimTierFromScore(50)).toBe('mid');
    expect(dimTierFromScore(49)).toBe('low');
    expect(dimTierFromScore(0)).toBe('low');
  });
});

describe('markdown parseBoldSegments', () => {
  it('splits alternating text + bold segments', () => {
    expect(parseBoldSegments('hello **world**')).toEqual([
      { type: 'text', value: 'hello ' },
      { type: 'bold', value: 'world' },
    ]);
  });

  it('handles multiple bold spans', () => {
    expect(parseBoldSegments('a **b** c **d**')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'bold', value: 'b' },
      { type: 'text', value: ' c ' },
      { type: 'bold', value: 'd' },
    ]);
  });

  it('strips lone/mismatched ** markers defensively', () => {
    expect(parseBoldSegments('lone **marker')).toEqual([{ type: 'text', value: 'lone marker' }]);
  });

  it('does not match bold across a newline (regex . excludes \\n)', () => {
    // '**foo\nbar**' → no bold scope; lone markers stripped from the text segment.
    expect(parseBoldSegments('**foo\nbar**')).toEqual([{ type: 'text', value: 'foo\nbar' }]);
  });

  it('returns [] for empty input', () => {
    expect(parseBoldSegments('')).toEqual([]);
  });
});
