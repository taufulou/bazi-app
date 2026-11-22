/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted */
/**
 * 1C item 2, layer 2 — the consent provider and sheet.
 *
 * The iOS timing rules are the point: the promise resolves from the sheet's
 * `onDismiss` (UIKit refuses a presentation while a dismissal animates), a sheet
 * that never shows cannot wedge the gate, and `granted` reaches the enforcement
 * layer BEFORE the caller resumes.
 */
import { act, render, screen, fireEvent } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { AiConsentProvider, useAiConsent, SHEET_SHOW_TIMEOUT_MS, SHEET_DISMISS_FALLBACK_MS, type AiConsentApi } from '../ai-consent';
import { AI_CONSENT_VERSION, getAiConsentStatus, __setAiConsentStatusForTest } from '../ai-consent-state';
import { ApiError } from '../api-error';
import { apiFetch } from '../api';

let mockUserId: string | null = 'user_1';
jest.mock('@clerk/clerk-expo', () => ({
  useAuth: () => ({ userId: mockUserId, getToken: jest.fn().mockResolvedValue('tok') }),
}));
jest.mock('../api', () => {
  const { ApiError: RealApiError } = jest.requireActual('../api-error');
  return { apiFetch: jest.fn(), ApiError: RealApiError };
});
jest.mock('../language', () => ({ useZh: () => (s: string) => s }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

const mockApiFetch = apiFetch as jest.Mock;

/**
 * RN unmounts a Modal whose `visible` is false, so its `onDismiss` cannot be
 * reached through the tree once closed — which is exactly the moment the test
 * needs it. Record the props instead; render children only while visible.
 */
type ModalProps = {
  visible?: boolean;
  onShow?: () => void;
  onDismiss?: () => void;
  onRequestClose?: () => void;
  children?: unknown;
};
const mockModal: { props: ModalProps | null } = { props: null };
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const React = require('react');
  const { View } = require('react-native');
  const M = (props: ModalProps) => {
    mockModal.props = props;
    return props.visible ? React.createElement(View, null, props.children) : null;
  };
  return { __esModule: true, default: M };
});

const granted = { aiConsentVersion: AI_CONSENT_VERSION, aiConsentAcceptedVersions: [AI_CONSENT_VERSION] };
const missing = { aiConsentVersion: null, aiConsentAcceptedVersions: [AI_CONSENT_VERSION] };
const outdatedServer = { aiConsentVersion: null, aiConsentAcceptedVersions: ['ai-newer'] };

let api: AiConsentApi;
function Probe() {
  api = useAiConsent();
  return null;
}

async function mount(me: unknown) {
  mockApiFetch.mockImplementation(async (path: string) => {
    if (path === '/api/users/me') {
      if (me instanceof Error) throw me;
      return me;
    }
    return {};
  });
  const r = await render(
    <AiConsentProvider>
      <Probe />
    </AiConsentProvider>,
  );
  await act(async () => {}); // let the initial load settle
  return r;
}

const sheet = () => mockModal.props!;
const isOpen = () => mockModal.props?.visible === true;

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockUserId = 'user_1';
  __setAiConsentStatusForTest('unknown');
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('loading the status', () => {
  it('granted on the server → granted, and the sheet is never shown', async () => {
    await mount(granted);
    expect(api.status).toBe('granted');
    expect(getAiConsentStatus()).toBe('granted');
    let result: boolean | undefined;
    await act(async () => {
      result = await api.requireAiConsent();
    });
    expect(result).toBe(true);
    expect(isOpen()).toBe(false);
  });

  it('404 (no user row yet) → missing, not an error', async () => {
    await mount(new ApiError('nf', 404));
    expect(api.status).toBe('missing');
  });

  it('a load failure → error (distinct from unknown, so the screen can offer 重試)', async () => {
    await mount(new ApiError('down', 503));
    expect(api.status).toBe('error');
    expect(getAiConsentStatus()).toBe('error');
  });

  it('outdated build: no sheet, the update alert at once, resolves false', async () => {
    await mount(outdatedServer);
    expect(api.status).toBe('outdated');
    let result: boolean | undefined;
    await act(async () => {
      result = await api.requireAiConsent();
    });
    expect(result).toBe(false);
    expect(isOpen()).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith('請更新 App', '請更新 App 後再使用 AI 解讀。');
  });

  it('a load started for a previous user is dropped', async () => {
    let resolveMe!: (v: unknown) => void;
    mockApiFetch.mockImplementation(() => new Promise((r) => (resolveMe = r)));
    const r = await render(
      <AiConsentProvider>
        <Probe />
      </AiConsentProvider>,
    );
    // user_1 signs out before their load returns
    mockUserId = null;
    await act(async () => {
      await r.rerender(
        <AiConsentProvider>
          <Probe />
        </AiConsentProvider>,
      );
    });
    await act(async () => {
      resolveMe(granted);
    });
    expect(api.status).toBe('unknown');
    expect(getAiConsentStatus()).toBe('unknown');
  });

  it('a foreground refresh that fails keeps the known status (never back to unknown)', async () => {
    const listeners: Array<(s: string) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, cb) => {
      listeners.push(cb as (s: string) => void);
      return { remove: () => {} } as never;
    });
    await mount(granted);
    mockApiFetch.mockRejectedValue(new ApiError('down', 503));
    await act(async () => {
      listeners.forEach((l) => l('active'));
    });
    expect(api.status).toBe('granted');
  });

  it('a foreground refresh picks up a withdrawal made elsewhere', async () => {
    const listeners: Array<(s: string) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, cb) => {
      listeners.push(cb as (s: string) => void);
      return { remove: () => {} } as never;
    });
    await mount(granted);
    mockApiFetch.mockResolvedValue(missing);
    await act(async () => {
      listeners.forEach((l) => l('active'));
    });
    expect(api.status).toBe('missing');
    expect(getAiConsentStatus()).toBe('missing');
  });
});

describe('the sheet', () => {
  it('missing → opens; 同意 posts THIS build\'s version; resolves only after onDismiss', async () => {
    await mount(missing);
    let result: boolean | undefined;
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = api.requireAiConsent();
      void pending.then((v) => (result = v));
    });
    await act(async () => {});
    expect(isOpen()).toBe(true);
    await act(async () => {
      sheet().onShow!();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-consent-agree'));
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/api/users/me/ai-consent', {
      method: 'POST',
      token: 'tok',
      body: { version: AI_CONSENT_VERSION },
    });
    // The enforcement layer is already granted…
    expect(getAiConsentStatus()).toBe('granted');
    // …but the caller has NOT resumed: the dismissal is still animating.
    expect(isOpen()).toBe(false);
    expect(result).toBeUndefined();

    await act(async () => {
      sheet().onDismiss!();
    });
    expect(result).toBe(true);
  });

  it('a guarded call on the line after `await requireAiConsent()` goes through', async () => {
    await mount(missing);
    let statusSeenByCaller: string | undefined;
    await act(async () => {
      void api.requireAiConsent().then(() => {
        statusSeenByCaller = getAiConsentStatus();
      });
    });
    await act(async () => {});
    await act(async () => {
      sheet().onShow!();
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-consent-agree'));
    });
    await act(async () => {
      sheet().onDismiss!();
    });
    expect(statusSeenByCaller).toBe('granted');
  });

  it('暫不使用 → false, nothing posted', async () => {
    await mount(missing);
    let result: boolean | undefined;
    await act(async () => {
      void api.requireAiConsent().then((v) => (result = v));
    });
    await act(async () => {});
    await act(async () => {
      sheet().onShow!();
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-consent-decline'));
    });
    await act(async () => {
      sheet().onDismiss!();
    });
    expect(result).toBe(false);
    expect(mockApiFetch).not.toHaveBeenCalledWith('/api/users/me/ai-consent', expect.anything());
    expect(getAiConsentStatus()).toBe('missing');
  });

  it('409 → outdated, the update alert AFTER the dismissal, resolves false', async () => {
    await mount(missing);
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/users/me/ai-consent') throw new ApiError('gone', 409, 'CONSENT_VERSION_UNKNOWN');
      return missing;
    });
    let result: boolean | undefined;
    await act(async () => {
      void api.requireAiConsent().then((v) => (result = v));
    });
    await act(async () => {});
    await act(async () => {
      sheet().onShow!();
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-consent-agree'));
    });
    expect(Alert.alert).not.toHaveBeenCalled(); // not while the sheet is still dismissing
    await act(async () => {
      sheet().onDismiss!();
    });
    expect(result).toBe(false);
    expect(getAiConsentStatus()).toBe('outdated');
    expect(Alert.alert).toHaveBeenCalledWith('請更新 App', '請更新 App 後再使用 AI 解讀。');
  });

  it('a save failure → false + the save-failed alert, status unchanged', async () => {
    await mount(missing);
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/users/me/ai-consent') throw new ApiError('down', 503);
      return missing;
    });
    let result: boolean | undefined;
    await act(async () => {
      void api.requireAiConsent().then((v) => (result = v));
    });
    await act(async () => {});
    await act(async () => {
      sheet().onShow!();
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-consent-agree'));
    });
    await act(async () => {
      sheet().onDismiss!();
    });
    expect(result).toBe(false);
    expect(getAiConsentStatus()).toBe('missing');
    expect(Alert.alert).toHaveBeenCalledWith('無法儲存', '無法儲存您的同意，請稍後再試。');
  });

  it('two concurrent callers share ONE sheet and both get the answer', async () => {
    await mount(missing);
    const results: boolean[] = [];
    await act(async () => {
      void api.requireAiConsent().then((v) => results.push(v));
      void api.requireAiConsent().then((v) => results.push(v));
    });
    await act(async () => {});
    await act(async () => {
      sheet().onShow!();
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-consent-agree'));
    });
    await act(async () => {
      sheet().onDismiss!();
    });
    expect(results).toEqual([true, true]);
    expect(mockApiFetch.mock.calls.filter((c) => c[0] === '/api/users/me/ai-consent')).toHaveLength(1);
  });

  it('a sheet iOS never shows (no onShow) settles false, and the next request opens a NEW sheet', async () => {
    await mount(missing);
    jest.useFakeTimers();
    let first: boolean | undefined;
    await act(async () => {
      void api.requireAiConsent().then((v) => (first = v));
    });
    expect(isOpen()).toBe(true);
    // onShow never fires; onDismiss never fires either (it was never presented).
    await act(async () => {
      jest.advanceTimersByTime(SHEET_SHOW_TIMEOUT_MS + SHEET_DISMISS_FALLBACK_MS + 10);
    });
    expect(first).toBe(false);
    expect(isOpen()).toBe(false);
    // …and says so, instead of a tap that silently does nothing.
    expect(Alert.alert).toHaveBeenCalledWith('請再試一次', '無法顯示 AI 解讀資料說明，請再試一次。');

    await act(async () => {
      void api.requireAiConsent();
    });
    expect(isOpen()).toBe(true);
    jest.useRealTimers();
  });

  it('if onDismiss never arrives after closing, the fallback still resolves', async () => {
    await mount(missing);
    jest.useFakeTimers();
    let result: boolean | undefined;
    await act(async () => {
      void api.requireAiConsent().then((v) => (result = v));
    });
    await act(async () => {
      sheet().onShow!();
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-consent-decline'));
    });
    await act(async () => {
      jest.advanceTimersByTime(SHEET_DISMISS_FALLBACK_MS + 10);
    });
    expect(result).toBe(false);
    jest.useRealTimers();
  });

  it('a user change while the sheet is open settles the pending request false', async () => {
    const r = await mount(missing);
    let result: boolean | undefined;
    await act(async () => {
      void api.requireAiConsent().then((v) => (result = v));
    });
    await act(async () => {});
    mockUserId = 'user_2';
    await act(async () => {
      await r.rerender(
        <AiConsentProvider>
          <Probe />
        </AiConsentProvider>,
      );
    });
    expect(result).toBe(false);
  });
});

describe('withdrawal', () => {
  it('confirm → DELETE → missing', async () => {
    await mount(granted);
    (Alert.alert as jest.Mock).mockImplementation((_t, _m, buttons) => {
      const destructive = (buttons as Array<{ style?: string; onPress?: () => void }>).find(
        (b) => b.style === 'destructive',
      );
      void destructive?.onPress?.();
    });
    await act(async () => {
      api.withdraw();
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/api/users/me/ai-consent', { method: 'DELETE', token: 'tok' });
    expect(api.status).toBe('missing');
    expect(getAiConsentStatus()).toBe('missing');
  });
});

describe('outside a provider', () => {
  it('fails closed', async () => {
    let outside!: AiConsentApi;
    function Bare() {
      outside = useAiConsent();
      return null;
    }
    await render(<Bare />);
    expect(outside.status).toBe('unknown');
    await expect(outside.requireAiConsent()).resolves.toBe(false);
  });
});
