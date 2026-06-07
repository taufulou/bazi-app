'use client';

/**
 * Renders one of the 7 chat dialogs based on the `dialogKey` prop. All copy
 * lives in `dialog-copy.ts`. Layout convention from plan:
 * - Secondary action on left (outlined)
 * - Primary action on right (filled, recommended)
 *
 * Dispatching:
 * - Dialog 5 (hard_cap_reached) is NOT closeable via Escape (must take action).
 * - All others can close on Escape; the action bus collapses to: cancel,
 *   extend, continue_paid, continue_free, new_session, force_new_session.
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  EXTEND_STANDARD,
  TURN20_WARNING_ZERO_BALANCE,
  TURN20_WARNING_WITH_BALANCE,
  NEAR_CAP_WARNING,
  HARD_CAP_REACHED,
  NEW_SESSION_LOSE_PAID,
  REFUSE_LIMIT_REACHED,
  type ChatDialogKey,
  type DialogAction,
} from './dialog-copy';
import styles from './ChatDialogs.module.css';

export interface ChatDialogProps {
  dialogKey: ChatDialogKey | null;
  /** Reactive parameters: paid balance, remaining-to-cap, etc. */
  context: {
    remainingPaid: number;
    /** = 30 - messageCount */
    messagesUntilHardCap: number;
    /** Free chats remaining in user's monthly quota. Used by Dialog 2 to
     *  display the «繼續此對話» cost as 「免費」 vs 「1 點數」 based on
     *  whether free quota covers the remaining session capacity. Mirrors
     *  the actual charging logic in ChatDrawer.handleDialogAction. */
    freeQuotaRemaining: number;
  };
  /** T6 fix — true while a purchaseExtension call is in flight. Used to
   *  disable any button whose action is `extend` or `continue_paid` so a
   *  rapid double-click can't enqueue a second request. */
  isPurchasingExtension?: boolean;
  onAction: (action: DialogAction, dialogKey: ChatDialogKey) => void;
}

/** Actions that trigger a credit-deducting `purchaseExtension` API call. The
 *  ChatDialogs component disables any button whose action is in this set
 *  while `isPurchasingExtension` is true (T6 fix). */
const PURCHASE_ACTIONS: ReadonlySet<DialogAction> = new Set<DialogAction>([
  'extend',
  'continue_paid',
]);

export default function ChatDialogs({
  dialogKey,
  context,
  isPurchasingExtension = false,
  onAction,
}: ChatDialogProps) {
  useEffect(() => {
    if (!dialogKey || dialogKey === 'hard_cap_reached') return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onAction('cancel', dialogKey);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [dialogKey, onAction]);

  if (!dialogKey) return null;
  if (typeof document === 'undefined') return null;

  const inner = renderDialog(dialogKey, context, onAction, isPurchasingExtension);
  if (!inner) return null;

  return createPortal(
    <div className={styles.backdrop}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-dialog-title"
      >
        {inner}
      </div>
    </div>,
    document.body,
  );
}

function renderDialog(
  key: ChatDialogKey,
  context: ChatDialogProps['context'],
  onAction: ChatDialogProps['onAction'],
  isPurchasingExtension: boolean,
): React.ReactNode {
  // T6 fix — wrapper that disables any button whose action would trigger a
  // `purchaseExtension` call while one is already in flight. Single source
  // of truth so we don't have to remember to add the guard at each call site.
  const isDisabled = (action: DialogAction): boolean =>
    isPurchasingExtension && PURCHASE_ACTIONS.has(action);

  switch (key) {
    case 'extend_standard': {
      const c = EXTEND_STANDARD;
      return (
        <>
          <h3 id="chat-dialog-title" className={styles.title}>
            {c.title}
          </h3>
          <div className={styles.body}>
            {c.body.map((line) => (
              <p key={line} className={styles.bodyLine}>
                {line}
              </p>
            ))}
          </div>
          <div className={styles.actions}>
            <ActionBtn
              label={c.secondary.label}
              disabled={isDisabled(c.secondary.action)}
              onClick={() => onAction(c.secondary.action, key)}
            />
            <ActionBtn
              primary
              label={c.primary.label}
              disabled={isDisabled(c.primary.action)}
              onClick={() => onAction(c.primary.action, key)}
            />
          </div>
        </>
      );
    }

    case 'turn20_warning_zero_balance': {
      const c = TURN20_WARNING_ZERO_BALANCE;
      // freeCovers: user's remaining monthly free quota is enough to cover
      // every message until hard cap → click 「繼續此對話」 won't charge.
      const freeCovers =
        context.freeQuotaRemaining >= context.messagesUntilHardCap;
      const sec = c.secondary({ freeCovers });
      return (
        <>
          <h3 id="chat-dialog-title" className={styles.title}>{c.title}</h3>
          <div className={styles.warning}>{c.warning}</div>
          <div className={styles.body}>
            {c.body.map((line) => (
              <p key={line} className={styles.bodyLine}>{line}</p>
            ))}
          </div>
          <div className={styles.actions}>
            <ActionBtn
              label={sec.label}
              sublabel={sec.sublabel}
              // freeCovers=true means continue_paid is a free dismiss
              // (no API call), so don't disable in that case.
              disabled={!freeCovers && isDisabled(sec.action)}
              onClick={() => onAction(sec.action, key)}
            />
            <ActionBtn
              primary
              label={c.primary.label}
              sublabel={c.primary.sublabel}
              disabled={isDisabled(c.primary.action)}
              onClick={() => onAction(c.primary.action, key)}
            />
          </div>
        </>
      );
    }

    case 'turn20_warning_with_balance': {
      const c = TURN20_WARNING_WITH_BALANCE;
      const args = { remainingPaid: context.remainingPaid };
      const sec = c.secondary(args);
      const pri = c.primary(args);
      return (
        <>
          <h3 id="chat-dialog-title" className={styles.title}>{c.title}</h3>
          <div className={styles.warning}>{c.warning}</div>
          <div className={styles.body}>
            {c.body(args).map((line) => (
              <p key={line} className={styles.bodyLine}>{line}</p>
            ))}
          </div>
          <div className={styles.actions}>
            <ActionBtn label={sec.label} sublabel={sec.sublabel} disabled={isDisabled(sec.action)} onClick={() => onAction(sec.action, key)} />
            <ActionBtn primary label={pri.label} sublabel={pri.sublabel} disabled={isDisabled(pri.action)} onClick={() => onAction(pri.action, key)} />
          </div>
        </>
      );
    }

    case 'near_cap_warning': {
      const c = NEAR_CAP_WARNING;
      const args = { remaining: context.messagesUntilHardCap };
      const sec = c.secondary(args);
      return (
        <>
          <h3 id="chat-dialog-title" className={styles.title}>{c.title(args)}</h3>
          <div className={styles.body}>
            {c.body.map((line) => (
              <p key={line} className={styles.bodyLine}>{line}</p>
            ))}
          </div>
          <div className={styles.actions}>
            <ActionBtn label={sec.label} sublabel={sec.sublabel} disabled={isDisabled(sec.action)} onClick={() => onAction(sec.action, key)} />
            <ActionBtn primary label={c.primary.label} sublabel={c.primary.sublabel} disabled={isDisabled(c.primary.action)} onClick={() => onAction(c.primary.action, key)} />
          </div>
        </>
      );
    }

    case 'hard_cap_reached': {
      const c = HARD_CAP_REACHED;
      return (
        <>
          <h3 id="chat-dialog-title" className={styles.title}>{c.title}</h3>
          <div className={styles.body}>
            {c.body.map((line) => (
              <p key={line} className={styles.bodyLine}>{line}</p>
            ))}
          </div>
          <div className={styles.actions} data-single-action>
            <ActionBtn primary label={c.primary.label} onClick={() => onAction(c.primary.action, key)} />
          </div>
        </>
      );
    }

    case 'new_session_lose_paid': {
      const c = NEW_SESSION_LOSE_PAID;
      const args = { unused: context.remainingPaid };
      return (
        <>
          <h3 id="chat-dialog-title" className={styles.title}>{c.title(args)}</h3>
          <div className={styles.body}>
            {c.body(args).map((line) => (
              <p key={line} className={styles.bodyLine}>{line}</p>
            ))}
          </div>
          <div className={styles.actions}>
            <ActionBtn label={c.secondary.label} sublabel={c.secondary.sublabel} onClick={() => onAction(c.secondary.action, key)} />
            <ActionBtn primary label={c.primary.label} sublabel={c.primary.sublabel} onClick={() => onAction(c.primary.action, key)} />
          </div>
        </>
      );
    }

    case 'refuse_limit_reached': {
      const c = REFUSE_LIMIT_REACHED;
      return (
        <>
          <h3 id="chat-dialog-title" className={styles.title}>{c.title}</h3>
          <div className={styles.warning}>{c.warning}</div>
          <div className={styles.body}>
            {c.body.map((line) => (
              <p key={line} className={styles.bodyLine}>{line}</p>
            ))}
          </div>
          <div className={styles.actions} data-single-action>
            <ActionBtn primary label={c.primary.label} onClick={() => onAction(c.primary.action, key)} />
          </div>
        </>
      );
    }

    // Persistent banners — never invoked as dialogs.
    case 'quota_badge':
    case 'disclaimer_footer':
      return null;
  }
}

function ActionBtn(props: {
  label: string;
  sublabel?: string;
  primary?: boolean;
  /** T6 fix — when true, button rejects clicks AND renders with the
   *  disabled style. Used to block rapid double-clicks on extension-
   *  purchase buttons while a request is in flight. */
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.btn} ${props.primary ? styles.primary : styles.secondary}`}
      disabled={props.disabled}
      aria-busy={props.disabled || undefined}
      onClick={props.onClick}
    >
      <span className={styles.btnLabel}>{props.label}</span>
      {props.sublabel && (
        <span className={styles.btnSublabel}>
          {props.sublabel.split('\n').map((line, i) => (
            <span key={i} className={styles.sublabelLine}>{line}</span>
          ))}
        </span>
      )}
    </button>
  );
}
