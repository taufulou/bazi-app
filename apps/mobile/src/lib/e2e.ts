/**
 * Dev-only E2E auth bypass — the RN analog of the web app's `__e2e_auth=1` cookie.
 *
 * Clerk email-OTP / password sign-in can't be automated in Maestro (and this dev
 * Clerk instance requires a phone number at sign-up), so authed flows can't be
 * driven end-to-end. When `EXPO_PUBLIC_E2E_BYPASS=1` in a DEBUG build, the
 * (authenticated) guard renders the tabs without a Clerk session. Screens that
 * need a token degrade gracefully (getToken → null); the free-preview 排盤 still
 * works because it hits the @Public() `/api/bazi/calculate` + `/explain-element`
 * passthroughs.
 *
 * `__DEV__` is compiled to `false` in release builds, so this can NEVER bypass in
 * production regardless of the env var. Default OFF.
 */
export const E2E_BYPASS_AUTH = __DEV__ && process.env.EXPO_PUBLIC_E2E_BYPASS === '1';
