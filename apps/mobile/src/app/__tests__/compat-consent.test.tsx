/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted */
/**
 * 1C item 2 on 合盤: the reveal (where 3 credits are charged) asks for AI-data
 * consent from the tap, BEFORE any state changes. Declining leaves the paywall
 * exactly as it was and calls nothing; the chat button asks before the sheet
 * opens. Heavy children are stubbed — this is about the screen's ordering.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import CompatScreen from '../(authenticated)/compat';
import { useAiConsent } from '../../lib/ai-consent';
import { streamCompatibilityReading } from '../../lib/readings-api';

// Stable objects, like the real hooks: the screen's load effect depends on
// `router`, and a new object per render would re-run it and wipe the state.
jest.mock('expo-router', () => {
  const router = { push: jest.fn(), replace: jest.fn(), setParams: jest.fn(), back: jest.fn() };
  const params = { id: 'cmp_1' };
  return { useRouter: () => router, useLocalSearchParams: () => params };
});
jest.mock('@clerk/clerk-expo', () => ({
  useAuth: () => ({ getToken: jest.fn().mockResolvedValue('tok') }),
}));
// A STABLE zh, like the real hook: this screen's load effect depends on it, and
// a fresh function per render re-runs that effect and wipes the screen's state.
jest.mock('../../lib/language', () => {
  const zh = (s: string) => s;
  return { useZh: () => zh };
});
jest.mock('../../lib/ai-consent', () => ({ useAiConsent: jest.fn() }));
jest.mock('../../lib/api', () => ({
  ...jest.requireActual('../../lib/api-error'),
  getUserProfile: jest.fn().mockResolvedValue({ subscriptionTier: 'FREE', credits: 10, languagePref: 'zh-TW', languageChosen: true }),
}));
jest.mock('../../lib/birth-profiles-api', () => ({ fetchBirthProfiles: jest.fn().mockResolvedValue([]) }));
jest.mock('../../lib/readings-api', () => ({
  ...jest.requireActual('../../lib/readings-api'),
  getCompatibility: jest.fn(),
  streamCompatibilityReading: jest.fn(() => ({ close: jest.fn() })),
  generateCompatibilityAI: jest.fn(),
  createBaziCompatibility: jest.fn(),
}));

jest.mock('../../components/BaziChart', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View, { testID: 'stub-chart' }) };
});
jest.mock('../../components/DualBirthDataForm', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View, { testID: 'stub-form' }) };
});
jest.mock('../../components/reading/PastReadingsSection', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View, { testID: 'stub-past' }) };
});
jest.mock('../../components/reading/AIReadingDisplay', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View, { testID: 'stub-ai' }) };
});
jest.mock('../../components/compat/CompatibilityScoreRevealV2', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View, { testID: 'stub-score' }) };
});
jest.mock('../../components/compat/ShareableCompatibilityCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View, { testID: 'stub-share-card' }) };
});
jest.mock('../../components/fortune/ShareFortuneButton', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View, { testID: 'stub-share' }) };
});
const mockChat = { visible: false };
jest.mock('../../components/chat/ChatSheet', () => {
  const C = (p: { visible: boolean }) => {
    mockChat.visible = p.visible;
    return null;
  };
  return { __esModule: true, default: C };
});
jest.mock('../../components/chat/ChatFloatingButton', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  const C = (p: { onPress: () => void }) => React.createElement(Pressable, { testID: 'chat-fab', onPress: p.onPress });
  return { __esModule: true, default: C };
});
jest.mock('../../components/compat/CompatibilityRevealCTA', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  const C = (p: { onReveal: () => void }) => React.createElement(Pressable, { testID: 'reveal', onPress: p.onReveal });
  return { __esModule: true, default: C };
});

const comparison = {
  id: 'cmp_1',
  comparisonType: 'ROMANCE',
  aiInterpretation: null,
  profileA: { name: 'A', birthDate: '1987-09-06' },
  profileB: { name: 'B', birthDate: '1987-01-25' },
  calculationData: {
    chartA: { gender: 'male' },
    chartB: { gender: 'female' },
    romancePreAnalysis: { blendedScore: 70, blendedLabel: '天生一對' },
  },
};

const mockUseAiConsent = useAiConsent as jest.Mock;
const mockStream = streamCompatibilityReading as jest.Mock;
const { getCompatibility } = jest.requireMock('../../lib/readings-api') as { getCompatibility: jest.Mock };

function withConsent(answer: boolean) {
  const requireAiConsent = jest.fn().mockResolvedValue(answer);
  mockUseAiConsent.mockReturnValue({ status: answer ? 'granted' : 'missing', requireAiConsent, withdraw: jest.fn(), refresh: jest.fn() });
  return requireAiConsent;
}

beforeEach(() => {
  jest.clearAllMocks();
  getCompatibility.mockResolvedValue(comparison);
});

async function mountResult() {
  await render(<CompatScreen />);
  await act(async () => {});
  expect(screen.getByTestId('reveal')).toBeTruthy(); // the paywall gate is up
}

it('declining consent at the reveal: nothing is called and the paywall stays', async () => {
  const require = withConsent(false);
  await mountResult();
  await act(async () => {
    fireEvent.press(screen.getByTestId('reveal'));
  });
  expect(require).toHaveBeenCalledTimes(1);
  expect(mockStream).not.toHaveBeenCalled();
  expect(screen.getByTestId('reveal')).toBeTruthy(); // not half-revealed
});

it('after declining, the reveal can be tapped again (the re-entry guard was released)', async () => {
  const require = withConsent(false);
  await mountResult();
  await act(async () => {
    fireEvent.press(screen.getByTestId('reveal'));
  });
  require.mockResolvedValue(true);
  await act(async () => {
    fireEvent.press(screen.getByTestId('reveal'));
  });
  expect(require).toHaveBeenCalledTimes(2);
  expect(mockStream).toHaveBeenCalledTimes(1);
});

it('accepting consent at the reveal starts the paid stream', async () => {
  withConsent(true);
  await mountResult();
  await act(async () => {
    fireEvent.press(screen.getByTestId('reveal'));
  });
  expect(mockStream).toHaveBeenCalledWith('tok', 'cmp_1', expect.any(Object));
});

it('a consent refusal from the stream returns to the paywall without the refund wording', async () => {
  withConsent(true);
  mockStream.mockImplementation((_t: string, _id: string, cbs: { onError: (e: unknown) => void }) => {
    // Same timing as the real refusal: on a microtask, after the handle is returned.
    queueMicrotask(() => cbs.onError({ message: '請先同意 AI 解讀資料說明', code: 'AI_CONSENT_REQUIRED' }));
    return { close: jest.fn() };
  });
  await mountResult();
  await act(async () => {
    fireEvent.press(screen.getByTestId('reveal'));
  });
  await act(async () => {}); // the refusal arrives on a microtask
  expect(screen.getByTestId('reveal')).toBeTruthy();
  expect(screen.getByText('請先同意 AI 解讀資料說明')).toBeTruthy();
  expect(screen.queryByText(/若已扣點將自動退回/)).toBeNull();
});
