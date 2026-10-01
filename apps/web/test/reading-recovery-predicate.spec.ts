import { needsInterpretationRecovery } from '../app/lib/readings-api';

/**
 * #21c — the branch that makes a charged-empty reading recoverable.
 *
 * Clicking a row in 歷史分析記錄 runs `loadSavedReading`, NOT
 * `recoverPaidReading`. Until 2026-09-02 that function's only job was to render
 * whatever it found, so a paid row with no interpretation rendered blank
 * forever. Verified against a real production row: 3 credits, no content, and
 * no way for the user to get either back.
 *
 * todo #3 (2026-09-28) briefly made the predicate TYPE-AWARE and fail closed on
 * HEALTH / ZWDS, because the backend's streamer switch used to end in
 * `default: streamLifetimeV2`. The PR #73 review fixes REMOVED that gate: the
 * API is the guard (`_setupStream` step 2b refuses AND refunds a charged-empty
 * row of a type it cannot stream), so reaching the stream is how the user gets
 * their credits back — see the last describe. `readingType` is no longer read.
 */
describe('needsInterpretationRecovery', () => {
  const paidEmpty = { creditsUsed: 3, refundedAt: null };

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
    expect(needsInterpretationRecovery({ creditsUsed: 0, refundedAt: null }, 0)).toBe(false);
  });

  it('does NOT recover a REFUNDED row', () => {
    // The money is already back. `_setupStream` refuses these and tells the
    // user to create a new reading — recovering here would fight that. This is
    // also the post-refund state of a not-streamable row after 2b has done its
    // job: the second open must NOT stream again.
    expect(
      needsInterpretationRecovery({ creditsUsed: 3, refundedAt: '2026-09-02T00:00:00Z' }, 0),
    ).toBe(false);
  });

  it('treats a missing refundedAt as not-refunded', () => {
    // The API omits the key entirely on older rows; `undefined` must not read
    // as refunded, or every legacy paid-empty row stays unrecoverable.
    expect(needsInterpretationRecovery({ creditsUsed: 3 }, 0)).toBe(true);
  });

  it('is driven by CONTENT, not by the degraded flag', () => {
    // A degraded reading has partial sections and its own regeneration path;
    // this must not fire for it. Content count is the whole question.
    expect(needsInterpretationRecovery({ creditsUsed: 3, refundedAt: null }, 8)).toBe(false);
  });

  describe('does NOT gate on type (PR #73 review fix A)', () => {
    // The API refuses AND refunds a charged-empty HEALTH / ZWDS row at
    // `_setupStream` step 2b. The only way that refund reaches a web user is
    // for this predicate to send the row to the stream — a type gate here would
    // strand their money behind a round-trip that never happens. The extra
    // `readingType` key is deliberately passed to prove it is IGNORED, not
    // merely absent from the signature.
    it('a paid-empty HEALTH row recovers — reaching the refusal IS the refund', () => {
      expect(
        needsInterpretationRecovery(
          { readingType: 'HEALTH', creditsUsed: 2, refundedAt: null } as never,
          0,
        ),
      ).toBe(true);
    });

    it('a paid-empty ZWDS row recovers for the same reason', () => {
      expect(
        needsInterpretationRecovery(
          { readingType: 'ZWDS_LIFETIME', creditsUsed: 2, refundedAt: null } as never,
          0,
        ),
      ).toBe(true);
    });
  });
});
