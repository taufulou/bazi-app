/**
 * Tests for PricingPage component.
 * Validates plan display, billing toggle, CTA checkout flow,
 * toast notifications, and sign-in redirect.
 */
import { render, screen, fireEvent, waitFor, within} from '@testing-library/react';
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
const mockRouterBack = jest.fn();

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  // `page.tsx` gained `useRouter()` for its back button in 303fc15. This mock
  // was never extended, so every test in this file died on
  // `useRouter is not a function` — invisibly, because web jest is not in CI.
  useRouter: () => ({
    back: mockRouterBack,
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
    forward: jest.fn(),
  }),
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
    master: { priceMonthly: 19.99, priceAnnual: 159.99, readingsPerMonth: 50 },
  },
}));

// ============================================================
// Tests
// ============================================================

/**
 * The subscribe CTA, scoped to one plan card.
 *
 * ⚠️ These tests used to do `screen.getByText('立即訂閱')`, which worked only
 * while exactly one plan rendered that label. There are three, so it threw
 * "found multiple elements" — and separately the label itself changed from
 * 選擇方案. Both went unnoticed because web jest is not in CI.
 *
 * Scoping by card rather than by index so a reordering of the plans cannot
 * silently point these assertions at the wrong plan.
 */
function ctaFor(planName: string): HTMLElement {
  const heading = screen
    .getAllByText(planName)
    .find((el) => el.tagName === 'H2' && /planName/.test(el.className));
  if (!heading) throw new Error(`No plan card heading found for "${planName}"`);
  const card = heading.closest('[class*="planCard"]');
  if (!card) throw new Error(`Plan heading for "${planName}" is not inside a plan card`);
  return within(card as HTMLElement).getByRole('button');
}

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

    fireEvent.click(ctaFor('Basic'));

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

    fireEvent.click(ctaFor('Pro'));

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

    fireEvent.click(ctaFor('Pro'));

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

    fireEvent.click(ctaFor('Pro'));

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
