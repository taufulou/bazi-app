import { parseSseDataFrame } from '../stream';

// parseSseDataFrame is the pure SSE-frame → typed-event parser at the heart of
// the streaming seam (mirrors web dispatchFortuneFrame). The expo/fetch reader
// loop itself was verified on-device in the M2.1 spike; here we lock the parser.

describe('parseSseDataFrame', () => {
  it('parses a single "data: {json}" line', () => {
    expect(parseSseDataFrame('data: {"type":"done","cacheHit":true}')).toEqual({
      type: 'done',
      cacheHit: true,
    });
  });

  it('accepts "data:" with no space after the colon', () => {
    expect(parseSseDataFrame('data:{"type":"engine_ready"}')).toEqual({ type: 'engine_ready' });
  });

  it('joins multi-line data payloads (SSE spec: concatenated with \\n)', () => {
    const frame = 'data: {"type":"section_complete",\ndata: "key":"daily_romance"}';
    expect(parseSseDataFrame(frame)).toEqual({ type: 'section_complete', key: 'daily_romance' });
  });

  it('ignores non-data lines (event:, id:, comments)', () => {
    const frame = 'event: message\nid: 42\ndata: {"type":"done"}';
    expect(parseSseDataFrame(frame)).toEqual({ type: 'done' });
  });

  it('returns null for a frame with no data line', () => {
    expect(parseSseDataFrame('event: ping')).toBeNull();
    expect(parseSseDataFrame('')).toBeNull();
  });

  it('returns null (drops silently) for malformed JSON', () => {
    expect(parseSseDataFrame('data: {not valid json')).toBeNull();
  });
});
