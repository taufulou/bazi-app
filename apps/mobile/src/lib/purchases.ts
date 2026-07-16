/**
 * RevenueCat (in-app purchases) wrapper — the single seam the app uses for IAP.
 *
 * Design:
 * - `appUserID` is ALWAYS the Clerk user id (never RC's anonymous id) so the
 *   backend webhook can map `event.app_user_id` → our User.
 * - Disabled-gracefully: when the platform's public key is absent
 *   (`EXPO_PUBLIC_RC_IOS_KEY` / `EXPO_PUBLIC_RC_ANDROID_KEY`), `isPurchasesSupported()`
 *   is false and the store screen shows a friendly "coming soon" state instead
 *   of crashing. This lets the app ship before the RC dashboard is configured.
 * - Purchases/entitlements are granted server-side by the RC webhook →
 *   EntitlementsService; the client only kicks off the purchase and then polls
 *   `/api/users/me` for the resulting credits/tier (see the store screen).
 *
 * NOTE: `react-native-purchases` is a NATIVE module — after installing it the
 * dev client must be rebuilt (`expo run:ios` / `run:android`). It is mocked in
 * jest.
 */
import { Platform, Linking } from 'react-native';
import Purchases, {
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesOfferings,
  type PurchasesPackage,
  LOG_LEVEL,
} from 'react-native-purchases';
import { env } from './env';

/** The public SDK key for the current platform (undefined → IAP disabled). */
function platformKey(): string | undefined {
  return Platform.OS === 'ios' ? env.revenueCatIosKey : env.revenueCatAndroidKey;
}

/** Whether IAP can run on this build (a platform key is present). */
export function isPurchasesSupported(): boolean {
  return !!platformKey();
}

let configuredForUser: string | null = null;

/**
 * Configure the RC SDK for a signed-in user (idempotent per user). Safe to call
 * on every app focus / sign-in. No-op (returns false) when unsupported.
 */
export async function configurePurchases(clerkUserId: string): Promise<boolean> {
  const apiKey = platformKey();
  if (!apiKey || !clerkUserId) return false;

  try {
    if (configuredForUser === null) {
      if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
      Purchases.configure({ apiKey, appUserID: clerkUserId });
      configuredForUser = clerkUserId;
    } else if (configuredForUser !== clerkUserId) {
      // A different user signed in on the same process — switch RC identity.
      await Purchases.logIn(clerkUserId);
      configuredForUser = clerkUserId;
    }
    return true;
  } catch (err) {
    console.warn('[purchases] configure failed', err);
    return false;
  }
}

/** Clear RC identity on sign-out (best-effort). */
export async function logOutPurchases(): Promise<void> {
  if (!isPurchasesSupported() || configuredForUser === null) return;
  try {
    await Purchases.logOut();
  } catch (err) {
    console.warn('[purchases] logOut failed', err);
  } finally {
    configuredForUser = null;
  }
}

/** Fetch the current offering (subscriptions + credit packs). null when none. */
export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!isPurchasesSupported()) return null;
  try {
    const offerings: PurchasesOfferings = await Purchases.getOfferings();
    return offerings.current ?? null;
  } catch (err) {
    console.warn('[purchases] getOfferings failed', err);
    return null;
  }
}

export interface PurchaseResult {
  success: boolean;
  userCancelled: boolean;
  customerInfo?: CustomerInfo;
  error?: string;
}

/**
 * Purchase a package. A user-cancel is NOT an error (`userCancelled: true`).
 * On success the RC webhook grants entitlements server-side; the caller polls
 * `/api/users/me` for the reflected credits/tier.
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseResult> {
  if (!isPurchasesSupported()) {
    return { success: false, userCancelled: false, error: 'IAP not available' };
  }
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { success: true, userCancelled: false, customerInfo };
  } catch (e) {
    const err = e as { userCancelled?: boolean; message?: string };
    if (err?.userCancelled) {
      return { success: false, userCancelled: true };
    }
    console.warn('[purchases] purchase failed', e);
    return { success: false, userCancelled: false, error: err?.message ?? 'purchase failed' };
  }
}

/** Restore prior purchases. Returns the CustomerInfo (or null on failure). */
export async function restorePurchases(): Promise<CustomerInfo | null> {
  if (!isPurchasesSupported()) return null;
  try {
    return await Purchases.restorePurchases();
  } catch (err) {
    console.warn('[purchases] restore failed', err);
    return null;
  }
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!isPurchasesSupported()) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch (err) {
    console.warn('[purchases] getCustomerInfo failed', err);
    return null;
  }
}

/**
 * Subscribe to CustomerInfo updates (fires when an entitlement changes — lets
 * the UI reflect a new subscription tier instantly). Returns an unsubscribe fn.
 */
export function addCustomerInfoListener(cb: (info: CustomerInfo) => void): () => void {
  if (!isPurchasesSupported()) return () => {};
  Purchases.addCustomerInfoUpdateListener(cb);
  return () => Purchases.removeCustomerInfoUpdateListener(cb);
}

/**
 * Open the native store's manage-subscriptions page. Apple/Google subscriptions
 * can only be cancelled by the user in the store (never server-side), so the
 * account-deletion + paywall flows deep-link here.
 */
export async function openManageSubscriptions(): Promise<void> {
  const url =
    Platform.OS === 'ios'
      ? 'https://apps.apple.com/account/subscriptions'
      : 'https://play.google.com/store/account/subscriptions';
  try {
    await Linking.openURL(url);
  } catch (err) {
    console.warn('[purchases] openManageSubscriptions failed', err);
  }
}

/** Test-only: reset the module's configured-user memo. */
export function __resetPurchasesForTest(): void {
  configuredForUser = null;
}
