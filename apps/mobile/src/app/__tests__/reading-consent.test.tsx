/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted */
/**
 * 1C item 2 on paid readings: 解鎖 asks for AI-data consent from the tap, BEFORE
 * UnlockConfirmModal opens — iOS cannot present the consent sheet over it.
 * Declining keeps the modal closed and charges nothing. Heavy children are
 * stubbed — this is about the screen's ordering.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import ReadingScreen from '../reading/[type]';
import { useAiConsent } from '../../lib/ai-consent';
import { createBaziReading } from '../../lib/readings-api';

jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');
  const router = { push: jest.fn(), replace: jest.fn(), setParams: jest.fn(), back: jest.fn() };
  const params = { type: 'lifetime' };
  function Stack(p: Record<string, unknown>) {
    return React.createElement(View, p);
  }
  Stack.Screen = function StackScreen() {
    return null;
  };
  return { useRouter: () => router, useLocalSearchParams: () => params, Redirect: () => null, Stack };
});
jest.mock('@clerk/clerk-expo', () => ({
  useAuth: () => ({ getToken: jest.fn().mockResolvedValue('tok'), isSignedIn: true, isLoaded: true }),
}));
jest.mock('../../lib/language', () => {
  const zh = (s: string) => s;
  return { useZh: () => zh };
});
jest.mock('../../lib/ai-consent', () => ({ useAiConsent: jest.fn() }));
jest.mock('../../lib/api', () => ({
  ...jest.requireActual('../../lib/api-error'),
  getUserProfile: jest.fn().mockResolvedValue({ subscriptionTier: 'FREE', credits: 10, languagePref: 'zh-TW', languageChosen: true }),
}));
jest.mock('../../lib/bazi-api', () => ({ calculateBazi: jest.fn().mockResolvedValue({ fourPillars: {} }) }));
jest.mock('../../lib/birth-profiles-api', () => ({
  fetchBirthProfiles: jest.fn().mockResolvedValue([]),
  createBirthProfile: jest.fn().mockResolvedValue({ id: 'prof_1' }),
  updateBirthProfile: jest.fn(),
  formValuesToPayload: jest.fn(() => ({})),
}));
jest.mock('../../lib/readings-api', () => ({
  ...jest.requireActual('../../lib/readings-api'),
  createBaziReading: jest.fn(),
  streamBaziReading: jest.fn(() => ({ close: jest.fn() })),
  getReadingHistoryByType: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../components/BirthDataForm', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  const values = { name: 'R', birthDate: '1987-09-06', birthTime: '16:11', hourKnown: true, birthCity: '吉打', birthTimezone: 'Asia/Kuala_Lumpur', gender: 'male' };
  return {
    __esModule: true,
    default: (p: { onSubmit: (v: unknown, pid: null) => void }) =>
      React.createElement(Pressable, { testID: 'submit-form', onPress: () => p.onSubmit(values, null) }),
  };
});
jest.mock('../../components/BaziChart', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View), CHART_REVEAL_SECTIONS: [] };
});
jest.mock('../../components/reading/PaywallCTA', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return { __esModule: true, default: (p: { onUnlock: () => void }) => React.createElement(Pressable, { testID: 'unlock', onPress: p.onUnlock }) };
});
const mockModal = { visible: false };
jest.mock('../../components/reading/UnlockConfirmModal', () => ({
  __esModule: true,
  default: (p: { visible: boolean }) => {
    mockModal.visible = p.visible;
    return null;
  },
}));
jest.mock('../../components/reading/AIReadingDisplay', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/reading/StepIndicator', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/reading/CacheToast', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/reading/ProgressPill', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/reading/PastReadingsSection', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/chat/ChatFloatingButton', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/chat/ChatSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/chat/InlineAskCard', () => ({ __esModule: true, default: () => null }));

const mockUseAiConsent = useAiConsent as jest.Mock;
const mockCreate = createBaziReading as jest.Mock;

function withConsent(answer: boolean) {
  const requireAiConsent = jest.fn().mockResolvedValue(answer);
  mockUseAiConsent.mockReturnValue({ status: answer ? 'granted' : 'missing', requireAiConsent, withdraw: jest.fn(), refresh: jest.fn() });
  return requireAiConsent;
}

async function toPreview() {
  await render(<ReadingScreen />);
  await act(async () => {});
  await act(async () => {
    fireEvent.press(screen.getByTestId('submit-form'));
  });
  await act(async () => {});
  expect(screen.getByTestId('unlock')).toBeTruthy();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockModal.visible = false;
});

it('declining consent at 解鎖: the confirm modal never opens and nothing is charged', async () => {
  const require = withConsent(false);
  await toPreview();
  await act(async () => {
    fireEvent.press(screen.getByTestId('unlock'));
  });
  expect(require).toHaveBeenCalledTimes(1);
  expect(mockModal.visible).toBe(false);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('accepting consent at 解鎖 opens the confirm modal (the charge waits for its 確認)', async () => {
  withConsent(true);
  await toPreview();
  await act(async () => {
    fireEvent.press(screen.getByTestId('unlock'));
  });
  expect(mockModal.visible).toBe(true);
  expect(mockCreate).not.toHaveBeenCalled();
});
