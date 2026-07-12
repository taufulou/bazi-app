import {
  getDynamicSectionTitle,
  transformAIResponse,
  parseReadingFrame,
  normalizeAnnualDeterministic,
  normalizeLoveDeterministic,
  V2_SECTION_ORDER,
  type NestJSReadingResponse,
} from '../readings-api';

describe('getDynamicSectionTitle', () => {
  it('career annual / monthly forecasts', () => {
    expect(getDynamicSectionTitle('annual_forecast_2026')).toBe('2026 年度事業運勢');
    expect(getDynamicSectionTitle('monthly_forecast_3')).toBe('3月運勢');
    expect(getDynamicSectionTitle('monthly_forecast_11')).toBe('11月運勢');
  });
  it('love annual / monthly forecasts', () => {
    expect(getDynamicSectionTitle('annual_love_2027')).toBe('2027 年度感情運勢');
    expect(getDynamicSectionTitle('monthly_love_5')).toBe('5月感情運勢');
  });
  it('annual V2 monthly (zero-padded → 中文)', () => {
    expect(getDynamicSectionTitle('monthly_01')).toBe('一月運程');
    expect(getDynamicSectionTitle('monthly_12')).toBe('十二月運程');
    expect(getDynamicSectionTitle('monthly_13')).toBeNull();
  });
  it('returns null for non-dynamic keys', () => {
    expect(getDynamicSectionTitle('chart_identity')).toBeNull();
    expect(getDynamicSectionTitle('foo')).toBeNull();
  });
});

function sec(preview: string, full: string, score?: number) {
  return score === undefined ? { preview, full } : { preview, full, score };
}

describe('transformAIResponse', () => {
  it('returns null when ai is null / has no sections', () => {
    expect(transformAIResponse(null)).toBeNull();
    expect(transformAIResponse({ sections: undefined as never })).toBeNull();
  });

  it('orders lifetime V2 by V2_SECTION_ORDER, appends unknown keys last', () => {
    const ai: NestJSReadingResponse['aiInterpretation'] = {
      schemaVersion: 'v2',
      sections: {
        // deliberately scrambled + one unknown key
        best_period: sec('bp', 'BP'),
        chart_identity: sec('ci', 'CI'),
        mystery_key: sec('mk', 'MK'),
        finance_pattern: sec('fp', 'FP'),
      },
    };
    const out = transformAIResponse(ai)!;
    const keys = out.sections.map((s) => s.key);
    // chart_identity < finance_pattern < best_period (per order), mystery last
    expect(keys.indexOf('chart_identity')).toBeLessThan(keys.indexOf('finance_pattern'));
    expect(keys.indexOf('finance_pattern')).toBeLessThan(keys.indexOf('best_period'));
    expect(keys[keys.length - 1]).toBe('mystery_key');
    expect(out.isV2).toBe(true);
    // titles resolved from SECTION_TITLE_MAP
    expect(out.sections.find((s) => s.key === 'chart_identity')!.title).toBe('先天命格解讀');
  });

  it('career V2 appends annual then monthly forecasts sorted', () => {
    const ai: NestJSReadingResponse['aiInterpretation'] = {
      schemaVersion: 'v2',
      sections: {
        suitable_positions: sec('sp', 'SP'),
        career_pattern: sec('cp', 'CP'),
        monthly_forecast_2: sec('m2', 'M2'),
        monthly_forecast_1: sec('m1', 'M1'),
        annual_forecast_2027: sec('a27', 'A27'),
        annual_forecast_2026: sec('a26', 'A26'),
      },
    };
    const keys = transformAIResponse(ai)!.sections.map((s) => s.key);
    // static first (career_pattern before suitable_positions per order)
    expect(keys.indexOf('career_pattern')).toBeLessThan(keys.indexOf('suitable_positions'));
    // then annuals sorted, then monthlies sorted — all AFTER the static block
    expect(keys.indexOf('annual_forecast_2026')).toBeLessThan(keys.indexOf('annual_forecast_2027'));
    expect(keys.indexOf('annual_forecast_2027')).toBeLessThan(keys.indexOf('monthly_forecast_1'));
    expect(keys.indexOf('monthly_forecast_1')).toBeLessThan(keys.indexOf('monthly_forecast_2'));
  });

  it('V1 (no schemaVersion) preserves insertion order + maps titles', () => {
    const ai: NestJSReadingResponse['aiInterpretation'] = {
      sections: {
        personality: sec('p', 'P'),
        career: sec('c', 'C'),
      },
    };
    const out = transformAIResponse(ai)!;
    expect(out.isV2).toBe(false);
    expect(out.sections.map((s) => s.key)).toEqual(['personality', 'career']);
    expect(out.sections[0]!.title).toBe('命格性格分析');
  });

  it('V2_SECTION_ORDER is the lifetime order (sanity)', () => {
    expect(V2_SECTION_ORDER[0]).toBe('chart_identity');
  });
});

describe('parseReadingFrame (SSE event:+data:)', () => {
  it('parses a section_complete frame', () => {
    const f = parseReadingFrame('event: section_complete\ndata: {"key":"chart_identity","preview":"p","full":"F"}');
    expect(f).toEqual({ event: 'section_complete', data: { key: 'chart_identity', preview: 'p', full: 'F' } });
  });
  it('parses a final frame', () => {
    const f = parseReadingFrame('event: final\ndata: {"status":"success","totalSections":15}');
    expect(f!.event).toBe('final');
    expect(f!.data.status).toBe('success');
  });
  it('drops heartbeat + comment frames', () => {
    expect(parseReadingFrame('event: heartbeat\ndata: {}')).toBeNull();
    expect(parseReadingFrame(': keep-alive comment')).toBeNull();
  });
  it('drops malformed JSON', () => {
    expect(parseReadingFrame('event: error\ndata: {not json')).toBeNull();
  });
  it('handles data: with no leading space + multi-line data (joined with \\n)', () => {
    // Two data: lines are joined with '\n' → valid JSON reconstructed.
    const f = parseReadingFrame('event: summary\ndata:{"preview":"a",\ndata: "full":"b"}');
    expect(f?.event).toBe('summary');
    expect(f?.data).toEqual({ preview: 'a', full: 'b' });
  });
  it('defaults event type to "message" when no event: line', () => {
    const f = parseReadingFrame('data: {"x":1}');
    expect(f).toEqual({ event: 'message', data: { x: 1 } });
  });
});

describe('normalizeAnnualDeterministic', () => {
  it('deep camelCases snake_case keys, detects annual shape', () => {
    const raw = {
      flow_year: { stem: '丙', branch: '午', year: 2026 },
      tai_sui: { has_tai_sui: false },
      monthly_forecasts: [{ month_index: 1, is_kong_wang: true }],
    };
    const out = normalizeAnnualDeterministic(raw) as unknown as Record<string, unknown>;
    expect(out).not.toBeNull();
    expect(out.flowYear).toEqual({ stem: '丙', branch: '午', year: 2026 });
    expect((out.taiSui as Record<string, unknown>).hasTaiSui).toBe(false);
    expect((out.monthlyForecasts as Array<Record<string, unknown>>)[0]!.isKongWang).toBe(true);
  });
  it('returns null for non-annual data', () => {
    expect(normalizeAnnualDeterministic({ foo: 1 })).toBeNull();
    expect(normalizeAnnualDeterministic(undefined)).toBeNull();
  });
});

describe('normalizeLoveDeterministic', () => {
  it('detects spouse_star / peach_blossoms + camelCases', () => {
    const out = normalizeLoveDeterministic({ spouse_star: { star: '正官' } }) as unknown as Record<string, unknown>;
    expect((out.spouseStar as Record<string, unknown>).star).toBe('正官');
  });
  it('returns null for non-love data', () => {
    expect(normalizeLoveDeterministic({ foo: 1 })).toBeNull();
  });
});
