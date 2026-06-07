/**
 * Streaming JSON section detector — Phase Fortune Streaming Layer 1.
 *
 * Wraps the `clarinet` SAX-style streaming JSON parser to detect when each
 * top-level `sections.<key>` value has been fully received in an incoming
 * Anthropic token stream, and fires a callback the moment each completes.
 *
 * Input shape (per `FORTUNE_V1_PROMPTS.daily.outputFormat`):
 * ```
 * { "sections": {
 *     "daily_overview": "...",          // string
 *     "daily_romance": "...",
 *     "daily_romance_takeaway": "...",
 *     "daily_career": "...",
 *     ... 11 string fields total ...
 *     "daily_advice": { "canTry": [...], "shouldHold": [...] }   // object
 * } }
 * ```
 *
 * Both string and object/array section values are emitted: primitives via
 * clarinet's `onvalue` event, compound values by reconstructing from
 * `onopenobject`/`onopenarray`/`onkey`/`onvalue`/`oncloseobject`/`onclosearray`
 * events into a small value-builder stack. (We do NOT use `parser.position`
 * for buffer slicing — verified empirically that clarinet's position counter
 * drifts by +1 per additional `write()` call when input is chunked, which
 * makes it unreliable as an index into our own buffer.)
 *
 * Markdown fence preamble (```json``` / ```) is stripped before the first
 * `{` is reached; trailing content after the root `}` is ignored (Anthropic
 * sometimes appends a remark like 「希望對您有幫助」). Both behaviors mirror
 * `FortuneService.extractJson`'s leniency so streaming + non-streaming
 * agree on what counts as the "JSON region".
 *
 * Per audit `feedback_audit_after_each_phase.md`: the detector is a pure
 * function; all branches and edge cases covered by `fortune-section-detector.spec.ts`.
 */
import clarinet from 'clarinet';

export interface SectionDetector {
  /** Feed an incoming chunk (e.g., Anthropic `text_delta.text`). Safe to call
   *  with empty strings, partial multi-byte escapes split across chunks, or
   *  trailing post-root garbage. After an internal error or `close()`, all
   *  further calls are no-ops. */
  write(chunk: string): void;
  /** Signal end-of-stream. Idempotent. Errors are swallowed (the caller can
   *  detect via the absence of expected `onSection` callbacks). */
  close(): void;
}

/** Frame tracking our position in the structural hierarchy. */
type ScopeFrame = { kind: 'obj' | 'arr'; currentKey?: string };

/** Frame used when reconstructing a compound section value. */
type BuilderFrame =
  | { kind: 'obj'; value: Record<string, unknown>; pendingKey?: string }
  | { kind: 'arr'; value: unknown[] };

/**
 * @param onSection Called once per completed top-level `sections.<key>`.
 *   `key` is the section key (e.g., `'daily_overview'`); `value` is the
 *   fully parsed value (string for prose sections, object for `daily_advice`).
 *   Emission order matches AI arrival order, NOT declaration order — the
 *   frontend MUST re-order to its canonical render sequence (see plan v2 H5).
 */
export function createSectionDetector(
  onSection: (key: string, value: unknown) => void,
): SectionDetector {
  const parser = clarinet.parser();
  const scope: ScopeFrame[] = [];

  /** Accumulator BEFORE the first `{` is found — used to absorb markdown
   *  fence / BOM / preamble characters that may span chunk boundaries. */
  let preBuffer = '';
  let foundStart = false;

  /** True once the root `}` is consumed. Subsequent `write()` chunks are
   *  dropped so trailing AI remarks don't crash the parser. */
  let rootClosed = false;

  let errored = false;
  let closed = false;

  /** When we're inside a compound section value, this holds the section key
   *  + the value-builder stack. `null` when not inside a compound section. */
  let activeCompound: { sectionKey: string; stack: BuilderFrame[] } | null = null;

  /** True iff scope is [rootFrame, sectionsFrame] — i.e., each new (key, value)
   *  at this scope is a section to emit. */
  const atSectionsScope = (): boolean =>
    scope.length === 2 && scope[0].kind === 'obj' && scope[1].kind === 'obj';

  /** True when the next `onopenobject` will push the sections frame — i.e.,
   *  scope is [rootFrame] with currentKey 'sections'. */
  const aboutToEnterSections = (): boolean =>
    scope.length === 1 && scope[0].kind === 'obj' && scope[0].currentKey === 'sections';

  /** Attach a constructed value to the top builder frame (set via its
   *  pendingKey for objects, push for arrays). */
  const attachToBuilderTop = (value: unknown) => {
    if (!activeCompound || activeCompound.stack.length === 0) return;
    const top = activeCompound.stack[activeCompound.stack.length - 1];
    if (top.kind === 'obj') {
      if (top.pendingKey !== undefined) {
        top.value[top.pendingKey] = value;
        top.pendingKey = undefined;
      }
    } else {
      top.value.push(value);
    }
  };

  parser.onopenobject = (firstKey?: string) => {
    const enteringSectionsFrame = aboutToEnterSections();

    if (activeCompound) {
      // We're already building a compound value — this is a nested object.
      const obj: Record<string, unknown> = {};
      attachToBuilderTop(obj);
      // If there's a firstKey, immediately set it as the pendingKey so the
      // next value (or compound) attaches to obj[firstKey].
      activeCompound.stack.push({ kind: 'obj', value: obj, pendingKey: firstKey });
      scope.push({ kind: 'obj', currentKey: firstKey });
      return;
    }

    // Not yet building. Push scope frame first.
    scope.push({ kind: 'obj', currentKey: firstKey });

    // Was this open a compound section value? (i.e., scope was [root, sections]
    // BEFORE we pushed → now we have [root, sections, this-new-obj].)
    if (atSectionsScope() === false && scope.length === 3 && scope[1].currentKey) {
      // Compound object value for a section. Start building.
      const obj: Record<string, unknown> = {};
      activeCompound = {
        sectionKey: scope[1].currentKey,
        stack: [{ kind: 'obj', value: obj, pendingKey: firstKey }],
      };
      return;
    }

    // Edge case: this is the FIRST key in the sections object (no preceding
    // onkey). firstKey names the first section.
    if (enteringSectionsFrame && firstKey !== undefined) {
      // No-op here — the value for firstKey will arrive as a primitive
      // (onvalue) or compound (onopenobject/onopenarray) and dispatch
      // through the normal paths.
    }
  };

  parser.onopenarray = () => {
    if (activeCompound) {
      const arr: unknown[] = [];
      attachToBuilderTop(arr);
      activeCompound.stack.push({ kind: 'arr', value: arr });
      scope.push({ kind: 'arr' });
      return;
    }

    scope.push({ kind: 'arr' });

    // Compound array value at sections-level
    if (scope.length === 3 && scope[1].currentKey) {
      const arr: unknown[] = [];
      activeCompound = {
        sectionKey: scope[1].currentKey,
        stack: [{ kind: 'arr', value: arr }],
      };
    }
  };

  parser.onkey = (k: string) => {
    if (scope.length === 0) return;
    scope[scope.length - 1].currentKey = k;
    if (activeCompound && activeCompound.stack.length > 0) {
      const top = activeCompound.stack[activeCompound.stack.length - 1];
      if (top.kind === 'obj') {
        top.pendingKey = k;
      }
    }
  };

  parser.onvalue = (v: string | number | boolean | null) => {
    if (activeCompound) {
      attachToBuilderTop(v);
      return;
    }
    if (atSectionsScope()) {
      const key = scope[scope.length - 1].currentKey;
      if (key) onSection(key, v);
    }
  };

  parser.oncloseobject = () => {
    scope.pop();
    if (activeCompound) {
      const finished = activeCompound.stack.pop();
      if (activeCompound.stack.length === 0 && finished) {
        // Top compound completed — emit and clear
        onSection(activeCompound.sectionKey, finished.value);
        activeCompound = null;
      }
    }
    if (scope.length === 0) {
      rootClosed = true;
    }
  };

  parser.onclosearray = () => {
    scope.pop();
    if (activeCompound) {
      const finished = activeCompound.stack.pop();
      if (activeCompound.stack.length === 0 && finished) {
        onSection(activeCompound.sectionKey, finished.value);
        activeCompound = null;
      }
    }
  };

  parser.onerror = () => {
    errored = true;
    // clarinet aborts further parsing after onerror; we swallow so the
    // caller can rely on the detector being "fail-soft" (any sections
    // emitted so far remain valid).
  };

  return {
    write(chunk: string) {
      if (errored || closed || rootClosed) return;
      if (!chunk) return;

      let toFeed: string;

      if (!foundStart) {
        preBuffer += chunk;
        // Strip BOM + markdown fence wrappers. Only the leading variant matters
        // here (we re-apply on every chunk while !foundStart to handle splits
        // like chunk1='```js', chunk2='on\n{...'); trailing ``` after JSON close
        // is handled by `rootClosed` swallowing further input.
        const cleaned = preBuffer
          .replace(/^﻿/, '')
          .replace(/^\s*```(?:json)?\s*/i, '');
        const firstBrace = cleaned.indexOf('{');
        if (firstBrace === -1) return; // still preamble — wait for more chunks
        foundStart = true;
        toFeed = cleaned.slice(firstBrace);
        preBuffer = '';
      } else {
        toFeed = chunk;
      }

      try {
        parser.write(toFeed);
      } catch {
        errored = true;
      }
    },
    close() {
      if (errored || closed) return;
      closed = true;
      if (!foundStart) return; // never received any JSON — nothing to close
      try {
        parser.close();
      } catch {
        errored = true;
      }
    },
  };
}
