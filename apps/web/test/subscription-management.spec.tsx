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
const mockGetUserProfile = jest.fn();
const mockCancelSubscription = jest.fn();
const mockReactivateSubscription = jest.fn();
const mockCreatePortalSession = jest.fn();

jest.mock('../app/lib/api', () => ({
  getSubscriptionStatus: (...args: any[]) => mockGetSubscriptionStatus(...args),
  getUserProfile: (...args: any[]) => mockGetUserProfile(...args),
  cancelSubscription: (...args: any[]) => mockCancelSubscription(...args),
  reactivateSubscription: (...args: any[]) => mockReactivateSubscription(...args),
  createPortalSession: (...args: any[]) => mockCreatePortalSession(...args),
}));

// ============================================================
// Test Data
// ============================================================

const freeProfile = {
  id: 'user-1',
  credits: 0,
  subscriptionTier: 'FREE' as const,
  freeReadingUsed: false,
  name: 'Test User',
};

const proProfile = {
  id: 'user-2',
  credits: 10,
  subscriptionTier: 'PRO' as const,
  freeReadingUsed: true,
  name: 'Pro User',
};

const masterProfile = {
  ...proProfile,
  subscriptionTier: 'MASTER' as const,
  credits: 99,
};

const activeSubscription = {
  subscribed: true,
  plan: 'pro',
  status: 'active',
  currentPeriodEnd: '2026-04-15T00:00:00Z',
  cancelAtPeriodEnd: false,
};

const cancelledSubscription = {
  ...activeSubscription,
  cancelAtPeriodEnd: true,
};

const freeSubscription = {
  subscribed: false,
  plan: null,
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

// ============================================================
// Tests
// ============================================================

describe('SubscriptionPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSignedIn = true;
    mockGetToken.mockResolvedValue('test-token');
  });

  it('shows loading state initially', () => {
    mockGetSubscriptionStatus.mockReturnValue(new Promise(() => {})); // never resolves
    mockGetUserProfile.mockReturnValue(new Promise(() => {}));

    render(<SubscriptionPage />);

    expect(screen.getByText('載入訂閱資料...')).toBeInTheDocument();
  });

  it('shows FREE tier for user with no subscription', async () => {
    mockGetSubscriptionStatus.mockResolvedValue(freeSubscription);
    mockGetUserProfile.mockResolvedValue(freeProfile);

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByText('免費方案')).toBeInTheDocument();
    });

    // Should show upgrade button
    expect(screen.getByText('升級方案')).toBeInTheDocument();

    // Free reading should be available
    expect(screen.getByText('1 次可用')).toBeInTheDocument();
  });

  it('shows PRO subscription details for active subscriber', async () => {
    mockGetSubscriptionStatus.mockResolvedValue(activeSubscription);
    mockGetUserProfile.mockResolvedValue(proProfile);

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByText('Pro 方案')).toBeInTheDocument();
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

  it('shows MASTER tier with unlimited credits', async () => {
    mockGetSubscriptionStatus.mockResolvedValue(activeSubscription);
    mockGetUserProfile.mockResolvedValue(masterProfile);

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByText('Master 方案')).toBeInTheDocument();
    });

    expect(screen.getByText('無限')).toBeInTheDocument();
  });

  it('shows cancel confirmation dialog', async () => {
    mockGetSubscriptionStatus.mockResolvedValue(activeSubscription);
    mockGetUserProfile.mockResolvedValue(proProfile);

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
      .mockResolvedValueOnce(activeSubscription)
      .mockResolvedValueOnce(cancelledSubscription);
    mockGetUserProfile.mockResolvedValue(proProfile);
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
    mockGetSubscriptionStatus.mockResolvedValue(cancelledSubscription);
    mockGetUserProfile.mockResolvedValue(proProfile);

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByText('將於到期日取消')).toBeInTheDocument();
    });

    expect(screen.getByText('重新啟用訂閱')).toBeInTheDocument();
  });

  it('shows error when API call fails', async () => {
    mockGetSubscriptionStatus.mockRejectedValue(new Error('Network error'));
    mockGetUserProfile.mockRejectedValue(new Error('Network error'));

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });
});
