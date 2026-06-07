/**
 * Phase 3.1 — YearNavigator RTL spec (picker-only, arrows removed).
 *
 * Phase 3.1 reworked the navigator: prev/next arrows REMOVED; the date chip
 * is the sole interaction (opens a year-picker). A chevron-down + «點擊選擇年份»
 * hint signal it. FREE users' chip click → onLockedAttempt.
 */
import * as React from 'react';
import { describe, expect, it } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock lucide-react icons as plain spans (dual-react-types forwardRef dodge).
jest.mock('lucide-react', () => ({
  __esModule: true,
  ChevronDown: (props: Record<string, unknown>) => (
    <span data-icon="ChevronDown" data-open={props['data-open']} />
  ),
  Lock: () => <span data-icon="Lock" />,
  Calendar: () => <span data-icon="Calendar" />,
}));

// Mock react-datepicker — stub that fires onChange with a fixed in-window year.
jest.mock('react-datepicker', () => ({
  __esModule: true,
  default: (props: { onChange: (d: Date) => void }) => (
    <button
      type="button"
      data-testid="mock-picker"
      onClick={() => props.onChange(new Date(2028, 0, 1))}
    >
      picker
    </button>
  ),
}));

// Side-effect locale module — its only purpose is to register react-datepicker's
// zh-TW locale (calls registerLocale, absent on the default-only mock above).
jest.mock('../app/lib/date-locale', () => ({}));

import YearNavigator from '../app/components/fortune/YearNavigator';

describe('YearNavigator (picker-only)', () => {
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

  it('renders the year label + offset badge + chevron, with NO prev/next arrows', () => {
    renderWith();
    expect(screen.getByText('2026年')).toBeInTheDocument();
    expect(screen.getByText('今年')).toBeInTheDocument();
    // Arrows are gone
    expect(screen.queryByLabelText('前一年')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('後一年')).not.toBeInTheDocument();
    // Chevron-down discoverability affordance present (subscriber)
    expect(screen.getByText((_c, el) => el?.getAttribute('data-icon') === 'ChevronDown')).toBeInTheDocument();
  });

  it('shows the «點擊選擇年份» hint for subscribers', () => {
    renderWith({ tier: 'PRO' });
    expect(screen.getByText('點擊選擇年份')).toBeInTheDocument();
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
    it('clicking the date chip fires onLockedAttempt, NOT onChange (no picker)', () => {
      const { onChange, onLockedAttempt } = renderWith({ tier: 'FREE' });
      fireEvent.click(screen.getByRole('button'));
      expect(onLockedAttempt).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
      // No picker opened
      expect(screen.queryByTestId('mock-picker')).not.toBeInTheDocument();
    });

    it('shows a Lock icon + «訂閱後可選擇其他年份» hint for free users', () => {
      renderWith({ tier: 'FREE' });
      expect(screen.getByText((_c, el) => el?.getAttribute('data-icon') === 'Lock')).toBeInTheDocument();
      expect(screen.getByText('訂閱後可選擇其他年份')).toBeInTheDocument();
    });

    it('treats undefined tier as FREE for locking', () => {
      const { onChange, onLockedAttempt } = renderWith({ tier: undefined });
      fireEvent.click(screen.getByRole('button'));
      expect(onLockedAttempt).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('subscriber tier (PRO)', () => {
    it('clicking the date chip opens the picker (aria-expanded true)', () => {
      renderWith({ tier: 'PRO' });
      const chip = screen.getByRole('button');
      expect(chip).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(chip);
      expect(chip).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('mock-picker')).toBeInTheDocument();
    });

    it('selecting a year in the picker fires onChange with that year', () => {
      const { onChange } = renderWith({ tier: 'PRO' });
      fireEvent.click(screen.getByRole('button')); // open picker
      fireEvent.click(screen.getByTestId('mock-picker')); // picks 2028
      expect(onChange).toHaveBeenCalledWith('2028');
    });
  });

  describe('tier loading state', () => {
    it('when tier is loading, the chip is disabled + shows no hint', () => {
      const { onChange, onLockedAttempt } = renderWith({
        tier: undefined,
        isTierLoading: true,
      });
      const chip = screen.getByRole('button');
      expect(chip).toBeDisabled();
      expect(chip).toHaveAttribute('data-state', 'loading');
      fireEvent.click(chip);
      expect(onChange).not.toHaveBeenCalled();
      expect(onLockedAttempt).not.toHaveBeenCalled();
      // No hint + no Lock during the placeholder window
      expect(screen.queryByText('點擊選擇年份')).not.toBeInTheDocument();
      expect(screen.queryByText('訂閱後可選擇其他年份')).not.toBeInTheDocument();
    });
  });
});
