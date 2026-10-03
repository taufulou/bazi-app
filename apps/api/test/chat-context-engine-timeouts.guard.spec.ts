import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHAT_CONTEXT_ENGINE_TIMEOUT_MS } from '../src/chat/chat-context.service';

/**
 * todo #26 — the chat stream's deadline and lock TTL are DERIVED from the
 * engine chat-context timeouts (`CHAT_CONTEXT_BUILD_BOUND_MS = max(...)` in
 * `chat-stream.service.ts`). That derivation only holds while BOTH links hold:
 *
 *   sites → object : every `engineFetch` site in `chat-context.service.ts`
 *                    reads its timeout from `CHAT_CONTEXT_ENGINE_TIMEOUT_MS`
 *                    (first three tests — a source-text ratchet, not a proof.
 *                    The negative lookahead DOES catch a hoisted
 *                    `const T = 60_000` passed in, and a site rebuilt on an
 *                    `AbortController` + manual `setTimeout` drops its key
 *                    from `uses`, which the second test's key list catches.
 *                    The one shape that slips through: a site that stops
 *                    using `AbortSignal.timeout(` while a textual
 *                    `AbortSignal.timeout(CHAT_CONTEXT_ENGINE_TIMEOUT_MS.<thatKey>)`
 *                    survives elsewhere in the file — a dead module-scope
 *                    const, say — so the key list and the site count still
 *                    balance);
 *   object → TTL   : `chat-stream.service.ts` really computes from the object
 *                    (last test — a module probe, so a later "simplification"
 *                    to a literal `60_000` cannot survive it).
 *
 * A literal re-introduced at either end would let the TTL drift from the real
 * bound silently — the exact drift #27 closed on the reading paths.
 */
const SRC = readFileSync(join(__dirname, '..', 'src', 'chat', 'chat-context.service.ts'), 'utf8');

describe('#26 — chat-context engine timeouts are named, never literals', () => {
  it('every AbortSignal.timeout(…) in chat-context.service.ts reads CHAT_CONTEXT_ENGINE_TIMEOUT_MS.<key>', () => {
    // Negative lookahead: ANY argument shape that is not the named object is a
    // violation — a literal, `60 * 1000`, `60e3`, a hoisted constant.
    const violations = SRC.match(/AbortSignal\.timeout\((?!\s*CHAT_CONTEXT_ENGINE_TIMEOUT_MS\.\w+\s*\))/g) ?? [];
    expect(violations).toEqual([]);
  });

  it('exactly the three engineFetch sites exist, and each reads a distinct key', () => {
    const uses = (SRC.match(/AbortSignal\.timeout\(\s*CHAT_CONTEXT_ENGINE_TIMEOUT_MS\.(\w+)\s*\)/g) ?? [])
      .map((m) => m.replace(/.*\.(\w+)\s*\)$/, '$1'))
      .sort();
    expect(uses).toEqual(['compat', 'fortune', 'reading']);
    // A fourth engineFetch with NO signal at all would otherwise go unseen.
    const engineFetchSites = (SRC.match(/\bengineFetch\(/g) ?? []).length;
    expect(engineFetchSites).toBe(uses.length);
  });

  it('has exactly the keys reading/compat/fortune, and the max the deadline is derived from is 60s', () => {
    expect(Object.keys(CHAT_CONTEXT_ENGINE_TIMEOUT_MS).sort()).toEqual(['compat', 'fortune', 'reading']);
    // Re-pin when a timeout changes — that is the point: the stream deadline
    // (205s) and lock TTL (317s) in chat-stream.service.ts move with it.
    expect(Math.max(...Object.values(CHAT_CONTEXT_ENGINE_TIMEOUT_MS))).toBe(60_000);
  });

  it('the deadline and the TTL MOVE with the engine timeouts (object → TTL link)', () => {
    // Load chat-stream.service with a compat timeout of 90s instead of 60s. If
    // the deadline is really derived, it is 235s and the TTL 347s; a literal
    // `60_000` left in its place would still report 205s / 317s.
    jest.isolateModules(() => {
      jest.doMock('../src/chat/chat-context.service', () => ({
        ...jest.requireActual('../src/chat/chat-context.service'),
        CHAT_CONTEXT_ENGINE_TIMEOUT_MS: { reading: 45_000, compat: 90_000, fortune: 45_000 },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('../src/chat/chat-stream.service') as {
        CHAT_STREAM_DEADLINE_MS: number;
        STREAM_LOCK_TTL_SECONDS: number;
      };
      expect(m.CHAT_STREAM_DEADLINE_MS).toBe(235_000);
      expect(m.STREAM_LOCK_TTL_SECONDS).toBe(347);
    });
  });
});
