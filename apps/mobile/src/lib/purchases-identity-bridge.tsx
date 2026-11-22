/**
 * Binds RevenueCat to the signed-in Clerk user as soon as one exists (1C item 6,
 * F19). RC used to be configured only when the store screen opened, so a
 * background-completed or Ask-to-Buy transaction in any other session landed on
 * an anonymous RC id that maps to no user. Lazy import: the native purchases
 * module stays off the boot path until there is a user. Renders nothing.
 */
import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-expo';
import { loadPurchases } from './lazy-purchases';

export function PurchasesIdentityBridge() {
  const { userId } = useAuth();
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const purchases = loadPurchases();
        if (cancelled || !purchases.isPurchasesSupported()) return;
        await purchases.configurePurchases(userId);
      } catch {
        // best-effort; the store screen configures again on open
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return null;
}
