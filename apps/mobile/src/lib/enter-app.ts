/**
 * The ONE way the app is entered after a successful sign-in / sign-up / reset.
 *
 * Sign-in, sign-up and reset-password are modal routes. A nested flow (登入 →
 * 忘記密碼 → reset, or 登入 → 註冊) left them on the stack when we `replace`d
 * the top one, and expo-router's native stack then treats `(authenticated)` —
 * pushed after a modal, with no `presentation` of its own — as ANOTHER modal on
 * top of them. The root view controller is then already presenting, so iOS
 * refuses the root-mounted AI-consent sheet: every AI feature silently did
 * nothing until restart (1C line audit). Dismissing the auth modals first puts
 * the app shell back at the root.
 *
 * `__tests__/app-store-guards.test.ts` fails on a direct replace elsewhere.
 */
import type { useRouter } from 'expo-router';

export const APP_HOME = '/(authenticated)/home' as const;

type Router = ReturnType<typeof useRouter>;

export function enterApp(router: Router): void {
  if (router.canDismiss?.()) router.dismissAll();
  router.replace(APP_HOME);
}
