/** 1C item 6 — the one sign-out path clears RevenueCat and consent first, and never hangs. */
import { signOutAndClear, PURCHASES_LOGOUT_TIMEOUT_MS } from '../session';
import { __setAiConsentStatusForTest, getAiConsentStatus } from '../ai-consent-state';

const mockLogOut = jest.fn();
jest.mock('../purchases', () => ({ logOutPurchases: () => mockLogOut() }));

beforeEach(() => {
  jest.useRealTimers();
  mockLogOut.mockReset();
  __setAiConsentStatusForTest('granted');
});

it('logs RevenueCat out and clears consent BEFORE signing out of Clerk', async () => {
  const order: string[] = [];
  mockLogOut.mockImplementation(async () => {
    order.push('rc');
  });
  const signOut = jest.fn(async () => {
    order.push(`clerk:${getAiConsentStatus()}`);
  });
  await signOutAndClear(signOut);
  expect(order).toEqual(['rc', 'clerk:unknown']);
});

it('a hung RevenueCat logout does not block sign-out past the timeout', async () => {
  jest.useFakeTimers();
  mockLogOut.mockReturnValue(new Promise(() => {}));
  const signOut = jest.fn(async () => {});
  const done = signOutAndClear(signOut);
  await jest.advanceTimersByTimeAsync(PURCHASES_LOGOUT_TIMEOUT_MS + 10);
  await done;
  expect(signOut).toHaveBeenCalledTimes(1);
});

it('a failing RevenueCat logout still signs out', async () => {
  mockLogOut.mockRejectedValue(new Error('net'));
  const signOut = jest.fn(async () => {});
  await signOutAndClear(signOut);
  expect(signOut).toHaveBeenCalledTimes(1);
});
