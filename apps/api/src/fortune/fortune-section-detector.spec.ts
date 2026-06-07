/**
 * Tests for the section-by-section streaming detector.
 *
 * Covers the edge cases the v1 plan review flagged that a custom JSON state
 * machine would have to re-solve (BOM, escapes, partial-escape across chunks,
 * numeric values, markdown fence preamble, out-of-order arrival, post-root
 * trailing remarks). Plan v2 switches to clarinet so most of these are
 * handled "for free" — these tests lock that contract.
 */
import { createSectionDetector } from './fortune-section-detector';

type Emit = { key: string; value: unknown };

const collect = (input: string | string[]) => {
  const emits: Emit[] = [];
  const detector = createSectionDetector((key, value) => {
    emits.push({ key, value });
  });
  const chunks = Array.isArray(input) ? input : [input];
  for (const chunk of chunks) detector.write(chunk);
  detector.close();
  return emits;
};

describe('createSectionDetector', () => {
  describe('basic emission', () => {
    it('emits a single section when full JSON arrives in one chunk', () => {
      const emits = collect('{"sections":{"daily_overview":"今日整體平穩"}}');
      expect(emits).toEqual([{ key: 'daily_overview', value: '今日整體平穩' }]);
    });

    it('emits two sections in arrival order', () => {
      const emits = collect(
        '{"sections":{"daily_overview":"今日整體","daily_romance":"感情敘述"}}',
      );
      expect(emits).toEqual([
        { key: 'daily_overview', value: '今日整體' },
        { key: 'daily_romance', value: '感情敘述' },
      ]);
    });

    it('emits all 7 canonical sections when prose values arrive intact', () => {
      const json = JSON.stringify({
        sections: {
          daily_overview: 'A',
          daily_romance: 'B',
          daily_career: 'C',
          daily_finance: 'D',
          daily_travel: 'E',
          daily_health: 'F',
          daily_advice: { canTry: ['x'], shouldHold: ['y'] },
        },
      });
      const emits = collect(json);
      expect(emits.map((e) => e.key)).toEqual([
        'daily_overview',
        'daily_romance',
        'daily_career',
        'daily_finance',
        'daily_travel',
        'daily_health',
        'daily_advice',
      ]);
      expect(emits[6].value).toEqual({ canTry: ['x'], shouldHold: ['y'] });
    });
  });

  describe('chunk boundaries', () => {
    it('emits two sections when JSON is split across 5 chunks', () => {
      const full = '{"sections":{"daily_overview":"今日整體","daily_romance":"感情敘述"}}';
      // arbitrary split into 5 chunks
      const splits = [10, 25, 40, 55];
      const chunks = [
        full.slice(0, splits[0]),
        full.slice(splits[0], splits[1]),
        full.slice(splits[1], splits[2]),
        full.slice(splits[2], splits[3]),
        full.slice(splits[3]),
      ];
      const emits = collect(chunks);
      expect(emits).toEqual([
        { key: 'daily_overview', value: '今日整體' },
        { key: 'daily_romance', value: '感情敘述' },
      ]);
    });

    it('handles a chunk boundary mid-string-value', () => {
      // boundary inside `"daily_overview":"...|hi..."` — clarinet must buffer
      const emits = collect([
        '{"sections":{"daily_overview":"hello ',
        'world","daily_romance":"x"}}',
      ]);
      expect(emits).toEqual([
        { key: 'daily_overview', value: 'hello world' },
        { key: 'daily_romance', value: 'x' },
      ]);
    });

    it('emits compound value when chunks split it across boundaries', () => {
      // daily_advice object split arbitrarily
      const full =
        '{"sections":{"daily_advice":{"canTry":["a","b","c"],"shouldHold":["d"]}}}';
      const chunks = [full.slice(0, 30), full.slice(30, 55), full.slice(55)];
      const emits = collect(chunks);
      expect(emits).toEqual([
        {
          key: 'daily_advice',
          value: { canTry: ['a', 'b', 'c'], shouldHold: ['d'] },
        },
      ]);
    });

    it('handles empty chunks without crashing', () => {
      const emits = collect(['', '{"sections":{"a":"1"', '', ',"b":"2"}}', '']);
      expect(emits).toEqual([
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
      ]);
    });
  });

  describe('JSON string escapes', () => {
    it('preserves escaped quotes inside values', () => {
      const emits = collect(
        '{"sections":{"daily_overview":"He said \\"hi\\" to me"}}',
      );
      expect(emits).toEqual([
        { key: 'daily_overview', value: 'He said "hi" to me' },
      ]);
    });

    it('preserves escaped backslashes', () => {
      const emits = collect('{"sections":{"daily_overview":"path\\\\to\\\\file"}}');
      expect(emits).toEqual([
        { key: 'daily_overview', value: 'path\\to\\file' },
      ]);
    });

    it('handles unicode escape split across chunks', () => {
      // 今 = 今. Split inside the escape sequence.
      const emits = collect(['{"sections":{"daily_overview":"\\u4e', 'ca日"}}']);
      expect(emits).toEqual([
        { key: 'daily_overview', value: '今日' },
      ]);
    });

    it('handles partial-escape across chunk boundary (backslash + quote split)', () => {
      // chunk1 ends with `\`, chunk2 begins with `"foo` — clarinet's slashed
      // state must survive the boundary
      const emits = collect([
        '{"sections":{"daily_overview":"abc\\',
        '"def"}}',
      ]);
      expect(emits).toEqual([
        { key: 'daily_overview', value: 'abc"def' },
      ]);
    });

    it('preserves markdown bold inside section value', () => {
      const emits = collect(
        '{"sections":{"daily_career":"今日宜 **創意表達** 避免硬碰硬"}}',
      );
      expect(emits).toEqual([
        { key: 'daily_career', value: '今日宜 **創意表達** 避免硬碰硬' },
      ]);
    });
  });

  describe('out-of-order arrival', () => {
    it('emits sections in arrival order regardless of canonical declaration order', () => {
      // AI could (in principle) emit sections in any key order; the detector
      // emits them as it sees them — the frontend re-orders to canonical.
      const emits = collect(
        '{"sections":{"daily_health":"H","daily_overview":"O","daily_romance":"R"}}',
      );
      expect(emits.map((e) => e.key)).toEqual([
        'daily_health',
        'daily_overview',
        'daily_romance',
      ]);
    });
  });

  describe('preamble + trailing tolerance', () => {
    it('strips ```json``` markdown fence wrapper before the first {', () => {
      const emits = collect('```json\n{"sections":{"daily_overview":"X"}}\n```');
      // The trailing ``` falls after the root `}` — detector ignores it via
      // rootClosed swallowing. The opening fence is stripped via preBuffer.
      expect(emits).toEqual([{ key: 'daily_overview', value: 'X' }]);
    });

    it('strips ``` (no language tag) markdown fence wrapper', () => {
      const emits = collect('```\n{"sections":{"daily_overview":"X"}}\n```');
      expect(emits).toEqual([{ key: 'daily_overview', value: 'X' }]);
    });

    it('strips markdown fence split across chunks', () => {
      const emits = collect([
        '```js',
        'on\n{"sections":{"daily_overview":"X"}}\n``',
        '`',
      ]);
      expect(emits).toEqual([{ key: 'daily_overview', value: 'X' }]);
    });

    it('strips arbitrary preamble text before the first {', () => {
      const emits = collect(
        '這是您的命盤：{"sections":{"daily_overview":"X"}}',
      );
      expect(emits).toEqual([{ key: 'daily_overview', value: 'X' }]);
    });

    it('ignores trailing AI remark after root close', () => {
      const emits = collect(
        '{"sections":{"daily_overview":"X"}} 希望對您有幫助',
      );
      expect(emits).toEqual([{ key: 'daily_overview', value: 'X' }]);
    });

    it('strips UTF-8 BOM before the first {', () => {
      const emits = collect('﻿{"sections":{"daily_overview":"X"}}');
      expect(emits).toEqual([{ key: 'daily_overview', value: 'X' }]);
    });
  });

  describe('value types', () => {
    it('only emits sections-level — does NOT emit nested object keys', () => {
      // daily_advice's `canTry` should NOT be emitted as a section
      const emits = collect(
        '{"sections":{"daily_advice":{"canTry":["x"],"shouldHold":["y"]}}}',
      );
      expect(emits.length).toBe(1);
      expect(emits[0].key).toBe('daily_advice');
      // canTry/shouldHold are sub-fields, NOT emitted as standalone sections
      expect(emits.map((e) => e.key)).not.toContain('canTry');
      expect(emits.map((e) => e.key)).not.toContain('shouldHold');
    });

    it('handles primitive scalar section values (number/null/bool — defensive)', () => {
      // The AI prompt requires strings, but the detector must not crash on
      // unexpected primitive types
      const emits = collect(
        '{"sections":{"score":42,"flag":true,"x":null}}',
      );
      expect(emits).toEqual([
        { key: 'score', value: 42 },
        { key: 'flag', value: true },
        { key: 'x', value: null },
      ]);
    });
  });

  describe('malformed input', () => {
    it('stops emitting after JSON syntax error mid-stream but preserves prior emits', () => {
      const emits = collect(
        '{"sections":{"daily_overview":"X",garbage,"daily_romance":"Y"}}',
      );
      // daily_overview must have been emitted before the parser errors out
      expect(emits[0]).toEqual({ key: 'daily_overview', value: 'X' });
      // daily_romance MAY or may not emit — but no crash
    });

    it('empty input does not crash', () => {
      expect(() => collect('')).not.toThrow();
      expect(collect('')).toEqual([]);
    });

    it('only-preamble input (no JSON ever arrives) does not crash', () => {
      expect(() => collect('這是一段純文字回應，沒有JSON。')).not.toThrow();
      expect(collect('這是一段純文字回應，沒有JSON。')).toEqual([]);
    });
  });

  describe('post-close safety', () => {
    it('write() after close() is a no-op', () => {
      const emits: Emit[] = [];
      const detector = createSectionDetector((key, value) => {
        emits.push({ key, value });
      });
      detector.write('{"sections":{"a":"1"}}');
      detector.close();
      detector.write('{"sections":{"b":"2"}}'); // ignored
      expect(emits).toEqual([{ key: 'a', value: '1' }]);
    });

    it('double-close is a no-op', () => {
      const detector = createSectionDetector(() => {});
      detector.write('{"sections":{"a":"1"}}');
      expect(() => {
        detector.close();
        detector.close();
      }).not.toThrow();
    });
  });

  // ============================================================
  // Phase 2.x M3 / NEW-M3 — monthly compound-section chunk boundary
  // ============================================================
  // Mirror Phase 2.x plan v3 NEW-M3 regression: monthly narrative emits
  // sections with mixed shapes (string for prose, object for monthly_advice,
  // array for intra_month_breakdown). Compound-section chunk boundaries
  // are the highest-risk regression class — a future clarinet upgrade or
  // refactor could silently double-emit on close-brace / close-bracket.
  describe('Phase 2.x M3 — monthly compound section chunk boundaries', () => {
    const fullMonthlyJson =
      '{"sections":{"monthly_overview":"本月癸巳月，整體平穩",' +
      '"monthly_advice":{"canTry":["積極推進","適合出行"],"shouldHold":["大筆投資","重要決策"]},' +
      '"intra_month_breakdown":[' +
      '{"partition_label":"上半月","narrative":"天干主導，9吉5挑戰"},' +
      '{"partition_label":"下半月","narrative":"地支主導，11吉3挑戰"}' +
      ']}}';

    it('happy path — emits all 3 monthly sections in declaration order with correct value shapes', () => {
      const emits = collect(fullMonthlyJson);
      expect(emits.length).toBe(3);
      // monthly_overview → string
      expect(emits[0]).toEqual({
        key: 'monthly_overview',
        value: '本月癸巳月，整體平穩',
      });
      // monthly_advice → object (compound)
      expect(emits[1].key).toBe('monthly_advice');
      expect(emits[1].value).toEqual({
        canTry: ['積極推進', '適合出行'],
        shouldHold: ['大筆投資', '重要決策'],
      });
      // intra_month_breakdown → array (compound)
      expect(emits[2].key).toBe('intra_month_breakdown');
      expect(Array.isArray(emits[2].value)).toBe(true);
      expect((emits[2].value as unknown[]).length).toBe(2);
    });

    it('array chunk boundary — intra_month_breakdown split mid-array emits ONCE at final close-bracket', () => {
      // chunk1 ends mid-array (after first object), chunk2 completes array
      const chunk1 =
        '{"sections":{"intra_month_breakdown":[' +
        '{"partition_label":"上半月","narrative":"天干主導"},';
      const chunk2 =
        '{"partition_label":"下半月","narrative":"地支主導"}' +
        ']}}';
      const emits = collect([chunk1, chunk2]);
      // EXACTLY ONE emission for intra_month_breakdown (NOT two)
      const breakdownEmits = emits.filter(
        (e) => e.key === 'intra_month_breakdown',
      );
      expect(breakdownEmits.length).toBe(1);
      expect(Array.isArray(breakdownEmits[0].value)).toBe(true);
      expect((breakdownEmits[0].value as unknown[]).length).toBe(2);
    });

    it('NEW-M3 object-close chunk boundary — monthly_advice close-brace lands on chunk1, intra_month_breakdown on chunk2', () => {
      // chunk1 ends right after monthly_advice's closing brace (the critical
      // boundary clarinet must not lose track of). chunk2 begins with the
      // next section key. Both sections MUST emit exactly once.
      const chunk1 =
        '{"sections":{' +
        '"monthly_advice":{"canTry":["積極推進"],"shouldHold":["大筆投資"]}';
      const chunk2 =
        ',"intra_month_breakdown":[{"partition_label":"上半月","narrative":"x"}]' +
        '}}';
      const emits = collect([chunk1, chunk2]);
      // EXACTLY ONE emission for each
      const adviceEmits = emits.filter((e) => e.key === 'monthly_advice');
      const breakdownEmits = emits.filter(
        (e) => e.key === 'intra_month_breakdown',
      );
      expect(adviceEmits.length).toBe(1);
      expect(breakdownEmits.length).toBe(1);
      expect(adviceEmits[0].value).toEqual({
        canTry: ['積極推進'],
        shouldHold: ['大筆投資'],
      });
      expect(Array.isArray(breakdownEmits[0].value)).toBe(true);
    });

    it('stream-end mid-array → emits whatever completed before close, no partial array double-emit', () => {
      // Truncated mid-array: only first element completes, second is partial
      const truncated =
        '{"sections":{"monthly_overview":"本月癸巳月",' +
        '"intra_month_breakdown":[{"partition_label":"上半月","narrative":"x"}';
      const emits = collect(truncated);
      // monthly_overview completed → emits
      const overviewEmits = emits.filter((e) => e.key === 'monthly_overview');
      expect(overviewEmits.length).toBe(1);
      // intra_month_breakdown array NEVER closed → must NOT emit
      const breakdownEmits = emits.filter(
        (e) => e.key === 'intra_month_breakdown',
      );
      expect(breakdownEmits.length).toBe(0);
    });
  });
});
