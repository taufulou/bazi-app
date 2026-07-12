/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
// Chunk-boundary coverage for openSseStream's buffer-accumulation loop (the part
// device-verified in the M2.1 spike but not otherwise unit-tested). Mocks
// expo/fetch's reader to feed controlled chunk splits.
import { openSseStream } from '../stream';
import { fetch as expoFetch } from 'expo/fetch';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../api', () => ({ notifyUnauthorized: jest.fn() }));

/** Fake Response whose body.getReader() yields the given string chunks in order. */
function mockResponse(chunks: string[]) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { value: enc.encode(chunks[i++]), done: false }
            : { value: undefined, done: true },
      }),
    },
  };
}

function collect(chunks: string[]): Promise<Array<{ type: string; key?: string }>> {
  (expoFetch as unknown as jest.Mock).mockResolvedValue(mockResponse(chunks));
  const events: Array<{ type: string; key?: string }> = [];
  return new Promise((resolve) => {
    openSseStream<{ type: string; key?: string }>({
      url: 'http://x/stream',
      token: 't',
      onEvent: (e) => events.push(e),
      onError: () => {},
      onClose: () => resolve(events),
    });
  });
}

describe('openSseStream — chunk-boundary reassembly', () => {
  it('reassembles a frame split across two chunks', async () => {
    const events = await collect(['data: {"type":"engine', '_ready"}\n\n']);
    expect(events).toEqual([{ type: 'engine_ready' }]);
  });

  it('dispatches multiple frames delivered in one chunk', async () => {
    const events = await collect([
      'data: {"type":"section_complete","key":"daily_romance"}\n\ndata: {"type":"done"}\n\n',
    ]);
    expect(events).toEqual([{ type: 'section_complete', key: 'daily_romance' }, { type: 'done' }]);
  });

  it('flushes a trailing partial frame (no final \\n\\n) at stream end', async () => {
    const events = await collect(['data: {"type":"engine_ready"}\n\n', 'data: {"type":"done"}']);
    expect(events.map((e) => e.type)).toEqual(['engine_ready', 'done']);
  });

  it('handles the split falling exactly on the \\n\\n boundary', async () => {
    const events = await collect(['data: {"type":"engine_ready"}\n', '\ndata: {"type":"done"}\n\n']);
    expect(events.map((e) => e.type)).toEqual(['engine_ready', 'done']);
  });
});
