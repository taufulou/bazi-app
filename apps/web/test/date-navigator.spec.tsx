/**
 * Tests for DateNavigator — prev/next arrows + picker. Subscriber-aware.
 *
 * Key behaviors locked:
 *   - FREE user click on arrow → fires onLockedAttempt, NOT onChange
 *   - Subscriber at +30 → next arrow aria-disabled
 *   - Subscriber at -1 → prev arrow disabled
 *   - "Today" derived from todayBaziIso prop (subject's 23:00 子時 boundary)
 */
import { render, screen, fireEvent } from '@testing-library/react';
import DateNavigator from '../app/components/fortune/DateNavigator';

// Avoid pulling the heavy react-datepicker library into the test env. We're
// testing the navigator's arrow/label logic, not the date-picker UI itself.
jest.mock('react-datepicker', () => ({
  __esModule: true,
  default: () => null,
  registerLocale: jest.fn(),
}));

// Same for the side-effect locale module — its only purpose is to register
// react-datepicker's zh-TW locale, which is mocked above.
jest.mock('../app/lib/date-locale', () => ({}));

// Mock lucide-react icons as simple stub spans. Lucide uses forwardRef which
// triggers a React identity mismatch in jsdom (multiple @types/react resolve
// to different namespaces). Replacing with plain spans dodges this AND keeps
// tests focused on the navigator's behavior, not icon rendering.
jest.mock('lucide-react', () => ({
  __esModule: true,
  ChevronLeft: () => <span data-icon="ChevronLeft" />,
  ChevronRight: () => <span data-icon="ChevronRight" />,
  Lock: () => <span data-icon="Lock" />,
  Calendar: () => <span data-icon="Calendar" />,
}));

describe('DateNavigator', () => {
  const TODAY = '2026-05-18';

  // Use sentinel so the test can intentionally pass undefined for tier.
  // Plain `?? 'PRO'` defaulting would treat undefined like an omitted key.
  const TIER_UNSET = Symbol('tier-unset');
  function renderWith(opts: {
    value?: string;
    tier?: 'FREE' | 'BASIC' | 'PRO' | 'MASTER' | undefined | typeof TIER_UNSET;
    isTierLoading?: boolean;
  } = {}) {
    const tier =
      opts.tier === TIER_UNSET || !('tier' in opts)
        ? ('PRO' as const)
        : (opts.tier as 'FREE' | 'BASIC' | 'PRO' | 'MASTER' | undefined);
    const onChange = jest.fn();
    const onLockedAttempt = jest.fn();
    render(
      <DateNavigator
        value={opts.value ?? TODAY}
        todayBaziIso={TODAY}
        tier={tier}
        isTierLoading={opts.isTierLoading ?? false}
        onChange={onChange}
        onLockedAttempt={onLockedAttempt}
      />,
    );
    return { onChange, onLockedAttempt };
  }

  it('renders prev/next arrows + a date label', () => {
    renderWith();
    expect(screen.getByLabelText('前一天')).toBeInTheDocument();
    expect(screen.getByLabelText('後一天')).toBeInTheDocument();
    expect(screen.getByText(/2026年5月18日/)).toBeInTheDocument();
  });

  describe('FREE tier', () => {
    it('clicking next arrow fires onLockedAttempt, NOT onChange', () => {
      const { onChange, onLockedAttempt } = renderWith({ tier: 'FREE' });
      fireEvent.click(screen.getByLabelText('後一天'));
      expect(onLockedAttempt).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('clicking prev arrow fires onLockedAttempt, NOT onChange', () => {
      const { onChange, onLockedAttempt } = renderWith({ tier: 'FREE' });
      fireEvent.click(screen.getByLabelText('前一天'));
      expect(onLockedAttempt).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('clicking date label fires onLockedAttempt (not picker open)', () => {
      const { onChange, onLockedAttempt } = renderWith({ tier: 'FREE' });
      const label = screen.getByText(/2026年5月18日/).closest('button');
      expect(label).not.toBeNull();
      fireEvent.click(label!);
      expect(onLockedAttempt).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('treats undefined tier as FREE for locking', () => {
      const { onChange, onLockedAttempt } = renderWith({ tier: undefined });
      fireEvent.click(screen.getByLabelText('後一天'));
      expect(onLockedAttempt).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('subscriber tier (PRO)', () => {
    it('clicking next arrow fires onChange with +1 day', () => {
      const { onChange, onLockedAttempt } = renderWith({ tier: 'PRO' });
      fireEvent.click(screen.getByLabelText('後一天'));
      expect(onChange).toHaveBeenCalledWith('2026-05-19');
      expect(onLockedAttempt).not.toHaveBeenCalled();
    });

    it('clicking prev arrow fires onChange with -1 day', () => {
      const { onChange } = renderWith({ tier: 'PRO' });
      fireEvent.click(screen.getByLabelText('前一天'));
      expect(onChange).toHaveBeenCalledWith('2026-05-17');
    });

    it('at +30 boundary, next arrow is aria-disabled', () => {
      renderWith({ tier: 'PRO', value: '2026-06-17' }); // today + 30
      const next = screen.getByLabelText('後一天');
      expect(next).toBeDisabled();
      expect(next).toHaveAttribute('aria-disabled', 'true');
    });

    it('at -1 boundary, prev arrow is aria-disabled', () => {
      renderWith({ tier: 'PRO', value: '2026-05-17' }); // today - 1
      const prev = screen.getByLabelText('前一天');
      expect(prev).toBeDisabled();
      expect(prev).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('tier loading state (audit Scenario H fix)', () => {
    it('when tier is loading, BOTH arrows disabled regardless of underlying tier', () => {
      const { onChange, onLockedAttempt } = renderWith({
        tier: undefined,
        isTierLoading: true,
      });
      const prev = screen.getByLabelText('前一天');
      const next = screen.getByLabelText('後一天');
      expect(prev).toBeDisabled();
      expect(next).toBeDisabled();
      // Clicking doesn't fire either callback — neutral placeholder
      fireEvent.click(prev);
      fireEvent.click(next);
      expect(onChange).not.toHaveBeenCalled();
      expect(onLockedAttempt).not.toHaveBeenCalled();
    });

    it('when tier is loading, container is NOT marked as locked (no lock icons render)', () => {
      renderWith({ tier: undefined, isTierLoading: true });
      const prev = screen.getByLabelText('前一天');
      // data-state attribute drives icon selection — 'loading' means
      // neutral chevron (not Lock). data-locked stays false to avoid
      // misleading lock styling.
      expect(prev).toHaveAttribute('data-state', 'loading');
    });

    it('when tier loading then resolves to PRO, arrow click fires onChange', () => {
      // First render — loading
      const { rerender } = render(
        <DateNavigator
          value={TODAY}
          todayBaziIso={TODAY}
          tier={undefined}
          isTierLoading={true}
          onChange={jest.fn()}
          onLockedAttempt={jest.fn()}
        />,
      );
      let next = screen.getByLabelText('後一天');
      expect(next).toBeDisabled();

      // Re-render with tier resolved
      const onChange2 = jest.fn();
      rerender(
        <DateNavigator
          value={TODAY}
          todayBaziIso={TODAY}
          tier="PRO"
          isTierLoading={false}
          onChange={onChange2}
          onLockedAttempt={jest.fn()}
        />,
      );
      next = screen.getByLabelText('後一天');
      expect(next).not.toBeDisabled();
      fireEvent.click(next);
      expect(onChange2).toHaveBeenCalledWith('2026-05-19');
    });
  });
});
