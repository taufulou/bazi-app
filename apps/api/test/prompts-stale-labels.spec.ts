/**
 * Phase 5 (PR #44 follow-up Issue 2) — stale-label drift gate for LOVE V2
 * prompts.
 *
 * Rationale: the LOVE narration AI is shown an enumeration of valid 桃花類型
 * labels. If that enumeration contains labels the engine NEVER emits, the
 * AI may echo a non-existent label, breaking anti-hallucination. PR #42
 * Phase 12g.7 Issue 1 fixed one such typo in `love_enhanced.py` but missed
 * the equivalent in `prompts.ts`. This regex sweep catches the current
 * instance plus any future drift.
 *
 * Source of truth for valid labels:
 *   - lifetime_enhanced.py:_compute_romance_candidates → `chong_label`
 *   - love_enhanced.py:PROTECTED_HIGH_PRIORITY tuple (love_enhanced.py:1817)
 *
 * Engine emits: 正緣動年, 偏緣動年, 婚動年, 喜事動年, 紅鸞年, 天喜年,
 *               紅鸞正緣年, 合婚年, 正緣桃花年, 偏財桃花年, 偏官桃花年
 *
 * Engine does NOT emit: 偏緣年 (typo for 偏緣動年), 正緣年 (typo for 正緣動年),
 *                       紅鸞動年 (no such label — 紅鸞年 is correct)
 */
import { LOVE_V2_PROMPTS, LOVE_V2_STYLE_RULES } from '../src/ai/prompts';

describe('LOVE V2 prompts — stale label drift gate (Phase 5 Issue 2)', () => {
  const combined = `${LOVE_V2_STYLE_RULES}\n${JSON.stringify(LOVE_V2_PROMPTS)}`;

  it('does not reference 偏緣年 (engine emits 偏緣動年 only)', () => {
    // 偏緣年 has no legitimate compound form. Engine emits 偏緣動年 (the
    // intermediate 動 means «偏緣年» is never present as a substring in any
    // valid label). Simple substring check suffices.
    expect(combined).not.toMatch(/偏緣年/);
  });

  it('does not reference standalone 正緣年 (only legitimate compound is 紅鸞正緣年)', () => {
    // The engine emits 正緣動年 (standalone) and 紅鸞正緣年 (compound).
    // The literal substring «正緣年» appears legitimately inside «紅鸞正緣年»
    // (positions 2-4). Use negative lookbehind to exclude that compound;
    // any other occurrence of «正緣年» is a stale-label typo.
    expect(combined).not.toMatch(/(?<!紅鸞)正緣年/);
  });

  it('does not reference 紅鸞動年 (engine emits 紅鸞年 only)', () => {
    expect(combined).not.toMatch(/紅鸞動年/);
  });

  // Belt-and-suspenders: the canonical 桃花類型 enumeration in
  // LOVE_V2_STYLE_RULES MUST still contain valid engine-emitted labels.
  // If a future edit accidentally drops one, this catches it.
  //
  // Note: 偏緣動年 IS a valid engine emission (love_enhanced.py:1817
  // PROTECTED_HIGH_PRIORITY tuple) but is NOT currently in the LOVE V2
  // prompt enumeration — a separate gap, NOT in scope for Issue 2.
  // This test guards only the labels actually present in the prompt list.
  it('positive — still contains canonical valid labels (正緣動年, 紅鸞年, 紅鸞正緣年, 婚動年)', () => {
    expect(combined).toContain('正緣動年');
    expect(combined).toContain('紅鸞年');
    expect(combined).toContain('紅鸞正緣年');
    expect(combined).toContain('婚動年');
  });
});
