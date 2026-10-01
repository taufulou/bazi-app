import { readFileSync } from 'fs';
import { join } from 'path';
import {
  absorbStreamUsage,
  emptyStreamUsage,
  hasUsage,
  mergeFinalUsage,
  readInputSideUsage,
} from '../src/ai/stream-usage';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const count = (s: string, re: RegExp) => (s.match(re) || []).length;

/**
 * S2 — an aborted stream is billed in full, so it must be metered in full.
 *
 * Four of the five streaming sites read usage only from `finalMessage()`, which
 * a client disconnect or watchdog abort never reaches. For chat that is most of
 * the turn's cost: the ~10k-token system block cached at the 1h TTL is charged
 * at the 2× cache-WRITE rate on the first turn, and it is known from
 * `message_start` — before any disconnect can happen.
 */

describe('absorbStreamUsage', () => {
  it('captures the whole input side from message_start alone', () => {
    // The property that makes an aborted stream meterable: everything expensive
    // is known from the FIRST event.
    const u = emptyStreamUsage();
    absorbStreamUsage(
      {
        type: 'message_start',
        message: {
          usage: {
            input_tokens: 900,
            output_tokens: 1,
            cache_read_input_tokens: 400,
            cache_creation_input_tokens: 10_000,
          },
        },
      },
      u,
    );
    expect(u).toEqual({
      inputTokens: 900,
      outputTokens: 1,
      cacheReadTokens: 400,
      cacheWriteTokens: 10_000,
      // #6 — no `cache_creation` split in this payload, so nothing is ATTRIBUTED
      // to the 5-minute TTL; the whole write is priced at the 1-hour rate.
      cacheWrite5mTokens: 0,
      // #20 — message_start carries no text, so the char counter stays 0.
      outputTextChars: 0,
      outputTokensEstimated: false,
    });
  });

  it('treats message_delta output_tokens as CUMULATIVE, not incremental', () => {
    // Summing them would multiply the bill: Anthropic re-sends a running total.
    const u = emptyStreamUsage();
    absorbStreamUsage({ type: 'message_delta', usage: { output_tokens: 10 } }, u);
    absorbStreamUsage({ type: 'message_delta', usage: { output_tokens: 25 } }, u);
    absorbStreamUsage({ type: 'message_delta', usage: { output_tokens: 60 } }, u);
    expect(u.outputTokens).toBe(60);
  });

  it('never lets a later event erase what an earlier one established', () => {
    const u = emptyStreamUsage();
    absorbStreamUsage(
      { type: 'message_start', message: { usage: { input_tokens: 500, cache_creation_input_tokens: 9000 } } },
      u,
    );
    absorbStreamUsage({ type: 'message_delta', usage: { output_tokens: 12 } }, u);
    expect(u.inputTokens).toBe(500);
    expect(u.cacheWriteTokens).toBe(9000);
  });

  describe('#6 — the cache-write TTL split', () => {
    it('reads the 5-minute attribution from message_start.usage.cache_creation', () => {
      const u = emptyStreamUsage();
      absorbStreamUsage(
        {
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 6_800,
              cache_creation_input_tokens: 15_700,
              cache_creation: { ephemeral_5m_input_tokens: 15_700, ephemeral_1h_input_tokens: 0 },
            },
          },
        },
        u,
      );
      expect(u.cacheWriteTokens).toBe(15_700);
      expect(u.cacheWrite5mTokens).toBe(15_700);
    });

    it('leaves the split at 0 when the payload carries none, while the total still lands', () => {
      const u = emptyStreamUsage();
      absorbStreamUsage(
        { type: 'message_start', message: { usage: { input_tokens: 1, cache_creation_input_tokens: 500 } } },
        u,
      );
      expect(u.cacheWriteTokens).toBe(500);
      expect(u.cacheWrite5mTokens).toBe(0);
    });

    it('a later message_delta carrying only totals does not reset the split', () => {
      // `MessageDeltaUsage` has the cache totals but no `cache_creation` split.
      const u = emptyStreamUsage();
      absorbStreamUsage(
        {
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 1,
              cache_creation_input_tokens: 900,
              cache_creation: { ephemeral_5m_input_tokens: 900, ephemeral_1h_input_tokens: 0 },
            },
          },
        },
        u,
      );
      absorbStreamUsage(
        { type: 'message_delta', usage: { output_tokens: 40, cache_creation_input_tokens: 900 } },
        u,
      );
      expect(u.cacheWrite5mTokens).toBe(900);
      expect(u.outputTokens).toBe(40);
    });

    it('tolerates a null split and null TTL fields', () => {
      const u = emptyStreamUsage();
      absorbStreamUsage(
        { type: 'message_start', message: { usage: { input_tokens: 1, cache_creation: null } } },
        u,
      );
      absorbStreamUsage(
        {
          type: 'message_start',
          message: { usage: { input_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: null } } },
        },
        u,
      );
      expect(u.cacheWrite5mTokens).toBe(0);
    });
  });

  it('tolerates null counters, which the SDK really does emit', () => {
    const u = emptyStreamUsage();
    absorbStreamUsage(
      { type: 'message_start', message: { usage: { input_tokens: 5, cache_read_input_tokens: null } } },
      u,
    );
    expect(u).toEqual({
      inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      cacheWrite5mTokens: 0, outputTextChars: 0, outputTokensEstimated: false,
    });
  });

  it('ignores every other event shape without throwing', () => {
    // It runs on the hot path inside `for await`; throwing there would kill a
    // stream to protect a counter.
    const u = emptyStreamUsage();
    for (const e of [
      undefined,
      null,
      {},
      'text',
      42,
      // ⚠️ `content_block_delta` used to sit in this list. It is now COUNTED —
      // its text is the only output signal an aborted stream leaves behind
      // (#20), so it moved to its own assertion below.
      { type: 'message_stop' },
      { type: 'message_start' },
      { type: 'message_delta' },
      // Still ignored: a delta whose text is absent or not a string.
      { type: 'content_block_delta' },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 42 } },
    ]) {
      expect(() => absorbStreamUsage(e, u)).not.toThrow();
    }
    expect(u).toEqual(emptyStreamUsage());
  });

  it('COUNTS content_block_delta text — the abort-survivable output signal', () => {
    const u = emptyStreamUsage();
    absorbStreamUsage({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }, u);
    absorbStreamUsage({ type: 'content_block_delta', delta: { type: 'text_delta', text: '八字' } }, u);
    expect(u.outputTextChars).toBe(4);
    // Counting alone must not invent tokens — that is `finalizeStreamUsage`'s job.
    expect(u.outputTokens).toBe(0);
  });

  it('an abort after message_start still bills the expensive half', () => {
    // The end-to-end case, in miniature: connect, receive the start event and
    // two deltas, then the client vanishes. Old behaviour recorded $0.
    const u = emptyStreamUsage();
    absorbStreamUsage(
      { type: 'message_start', message: { usage: { input_tokens: 800, cache_creation_input_tokens: 10_000 } } },
      u,
    );
    absorbStreamUsage({ type: 'message_delta', usage: { output_tokens: 40 } }, u);
    expect(u.inputTokens + u.cacheWriteTokens).toBe(10_800);
    expect(u.outputTokens).toBe(40);
  });
});

describe('mergeFinalUsage', () => {
  it('prefers the authoritative final numbers on clean completion', () => {
    const u = emptyStreamUsage();
    absorbStreamUsage({ type: 'message_delta', usage: { output_tokens: 40 } }, u);
    mergeFinalUsage(u, { input_tokens: 800, output_tokens: 512 });
    expect(u.outputTokens).toBe(512);
    expect(u.inputTokens).toBe(800);
  });

  it('leaves the accumulated value alone when the final message omits a field', () => {
    const u = emptyStreamUsage();
    absorbStreamUsage(
      { type: 'message_start', message: { usage: { input_tokens: 700, cache_creation_input_tokens: 900 } } },
      u,
    );
    mergeFinalUsage(u, { output_tokens: 30 });
    expect(u.inputTokens).toBe(700);
    expect(u.cacheWriteTokens).toBe(900);
  });
});

describe('the four streaming sites record on EVERY exit path', () => {
  // Wiring, not logic — the helper above can be perfect while no site calls it.
  // That gap (a well-covered helper behind untested wiring) is this project's
  // most-repeated defect.
  const FILES = [
    ['src/fortune/fortune-stream.service.ts', 3],
    ['src/chat/chat-stream.service.ts', 1],
  ] as const;

  it.each(FILES)('%s accumulates during the loop at each site', (file, n) => {
    expect(count(src(file), /absorbStreamUsage\(event, streamUsage\)/g)).toBe(n);
  });

  it.each(FILES)('%s feeds EVERY record() from the accumulator', (file, n) => {
    // Not "at least one uses it" — every spend record in the file must, or a
    // second call site can quietly go back to reading `finalMessage()`, which
    // is exactly what an abort skips. (`chat-stream` still builds a separate
    // `usage` local from `finalMessage` for the ChatMessage row; that is a DB
    // field, not the meter, and it is only reached on clean completion anyway.)
    expect(count(src(file), /usage: streamUsage,/g)).toBe(n);
    expect(count(src(file), /aiSpend\.record\(/g)).toBe(n);
  });

  it.each(FILES)('%s records inside a finally, after the catch', (file) => {
    // A record between the stream and the catch is the bug; it must sit on the
    // path every exit takes.
    const s = src(file);
    let from = 0;
    for (;;) {
      const rec = s.indexOf('usage: streamUsage,', from);
      if (rec === -1) break;
      const finallyBefore = s.lastIndexOf('} finally {', rec);
      const catchBefore = s.lastIndexOf('} catch', rec);
      expect(finallyBefore).toBeGreaterThan(catchBefore);
      from = rec + 1;
    }
  });
});

describe('hasUsage — the guard that decides whether to record at all', () => {
  it('counts a cache-only stream as spend', () => {
    // The case the first guard missed, in the module whose whole argument is
    // that the cache-write half is the expensive one.
    expect(
      hasUsage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 10_000, cacheWrite5mTokens: 0, outputTextChars: 0, outputTokensEstimated: false }),
    ).toBe(true);
    expect(
      hasUsage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 4_000, cacheWriteTokens: 0, cacheWrite5mTokens: 0, outputTextChars: 0, outputTokensEstimated: false }),
    ).toBe(true);
  });

  it('is false only when the stream genuinely cost nothing', () => {
    // A stream that threw before `message_start` must record nothing.
    expect(hasUsage(emptyStreamUsage())).toBe(false);
  });
});

describe('readInputSideUsage — the input side of a COMPLETED response', () => {
  // Sync chat, non-streaming fortune and a stream's `finalMessage()` go through
  // this, so they read the cache counters AND the 5m/1h split the same way the
  // stream accumulator does (see `test/usage-reader.guard.spec.ts`).
  it('reads every input-side counter, including the 5-minute part of the split', () => {
    expect(
      readInputSideUsage({
        input_tokens: 1200,
        output_tokens: 400,
        cache_read_input_tokens: 700,
        cache_creation_input_tokens: 300,
        cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 100 },
      }),
    ).toEqual({ inputTokens: 1200, cacheReadTokens: 700, cacheWriteTokens: 300, cacheWrite5mTokens: 200 });
  });

  it('zero-fills whatever is missing — the shape the call sites used to build with `?? 0`', () => {
    const zero = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite5mTokens: 0 };
    expect(readInputSideUsage(undefined)).toEqual(zero);
    expect(readInputSideUsage({})).toEqual(zero);
    // The SDK types the cache counters `number | null`; null must read as 0.
    expect(
      readInputSideUsage({
        input_tokens: 5,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
        cache_creation: null,
      }),
    ).toEqual({ ...zero, inputTokens: 5 });
  });

  it('does not read output_tokens — that is each caller\'s own, deliberately', () => {
    expect(readInputSideUsage({ output_tokens: 999 })).not.toHaveProperty('outputTokens');
  });

  it('returns a fresh object each call — a caller mutating one cannot leak into the next', () => {
    expect(readInputSideUsage({})).not.toBe(readInputSideUsage({}));
    // A field the second call's input does NOT set must not inherit the first
    // caller's write (a shared object would carry it over).
    const first = readInputSideUsage({});
    first.cacheReadTokens = 42;
    expect(readInputSideUsage({}).cacheReadTokens).toBe(0);
  });
});
