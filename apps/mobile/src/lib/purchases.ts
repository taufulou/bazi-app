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
let inFlight: Promise<boolean> | null = null;

/**
 * Bind the RC SDK to a signed-in user. Safe to call on every sign-in and from
 * the store screen. No-op (returns false) when unsupported.
 *
 * `Purchases.configure` runs ONCE per process — asked of the SDK itself, not of
 * our memo, because sign-out clears the memo while the SDK stays configured. A
 * second `configure` replaces the shared instance and drops its listeners (1C
 * item 6). Every later user is a `logIn`. Concurrent callers (the identity bridge
 * and the store screen at sign-in) share one in-flight call.
 */
export async function configurePurchases(clerkUserId: string): Promise<boolean> {
  const apiKey = platformKey();
  if (!apiKey || !clerkUserId) return false;

  if (inFlight) await inFlight.catch(() => false);
  if (configuredForUser === clerkUserId) return true;

  inFlight = (async () => {
    try {
      if (!(await Purchases.isConfigured())) {
        if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
        Purchases.configure({ apiKey, appUserID: clerkUserId });
      } else {
        await Purchases.logIn(clerkUserId);
      }
      configuredForUser = clerkUserId;
      return true;
    } catch (err) {
      console.warn('[purchases] configure failed', err);
      return false;
    }
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Clear the RC identity on sign-out (best-effort). Asks the SDK rather than our
 * memo, so an identity bound by the sign-in bridge is cleared even if this module
 * never configured it in this session. Logging out an anonymous user throws in
 * RC, so that case is skipped.
 */
export async function logOutPurchases(): Promise<void> {
  if (!isPurchasesSupported()) return;
  try {
    if ((await Purchases.isConfigured()) && !(await Purchases.isAnonymous())) {
      await Purchases.logOut();
    }
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

/**
 * Outcome of a restore (1C item 6, F26). It used to collapse every failure into
 * "nothing to restore", which hid the case that matters under O4: the purchase
 * belongs to ANOTHER account (RevenueCat "keep with original App User ID").
 */
export type RestoreResult =
  | { kind: 'restored'; hasPurchases: boolean }
  | { kind: 'other_account' }
  | { kind: 'error' };

/** RC error codes: RECEIPT_ALREADY_IN_USE_ERROR / RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR. */
const OTHER_ACCOUNT_CODES = new Set(['7', '13']);

export function hasAnyPurchase(info: CustomerInfo | null | undefined): boolean {
  if (!info) return false;
  return (
    Object.keys(info.entitlements?.active ?? {}).length > 0 ||
    (info.activeSubscriptions?.length ?? 0) > 0 ||
    (info.nonSubscriptionTransactions?.length ?? 0) > 0
  );
}

export async function restorePurchases(): Promise<RestoreResult> {
  if (!isPurchasesSupported()) return { kind: 'error' };
  try {
    const info = await Purchases.restorePurchases();
    return { kind: 'restored', hasPurchases: hasAnyPurchase(info) };
  } catch (err) {
    const code = String((err as { code?: unknown })?.code ?? '');
    if (OTHER_ACCOUNT_CODES.has(code)) return { kind: 'other_account' };
    console.warn('[purchases] restore failed', err);
    return { kind: 'error' };
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
export const MANAGE_SUBSCRIPTIONS_URL =
  Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';

/**
 * iOS: Apple's own manage-subscriptions sheet — the only view that lists SANDBOX
 * subscriptions, which is what App Review uses. Falls back to the account URL on
 * Android, when RC is not configured, or on any failure.
 */
export async function openManageSubscriptions(): Promise<void> {
  if (Platform.OS === 'ios' && isPurchasesSupported()) {
    try {
      if (await Purchases.isConfigured()) {
        await Purchases.showManageSubscriptions();
        return;
      }
    } catch (err) {
      console.warn('[purchases] showManageSubscriptions failed', err);
    }
  }
  try {
    await Linking.openURL(MANAGE_SUBSCRIPTIONS_URL);
  } catch (err) {
    console.warn('[purchases] openManageSubscriptions failed', err);
  }
}

/** Test-only: reset the module's configured-user memo. */
export function __resetPurchasesForTest(): void {
  configuredForUser = null;
  inFlight = null;
}
