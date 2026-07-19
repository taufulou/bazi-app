/**
 * RTL tests for the store screen — unsupported "coming soon" state, and the
 * populated (offering) state rendering subscription + credit-pack rows with
 * prices and compliance copy. RC + API + Clerk are mocked.
 */
import { render, screen, waitFor } from '@testing-library/react-native';
import StoreScreen from '../store';
import * as purchases from '../../lib/purchases';
import * as api from '../../lib/api';

jest.mock('@clerk/clerk-expo', () => ({
  useAuth: () => ({ getToken: jest.fn().mockResolvedValue('token'), userId: 'clerk_1', isSignedIn: true }),
}));
jest.mock('../../lib/language', () => ({ useZh: () => (s: string) => s }));
// Explicit factory (NOT automock) so the real purchases.ts — and the native
// react-native-purchases module it imports — is never loaded/transformed.
jest.mock('../../lib/purchases', () => ({
  isPurchasesSupported: jest.fn(),
  configurePurchases: jest.fn(),
  getCurrentOffering: jest.fn(),
  purchasePackage: jest.fn(),
  restorePurchases: jest.fn(),
  openManageSubscriptions: jest.fn(),
}));
jest.mock('../../lib/api');

const mockPurchases = purchases as jest.Mocked<typeof purchases>;
const mockApi = api as jest.Mocked<typeof api>;

function pkg(id: string, title: string, price: string, category: 'SUBSCRIPTION' | 'NON_SUBSCRIPTION') {
  return { identifier: id, product: { title, priceString: price, description: '', productCategory: category } } as never;
}

describe('StoreScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getUserProfile.mockResolvedValue({ credits: 42, subscriptionTier: 'FREE', languagePref: 'zh-TW', languageChosen: true });
  });

  it('shows the "coming soon" state when IAP is unsupported', async () => {
    mockPurchases.isPurchasesSupported.mockReturnValue(false);
    await render(<StoreScreen />);
    await waitFor(() => expect(screen.getByText('商店即將推出')).toBeTruthy());
    // Balance still renders from the profile fetch.
    expect(screen.getByText('42')).toBeTruthy();
    expect(mockPurchases.getCurrentOffering).not.toHaveBeenCalled();
  });

  it('renders subscription + credit-pack rows with prices + compliance copy', async () => {
    mockPurchases.isPurchasesSupported.mockReturnValue(true);
    mockPurchases.configurePurchases.mockResolvedValue(true);
    mockPurchases.getCurrentOffering.mockResolvedValue({
      identifier: 'default',
      availablePackages: [
        pkg('pro', '專業版 月費', 'NT$300', 'SUBSCRIPTION'),
        pkg('credits12', '12 點數包', 'NT$150', 'NON_SUBSCRIPTION'),
      ],
    } as never);

    await render(<StoreScreen />);

    await waitFor(() => expect(screen.getByText('專業版 月費')).toBeTruthy());
    expect(screen.getByText('訂閱方案')).toBeTruthy();
    expect(screen.getByText('點數包')).toBeTruthy();
    expect(screen.getByText('12 點數包')).toBeTruthy();
    expect(screen.getByText('NT$300')).toBeTruthy();
    expect(screen.getByText('NT$150')).toBeTruthy();
    expect(screen.getByText('恢復購買')).toBeTruthy();
    // Auto-renew compliance copy appears when a subscription is present.
    expect(screen.getByText(/訂閱為自動續訂/)).toBeTruthy();
  });

  it('shows the empty state when the offering has no packages', async () => {
    mockPurchases.isPurchasesSupported.mockReturnValue(true);
    mockPurchases.configurePurchases.mockResolvedValue(true);
    mockPurchases.getCurrentOffering.mockResolvedValue({ identifier: 'default', availablePackages: [] } as never);

    await render(<StoreScreen />);
    await waitFor(() => expect(screen.getByText('商店即將推出')).toBeTruthy());
  });
});
