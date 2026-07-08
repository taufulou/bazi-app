/**
 * Tests for HomeDailyFortuneCard.
 *
 * Locks the graceful-degradation contract introduced in the dashboard redesign:
 * the 今日運勢 heading is rendered INSIDE the component, so on a fetch failure the
 * whole section (heading + card) renders nothing — no orphaned heading (PR #54
 * review issue B).
 */
import { render, screen, waitFor } from '@testing-library/react';
import HomeDailyFortuneCard from '../app/components/HomeDailyFortuneCard';

// ============================================================
// Mocks
// ============================================================

const mockGetToken = jest.fn();
let mockIsSignedIn = true;
let mockIsLoaded = true;

jest.mock('@clerk/nextjs', () => ({
  useAuth: () => ({
    getToken: mockGetToken,
    isSignedIn: mockIsSignedIn,
    isLoaded: mockIsLoaded,
  }),
}));

// Mock next/link to avoid router context requirement
jest.mock('next/link', () =>
  jest.fn(({ href, children, className, ...rest }: any) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  )),
);

const mockFetchDailyFortune = jest.fn();

// Keep the real helpers (tierOf / resolveBaziToday / civilTodayTaipei /
// moodKeywordFromLabel) + the real FortuneApiError so `instanceof` still works;
// only stub the network call.
jest.mock('../app/lib/fortune-api', () => {
  const actual = jest.requireActual('../app/lib/fortune-api');
  return {
    ...actual,
    fetchDailyFortune: (...args: any[]) => mockFetchDailyFortune(...args),
  };
});

jest.mock('../app/lib/dev-warn', () => ({
  devWarnServiceDown: jest.fn(),
}));

// ============================================================
// Tests
// ============================================================

describe('HomeDailyFortuneCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSignedIn = true;
    mockIsLoaded = true;
    mockGetToken.mockResolvedValue('test-token');
  });

  it('renders the 今日運勢 heading + energy score on success', async () => {
    mockFetchDailyFortune.mockResolvedValue({
      date: '2026-07-09',
      engineOutput: { energyScore: 72, auspiciousness: '吉' },
    });

    render(<HomeDailyFortuneCard />);

    await waitFor(() => {
      expect(screen.getByText('今日運勢')).toBeInTheDocument();
      expect(screen.getByText('72')).toBeInTheDocument();
    });
  });

  it('renders nothing (no orphaned heading) when the fortune fetch fails', async () => {
    // A non-404 error routes to the `error` state, which must hide the whole
    // section — heading included.
    mockFetchDailyFortune.mockRejectedValue(new Error('engine down'));

    const { container } = render(<HomeDailyFortuneCard />);

    // Wait until the async effect settles (loading skeleton cleared). Asserting
    // synchronously would pass for the wrong reason — the heading is absent
    // during the initial loading tick too.
    await waitFor(() => {
      expect(container.querySelector('[class*="skeleton"]')).toBeNull();
    });

    // The heading and card are both gone — the section is fully absent.
    expect(screen.queryByText('今日運勢')).not.toBeInTheDocument();
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing while signed out', () => {
    mockIsSignedIn = false;
    const { container } = render(<HomeDailyFortuneCard />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('今日運勢')).not.toBeInTheDocument();
  });
});
