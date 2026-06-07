/**
 * Tests for MonthlyNarrativeCard's `renderAfterDimension` prop — MONTH per-dim
 * ask-card parity (mirror of YEAR Tier B2 / daily NarrativeCard).
 *
 * Locks the 3-STATE visibility guard (NOT daily's 2-state):
 *   - narrative present → ALL 4 dim slots VISIBLE, even a dim with no text
 *     (renders the «本月此面向平穩» empty-state + ask card stays visible).
 *     A `text`-only guard would wrongly hide the ask card there.
 *   - hybrid streaming (narrative null + partial streamedSections) → arrived
 *     dims VISIBLE, un-arrived dims HIDDEN (visibility:hidden) to reserve
 *     layout space (H4 lesson).
 *   - slot invoked for all 4 dims regardless of state.
 */
import * as React from 'react'; // Required for dual @types/react JSX-identity workaround

// Mock lucide-react icons (ForwardRefExoticComponent identity collides with the
// dual @types/react in the test renderer) — stub to null. Mirror of the daily
// narrative-card-streamed-sections spec.
jest.mock('lucide-react', () => {
  const stub = () =>
    function StubIcon() {
      return null;
    };
  return new Proxy(
    {},
    {
      get: (_target, prop: string) => stub(),
    },
  );
});

import { render } from '@testing-library/react';
import MonthlyNarrativeCard from '../app/components/fortune/MonthlyNarrativeCard';
import type { MonthlyFortuneNarrative } from '../app/lib/fortune-api';

const DIMS = {
  career: { score: 50, label: '平穩' },
  finance: { score: 50, label: '平穩' },
  romance: { score: 50, label: '平穩' },
  health: { score: 50, label: '平穩' },
};

const FULL_NARRATIVE: MonthlyFortuneNarrative = {
  monthly_overview: '本月整體偏向平穩',
  monthly_career: '事業敘述',
  monthly_finance: '財運敘述',
  monthly_romance: '感情敘述',
  monthly_health: '健康敘述',
  monthly_advice: { canTry: ['宜試'], shouldHold: ['宜緩'] },
};

describe('MonthlyNarrativeCard renderAfterDimension (per-dim ask cards)', () => {
  it('invokes the slot for all 4 dims when narrative is present', () => {
    const renderAfterDimension = jest.fn(() => (
      <div data-testid="inline-ask-card">Ask card</div>
    ));
    render(
      <MonthlyNarrativeCard
        narrative={FULL_NARRATIVE}
        dimensions={DIMS}
        renderAfterDimension={renderAfterDimension}
      />,
    );
    expect(renderAfterDimension).toHaveBeenCalledTimes(4);
  });

  it('keeps ALL 4 slots VISIBLE when narrative present, even a dim with no text (3-state guard)', () => {
    // health has an empty narrative string → 「本月此面向平穩無特別動向」
    // empty-state renders, but the ask card MUST stay visible (parity with YEAR;
    // daily's 2-state guard would wrongly hide it).
    const narrativeNoHealth: MonthlyFortuneNarrative = {
      ...FULL_NARRATIVE,
      monthly_health: '',
    };
    const { container } = render(
      <MonthlyNarrativeCard
        narrative={narrativeNoHealth}
        dimensions={DIMS}
        renderAfterDimension={() => (
          <div data-testid="inline-ask-card">Ask card</div>
        )}
      />,
    );
    const hidden = container.querySelectorAll(
      'div[style*="visibility: hidden"], div[style*="visibility:hidden"]',
    );
    expect(hidden.length).toBe(0); // all 4 visible
  });

  it('hides un-arrived dims (visibility:hidden) in hybrid streaming mode', () => {
    const renderAfterDimension = jest.fn(() => (
      <div data-testid="inline-ask-card">Ask card</div>
    ));
    const { container } = render(
      <MonthlyNarrativeCard
        narrative={null}
        dimensions={DIMS}
        loading
        streamedSections={{ monthly_career: '事業已到' }}
        renderAfterDimension={renderAfterDimension}
      />,
    );
    // slot invoked for all 4 dims
    expect(renderAfterDimension).toHaveBeenCalledTimes(4);
    // 3 un-arrived (finance/romance/health) hidden, 1 visible (career)
    const hidden = container.querySelectorAll(
      'div[style*="visibility: hidden"], div[style*="visibility:hidden"]',
    );
    expect(hidden.length).toBe(3);
  });

  it('renders nothing extra when renderAfterDimension is omitted', () => {
    const { queryByTestId } = render(
      <MonthlyNarrativeCard narrative={FULL_NARRATIVE} dimensions={DIMS} />,
    );
    expect(queryByTestId('inline-ask-card')).toBeNull();
  });
});
