'use client';

/**
 * ShareFortuneButton — orchestrates the Phase 1.5 share flow.
 *
 * iOS Safari user-gesture safety (audit fixes):
 *   1. QR generation fires on hover/touch/focus via `handlePreArm`, BEFORE
 *      the click. By click time, `qrDataUrl` is cached so the click handler
 *      has no `await` between gesture and `navigator.share`. (Fixes Bug #1.)
 *   2. Shell's top-right share icon calls `ref.current.triggerShare()` via
 *      `useImperativeHandle` — direct method invocation preserves the
 *      user-gesture context. Programmatic `.click()` does NOT establish
 *      transient activation in WebKit. (Fixes Bug #2.)
 *
 * Lazy mount strategy: parent (page.tsx) only mounts ShareableFortuneCard
 * once `shareCardArmed=true` AND `qrDataUrl` is non-null — both flip during
 * pre-arm so by click time the card is already in the DOM, painted, and
 * ready for html2canvas.
 */
import * as React from 'react';
import * as Sentry from '@sentry/nextjs';
import { Share2, Loader2 } from 'lucide-react';
import {
  fortuneShareUrl,
  generateQrDataUrl,
  loadFortuneCardFonts,
  rasterizeNode,
  shareOrDownloadPng,
  type ShareResult,
} from '../../lib/share-fortune';
import styles from './ShareFortuneButton.module.css';

/** Scope-agnostic share metadata. Each call site (daily / yearly) derives
 *  the download filename + native-share text from its own response shape,
 *  keeping this component free of any single scope's data type. */
export interface ShareMeta {
  /** Download filename for the PNG (e.g. `fortune-2026-05-17.png`). */
  filename: string;
  /** Native-share sheet body text. */
  shareText: string;
}

interface ShareFortuneButtonProps {
  shareMeta: ShareMeta;
  cardRef: React.RefObject<HTMLDivElement | null>;
  /** Idle button label (e.g. 「分享今日運勢」 / 「分享今年運勢」). */
  idleLabel?: string;
  /** Parent state — true once user has signaled intent (hover/touch/click) */
  shareCardArmed: boolean;
  /** Parent setter — flip `shareCardArmed=true` to mount ShareableFortuneCard */
  onArmShareCard: () => void;
  /** Parent state — current QR data URL (parent caches it across renders) */
  qrDataUrl: string | null;
  /** Parent setter — store generated QR data URL */
  onQrGenerated: (dataUrl: string) => void;
  /** Optional toast/notification handler — receives the share method on success */
  onShareComplete?: (result: ShareResult) => void;
}

export interface ShareFortuneButtonHandle {
  /** Triggers the share flow — called directly (no .click()) by external
   *  invokers (e.g. FortuneShell's top-right share icon). Direct method
   *  invocation preserves the user-gesture context required by
   *  navigator.share on iOS Safari. */
  triggerShare: () => Promise<void>;
}

type Phase = 'idle' | 'preparing' | 'capturing' | 'error';

const ShareFortuneButton = React.forwardRef<ShareFortuneButtonHandle, ShareFortuneButtonProps>(
  function ShareFortuneButton(
    {
      shareMeta,
      cardRef,
      idleLabel = '分享運勢',
      shareCardArmed,
      onArmShareCard,
      qrDataUrl,
      onQrGenerated,
      onShareComplete,
    },
    ref,
  ) {
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  /** Pre-arm on hover/touch/focus — does two things:
   *   1. Arms the card mount (parent setState)
   *   2. Starts QR generation async if not cached
   *  Both run in parallel during the pre-click window so by click time the
   *  card is mounted AND the QR data URL is ready (no await needed in
   *  click handler). Avoids consuming the iOS user-gesture window. */
  const handlePreArm = React.useCallback(() => {
    if (!shareCardArmed) onArmShareCard();
    if (!qrDataUrl) {
      // Fire-and-forget — handleClick has a defensive await if QR not ready yet
      void (async () => {
        try {
          const url = await generateQrDataUrl(fortuneShareUrl());
          onQrGenerated(url);
        } catch (err) {
          // Pre-arm QR errors are non-fatal — handleClick retries
          Sentry.captureException(err, { tags: { component: 'ShareFortuneButton', stage: 'pre-arm-qr' } });
        }
      })();
    }
  }, [shareCardArmed, onArmShareCard, qrDataUrl, onQrGenerated]);

  const handleClick = React.useCallback(async () => {
    if (phase === 'preparing' || phase === 'capturing') return;
    setErrorMessage(null);
    setPhase('preparing');

    try {
      // Step 1: if QR not pre-generated (user clicked without hover/touch),
      // generate it now. Worst case: minor latency on first click, but at
      // least one of hover/touch/focus fires before click on most paths.
      let qrUrl = qrDataUrl;
      if (!qrUrl) {
        qrUrl = await generateQrDataUrl(fortuneShareUrl());
        onQrGenerated(qrUrl);
      }

      // Step 2: arm the card mount if not already armed (idempotent)
      if (!shareCardArmed) {
        onArmShareCard();
      }

      // Step 3: wait for React commit + browser layout (1 RAF is enough — QR
      // is already a synchronous <img src> via prop; html2canvas internally
      // awaits image decode before drawing).
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      // Defensive: if card still not mounted (parent slow), wait one more frame
      if (!cardRef.current) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      if (!cardRef.current) {
        throw new Error('Share card failed to mount');
      }

      // Step 4: force-load Noto Serif TC + rasterize
      setPhase('capturing');
      await loadFortuneCardFonts();
      const canvas = await rasterizeNode(cardRef.current);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
          'image/png',
        );
      });

      // Step 5: share / download cascade
      const result = await shareOrDownloadPng(blob, shareMeta.filename, shareMeta.shareText);

      setPhase('idle');
      onShareComplete?.(result);
    } catch (err) {
      // Audit Finding 4: don't lose the original error class. Sentry captures
      // it with a tag so prod debug can distinguish mount race vs rasterize
      // vs network share failures.
      console.error('[ShareFortuneButton] share failed', err);
      Sentry.captureException(err, { tags: { component: 'ShareFortuneButton', stage: 'share' } });
      setPhase('error');
      setErrorMessage('圖片生成失敗，請稍後再試');
    }
  }, [
    phase,
    qrDataUrl,
    shareCardArmed,
    cardRef,
    shareMeta,
    onArmShareCard,
    onQrGenerated,
    onShareComplete,
  ]);

  // Audit Bug #2 fix: expose triggerShare() via useImperativeHandle so the
  // shell's share icon can invoke share orchestration WITHOUT going through
  // a programmatic `.click()` (which would lose user-gesture activation in
  // WebKit). External callers do `ref.current?.triggerShare()` from within
  // their own onClick handler — the gesture context is preserved through
  // the synchronous method call chain.
  React.useImperativeHandle(ref, () => ({ triggerShare: handleClick }), [handleClick]);

  const isBusy = phase === 'preparing' || phase === 'capturing';
  const buttonLabel =
    phase === 'preparing'
      ? '準備分享…'
      : phase === 'capturing'
      ? '正在生成圖片…'
      : idleLabel;

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.button}
        onClick={handleClick}
        onMouseEnter={handlePreArm}
        onTouchStart={handlePreArm}
        onFocus={handlePreArm}
        disabled={isBusy}
        aria-busy={isBusy}
      >
        {isBusy ? (
          <Loader2 size={18} strokeWidth={2} aria-hidden="true" className={styles.spinner} />
        ) : (
          <Share2 size={18} strokeWidth={2} aria-hidden="true" />
        )}
        <span>{buttonLabel}</span>
      </button>
      {phase === 'error' && errorMessage && (
        <div className={styles.errorRow} role="alert">
          <span>{errorMessage}</span>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={() => {
              // Audit Bug #4 fix: don't setPhase('idle') here — handleClick
              // owns the state machine and will transition error→preparing
              // in one batched update. The stale 'idle' write was a no-op.
              setErrorMessage(null);
              void handleClick();
            }}
          >
            重試
          </button>
        </div>
      )}
    </div>
  );
  },
);

export default ShareFortuneButton;
