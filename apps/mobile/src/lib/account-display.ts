/**
 * How 我的 shows the signed-in account (1C item 1). Sign in with Apple users often
 * have no first name and, if they chose "Hide My Email", a relay address that
 * means nothing to them.
 */

const APPLE_RELAY_DOMAIN = '@privaterelay.appleid.com';

export function isAppleRelayEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(APPLE_RELAY_DOMAIN);
}

/** The email line on the account card (already translated text for the relay case). */
export function accountEmailLabel(email: string | null | undefined): string {
  if (!email) return '';
  return isAppleRelayEmail(email) ? '已隱藏的 Apple 電子郵件' : email;
}

export function accountDisplayName(firstName: string | null | undefined): string {
  const name = firstName?.trim();
  return name ? name : '會員';
}
