import { Platform } from 'react-native';

/**
 * Centralised runtime env resolution.
 *
 * Android quirk: inside the Android emulator, `localhost`/`127.0.0.1` refer to
 * the emulator VM itself — NOT the host Mac running the API. The emulator
 * reaches the host loopback via the special alias 10.0.2.2. The iOS simulator
 * shares the host network, so localhost works there unchanged. We only rewrite
 * in __DEV__ (production uses a real public API URL).
 */
/**
 * Pure, testable core of the Android rewrite. Exported for unit tests so the
 * platform + dev flag can be passed explicitly instead of read from globals.
 */
export function resolveApiUrlFor(raw: string, os: string, isDev: boolean): string {
  if (isDev && os === 'android') {
    // Anchor to the host position (right after `//`, up to `:`/`/`/end) so only a
    // bare localhost/127.0.0.1 host is rewritten — NOT `mylocalhost.io` etc.
    return raw.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/, '//10.0.2.2');
  }
  return raw;
}

function resolveApiUrl(): string {
  // Strip trailing slashes so `${apiUrl}${path}` never yields `//api/...` (404).
  const raw = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/+$/, '');
  return resolveApiUrlFor(raw, Platform.OS, __DEV__);
}

export const env = {
  /** NestJS API base URL (Android-emulator-aware in dev). */
  apiUrl: resolveApiUrl(),
  /** Clerk publishable key (may be undefined in a bare dev build). */
  clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  /** Base URL for remotely-served assets (mascots etc.); empty until configured. */
  assetsUrl: process.env.EXPO_PUBLIC_ASSETS_URL ?? '',
  /** PostHog analytics key (analytics is a no-op when absent). */
  posthogKey: process.env.EXPO_PUBLIC_POSTHOG_KEY,
  /** Sentry DSN for crash reporting (init is skipped when absent). */
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
} as const;

export default env;
