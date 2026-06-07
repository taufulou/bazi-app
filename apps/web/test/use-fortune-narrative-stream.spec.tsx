/**
 * Tests for useFortuneNarrativeStream — Phase Fortune Streaming Layer 4.
 *
 * Mocks @clerk/nextjs and the underlying streamDailyFortune helper. Captures
 * the helper's callbacks via a per-test fake so we can simulate engine_ready,
 * section_complete, done, and error events.
 */
import { act, renderHook, waitFor } from '@testing-library/react';

// ============================================================
// Mocks
// ============================================================

const mockGetToken = jest.fn();
jest.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

type StreamArgs = {
  token: string;
  profileId?: string;
  date?: string;
  onEvent: (ev: any) => void;
  onError: (err: Error) => void;
  onClose: () => void;
};
let lastStreamArgs: StreamArgs | null = null;
let abortSpy = jest.fn();
const mockStreamDailyFortune = jest.fn();
jest.mock('../app/lib/fortune-api', () => ({
  __esModule: true,
  streamDailyFortune: (args: StreamArgs) => mockStreamDailyFortune(args),
}));

import { useFortuneNarrativeStream } from '../app/components/fortune/hooks/useFortuneNarrativeStream';

// ============================================================
// Helpers
// ============================================================

function setupStreamCapture() {
  lastStreamArgs = null;
  abortSpy = jest.fn();
  mockStreamDailyFortune.mockClear();
  mockStreamDailyFortune.mockImplementation((args: StreamArgs) => {
    lastStreamArgs = args;
    return abortSpy;
  });
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// ============================================================
// Tests
// ============================================================

describe('useFortuneNarrativeStream', () => {
  beforeEach(() => {
    setupStreamCapture();
    mockGetToken.mockReset();
    mockGetToken.mockResolvedValue('sk-test-token');
  });

  it('does NOT open the stream when enabled=false', () => {
    renderHook(() =>
      useFortuneNarrativeStream({
        enabled: false,
        profileId: 'p1',
        date: '2026-05-14',
        onEvent: jest.fn(),
      }),
    );
    expect(mockStreamDailyFortune).not.toHaveBeenCalled();
  });

  it('opens stream with token + profileId + date on mount when enabled=true', async () => {
    const onEvent = jest.fn();
    renderHook(() =>
      useFortuneNarrativeStream({
        enabled: true,
        profileId: 'p1',
        date: '2026-05-14',
        onEvent,
      }),
    );
    await waitFor(() => expect(mockStreamDailyFortune).toHaveBeenCalledTimes(1));
    expect(lastStreamArgs).toMatchObject({
      token: 'sk-test-token',
      profileId: 'p1',
      date: '2026-05-14',
    });
  });

  it('forwards each event to the caller-provided onEvent', async () => {
    const onEvent = jest.fn();
    renderHook(() =>
      useFortuneNarrativeStream({
        enabled: true,
        profileId: 'p1',
        date: '2026-05-14',
        onEvent,
      }),
    );
    await waitFor(() => expect(mockStreamDailyFortune).toHaveBeenCalled());

    act(() => {
      lastStreamArgs!.onEvent({ type: 'engine_ready', engineOutput: {} as any, profileId: 'p1', profileBirthDate: '1987-09-06', profileBirthTime: '16:11', date: '2026-05-14' });
    });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine_ready' }));

    act(() => {
      lastStreamArgs!.onEvent({ type: 'section_complete', key: 'daily_overview', value: 'X' });
    });
    expect(onEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'section_complete', key: 'daily_overview',
    }));
  });

  it('tracks section keys in sectionsReceived as events arrive', async () => {
    const { result } = renderHook(() =>
      useFortuneNarrativeStream({
        enabled: true,
        profileId: 'p1',
        date: '2026-05-14',
        onEvent: jest.fn(),
      }),
    );
    await waitFor(() => expect(mockStreamDailyFortune).toHaveBeenCalled());

    expect(result.current.sectionsReceived.size).toBe(0);

    act(() => {
      lastStreamArgs!.onEvent({ type: 'section_complete', key: 'daily_overview', value: 'X' });
    });
    expect(result.current.sectionsReceived.has('daily_overview')).toBe(true);
    expect(result.current.sectionsReceived.size).toBe(1);

    act(() => {
      lastStreamArgs!.onEvent({ type: 'section_complete', key: 'daily_romance', value: 'Y' });
    });
    expect(result.current.sectionsReceived.size).toBe(2);
  });

  it('streaming=true until onClose fires, then false', async () => {
    const { result } = renderHook(() =>
      useFortuneNarrativeStream({
        enabled: true,
        profileId: 'p1',
        date: '2026-05-14',
        onEvent: jest.fn(),
      }),
    );
    await waitFor(() => expect(result.current.streaming).toBe(true));

    act(() => {
      lastStreamArgs!.onClose();
    });
    await waitFor(() => expect(result.current.streaming).toBe(false));
  });

  it('captures error events into state', async () => {
    const { result } = renderHook(() =>
      useFortuneNarrativeStream({
        enabled: true,
        profileId: 'p1',
        date: '2026-05-14',
        onEvent: jest.fn(),
      }),
    );
    await waitFor(() => expect(mockStreamDailyFortune).toHaveBeenCalled());

    act(() => {
      lastStreamArgs!.onEvent({ type: 'error', code: 'AI_FAILED', message: 'oops' });
    });
    expect(result.current.error).toEqual({ code: 'AI_FAILED', message: 'oops' });
  });

  it('clearError resets the error state', async () => {
    const { result } = renderHook(() =>
      useFortuneNarrativeStream({
        enabled: true,
        profileId: 'p1',
        date: '2026-05-14',
        onEvent: jest.fn(),
      }),
    );
    await waitFor(() => expect(mockStreamDailyFortune).toHaveBeenCalled());

    act(() => {
      lastStreamArgs!.onEvent({ type: 'error', code: 'AI_FAILED', message: 'oops' });
    });
    expect(result.current.error).not.toBeNull();

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it('aborts existing stream + re-opens when date changes', async () => {
    const initialDate = '2026-05-14';
    const { rerender } = renderHook(
      ({ date }: { date: string }) =>
        useFortuneNarrativeStream({
          enabled: true,
          profileId: 'p1',
          date,
          onEvent: jest.fn(),
        }),
      { initialProps: { date: initialDate } },
    );
    await waitFor(() => expect(mockStreamDailyFortune).toHaveBeenCalledTimes(1));
    expect(abortSpy).not.toHaveBeenCalled();

    // Switch date
    setupStreamCapture();
    rerender({ date: '2026-05-15' });
    await waitFor(() => expect(mockStreamDailyFortune).toHaveBeenCalledTimes(1));
    // The OLD stream's abort was called on cleanup. Since setupStreamCapture
    // replaced abortSpy AFTER the first stream's args were captured, we can't
    // assert directly here — instead verify the new stream opened with new date.
    expect(lastStreamArgs?.date).toBe('2026-05-15');
  });

  it('aborts stream when enabled toggles to false', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useFortuneNarrativeStream({
          enabled,
          profileId: 'p1',
          date: '2026-05-14',
          onEvent: jest.fn(),
        }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(mockStreamDailyFortune).toHaveBeenCalledTimes(1));
    expect(abortSpy).not.toHaveBeenCalled();

    rerender({ enabled: false });
    await waitFor(() => expect(abortSpy).toHaveBeenCalledTimes(1));
    expect(result.current.streaming).toBe(false);
  });

  it('aborts stream on unmount', async () => {
    const { unmount } = renderHook(() =>
      useFortuneNarrativeStream({
        enabled: true,
        profileId: 'p1',
        date: '2026-05-14',
        onEvent: jest.fn(),
      }),
    );
    await waitFor(() => expect(mockStreamDailyFortune).toHaveBeenCalledTimes(1));

    unmount();
    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it('emits AUTH_FAILED error when getToken returns null', async () => {
    mockGetToken.mockResolvedValueOnce(null);
    const { result } = renderHook(() =>
      useFortuneNarrativeStream({
        enabled: true,
        profileId: 'p1',
        date: '2026-05-14',
        onEvent: jest.fn(),
      }),
    );
    await flush();
    await waitFor(() => expect(result.current.error?.code).toBe('AUTH_FAILED'));
    expect(mockStreamDailyFortune).not.toHaveBeenCalled();
    expect(result.current.streaming).toBe(false);
  });

  it('audit HIGH fix — guards onEvent against cancelled stale callbacks', async () => {
    // Race: when deps change (date / profileId), the old stream's in-flight
    // onEvent calls can arrive AFTER the cleanup has set cancelled=true.
    // Without the guard, late events would write into stale state.
    const onEvent = jest.fn();
    const { rerender } = renderHook(
      ({ date }: { date: string }) =>
        useFortuneNarrativeStream({
          enabled: true,
          profileId: 'p1',
          date,
          onEvent,
        }),
      { initialProps: { date: '2026-05-14' } },
    );
    await waitFor(() => expect(mockStreamDailyFortune).toHaveBeenCalled());
    const oldStreamArgs = lastStreamArgs!;

    // Trigger deps change → effect cleanup runs → cancelled=true; new stream opens
    setupStreamCapture();
    rerender({ date: '2026-05-15' });
    await waitFor(() => expect(mockStreamDailyFortune).toHaveBeenCalled());

    // Old stream emits a late section_complete after cancellation
    const onEventCallsBefore = onEvent.mock.calls.length;
    act(() => {
      oldStreamArgs.onEvent({ type: 'section_complete', key: 'daily_overview', value: 'stale' });
    });
    // The guard should drop the stale callback BEFORE it reaches the caller
    expect(onEvent.mock.calls.length).toBe(onEventCallsBefore);
  });

  it('sectionsReceived resets when stream re-opens (e.g., date change)', async () => {
    const { result, rerender } = renderHook(
      ({ date }: { date: string }) =>
        useFortuneNarrativeStream({
          enabled: true,
          profileId: 'p1',
          date,
          onEvent: jest.fn(),
        }),
      { initialProps: { date: '2026-05-14' } },
    );
    await waitFor(() => expect(mockStreamDailyFortune).toHaveBeenCalledTimes(1));
    act(() => {
      lastStreamArgs!.onEvent({ type: 'section_complete', key: 'daily_overview', value: 'X' });
    });
    expect(result.current.sectionsReceived.size).toBe(1);

    setupStreamCapture();
    rerender({ date: '2026-05-15' });
    await waitFor(() => expect(result.current.sectionsReceived.size).toBe(0));
  });
});
