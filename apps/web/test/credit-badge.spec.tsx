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

// Mock next/link to avoid router context requirement
jest.mock('next/link', () => {
  return jest.fn(({ href, children, className, ...rest }: any) => (
    <a href={href} className={className} {...rest}>{children}</a>
  ));
});

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

  it('tier badge links to subscription management', async () => {
    render(<CreditBadge />);

    await waitFor(() => {
      const tierLink = screen.getByText('專業').closest('a');
      expect(tierLink).toHaveAttribute('href', '/dashboard/subscription');
    });
  });

  it('credit count links to store', async () => {
    render(<CreditBadge />);

    await waitFor(() => {
      const creditLink = screen.getByText('10').closest('a');
      expect(creditLink).toHaveAttribute('href', '/store');
    });
  });

  it('MASTER tier credit count links to store', async () => {
    mockGetUserProfile.mockResolvedValue({
      credits: 999,
      subscriptionTier: 'MASTER',
      freeReadingUsed: true,
    });
    render(<CreditBadge />);

    await waitFor(() => {
      expect(screen.getByText('大師')).toBeInTheDocument();
      expect(screen.getByText('999')).toBeInTheDocument();
      const creditLink = screen.getByText('999').closest('a');
      expect(creditLink).toHaveAttribute('href', '/store');
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
