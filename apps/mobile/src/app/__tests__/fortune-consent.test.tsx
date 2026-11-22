/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted */
/**
 * 1C item 2 on the 運勢 tab: before AI-data consent, 日運 renders the engine-only
 * score (no AI stream) with the consent card where the narrative would be;
 * 月運 / 年運 fetch nothing; an unknown status starts nothing; a load failure
 * offers 重試; and the chat button asks for consent before the sheet opens.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import FortuneScreen from '../(authenticated)/fortune';
import { useAiConsent, type AiConsentApi } from '../../lib/ai-consent';
import { fetchDailyFortune } from '../../lib/fortune-api';
import { useFortuneNarrativeStream } from '../../components/fortune/hooks/useFortuneNarrativeStream';

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Stub = (props: Record<string, unknown>) =>
    React.createElement(View, props, (props as { children?: unknown }).children as never);
  return { __esModule: true, default: Stub, Svg: Stub, Circle: Stub, G: Stub, Path: Stub, Text: Stub, Defs: Stub, LinearGradient: Stub, Stop: Stub, Rect: Stub };
});
jest.mock('@clerk/clerk-expo', () => ({
  useAuth: () => ({ isSignedIn: true, isLoaded: true, getToken: jest.fn().mockResolvedValue('tok') }),
}));
jest.mock('../../lib/language', () => ({ useZh: () => (s: string) => s }));
jest.mock('../../lib/ai-consent', () => ({ useAiConsent: jest.fn() }));
jest.mock('../../components/fortune/hooks/useFortuneNarrativeStream', () => ({
  useFortuneNarrativeStream: jest.fn(() => ({ streaming: false, error: null, sectionsReceived: new Set(), clearError: jest.fn(), cancel: jest.fn() })),
}));
jest.mock('../../lib/api', () => ({
  ...jest.requireActual('../../lib/api-error'),
  getUserProfile: jest.fn().mockResolvedValue({ subscriptionTier: 'FREE', credits: 0, languagePref: 'zh-TW', languageChosen: true }),
}));
jest.mock('../../lib/birth-profiles-api', () => ({ fetchBirthProfiles: jest.fn().mockResolvedValue([]) }));
jest.mock('../../lib/fortune-api', () => ({
  ...jest.requireActual('../../lib/fortune-api'),
  fetchDailyFortune: jest.fn(),
}));
// The chat sheet is irrelevant here except for whether it was asked to open.
const mockChatProps: { open?: boolean; onOpenChange?: (o: boolean) => void } = {};
jest.mock('../../components/fortune/FortuneChat', () => {
  const Strip = () => null;
  const Chat = (props: { open: boolean; onOpenChange: (o: boolean) => void }) => {
    mockChatProps.open = props.open;
    mockChatProps.onOpenChange = props.onOpenChange;
    return null;
  };
  return { __esModule: true, default: Chat, SampleQuestionStrip: Strip };
});

const mockUseAiConsent = useAiConsent as jest.Mock;
const mockFetchDaily = fetchDailyFortune as jest.Mock;
const mockStream = useFortuneNarrativeStream as jest.Mock;

function consent(status: AiConsentApi['status'], requireAiConsent = jest.fn().mockResolvedValue(false)) {
  const api = { status, requireAiConsent, withdraw: jest.fn(), refresh: jest.fn().mockResolvedValue(undefined) };
  mockUseAiConsent.mockReturnValue(api);
  return api;
}

const dim = { score: 50, label: '平穩', signals: [] };
const engineResponse = {
  date: '2026-11-21',
  profileId: 'p1',
  profileBirthDate: '',
  narrative: null,
  cacheHit: false,
  generatedAt: '',
  engineOutput: {
    dayStem: '丁', dayBranch: '亥', dayGanZhi: '丁亥', dayTenGod: '正印', auspiciousness: '吉', energyScore: 72,
    metaFraming: 'soft_trigger',
    dimensions: { romance: dim, career: dim, finance: dim, travel: dim, health: dim },
    folkContent: {
      wealthDirection: { element: '火', direction: '南方', provenance: 'classical', note: '' },
      luckyColor: null, luckyNumber: null, luckyFoodFavor: null, luckyFoodAvoid: null, auspiciousHours: [],
    },
    ruleTrace: [], preAnalysisVersion: 'v',
  },
};

/** Was the AI stream ever asked to run? */
const streamEverEnabled = () => mockStream.mock.calls.some((c) => c[0]?.enabled === true);

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchDaily.mockResolvedValue(engineResponse);
});

it('before consent, 日運 uses the engine-only fetch, never the AI stream, and shows the consent card', async () => {
  consent('missing');
  await render(<FortuneScreen />);
  await act(async () => {});
  expect(mockFetchDaily).toHaveBeenCalledWith(expect.objectContaining({ engineOnly: true }));
  expect(streamEverEnabled()).toBe(false);
  expect(screen.getByText('72')).toBeTruthy(); // the engine score renders
  expect(screen.getByTestId('ai-consent-card')).toBeTruthy();
});

it('the card asks for consent', async () => {
  const api = consent('missing');
  await render(<FortuneScreen />);
  await act(async () => {});
  await act(async () => {
    fireEvent.press(screen.getByTestId('ai-consent-card-enable'));
  });
  expect(api.requireAiConsent).toHaveBeenCalledTimes(1);
});

it('granted: the stream runs and the engine-only fetch is not used', async () => {
  consent('granted');
  await render(<FortuneScreen />);
  await act(async () => {});
  expect(streamEverEnabled()).toBe(true);
  expect(mockFetchDaily).not.toHaveBeenCalled();
  expect(screen.queryByTestId('ai-consent-card')).toBeNull();
});

it('unknown: nothing starts — no stream, no engine-only fetch', async () => {
  consent('unknown');
  await render(<FortuneScreen />);
  await act(async () => {});
  expect(streamEverEnabled()).toBe(false);
  expect(mockFetchDaily).not.toHaveBeenCalled();
  expect(screen.getByText('正在為您排運勢…')).toBeTruthy();
});

it('a consent load failure offers 重試, which re-reads the consent', async () => {
  const api = consent('error');
  await render(<FortuneScreen />);
  await act(async () => {});
  expect(screen.getByTestId('fortune-consent-error')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByText('重試'));
  });
  expect(api.refresh).toHaveBeenCalledTimes(1);
  expect(mockFetchDaily).not.toHaveBeenCalled();
});

it.each([
  ['month', 'fortune-scope-month'],
  ['year', 'fortune-scope-year'],
])('before consent, %s fetches nothing and shows the consent card', async (_scope, testID) => {
  consent('missing');
  await render(<FortuneScreen />);
  await act(async () => {});
  mockFetchDaily.mockClear();
  mockStream.mockClear();
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
  expect(screen.getByTestId('ai-consent-card')).toBeTruthy();
  expect(mockStream.mock.calls.some((c) => c[0]?.scope !== 'day' && c[0]?.enabled)).toBe(false);
});

it('the chat button asks first: declined → the sheet stays closed; granted → it opens', async () => {
  const require = jest.fn().mockResolvedValue(false);
  consent('missing', require);
  await render(<FortuneScreen />);
  await act(async () => {});
  await act(async () => {
    mockChatProps.onOpenChange?.(true);
  });
  expect(require).toHaveBeenCalledTimes(1);
  expect(mockChatProps.open).toBe(false);

  require.mockResolvedValue(true);
  await act(async () => {
    mockChatProps.onOpenChange?.(true);
  });
  expect(mockChatProps.open).toBe(true);
});
