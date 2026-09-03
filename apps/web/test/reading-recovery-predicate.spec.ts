import { needsInterpretationRecovery } from '../app/lib/readings-api';

/**
 * #21c — the branch that makes a charged-empty reading recoverable.
 *
 * Clicking a row in 歷史分析記錄 runs `loadSavedReading`, NOT
 * `recoverPaidReading`. Until 2026-09-02 that function's only job was to render
 * whatever it found, so a paid row with no interpretation rendered blank
 * forever. Verified against a real production row: 3 credits, no content, and
 * no way for the user to get either back.
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
    // user to create a new reading — recovering here would fight that.
    expect(needsInterpretationRecovery({ creditsUsed: 3, refundedAt: '2026-09-02T00:00:00Z' }, 0)).toBe(false);
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
});
