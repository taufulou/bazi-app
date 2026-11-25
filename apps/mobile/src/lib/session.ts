/**
 * The ONE way the app signs out (1C item 6, F19). Clears what belongs to the
 * previous user before Clerk's session goes:
 * - the RevenueCat identity, so a background-completed purchase cannot land on
 *   the account that signed out (raced against a timeout — sign-out never waits
 *   on the network);
 * - the AI-consent enforcement state.
 *
 * `__tests__/single-sign-out.test.ts` fails if `signOut()` is called anywhere else.
 */
import { setAiConsentStatus } from './ai-consent-state';
import { loadPurchases } from './lazy-purchases';

export const PURCHASES_LOGOUT_TIMEOUT_MS = 3000;

export async function signOutAndClear(signOut: () => Promise<unknown>): Promise<void> {
  try {
    // Lazy: keeps the native purchases module off the boot path of the screens
    // that sign out (我的 is an always-mounted tab).
    const { logOutPurchases } = loadPurchases();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      logOutPurchases(),
      new Promise<void>((r) => {
        timer = setTimeout(r, PURCHASES_LOGOUT_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
  } catch {
    // best-effort — never block sign-out
  }
  setAiConsentStatus('unknown');
  await signOut();
}
