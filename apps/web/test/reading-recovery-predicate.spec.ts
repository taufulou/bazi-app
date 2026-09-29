import { needsInterpretationRecovery, STREAMABLE_READING_TYPES } from '../app/lib/readings-api';

/**
 * #21c — the branch that makes a charged-empty reading recoverable.
 *
 * Clicking a row in 歷史分析記錄 runs `loadSavedReading`, NOT
 * `recoverPaidReading`. Until 2026-09-02 that function's only job was to render
 * whatever it found, so a paid row with no interpretation rendered blank
 * forever. Verified against a real production row: 3 credits, no content, and
 * no way for the user to get either back.
 *
 * todo #3 (2026-09-28) made the predicate TYPE-AWARE: the backend's streamer
 * switch used to end in `default: streamLifetimeV2`, so recovering a HEALTH or
 * ZWDS row here generated a 八字終身運 reading over the wrong chart and
 * persisted it. Every object literal below therefore carries `readingType`.
 */
describe('needsInterpretationRecovery', () => {
  const paidEmpty = { readingType: 'LIFETIME', creditsUsed: 3, refundedAt: null };

  it('RECOVERS a paid row with no sections — the production case', () => {
    expect(needsInterpretationRecovery(paidEmpty, 0)).toBe(true);
  });

  it('does NOT re-stream over content the user already has', () => {
    // Re-streaming a complete reading would spend real Anthropic money to
    // overwrite something correct, and could clobber it with a degraded retry.
    expect(needsInterpretationRecovery(paidEmpty, 15)).toBe(false);
    expect(needsInterpretationRecovery(paidEmpty, 1)).toBe(false);
  });

  it('does NOT recover a FREE / chart-only row', () => {
    // Legitimately empty. The backend refuses these with READING_NOT_PAID, so
    // asking is a wasted round-trip that surfaces to the user as an error.
    expect(needsInterpretationRecovery({ readingType: 'LIFETIME', creditsUsed: 0, refundedAt: null }, 0)).toBe(false);
  });

  it('does NOT recover a REFUNDED row', () => {
    // The money is already back. `_setupStream` refuses these and tells the
    // user to create a new reading — recovering here would fight that.
    expect(
      needsInterpretationRecovery({ readingType: 'LIFETIME', creditsUsed: 3, refundedAt: '2026-09-02T00:00:00Z' }, 0),
    ).toBe(false);
  });

  it('treats a missing refundedAt as not-refunded', () => {
    // The API omits the key entirely on older rows; `undefined` must not read
    // as refunded, or every legacy paid-empty row stays unrecoverable.
    expect(needsInterpretationRecovery({ readingType: 'LIFETIME', creditsUsed: 3 }, 0)).toBe(true);
  });

  it('is driven by CONTENT, not by the degraded flag', () => {
    // A degraded reading has partial sections and its own regeneration path;
    // this must not fire for it. Content count is the whole question.
    expect(needsInterpretationRecovery({ readingType: 'LIFETIME', creditsUsed: 3, refundedAt: null }, 8)).toBe(false);
  });

  describe('type-aware (todo #3)', () => {
    it.each(STREAMABLE_READING_TYPES)('%s paid-empty → recovers', (readingType) => {
      expect(needsInterpretationRecovery({ readingType, creditsUsed: 3, refundedAt: null }, 0)).toBe(true);
    });

    it('does NOT recover a paid-empty HEALTH row — no streamer exists; the backend would have narrated LIFETIME over it', () => {
      expect(needsInterpretationRecovery({ readingType: 'HEALTH', creditsUsed: 2, refundedAt: null }, 0)).toBe(false);
    });

    it('does NOT recover a paid-empty ZWDS row — ZWDS is deleted and the row renders from calculationData', () => {
      expect(needsInterpretationRecovery({ readingType: 'ZWDS_LIFETIME', creditsUsed: 2, refundedAt: null }, 0)).toBe(false);
    });

    it('fails CLOSED when readingType is missing — a row we cannot classify must not be sent to the stream', () => {
      // `getReading` always returns the type today; this pins the direction of
      // the default if that ever changes.
      expect(needsInterpretationRecovery({ creditsUsed: 3, refundedAt: null }, 0)).toBe(false);
    });
  });
});
