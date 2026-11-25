/**
 * 1C item 1 — Sign in with Apple → Clerk session. Every outcome the screen
 * distinguishes, read from THIS call's results only.
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import { signInWithApple, type ClerkSignInLike, type ClerkSignUpLike } from '../apple-sign-in';

jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(),
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'nonce-1' }));

const A = AppleAuthentication as jest.Mocked<typeof AppleAuthentication>;
const credential = (over: Record<string, unknown> = {}) =>
  ({ identityToken: 'id-token', fullName: { givenName: '小明', familyName: '王' }, ...over }) as never;

function clerk(signInResult: unknown, signUpResult: unknown = { status: 'complete', createdSessionId: 'sess_up' }) {
  const signIn = { create: jest.fn().mockResolvedValue(signInResult) } as unknown as ClerkSignInLike & { create: jest.Mock };
  const signUp = { create: jest.fn().mockResolvedValue(signUpResult) } as unknown as ClerkSignUpLike & { create: jest.Mock };
  return { signIn, signUp };
}

beforeEach(() => {
  jest.clearAllMocks();
  A.isAvailableAsync.mockResolvedValue(true);
  A.signInAsync.mockResolvedValue(credential());
});

it('requests name + email with a nonce, signs in with the identity token', async () => {
  const { signIn, signUp } = clerk({ status: 'complete', createdSessionId: 'sess_in' });
  await expect(signInWithApple(signIn, signUp)).resolves.toEqual({ kind: 'session', sessionId: 'sess_in' });
  expect(A.signInAsync).toHaveBeenCalledWith({ requestedScopes: [0, 1], nonce: 'nonce-1' });
  expect(signIn.create).toHaveBeenCalledWith({ strategy: 'oauth_token_apple', token: 'id-token' });
  expect(signUp.create).not.toHaveBeenCalled();
});

it('a new user is transferred to a sign-up WITH the name Apple sends only once', async () => {
  const { signIn, signUp } = clerk({ status: 'needs_identifier', createdSessionId: null, firstFactorVerification: { status: 'transferable' } });
  await expect(signInWithApple(signIn, signUp)).resolves.toEqual({ kind: 'session', sessionId: 'sess_up' });
  expect(signUp.create).toHaveBeenCalledWith({ transfer: true, firstName: '小明', lastName: '王' });
});

it('no name from Apple (returning user on a new install) → no name sent, not empty strings', async () => {
  A.signInAsync.mockResolvedValue(credential({ fullName: null }));
  const { signIn, signUp } = clerk({ status: null, createdSessionId: null, firstFactorVerification: { status: 'transferable' } });
  await signInWithApple(signIn, signUp);
  expect(signUp.create).toHaveBeenCalledWith({ transfer: true, firstName: undefined, lastName: undefined });
});

it('sign-up missing_requirements → incomplete', async () => {
  const { signIn, signUp } = clerk(
    { status: null, createdSessionId: null, firstFactorVerification: { status: 'transferable' } },
    { status: 'missing_requirements', createdSessionId: null },
  );
  await expect(signInWithApple(signIn, signUp)).resolves.toEqual({ kind: 'incomplete', status: 'missing_requirements' });
});

it('any other sign-in status → incomplete, never a session', async () => {
  const { signIn, signUp } = clerk({ status: 'needs_second_factor', createdSessionId: null, firstFactorVerification: { status: 'verified' } });
  await expect(signInWithApple(signIn, signUp)).resolves.toEqual({ kind: 'incomplete', status: 'needs_second_factor' });
});

it('the user cancels Apple\'s sheet → cancelled (no Clerk call)', async () => {
  A.signInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
  const { signIn, signUp } = clerk({});
  await expect(signInWithApple(signIn, signUp)).resolves.toEqual({ kind: 'cancelled' });
  expect(signIn.create).not.toHaveBeenCalled();
});

it('unavailable device → unavailable', async () => {
  A.isAvailableAsync.mockResolvedValue(false);
  const { signIn, signUp } = clerk({});
  await expect(signInWithApple(signIn, signUp)).resolves.toEqual({ kind: 'unavailable' });
});

it('no identity token → error', async () => {
  A.signInAsync.mockResolvedValue(credential({ identityToken: null }));
  const { signIn, signUp } = clerk({});
  await expect(signInWithApple(signIn, signUp)).resolves.toEqual({ kind: 'error' });
});

it('a Clerk error → error carrying Clerk\'s message', async () => {
  const { signIn, signUp } = clerk({});
  (signIn.create as jest.Mock).mockRejectedValue({ errors: [{ longMessage: 'Sign in not allowed' }] });
  await expect(signInWithApple(signIn, signUp)).resolves.toEqual({ kind: 'error', message: 'Sign in not allowed' });
});
