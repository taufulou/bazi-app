/**
 * Phase 3 年運 — YearNavigator RTL spec.
 *
 * Mirrors date-navigator.spec.tsx boundary-state coverage:
 *   - FREE user click → fires onLockedAttempt, NOT onChange
 *   - Subscriber click prev/next → fires onChange ±1 year
 *   - At +4 (SUBSCRIBER_WINDOW_FUTURE_YEAR) → next arrow aria-disabled
 *   - At -1 → prev arrow aria-disabled
 *   - tier loading → both arrows disabled (neutral placeholder)
 *   - offset badge shows 今年/明年/去年/+N 年
 */
import * as React from 'react';
import { describe, expect, it } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock lucide-react icons as plain spans (dual-react-types forwardRef dodge).
jest.mock('lucide-react', () => ({
  __esModule: true,
  ChevronLeft: () => <span data-icon="ChevronLeft" />,
  ChevronRight: () => <span data-icon="ChevronRight" />,
  Lock: () => <span data-icon="Lock" />,
  Calendar: () => <span data-icon="Calendar" />,
}));

import YearNavigator from '../app/components/fortune/YearNavigator';

describe('YearNavigator', () => {
  const CURRENT = '2026';

  function renderWith(opts: {
    value?: string;
    tier?: 'FREE' | 'BASIC' | 'PRO' | 'MASTER' | undefined;
    isTierLoading?: boolean;
  } = {}) {
    const tier = 'tier' in opts ? opts.tier : ('PRO' as const);
    const onChange = jest.fn();
    const onLockedAttempt = jest.fn();
    render(
      <YearNavigator
        value={opts.value ?? CURRENT}
        currentYearIso={CURRENT}
        tier={tier}
        isTierLoading={opts.isTierLoading ?? false}
        onChange={onChange}
        onLockedAttempt={onLockedAttempt}
      />,
    );
    return { onChange, onLockedAttempt };
  }

  it('renders prev/next arrows + a year label with offset badge', () => {
    renderWith();
    expect(screen.getByLabelText('前一年')).toBeInTheDocument();
    expect(screen.getByLabelText('後一年')).toBeInTheDocument();
    expect(screen.getByText('2026年')).toBeInTheDocument();
    expect(screen.getByText('今年')).toBeInTheDocument();
  });

  describe('offset badge', () => {
    it('shows 明年 for current+1', () => {
      renderWith({ value: '2027' });
      expect(screen.getByText('明年')).toBeInTheDocument();
    });
    it('shows 去年 for current-1', () => {
      renderWith({ value: '2025' });
      expect(screen.getByText('去年')).toBeInTheDocument();
    });
    it('shows +N 年 for current+N', () => {
      renderWith({ value: '2029' });
      expect(screen.getByText('+3 年')).toBeInTheDocument();
    });
  });

  describe('FREE tier', () => {
    it('clicking next arrow fires onLockedAttempt, NOT onChange', () => {
      const { onChange, onLockedAttempt } = renderWith({ tier: 'FREE' });
      fireEvent.click(screen.getByLabelText('後一年'));
      expect(onLockedAttempt).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('clicking prev arrow fires onLockedAttempt, NOT onChange', () => {
      const { onChange, onLockedAttempt } = renderWith({ tier: 'FREE' });
      fireEvent.click(screen.getByLabelText('前一年'));
      expect(onLockedAttempt).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('treats undefined tier as FREE for locking', () => {
      const { onChange, onLockedAttempt } = renderWith({ tier: undefined });
      fireEvent.click(screen.getByLabelText('後一年'));
      expect(onLockedAttempt).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('subscriber tier (PRO)', () => {
    it('clicking next arrow fires onChange with +1 year', () => {
      const { onChange, onLockedAttempt } = renderWith({ tier: 'PRO' });
      fireEvent.click(screen.getByLabelText('後一年'));
      expect(onChange).toHaveBeenCalledWith('2027');
      expect(onLockedAttempt).not.toHaveBeenCalled();
    });

    it('clicking prev arrow fires onChange with -1 year', () => {
      const { onChange } = renderWith({ tier: 'PRO' });
      fireEvent.click(screen.getByLabelText('前一年'));
      expect(onChange).toHaveBeenCalledWith('2025');
    });

    it('at +4 boundary, next arrow is aria-disabled', () => {
      renderWith({ tier: 'PRO', value: '2030' }); // current + 4
      const next = screen.getByLabelText('後一年');
      expect(next).toBeDisabled();
      expect(next).toHaveAttribute('aria-disabled', 'true');
    });

    it('at -1 boundary, prev arrow is aria-disabled', () => {
      renderWith({ tier: 'PRO', value: '2025' }); // current - 1
      const prev = screen.getByLabelText('前一年');
      expect(prev).toBeDisabled();
      expect(prev).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('tier loading state', () => {
    it('when tier is loading, BOTH arrows disabled regardless of tier', () => {
      const { onChange, onLockedAttempt } = renderWith({
        tier: undefined,
        isTierLoading: true,
      });
      const prev = screen.getByLabelText('前一年');
      const next = screen.getByLabelText('後一年');
      expect(prev).toBeDisabled();
      expect(next).toBeDisabled();
      fireEvent.click(prev);
      fireEvent.click(next);
      expect(onChange).not.toHaveBeenCalled();
      expect(onLockedAttempt).not.toHaveBeenCalled();
    });

    it('when tier is loading, data-state is "loading" (neutral chevron, not lock)', () => {
      renderWith({ tier: undefined, isTierLoading: true });
      const prev = screen.getByLabelText('前一年');
      expect(prev).toHaveAttribute('data-state', 'loading');
    });
  });
});
