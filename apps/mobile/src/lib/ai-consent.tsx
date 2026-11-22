/**
 * AI-data consent — the ASKING layer (1C item 2, layer 2).
 *
 * `AiConsentProvider` loads the user's consent from `GET /api/users/me`, keeps the
 * enforcement layer (`ai-consent-state.ts`) in sync, and renders the one-time
 * sheet. `useAiConsent().requireAiConsent()` is called from TAP HANDLERS only,
 * with no other Modal on screen, before that tap opens anything:
 *
 * - iOS presents a RN Modal from the nearest view controller and UIKit refuses to
 *   present from one that is already presenting — or one whose dismissal is still
 *   animating. So the sheet never opens over another Modal, and the promise
 *   resolves from the sheet's `onDismiss` (A1/H1), after which the caller may
 *   open its own Modal safely.
 * - If iOS refuses to show the sheet, `onShow` never fires; a watchdog closes it
 *   and resolves `false`, so the gate cannot wedge (round-3 A1).
 * - On consent the enforcement layer is set to `granted` synchronously BEFORE the
 *   promise resolves, so a guarded call on the next line goes through (H2).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import * as WebBrowser from 'expo-web-browser';
import { apiFetch, ApiError } from './api';
import {
  AI_CONSENT_VERSION,
  AI_DATA_DISCLOSURE_ZH,
  getAiConsentStatus,
  setAiConsentStatus,
  statusFromServer,
  type AiConsentStatus,
  type ServerConsentFields,
} from './ai-consent-state';
import { PRIVACY_URL } from './links';
import { useZh } from './language';
import { colors, radius, spacing, text as T } from '../theme';

/** How long to wait for iOS to show the sheet before giving up (A1). */
export const SHEET_SHOW_TIMEOUT_MS = 1000;
/** Fallback if `onDismiss` never arrives (iOS) / the close delay on Android. */
export const SHEET_DISMISS_FALLBACK_MS = Platform.OS === 'ios' ? 1000 : 250;

type FollowUp = 'outdated' | 'save_failed' | 'not_shown' | null;

export interface AiConsentApi {
  status: AiConsentStatus;
  /** From a tap handler only, with no Modal on screen. Resolves true iff the AI may be called. */
  requireAiConsent: () => Promise<boolean>;
  /** 我的: confirm, then withdraw. */
  withdraw: () => void;
  /** Re-read the server. Keeps the current status unless the server says otherwise. */
  refresh: () => Promise<void>;
}

/** Outside a provider: fail closed, so component tests render without one (A5). */
const FAIL_CLOSED: AiConsentApi = {
  status: 'unknown',
  requireAiConsent: async () => false,
  withdraw: () => {},
  refresh: async () => {},
};

const AiConsentContext = createContext<AiConsentApi>(FAIL_CLOSED);

export function useAiConsent(): AiConsentApi {
  return useContext(AiConsentContext);
}

export function AiConsentProvider({ children }: { children: ReactNode }) {
  const { userId, getToken } = useAuth();
  const zh = useZh();
  const [status, setStatusState] = useState<AiConsentStatus>(getAiConsentStatus());
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const userIdRef = useRef(userId);
  const pendingRef = useRef<{ promise: Promise<boolean>; resolve: (v: boolean) => void } | null>(null);
  const outcomeRef = useRef<{ result: boolean; followUp: FollowUp }>({ result: false, followUp: null });
  const shownRef = useRef(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  /** Enforcement layer FIRST, then React (H2). */
  const writeStatus = useCallback((next: AiConsentStatus) => {
    setAiConsentStatus(next);
    setStatusState(next);
  }, []);

  const clearTimers = () => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    showTimerRef.current = null;
    dismissTimerRef.current = null;
  };

  const showFollowUp = useCallback(
    (followUp: FollowUp) => {
      if (followUp === 'outdated') {
        Alert.alert(zh('請更新 App'), zh('請更新 App 後再使用 AI 解讀。'));
      } else if (followUp === 'save_failed') {
        Alert.alert(zh('無法儲存'), zh('無法儲存您的同意，請稍後再試。'));
      } else if (followUp === 'not_shown') {
        // Never silent: a tap that does nothing reads as a broken feature.
        Alert.alert(zh('請再試一次'), zh('無法顯示 AI 解讀資料說明，請再試一次。'));
      }
    },
    [zh],
  );

  /** Resolve the pending request once the sheet is fully gone. */
  const settle = useCallback(() => {
    clearTimers();
    const pending = pendingRef.current;
    pendingRef.current = null;
    setSaving(false);
    if (!pending) return;
    const { result, followUp } = outcomeRef.current;
    pending.resolve(result);
    showFollowUp(followUp);
  }, [showFollowUp]);

  const closeSheet = useCallback(
    (result: boolean, followUp: FollowUp = null) => {
      outcomeRef.current = { result, followUp };
      setVisible(false);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(settle, SHEET_DISMISS_FALLBACK_MS);
    },
    [settle],
  );

  /**
   * Read the server. `keepOnFailure`: a foreground refresh never downgrades a
   * known status on a network blip (M2) — only a real answer changes it.
   */
  const load = useCallback(
    async (keepOnFailure: boolean): Promise<AiConsentStatus> => {
      const forUser = userIdRef.current;
      if (!forUser) return 'unknown';
      let next: AiConsentStatus;
      try {
        const token = await getTokenRef.current();
        if (!token) throw new Error('no token');
        const me = await apiFetch<ServerConsentFields>('/api/users/me', { token });
        next = statusFromServer(me);
      } catch (e) {
        // No user row yet (Clerk webhook not landed): consenting creates it.
        next = e instanceof ApiError && e.status === 404 ? 'missing' : 'error';
      }
      // A load for a user who has since signed out / switched is dropped (M3).
      if (userIdRef.current !== forUser) return getAiConsentStatus();
      if (next === 'error' && keepOnFailure && getAiConsentStatus() !== 'unknown') {
        return getAiConsentStatus();
      }
      if (next !== getAiConsentStatus()) writeStatus(next);
      return next;
    },
    [writeStatus],
  );

  // `settle` changes with the display language (via `zh`); the user-change effect
  // must not re-run — and reset consent to `unknown` — when 繁/简 is switched.
  const settleRef = useRef(settle);
  settleRef.current = settle;

  // User change: reset, settle anything pending as declined, then load.
  useEffect(() => {
    userIdRef.current = userId;
    if (pendingRef.current) {
      outcomeRef.current = { result: false, followUp: null };
      setVisible(false);
      settleRef.current();
    }
    writeStatus('unknown');
    if (userId) void load(false);
  }, [userId, load, writeStatus]);

  // Foreground refresh: a withdrawal on another device takes effect (M2/M3).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && userIdRef.current) void load(true);
    });
    return () => sub.remove();
  }, [load]);

  // Unmount: never leave a caller waiting.
  useEffect(
    () => () => {
      clearTimers();
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    },
    [],
  );

  const openSheet = useCallback((): Promise<boolean> => {
    if (pendingRef.current) return pendingRef.current.promise; // one sheet for concurrent callers
    let resolve!: (v: boolean) => void;
    const promise = new Promise<boolean>((r) => {
      resolve = r;
    });
    pendingRef.current = { promise, resolve };
    outcomeRef.current = { result: false, followUp: null };
    shownRef.current = false;
    setVisible(true);
    // iOS may refuse to present (another presentation animating): don't wedge.
    showTimerRef.current = setTimeout(() => {
      if (!shownRef.current) closeSheet(false, 'not_shown');
    }, SHEET_SHOW_TIMEOUT_MS);
    return promise;
  }, [closeSheet]);

  const requireAiConsent = useCallback(async (): Promise<boolean> => {
    let current = getAiConsentStatus();
    if (current === 'unknown' || current === 'error') current = await load(false);
    if (current === 'granted') return true;
    if (current === 'outdated') {
      showFollowUp('outdated');
      return false;
    }
    if (current === 'missing') return openSheet();
    Alert.alert(zh('暫時無法確認'), zh('暫時無法確認您的設定，請稍後再試。'));
    return false;
  }, [load, openSheet, showFollowUp, zh]);

  const onAgree = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const token = await getTokenRef.current();
      if (!token) throw new Error('no token');
      await apiFetch('/api/users/me/ai-consent', {
        method: 'POST',
        token,
        body: { version: AI_CONSENT_VERSION },
      });
      writeStatus('granted'); // synchronously, before the promise resolves (H2)
      closeSheet(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        writeStatus('outdated');
        closeSheet(false, 'outdated');
      } else {
        closeSheet(false, 'save_failed');
      }
    }
  }, [saving, writeStatus, closeSheet]);

  const onDecline = useCallback(() => closeSheet(false), [closeSheet]);

  const withdraw = useCallback(() => {
    Alert.alert(
      zh('撤回同意'),
      zh('撤回後，AI 解讀、運勢分析與 AI 對話將暫停使用，直到您再次同意。'),
      [
        { text: zh('取消'), style: 'cancel' },
        {
          text: zh('撤回'),
          style: 'destructive',
          onPress: async () => {
            try {
              const token = await getTokenRef.current();
              if (!token) throw new Error('no token');
              await apiFetch('/api/users/me/ai-consent', { method: 'DELETE', token });
              writeStatus('missing');
            } catch {
              Alert.alert(zh('撤回失敗'), zh('請稍後再試。'));
            }
          },
        },
      ],
    );
  }, [writeStatus, zh]);

  const refresh = useCallback(async () => {
    await load(getAiConsentStatus() !== 'unknown');
  }, [load]);

  const api = useMemo<AiConsentApi>(
    () => ({ status, requireAiConsent, withdraw, refresh }),
    [status, requireAiConsent, withdraw, refresh],
  );

  return (
    <AiConsentContext.Provider value={api}>
      {children}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onShow={() => {
          shownRef.current = true;
        }}
        // iOS: the dismissal has finished — now the caller may present its own Modal.
        onDismiss={settle}
        // Android hardware back = 暫不使用.
        onRequestClose={onDecline}
        testID="ai-consent-sheet"
      >
        <View style={styles.overlay}>
          <View style={styles.card} accessibilityViewIsModal>
            <Text style={styles.title} accessibilityRole="header">
              {zh('AI 解讀資料說明')}
            </Text>
            <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.bodyContent}>
              <Text style={styles.body}>{zh(AI_DATA_DISCLOSURE_ZH)}</Text>
              <Text style={styles.body}>
                {zh('您可隨時在「我的」中撤回同意。')}
              </Text>
              <Pressable
                accessibilityRole="link"
                onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)}
                hitSlop={8}
              >
                <Text style={styles.link}>{zh('隱私權政策')}</Text>
              </Pressable>
            </ScrollView>
            <Pressable
              testID="ai-consent-agree"
              style={[styles.primary, saving && styles.disabled]}
              accessibilityRole="button"
              onPress={() => void onAgree()}
              disabled={saving}
            >
              <Text style={styles.primaryText}>{zh('同意並繼續')}</Text>
            </Pressable>
            <Pressable
              testID="ai-consent-decline"
              style={styles.secondary}
              accessibilityRole="button"
              onPress={onDecline}
              disabled={saving}
            >
              <Text style={styles.secondaryText}>{zh('暫不使用')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </AiConsentContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(60, 36, 21, 0.45)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
    maxHeight: '85%',
  },
  title: { ...T.section, color: colors.textAccent },
  bodyScroll: { flexGrow: 0 },
  bodyContent: { gap: spacing.md },
  body: { ...T.bodyTight, color: colors.textPrimary },
  link: { ...T.bodyTight, color: colors.textAccent, textDecorationLine: 'underline' },
  primary: {
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  disabled: { opacity: 0.7 },
  primaryText: { ...T.bodyTight, color: colors.textOnRed, fontWeight: '700' },
  secondary: { paddingVertical: spacing.md, alignItems: 'center' },
  secondaryText: { ...T.bodyTight, color: colors.textSecondary },
});
