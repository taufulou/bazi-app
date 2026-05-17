/**
 * UX Sprint R1.3 + Round-2 N1 — parseBoldSegments tests covering:
 *   - balanced markers
 *   - mismatched lone-left / lone-right
 *   - empty input
 *   - multiple bold scopes in one string
 *   - N1 edge case: newline mid-bold (JS regex `.` does NOT match \n)
 *   - banned-phrase wrapped in bold (verifies content untouched by parser)
 *   - Chinese punctuation inside markers
 */
import { parseBoldSegments } from './markdown';

describe('parseBoldSegments', () => {
  it('handles empty input', () => {
    expect(parseBoldSegments('')).toEqual([]);
  });

  it('returns plain text segment when no markers present', () => {
    expect(parseBoldSegments('hello world')).toEqual([
      { type: 'text', value: 'hello world' },
    ]);
  });

  it('parses a single balanced bold scope', () => {
    expect(parseBoldSegments('hello **world**')).toEqual([
      { type: 'text', value: 'hello ' },
      { type: 'bold', value: 'world' },
    ]);
  });

  it('parses multiple bold scopes interleaved with text', () => {
    expect(parseBoldSegments('a **b** c **d** e')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'bold', value: 'b' },
      { type: 'text', value: ' c ' },
      { type: 'bold', value: 'd' },
      { type: 'text', value: ' e' },
    ]);
  });

  it('strips lone left marker (mismatched)', () => {
    // Lone ** with no closing pair — defensively stripped from text segments
    expect(parseBoldSegments('lone **marker here')).toEqual([
      { type: 'text', value: 'lone marker here' },
    ]);
  });

  it('strips lone right marker (mismatched)', () => {
    expect(parseBoldSegments('text** trailing')).toEqual([
      { type: 'text', value: 'text trailing' },
    ]);
  });

  it('N1 — newline mid-bold: regex does not match across \\n, lone markers stripped', () => {
    // `**foo\nbar**` — the regex `.+?` does not match \n by default in JS,
    // so the bold scope is silently lost; lone markers are stripped defensively.
    // Documents expected behavior; if AI ever emits this, takeaway gracefully degrades.
    expect(parseBoldSegments('**foo\nbar**')).toEqual([
      { type: 'text', value: 'foo\nbar' },
    ]);
  });

  it('preserves Chinese punctuation inside markers', () => {
    expect(parseBoldSegments('傷官見官有益**沖配偶宮（子午沖）**')).toEqual([
      { type: 'text', value: '傷官見官有益' },
      { type: 'bold', value: '沖配偶宮（子午沖）' },
    ]);
  });

  it('preserves banned-phrase-like content (validator handles separately)', () => {
    // Parser does not interpret content; it just splits on markers.
    // Banned-phrase replacement is the validator's job (server-side).
    expect(parseBoldSegments('**一定發生**')).toEqual([
      { type: 'bold', value: '一定發生' },
    ]);
  });

  it('handles back-to-back bold scopes', () => {
    expect(parseBoldSegments('**a****b**')).toEqual([
      { type: 'bold', value: 'a' },
      { type: 'bold', value: 'b' },
    ]);
  });

  it('regex state resets between calls (no /g flag leak)', () => {
    // Important — the BOLD_RE is module-level with /g flag; lastIndex must
    // reset on every call. Repeated invocations on different strings should
    // not be affected by prior calls' state.
    parseBoldSegments('first **bold** call');
    expect(parseBoldSegments('second **bold** call')).toEqual([
      { type: 'text', value: 'second ' },
      { type: 'bold', value: 'bold' },
      { type: 'text', value: ' call' },
    ]);
  });
});
