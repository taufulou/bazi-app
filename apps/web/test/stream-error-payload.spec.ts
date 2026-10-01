/** @jest-environment node */
import { streamBaziReading } from '../app/lib/readings-api';

/**
 * The web side of the SSE `error` wire contract (PR #73 review fix A).
 *
 * `_setupStream` step 2b REFUNDS a charged-empty row of a type it cannot stream
 * and `streamReading` forwards `{message, code, refunded, refundedAmount}` in
 * the `error` event. `recoverPaidReading`'s `onError` branches on `refunded`
 * to show the refund banner — so `streamBaziReading` must hand the parsed
 * event through UNTOUCHED. A "tidy" `{ message: data.message }` here would
 * silently drop the receipt and the user would see a stopped spinner instead
 * of their credits coming back.
 *
 * Runs under `node`, not the config's `jsdom`: `streamBaziReading` calls
 * `new TextDecoder()`, which jsdom does not provide, and touches no DOM.
 */

function sseResponse(frames: string[]) {
  const encoder = new TextEncoder();
  const chunks = frames.map((f) => encoder.encode(f));
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
      }),
    },
  };
}

describe('streamBaziReading — the error event reaches onError with its typed fields intact', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function run(frames: string[]) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      global.fetch = jest.fn().mockResolvedValue(sseResponse(frames)) as unknown as typeof fetch;
      streamBaziReading('token', 'reading-1', {
        onSectionComplete: () => reject(new Error('unexpected section')),
        onSummary: () => reject(new Error('unexpected summary')),
        onError: (err) => resolve(err as unknown as Record<string, unknown>),
        onCallComplete: () => {},
      });
    });
  }

  it('forwards message, code, refunded and refundedAmount exactly as sent', async () => {
    const payload = await run([
      'event: error\ndata: {"message":"此類型分析已停止提供，無法生成，點數已退回。","code":"READING_TYPE_NOT_STREAMABLE","refunded":true,"refundedAmount":2}\n\n',
    ]);
    expect(payload).toEqual({
      message: '此類型分析已停止提供，無法生成，點數已退回。',
      code: 'READING_TYPE_NOT_STREAMABLE',
      refunded: true,
      refundedAmount: 2,
    });
  });

  it('forwards a message-only error unchanged — no fields are invented', async () => {
    const payload = await run(['event: error\ndata: {"message":"boom"}\n\n']);
    expect(payload).toEqual({ message: 'boom' });
  });

  it('reassembles a frame split across two chunks before dispatching it', async () => {
    // The `error` frame is the LAST thing the server sends, so a chunk boundary
    // inside it is the common case, not the edge case.
    const payload = await run([
      'event: error\ndata: {"message":"m","code":"READING_TYPE_NOT_STREAMABLE",',
      '"refunded":true,"refundedAmount":2}\n\n',
    ]);
    expect(payload).toEqual({
      message: 'm',
      code: 'READING_TYPE_NOT_STREAMABLE',
      refunded: true,
      refundedAmount: 2,
    });
  });
});
