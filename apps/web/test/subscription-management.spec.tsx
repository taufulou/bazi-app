/**
 * Tests for SubscriptionPage (subscription management).
 * Validates loading state, plan display, cancel/reactivate flow, and portal link.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SubscriptionPage from '../app/dashboard/subscription/page';

// ============================================================
// Mocks
// ============================================================

const mockGetToken = jest.fn();
let mockIsSignedIn = true;

jest.mock('@clerk/nextjs', () => ({
  useAuth: () => ({
    getToken: mockGetToken,
    isSignedIn: mockIsSignedIn,
  }),
}));

jest.mock('next/link', () => {
  return ({ children, href, ...props }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} {...props}>{children}</a>
  );
});

// Mock API functions
const mockGetSubscriptionStatus = jest.fn();
const mockCancelSubscription = jest.fn();
const mockReactivateSubscription = jest.fn();
const mockCreatePortalSession = jest.fn();
const mockGetInvoices = jest.fn();

jest.mock('../app/lib/api', () => ({
  // Real implementations: the page's Stripe/store decisions live in these.
  stripeSubscriptionOf: jest.requireActual('../app/lib/api').stripeSubscriptionOf,
  STORE_MANAGED_NOTE: jest.requireActual('../app/lib/api').STORE_MANAGED_NOTE,
  getSubscriptionStatus: (...args: any[]) => mockGetSubscriptionStatus(...args),
  cancelSubscription: (...args: any[]) => mockCancelSubscription(...args),
  reactivateSubscription: (...args: any[]) => mockReactivateSubscription(...args),
  createPortalSession: (...args: any[]) => mockCreatePortalSession(...args),
  getInvoices: (...args: any[]) => mockGetInvoices(...args),
}));

// ============================================================
// Test Data — matches SubscriptionStatus type from api.ts
// ============================================================

const freeSubscription: any = {
  subscriptionTier: 'FREE',
  credits: 0,
  activeSubscription: null,
  stripeSubscription: null,
};

const stripeRow = (over: Record<string, unknown> = {}) => ({
  planTier: 'PRO',
  platform: 'STRIPE',
  currentPeriodStart: '2026-03-15T00:00:00Z',
  currentPeriodEnd: '2026-04-15T00:00:00Z',
  status: 'ACTIVE',
  cancelledAt: null,
  ...over,
});

const proSubscription: any = {
  subscriptionTier: 'PRO',
  credits: 10,
  activeSubscription: stripeRow(),
  stripeSubscription: stripeRow(),
};

const masterSubscription: any = {
  subscriptionTier: 'MASTER',
  credits: 99,
  activeSubscription: stripeRow({ planTier: 'MASTER' }),
  stripeSubscription: stripeRow({ planTier: 'MASTER' }),
};

const cancelledRow = stripeRow({ status: 'CANCELLED', cancelledAt: '2026-03-10T00:00:00Z' });
const cancelledProSubscription: any = {
  ...proSubscription,
  activeSubscription: cancelledRow,
  stripeSubscription: cancelledRow,
};

const appleRow = (over: Record<string, unknown> = {}) =>
  stripeRow({ platform: 'APPLE_IAP', ...over });

const STRIPE_BUTTONS = ['管理帳務資料', '取消訂閱', '重新啟用訂閱'];
const STORE_NOTE = /此方案透過 App Store／Google Play 訂閱/;

// ============================================================
// Tests
// ============================================================

describe('SubscriptionPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSignedIn = true;
    mockGetToken.mockResolvedValue('test-token');
    mockGetInvoices.mockResolvedValue([]);
  });

  it('shows loading state initially', () => {
    mockGetSubscriptionStatus.mockReturnValue(new Promise(() => {})); // never resolves

    render(<SubscriptionPage />);

    expect(screen.getByText('載入訂閱資料...')).toBeInTheDocument();
  });

  it('shows FREE tier for user with no subscription', async () => {
    mockGetSubscriptionStatus.mockResolvedValue(freeSubscription);

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByText('免費方案')).toBeInTheDocument();
    });

    // Should show upgrade button
    expect(screen.getByText('升級方案')).toBeInTheDocument();
  });

  it('shows PRO subscription details for active subscriber', async () => {
    mockGetSubscriptionStatus.mockResolvedValue(proSubscription);

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByText('專業會員')).toBeInTheDocument();
    });

    // Should show credits
    expect(screen.getByText('10')).toBeInTheDocument();

    // Should show status
    expect(screen.getByText('啟用中')).toBeInTheDocument();

    // Should show renewal date
    expect(screen.getByText(/2026/)).toBeInTheDocument();

    // Should show cancel + portal buttons
    expect(screen.getByText('管理帳務資料')).toBeInTheDocument();
    expect(screen.getByText('取消訂閱')).toBeInTheDocument();
  });

  it('shows MASTER tier with real credit balance (no unlimited bypass)', async () => {
    mockGetSubscriptionStatus.mockResolvedValue(masterSubscription);

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByText('大師會員')).toBeInTheDocument();
    });

    // MASTER now shows actual credit count (99 per mock), not "無限"
    expect(screen.getByText('99')).toBeInTheDocument();
    expect(screen.queryByText('無限')).not.toBeInTheDocument();
  });

  it('shows cancel confirmation dialog', async () => {
    mockGetSubscriptionStatus.mockResolvedValue(proSubscription);

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByText('取消訂閱')).toBeInTheDocument();
    });

    // Click cancel
    fireEvent.click(screen.getByText('取消訂閱'));

    // Dialog should appear
    expect(screen.getByText('確認取消訂閱')).toBeInTheDocument();
    expect(screen.getByText(/取消後，您的訂閱將持續至當前計費週期結束/)).toBeInTheDocument();
    expect(screen.getByText('返回')).toBeInTheDocument();
    expect(screen.getByText('確認取消')).toBeInTheDocument();
  });

  it('calls cancelSubscription on confirmation', async () => {
    mockGetSubscriptionStatus
      .mockResolvedValueOnce(proSubscription)
      .mockResolvedValueOnce(cancelledProSubscription);
    mockCancelSubscription.mockResolvedValue({ message: 'ok' });

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByText('取消訂閱')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('取消訂閱'));
    fireEvent.click(screen.getByText('確認取消'));

    await waitFor(() => {
      expect(mockCancelSubscription).toHaveBeenCalledWith('test-token');
    });
  });

  it('shows reactivate button for cancelled subscription', async () => {
    mockGetSubscriptionStatus.mockResolvedValue(cancelledProSubscription);

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByText('將於到期日取消')).toBeInTheDocument();
    });

    expect(screen.getByText('重新啟用訂閱')).toBeInTheDocument();
  });

  // ---- 1B item 5: App Store / Google Play memberships ----

  it('store member: store label + note, no Stripe buttons, no 變更方案', async () => {
    mockGetSubscriptionStatus.mockResolvedValue({
      subscriptionTier: 'PRO',
      credits: 5,
      activeSubscription: appleRow(),
      stripeSubscription: null,
    });
    render(<SubscriptionPage />);
    await waitFor(() => expect(screen.getByText('App Store')).toBeInTheDocument());
    expect(screen.getByText(STORE_NOTE)).toBeInTheDocument();
    for (const b of STRIPE_BUTTONS) expect(screen.queryByText(b)).not.toBeInTheDocument();
    expect(screen.queryByText('變更方案')).not.toBeInTheDocument();
    expect(screen.queryByText('升級方案')).not.toBeInTheDocument();
  });

  it('Google Play member gets the Google Play label', async () => {
    mockGetSubscriptionStatus.mockResolvedValue({
      subscriptionTier: 'BASIC',
      credits: 5,
      activeSubscription: stripeRow({ platform: 'GOOGLE_PLAY' }),
      stripeSubscription: null,
    });
    render(<SubscriptionPage />);
    await waitFor(() => expect(screen.getByText('Google Play')).toBeInTheDocument());
    expect(screen.getByText(STORE_NOTE)).toBeInTheDocument();
  });

  it('mixed (newer Apple row + live Stripe row): Stripe controls stay AND the store note says where the Apple one is managed', async () => {
    mockGetSubscriptionStatus.mockResolvedValue({
      subscriptionTier: 'MASTER',
      credits: 5,
      activeSubscription: appleRow({ planTier: 'MASTER' }),
      stripeSubscription: stripeRow(),
    });
    render(<SubscriptionPage />);
    await waitFor(() => expect(screen.getByText('管理帳務資料')).toBeInTheDocument());
    expect(screen.getByText('取消訂閱')).toBeInTheDocument();
    expect(screen.getByText(STORE_NOTE)).toBeInTheDocument();
  });

  it('Stripe-only member: no store note', async () => {
    mockGetSubscriptionStatus.mockResolvedValue(proSubscription);
    render(<SubscriptionPage />);
    await waitFor(() => expect(screen.getByText('管理帳務資料')).toBeInTheDocument());
    expect(screen.queryByText(STORE_NOTE)).not.toBeInTheDocument();
  });

  it('cancelled Stripe row + newer ACTIVE Apple row: NO reactivate (double billing), store note shown', async () => {
    mockGetSubscriptionStatus.mockResolvedValue({
      subscriptionTier: 'PRO',
      credits: 5,
      activeSubscription: appleRow(),
      stripeSubscription: cancelledRow,
    });
    render(<SubscriptionPage />);
    await waitFor(() => expect(screen.getByText('App Store')).toBeInTheDocument());
    expect(screen.queryByText('重新啟用訂閱')).not.toBeInTheDocument();
    expect(screen.getByText(STORE_NOTE)).toBeInTheDocument();
    // The Stripe row still has a portal (invoices, card) — only the restart is withheld.
    expect(screen.getByText('管理帳務資料')).toBeInTheDocument();
  });

  it('portal-cancelled (ACTIVE + cancelledAt): badge, portal, NO reactivate, NO cancel', async () => {
    const row = stripeRow({ cancelledAt: '2026-04-15T00:00:00Z' });
    mockGetSubscriptionStatus.mockResolvedValue({
      subscriptionTier: 'PRO',
      credits: 5,
      activeSubscription: row,
      stripeSubscription: row,
    });
    render(<SubscriptionPage />);
    await waitFor(() => expect(screen.getByText('將於到期日取消')).toBeInTheDocument());
    expect(screen.getByText('管理帳務資料')).toBeInTheDocument();
    expect(screen.queryByText('重新啟用訂閱')).not.toBeInTheDocument();
    expect(screen.queryByText('取消訂閱')).not.toBeInTheDocument();
  });

  it('PAST_DUE with tier FREE: portal + notice, no 升級方案 (no second checkout)', async () => {
    mockGetSubscriptionStatus.mockResolvedValue({
      subscriptionTier: 'FREE',
      credits: 0,
      activeSubscription: null,
      stripeSubscription: stripeRow({ status: 'PAST_DUE' }),
    });
    render(<SubscriptionPage />);
    await waitFor(() => expect(screen.getByText('管理帳務資料')).toBeInTheDocument());
    expect(screen.getByText(/上一筆扣款未成功/)).toBeInTheDocument();
    expect(screen.queryByText('升級方案')).not.toBeInTheDocument();
    expect(screen.queryByText('取消訂閱')).not.toBeInTheDocument();
  });

  it('old API (no stripeSubscription key) with a Stripe activeSubscription: buttons still shown', async () => {
    mockGetSubscriptionStatus.mockResolvedValue({
      subscriptionTier: 'PRO',
      credits: 5,
      activeSubscription: stripeRow(),
    });
    render(<SubscriptionPage />);
    await waitFor(() => expect(screen.getByText('管理帳務資料')).toBeInTheDocument());
    expect(screen.getByText('取消訂閱')).toBeInTheDocument();
  });

  it('new API null + STALE cancelled Stripe activeSubscription: no reactivate (null is not "missing")', async () => {
    mockGetSubscriptionStatus.mockResolvedValue({
      subscriptionTier: 'FREE',
      credits: 0,
      activeSubscription: cancelledRow,
      stripeSubscription: null,
    });
    render(<SubscriptionPage />);
    await waitFor(() => expect(screen.getByText('免費方案')).toBeInTheDocument());
    for (const b of STRIPE_BUTTONS) expect(screen.queryByText(b)).not.toBeInTheDocument();
    expect(screen.getByText('升級方案')).toBeInTheDocument();
  });

  it('cancel dialog shows the STRIPE period end, not the newer store row\'s', async () => {
    mockGetSubscriptionStatus.mockResolvedValue({
      subscriptionTier: 'MASTER',
      credits: 5,
      activeSubscription: appleRow({ currentPeriodEnd: '2027-01-20T00:00:00Z' }),
      stripeSubscription: stripeRow({ currentPeriodEnd: '2026-12-05T00:00:00Z' }),
    });
    render(<SubscriptionPage />);
    await waitFor(() => expect(screen.getByText('取消訂閱')).toBeInTheDocument());
    fireEvent.click(screen.getByText('取消訂閱'));
    const dialogText = screen.getByText(/取消後，您的訂閱將持續至當前計費週期結束/).textContent ?? '';
    expect(dialogText).toContain('12月');
    expect(dialogText).not.toContain('1月20');
  });

  it('shows error when API call fails', async () => {
    mockGetSubscriptionStatus.mockRejectedValue(new Error('Network error'));

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });
});
