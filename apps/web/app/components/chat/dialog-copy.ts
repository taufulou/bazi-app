/**
 * Single source of truth for all chat dialog/banner copy strings (zh-TW).
 *
 * Per plan section "Chat Dialog Copy". Each dialog has a unique key for
 * analytics tracking. Layout convention: secondary action on left
 * (outlined), primary action on right (filled, recommended).
 */

import type { ChatDialogKey } from '../../lib/chat-types';

export type { ChatDialogKey };

// ============================================================
// Dialog 1 — Credit-extension prompt
// ============================================================

export const EXTEND_STANDARD = {
  key: 'extend_standard' as const,
  title: '此對話的免費訊息已用完',
  body: [
    '支付 1 點數可繼續對話 10 則',
    '此對話最多可進行至第 30 則',
  ],
  secondary: { label: '結束此對話', action: 'cancel' as const },
  primary: { label: '支付 1 點數繼續', action: 'extend' as const },
};

// ============================================================
// Dialog 2 — Soft warning at turn 20, no paid balance
// ============================================================

export const TURN20_WARNING_ZERO_BALANCE = {
  key: 'turn20_warning_zero_balance' as const,
  title: '已對話 20 則',
  warning: '對話越長，AI 準確度可能下降',
  body: [
    '此對話最多可進行至第 30 則 (再 10 則)',
    '請選擇繼續方式：',
  ],
  // The "繼續此對話" cost is dynamic. If the user's monthly free quota
  // already covers the remaining session capacity (e.g. PRO tier user with
  // 10 free chats left at msg 20 + 10 messages until cap = no extension
  // needed), the click is free — show 「免費」 not 「1 點數」 to avoid
  // misleading the user. The backend handler in ChatDrawer.tsx mirrors
  // this logic and skips purchaseExtension() in the same condition.
  secondary: ({ freeCovers }: { freeCovers: boolean }) => ({
    label: '繼續此對話',
    sublabel: freeCovers
      ? '免費\n再 10 則後結束'
      : '1 點數\n再 10 則後結束',
    action: 'continue_paid' as const,
  }),
  primary: {
    label: '開啟新對話',
    sublabel: '1 點數\n全新 10 則\nAI 重新讀取完整命盤',
    action: 'new_session' as const,
  },
};

// ============================================================
// Dialog 3 — Soft warning at turn 20, paid balance remaining
// ============================================================

export const TURN20_WARNING_WITH_BALANCE = {
  key: 'turn20_warning_with_balance' as const,
  title: '已對話 20 則',
  warning: '對話越長，AI 準確度可能下降',
  body: ({ remainingPaid }: { remainingPaid: number }) => [
    `您還有 ${remainingPaid} 則已付費對話可繼續使用 (免再付費)`,
  ],
  secondary: ({ remainingPaid }: { remainingPaid: number }) => ({
    label: '開啟新對話',
    sublabel: `1 點數\n⚠️ 將失去剩餘\n${remainingPaid} 則已付費`,
    action: 'new_session' as const,
  }),
  primary: ({ remainingPaid }: { remainingPaid: number }) => ({
    label: '繼續此對話',
    sublabel: `免費 (用剩餘 ${remainingPaid} 則)`,
    action: 'continue_free' as const,
  }),
};

// ============================================================
// Dialog 4 — Edge case at msg 25 / partial-credit warning
// ============================================================

export const NEAR_CAP_WARNING = {
  key: 'near_cap_warning' as const,
  title: ({ remaining }: { remaining: number }) =>
    `此對話即將達上限 (剩餘 ${remaining} 則)`,
  body: ['選擇繼續方式：'],
  secondary: ({ remaining }: { remaining: number }) => ({
    label: '繼續此對話',
    sublabel: `1 點數\n⚠️ 僅可再使用 ${remaining}\n則就結束`,
    action: 'continue_paid' as const,
  }),
  primary: {
    label: '開啟新對話',
    sublabel: '1 點數\n全新 10 則\nAI 重新讀取完整命盤',
    action: 'new_session' as const,
  },
};

// ============================================================
// Dialog 5 — Hard cap reached
// ============================================================

export const HARD_CAP_REACHED = {
  key: 'hard_cap_reached' as const,
  title: '此對話已達 30 則上限',
  body: [
    '請開啟新對話繼續詢問',
    '新對話 AI 會重新讀取完整命盤資料',
  ],
  primary: { label: '開啟新對話 (1 點數)', action: 'new_session' as const },
  closeable: false,
};

// ============================================================
// Dialog 6 — Confirm new session with unused paid chats
// ============================================================

export const NEW_SESSION_LOSE_PAID = {
  key: 'new_session_lose_paid' as const,
  title: ({ unused }: { unused: number }) =>
    `⚠️ 您將失去 ${unused} 則已付費對話`,
  body: ({ unused }: { unused: number }) => [
    `當前對話還有 ${unused} 則已付費對話未使用`,
    `開啟新對話將失去這 ${unused} 則`,
    '建議：先用完當前對話的付費訊息',
  ],
  secondary: { label: '仍要開啟新對話', sublabel: '1 點數', action: 'force_new_session' as const },
  primary: { label: '回到當前對話', sublabel: '(取消)', action: 'cancel' as const },
};

// ============================================================
// Persistent UI strings
// ============================================================

/** Header quota badge text. */
export function quotaBadgeText(args: {
  chatsUsed: number;
  monthlyQuota: number;
  paidRemaining: number;
}): string {
  const { chatsUsed, monthlyQuota, paidRemaining } = args;
  if (chatsUsed < monthlyQuota) {
    const remaining = monthlyQuota - chatsUsed;
    return `本月剩餘免費對話：${remaining} / ${monthlyQuota}`;
  }
  return `本月免費對話已用完  •  此對話剩餘付費：${paidRemaining} 則`;
}

/** Persistent footer disclaimer. Load-bearing per plan. */
export const DISCLAIMER_FOOTER = '本服務僅供參考與娛樂用途，不構成任何專業建議';

// ============================================================
// Dialog action types (discriminator for UI dispatcher)
// ============================================================

export type DialogAction =
  | 'cancel'
  | 'extend'
  | 'continue_paid'
  | 'continue_free'
  | 'new_session'
  | 'force_new_session';
