/**
 * Sign in with Apple → a Clerk session (1C item 1; guideline 4.8).
 *
 * Written directly rather than via Clerk's `useSignInWithApple`, which (in
 * @clerk/clerk-expo 2.19.31) discards the user's name — Apple sends it on the
 * FIRST authorisation only, so it can never be recovered — and returns
 * `createdSessionId: null` for four different reasons. The primitives are the
 * same ones the hook uses: Apple credential → `signIn.create({ strategy:
 * 'oauth_token_apple' })` → transfer to a sign-up for a new user.
 *
 * Statuses are read from the objects THIS call returns, never from state an
 * earlier attempt left on the shared Clerk resources.
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

export type AppleSignInResult =
  | { kind: 'session'; sessionId: string }
  | { kind: 'cancelled' }
  | { kind: 'unavailable' }
  | { kind: 'incomplete'; status?: string }
  | { kind: 'error'; message?: string };

/** The slice of Clerk's sign-in / sign-up resources this flow needs. */
export interface ClerkSignInLike {
  create(params: { strategy: 'oauth_token_apple'; token: string }): Promise<{
    status: string | null;
    createdSessionId: string | null;
    firstFactorVerification?: { status: string | null } | null;
  }>;
}
export interface ClerkSignUpLike {
  create(params: { transfer: true; firstName?: string; lastName?: string }): Promise<{
    status: string | null;
    createdSessionId: string | null;
  }>;
}

function clerkMessage(err: unknown): string | undefined {
  const e = err as { errors?: { longMessage?: string; message?: string }[]; message?: string };
  return e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || undefined;
}

export async function signInWithApple(
  signIn: ClerkSignInLike,
  signUp: ClerkSignUpLike,
): Promise<AppleSignInResult> {
  if (!(await AppleAuthentication.isAvailableAsync())) return { kind: 'unavailable' };

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: Crypto.randomUUID(),
    });
  } catch (err) {
    if ((err as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return { kind: 'cancelled' };
    return { kind: 'error', message: (err as Error)?.message };
  }

  if (!credential.identityToken) return { kind: 'error' };

  try {
    const si = await signIn.create({ strategy: 'oauth_token_apple', token: credential.identityToken });
    if (si.status === 'complete' && si.createdSessionId) {
      return { kind: 'session', sessionId: si.createdSessionId };
    }
    if (si.firstFactorVerification?.status === 'transferable') {
      // New user. Store the name now — Apple will not send it again.
      const su = await signUp.create({
        transfer: true,
        firstName: credential.fullName?.givenName ?? undefined,
        lastName: credential.fullName?.familyName ?? undefined,
      });
      if (su.status === 'complete' && su.createdSessionId) {
        return { kind: 'session', sessionId: su.createdSessionId };
      }
      return { kind: 'incomplete', status: su.status ?? undefined };
    }
    return { kind: 'incomplete', status: si.status ?? undefined };
  } catch (err) {
    return { kind: 'error', message: clerkMessage(err) };
  }
}
