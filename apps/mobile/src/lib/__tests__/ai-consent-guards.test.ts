/**
 * 1C item 2, layer 1 — no AI or AI-charging request leaves the device without
 * consent. Every guarded function is driven with consent missing and must send
 * nothing; promise functions reject with AiConsentRequiredError, stream
 * functions route the refusal through onError → onClose (never a throw).
 */
import { fetch as expoFetch } from 'expo/fetch';
import {
  AI_CONSENT_REQUIRED_CODE,
  AiConsentRequiredError,
  __setAiConsentStatusForTest,
  isAiConsentRequiredError,
  statusFromServer,
  AI_CONSENT_VERSION,
  type AiConsentStatus,
} from '../ai-consent-state';
import { ApiError } from '../api-error';
import { openSseStream } from '../stream';
import {
  fetchDailyFortune,
  fetchMonthlyFortune,
  streamDailyFortune,
  streamMonthlyFortune,
  streamYearlyFortune,
} from '../fortune-api';
import {
  createBaziReading,
  regenerateBaziReading,
  streamBaziReading,
  generateCompatibilityAI,
  streamCompatibilityReading,
  createBaziCompatibility,
} from '../readings-api';
import { createChatSession, extendSession, streamChatMessage } from '../chat-api';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
const mockExpoFetch = expoFetch as jest.Mock;
const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  jest.clearAllMocks();
  __setAiConsentStatusForTest('missing');
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
});

afterAll(() => {
  __setAiConsentStatusForTest('unknown');
});

/** Wait for queued microtasks. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('statusFromServer', () => {
  it('granted when the recorded version is still accepted', () => {
    expect(statusFromServer({ aiConsentVersion: AI_CONSENT_VERSION, aiConsentAcceptedVersions: [AI_CONSENT_VERSION] })).toBe('granted');
  });
  it('granted for an older still-accepted version even if this build is outdated', () => {
    expect(statusFromServer({ aiConsentVersion: 'ai-old', aiConsentAcceptedVersions: ['ai-old'] })).toBe('granted');
  });
  it('outdated when this build\'s version is no longer accepted and nothing valid is recorded', () => {
    expect(statusFromServer({ aiConsentVersion: null, aiConsentAcceptedVersions: ['ai-newer'] })).toBe('outdated');
  });
  it('missing when nothing is recorded, or the recorded version was withdrawn from the list', () => {
    expect(statusFromServer({ aiConsentVersion: null, aiConsentAcceptedVersions: [AI_CONSENT_VERSION] })).toBe('missing');
    expect(statusFromServer({ aiConsentVersion: 'ai-removed', aiConsentAcceptedVersions: [AI_CONSENT_VERSION] })).toBe('missing');
  });
  it('an API predating 1B (no list) → missing, never granted', () => {
    expect(statusFromServer({})).toBe('missing');
    // A recorded version is never self-validating: without the server's list,
    // only THIS build's version counts as accepted.
    expect(statusFromServer({ aiConsentVersion: 'ai-unknown' })).toBe('missing');
  });
});

describe('the refusal error', () => {
  it('is an ApiError with a user-facing message and the AI_CONSENT_REQUIRED code', () => {
    const e = new AiConsentRequiredError();
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe(AI_CONSENT_REQUIRED_CODE);
    expect(e.message).toBe('請先同意 AI 解讀資料說明');
    expect(isAiConsentRequiredError(e)).toBe(true);
    expect(isAiConsentRequiredError({ code: AI_CONSENT_REQUIRED_CODE })).toBe(true);
    expect(isAiConsentRequiredError(new Error('x'))).toBe(false);
  });
});

describe('openSseStream with requiresAiConsent', () => {
  const run = () => {
    const onError = jest.fn();
    const onClose = jest.fn();
    const onEvent = jest.fn();
    const teardown = openSseStream({ url: 'https://x/s', token: 't', onEvent, onError, onClose, requiresAiConsent: true });
    return { onError, onClose, onEvent, teardown };
  };

  it.each<AiConsentStatus>(['missing', 'unknown', 'outdated', 'error'])(
    'status %s: no request, onError(AiConsentRequiredError) then onClose, on a microtask',
    async (status) => {
      __setAiConsentStatusForTest(status);
      const { onError, onClose, teardown } = run();
      expect(typeof teardown).toBe('function');
      // Not synchronous: callers assign the teardown first, then onClose clears it.
      expect(onError).not.toHaveBeenCalled();
      await flush();
      expect(mockExpoFetch).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(AiConsentRequiredError);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onError.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
    },
  );

  it('a teardown before the microtask suppresses the callbacks', async () => {
    const { onError, onClose, teardown } = run();
    teardown();
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('granted: the request is sent', async () => {
    __setAiConsentStatusForTest('granted');
    mockExpoFetch.mockReturnValue(new Promise(() => {}));
    run();
    await flush();
    expect(mockExpoFetch).toHaveBeenCalledTimes(1);
  });

  it('a stream without the flag is unaffected', async () => {
    mockExpoFetch.mockReturnValue(new Promise(() => {}));
    openSseStream({ url: 'https://x/s', token: 't', onEvent: jest.fn(), onError: jest.fn(), onClose: jest.fn() });
    await flush();
    expect(mockExpoFetch).toHaveBeenCalledTimes(1);
  });
});

describe('every AI-calling function refuses without consent and sends nothing', () => {
  const rejects = async (p: Promise<unknown>) => {
    await expect(p).rejects.toBeInstanceOf(AiConsentRequiredError);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockExpoFetch).not.toHaveBeenCalled();
  };

  it('fetchDailyFortune (with narration)', () => rejects(fetchDailyFortune({ token: 't' })));
  it('fetchMonthlyFortune', () => rejects(fetchMonthlyFortune({ token: 't' })));
  it('createBaziReading (charges credits)', () =>
    rejects(createBaziReading('t', { birthProfileId: 'p', readingType: 'lifetime', stream: true })));
  it('regenerateBaziReading', () => rejects(regenerateBaziReading('t', 'r')));
  it('generateCompatibilityAI', () => rejects(generateCompatibilityAI('t', 'c')));
  it('createBaziCompatibility WITHOUT skipAI', () =>
    rejects(createBaziCompatibility('t', { profileAId: 'a', profileBId: 'b', comparisonType: 'romance' })));
  it('createChatSession — a rejected promise, not a synchronous throw', async () => {
    let p: Promise<unknown> | undefined;
    expect(() => {
      p = createChatSession({ readingId: 'r', token: 't' });
    }).not.toThrow();
    await rejects(p!);
  });
  it('extendSession — a rejected promise, not a synchronous throw', async () => {
    let p: Promise<unknown> | undefined;
    expect(() => {
      p = extendSession({ sessionId: 's', token: 't' });
    }).not.toThrow();
    await rejects(p!);
  });

  const streams: Array<[string, (h: { onError: jest.Mock; onClose: jest.Mock }) => void]> = [
    ['streamDailyFortune', (h) => void streamDailyFortune({ token: 't', onEvent: jest.fn(), ...h })],
    ['streamMonthlyFortune', (h) => void streamMonthlyFortune({ token: 't', onEvent: jest.fn(), ...h })],
    ['streamYearlyFortune', (h) => void streamYearlyFortune({ token: 't', onEvent: jest.fn(), ...h })],
    ['streamChatMessage', (h) => void streamChatMessage({ sessionId: 's', content: 'c', token: 't', onEvent: jest.fn(), ...h })],
  ];
  it.each(streams)('%s routes the refusal through onError → onClose', async (_n, start) => {
    const onError = jest.fn();
    const onClose = jest.fn();
    expect(() => start({ onError, onClose })).not.toThrow();
    await flush();
    expect(mockExpoFetch).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(AiConsentRequiredError));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['streamBaziReading', streamBaziReading],
    ['streamCompatibilityReading', streamCompatibilityReading],
  ] as const)('%s reports the refusal with its code', async (_n, fn) => {
    const onError = jest.fn();
    const cbs = { onSectionComplete: jest.fn(), onCallComplete: jest.fn(), onSummary: jest.fn(), onDone: jest.fn(), onError };
    expect(() => fn('t', 'id', cbs as never)).not.toThrow();
    await flush();
    expect(mockExpoFetch).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith({ message: '請先同意 AI 解讀資料說明', code: AI_CONSENT_REQUIRED_CODE });
  });
});

describe('engine-only paths need no consent', () => {
  it('fetchDailyFortune({ engineOnly: true }) is sent', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ engineOutput: {} }) });
    await fetchDailyFortune({ token: 't', engineOnly: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0][0])).toContain('engineOnly=true');
  });

  it('createBaziCompatibility({ skipAI: true }) is sent', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'c' }) });
    await createBaziCompatibility('t', { profileAId: 'a', profileBId: 'b', comparisonType: 'romance', skipAI: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
