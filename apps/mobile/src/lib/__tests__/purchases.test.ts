/**
 * Tests for the RevenueCat wrapper — graceful-when-unconfigured, configure
 * idempotency + identity switch, and the purchase/restore result shapes. The
 * native `react-native-purchases` module is mocked.
 */
import Purchases from 'react-native-purchases';
import { env } from '../env';
import {
  isPurchasesSupported,
  configurePurchases,
  getCurrentOffering,
  purchasePackage,
  restorePurchases,
  __resetPurchasesForTest,
} from '../purchases';

// Mutable env mock — purchases.ts reads env at CALL time, so mutating these
// between tests toggles supported/unsupported without re-importing.
jest.mock('../env', () => ({ env: { revenueCatIosKey: undefined, revenueCatAndroidKey: undefined } }));

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    logIn: jest.fn().mockResolvedValue({}),
    logOut: jest.fn().mockResolvedValue({}),
    setLogLevel: jest.fn(),
    getOfferings: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
    getCustomerInfo: jest.fn(),
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(),
  },
  LOG_LEVEL: { WARN: 'WARN' },
}));

const P = Purchases as jest.Mocked<typeof Purchases>;
const mutableEnv = env as { revenueCatIosKey?: string; revenueCatAndroidKey?: string };

describe('purchases wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetPurchasesForTest();
    mutableEnv.revenueCatIosKey = undefined; // jest-expo Platform.OS defaults to 'ios'
    mutableEnv.revenueCatAndroidKey = undefined;
  });

  describe('unconfigured (no platform key)', () => {
    it('isPurchasesSupported is false + configure/getOfferings no-op', async () => {
      expect(isPurchasesSupported()).toBe(false);
      await expect(configurePurchases('clerk_1')).resolves.toBe(false);
      expect(P.configure).not.toHaveBeenCalled();
      await expect(getCurrentOffering()).resolves.toBeNull();
    });

    it('purchasePackage returns a non-error unavailable result', async () => {
      const res = await purchasePackage({ identifier: 'pkg' } as never);
      expect(res).toEqual({ success: false, userCancelled: false, error: 'IAP not available' });
      expect(P.purchasePackage).not.toHaveBeenCalled();
    });
  });

  describe('configured (ios key present)', () => {
    beforeEach(() => {
      mutableEnv.revenueCatIosKey = 'appl_key';
    });

    it('isPurchasesSupported true + configure passes appUserID=clerkUserId', async () => {
      expect(isPurchasesSupported()).toBe(true);
      const ok = await configurePurchases('clerk_1');
      expect(ok).toBe(true);
      expect(P.configure).toHaveBeenCalledWith({ apiKey: 'appl_key', appUserID: 'clerk_1' });
    });

    it('is idempotent for the same user + logIn-switches a different user', async () => {
      await configurePurchases('clerk_1');
      await configurePurchases('clerk_1'); // same → no re-configure
      expect(P.configure).toHaveBeenCalledTimes(1);
      expect(P.logIn).not.toHaveBeenCalled();

      await configurePurchases('clerk_2'); // different → logIn
      expect(P.logIn).toHaveBeenCalledWith('clerk_2');
      expect(P.configure).toHaveBeenCalledTimes(1);
    });

    it('getCurrentOffering returns offerings.current', async () => {
      const current = { identifier: 'default', availablePackages: [] };
      P.getOfferings.mockResolvedValue({ current } as never);
      await expect(getCurrentOffering()).resolves.toBe(current);
    });

    it('purchasePackage maps success / user-cancel / error', async () => {
      P.purchasePackage.mockResolvedValueOnce({ customerInfo: { id: 'ci' } } as never);
      await expect(purchasePackage({ identifier: 'p' } as never)).resolves.toMatchObject({ success: true, userCancelled: false });

      P.purchasePackage.mockRejectedValueOnce({ userCancelled: true });
      await expect(purchasePackage({ identifier: 'p' } as never)).resolves.toEqual({ success: false, userCancelled: true });

      P.purchasePackage.mockRejectedValueOnce({ message: 'network' });
      await expect(purchasePackage({ identifier: 'p' } as never)).resolves.toMatchObject({ success: false, userCancelled: false, error: 'network' });
    });

    it('restorePurchases returns the CustomerInfo', async () => {
      P.restorePurchases.mockResolvedValue({ id: 'ci' } as never);
      await expect(restorePurchases()).resolves.toEqual({ id: 'ci' });
    });
  });
});
