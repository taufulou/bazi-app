/**
 * Tests for CreditBadge component.
 * Validates credit display, tier badge, free trial indicator,
 * loading state, and refresh capability.
 */
import { render, screen, waitFor, act } from '@testing-library/react';
import CreditBadge, { type CreditBadgeHandle } from '../app/components/CreditBadge';
import { createRef } from 'react';

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

const mockGetUserProfile = jest.fn();

jest.mock('../app/lib/api', () => ({
  getUserProfile: (...args: any[]) => mockGetUserProfile(...args),
}));

// ============================================================
// Tests
// ============================================================

describe('CreditBadge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSignedIn = true;
    mockIsLoaded = true;
    mockGetToken.mockResolvedValue('test-token');
    mockGetUserProfile.mockResolvedValue({
      credits: 10,
      subscriptionTier: 'PRO',
      freeReadingUsed: true,
    });
  });

  it('shows loading skeleton initially', () => {
    // Make profile fetch hang
    mockGetUserProfile.mockReturnValue(new Promise(() => {}));
    render(<CreditBadge />);
    // Skeleton element should be present (loading state)
    const container = document.querySelector('[class*="skeleton"]');
    expect(container).toBeTruthy();
  });

  it('displays tier badge and credit count after loading', async () => {
    render(<CreditBadge />);

    await waitFor(() => {
      expect(screen.getByText('專業')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument();
    });
  });

  it('shows free trial gift badge when free reading not used', async () => {
    mockGetUserProfile.mockResolvedValue({
      credits: 0,
      subscriptionTier: 'FREE',
      freeReadingUsed: false,
    });

    render(<CreditBadge />);

    await waitFor(() => {
      expect(screen.getByText('免費')).toBeInTheDocument();
      expect(screen.getByText('🎁')).toBeInTheDocument();
    });
  });

  it('does not render when user is not signed in', () => {
    mockIsSignedIn = false;
    const { container } = render(<CreditBadge />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when API fails (silent degrade)', async () => {
    mockGetUserProfile.mockRejectedValue(new Error('Network error'));
    const { container } = render(<CreditBadge />);

    await waitFor(() => {
      // After loading resolves, should be empty (credits is null)
      expect(container.querySelector('[class*="skeleton"]')).toBeNull();
    });

    // Should not display any tier badge or credits
    expect(screen.queryByText('免費')).not.toBeInTheDocument();
    expect(screen.queryByText('專業')).not.toBeInTheDocument();
  });

  it('can refresh credit data via imperative handle', async () => {
    const ref = createRef<CreditBadgeHandle>();

    // Initial: 10 credits, PRO
    render(<CreditBadge ref={ref} />);

    await waitFor(() => {
      expect(screen.getByText('10')).toBeInTheDocument();
    });

    // Update mock to return new data
    mockGetUserProfile.mockResolvedValue({
      credits: 5,
      subscriptionTier: 'PRO',
      freeReadingUsed: true,
    });

    // Call refresh via ref
    await act(async () => {
      await ref.current?.refresh();
    });

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });
});
