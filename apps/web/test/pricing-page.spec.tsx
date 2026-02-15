/**
 * Tests for PricingPage component.
 * Validates plan display, billing toggle, CTA checkout flow,
 * toast notifications, and sign-in redirect.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PricingPage from '../app/pricing/page';

// ============================================================
// Mocks
// ============================================================

const mockGetToken = jest.fn();
let mockIsSignedIn = false;

jest.mock('@clerk/nextjs', () => ({
  useAuth: () => ({
    getToken: mockGetToken,
    isSignedIn: mockIsSignedIn,
  }),
  useUser: () => ({
    user: mockIsSignedIn ? { id: 'user-1' } : null,
  }),
}));

// Mock Next.js hooks
const mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

jest.mock('next/link', () => {
  return ({ children, href, ...props }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} {...props}>{children}</a>
  );
});

// Mock API functions
const mockCreateSubscriptionCheckout = jest.fn();
jest.mock('../app/lib/api', () => ({
  createSubscriptionCheckout: (...args: any[]) => mockCreateSubscriptionCheckout(...args),
}));

// Mock @repo/shared
jest.mock('@repo/shared', () => ({
  DEFAULT_PLANS: {
    basic: { priceMonthly: 4.99, priceAnnual: 39.99, readingsPerMonth: 5 },
    pro: { priceMonthly: 9.99, priceAnnual: 79.99, readingsPerMonth: 15 },
    master: { priceMonthly: 19.99, priceAnnual: 159.99, readingsPerMonth: -1 },
  },
}));

// ============================================================
// Tests
// ============================================================

describe('PricingPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSignedIn = false;
    mockGetToken.mockResolvedValue('test-token');
    // Reset search params
    mockSearchParams.delete('subscription');
    mockSearchParams.delete('cancelled');
  });

  it('renders all three plan cards with names', () => {
    render(<PricingPage />);

    // Plan names appear in card headings + comparison table headers
    expect(screen.getAllByText('Basic').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Pro').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Master').length).toBeGreaterThanOrEqual(1);
  });

  it('shows monthly prices by default', () => {
    render(<PricingPage />);

    expect(screen.getByText('4.99')).toBeInTheDocument();
    expect(screen.getByText('9.99')).toBeInTheDocument();
    expect(screen.getByText('19.99')).toBeInTheDocument();
  });

  it('toggles to annual prices when toggle is clicked', () => {
    render(<PricingPage />);

    // Click the annual label
    fireEvent.click(screen.getByText('年繳'));

    // Annual prices divided by 12
    expect(screen.getByText('3.33')).toBeInTheDocument(); // 39.99/12
    expect(screen.getByText('6.67')).toBeInTheDocument(); // 79.99/12
    expect(screen.getByText('13.33')).toBeInTheDocument(); // 159.99/12

    // Should show savings badge
    expect(screen.getByText(/最高省 33%/)).toBeInTheDocument();
  });

  it('shows recommended badge on Pro plan', () => {
    render(<PricingPage />);

    expect(screen.getByText('推薦')).toBeInTheDocument();
  });

  it('shows comparison table', () => {
    render(<PricingPage />);

    expect(screen.getByText('免費體驗')).toBeInTheDocument();
    expect(screen.getByText('每月解讀次數')).toBeInTheDocument();
    expect(screen.getByText('八字終身運')).toBeInTheDocument();
  });

  it('renders CTA as buttons (not links)', () => {
    render(<PricingPage />);

    const ctaButtons = screen.getAllByRole('button');
    const planButtons = ctaButtons.filter(
      (btn) => btn.textContent === '立即訂閱' || btn.textContent === '選擇方案'
    );
    expect(planButtons).toHaveLength(3);
  });

  it('does not call API for unauthenticated users on CTA click', () => {
    mockIsSignedIn = false;

    render(<PricingPage />);

    const basicButton = screen.getAllByRole('button').find(
      (btn) => btn.textContent === '選擇方案'
    )!;
    fireEvent.click(basicButton);

    // API should NOT be called — user is redirected to sign-in instead
    expect(mockCreateSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it('calls createSubscriptionCheckout on CTA click for signed-in user', async () => {
    mockIsSignedIn = true;
    mockCreateSubscriptionCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/session_123',
      sessionId: 'cs_123',
    });

    render(<PricingPage />);

    const proButton = screen.getByText('立即訂閱');
    fireEvent.click(proButton);

    await waitFor(() => {
      expect(mockCreateSubscriptionCheckout).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({
          planSlug: 'pro',
          billingCycle: 'monthly',
        }),
      );
    });
  });

  it('passes annual billingCycle when toggle is on', async () => {
    mockIsSignedIn = true;
    mockCreateSubscriptionCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/session_456',
      sessionId: 'cs_456',
    });

    render(<PricingPage />);

    // Toggle to annual
    fireEvent.click(screen.getByText('年繳'));

    const proButton = screen.getByText('立即訂閱');
    fireEvent.click(proButton);

    await waitFor(() => {
      expect(mockCreateSubscriptionCheckout).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({
          billingCycle: 'annual',
        }),
      );
    });
  });

  it('shows error when checkout fails', async () => {
    mockIsSignedIn = true;
    mockCreateSubscriptionCheckout.mockRejectedValue(new Error('Stripe error'));

    render(<PricingPage />);

    const proButton = screen.getByText('立即訂閱');
    fireEvent.click(proButton);

    await waitFor(() => {
      expect(screen.getByText('Stripe error')).toBeInTheDocument();
    });
  });

  it('does not show manage link for unauthenticated users', () => {
    mockIsSignedIn = false;
    render(<PricingPage />);

    expect(screen.queryByText('管理我的訂閱')).not.toBeInTheDocument();
  });
});
