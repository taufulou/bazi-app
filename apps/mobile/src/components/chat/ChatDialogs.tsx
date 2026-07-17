/**
 * ChatDialogs — presentational chat modals (RN port of apps/web ChatDialogs +
 * dialog-copy.ts). The parent shows these conditionally via `visible`.
 *
 * Exports:
 *   - ExtendDialog      — credit-extension prompt («支付 1 點數繼續»).
 *   - HardCapDialog     — 30-message hard cap → start a new session.
 *   - RefuseLimitDialog — «超出範圍提醒» off-topic-refuse warning.
 *
 * Copy is zh-TW verbatim from the web dialog-copy.ts. Layout convention:
 * secondary action left (outlined), primary right (filled). Simple centered
 * RN Modals (transparent + fade).
 */
import * as React from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT } from '@repo/shared';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';

// ============================================================
// Shared primitives
// ============================================================

function DialogShell({
  visible,
  onRequestClose,
  children,
}: {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <View style={styles.backdrop}>
        <View style={styles.dialog} accessibilityViewIsModal>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function DialogBtn({
  label,
  primary = false,
  disabled = false,
  busy = false,
  onPress,
}: {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.btn,
        primary ? styles.btnPrimary : styles.btnSecondary,
        (disabled || busy) && styles.btnDisabled,
      ]}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
    >
      {busy ? (
        <ActivityIndicator
          size="small"
          color={primary ? colors.textOnRed : colors.textSecondary}
        />
      ) : (
        <Text style={[styles.btnLabel, primary ? styles.btnLabelPrimary : styles.btnLabelSecondary]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// ============================================================
// ExtendDialog — Dialog 1 (EXTEND_STANDARD)
// ============================================================

/** Optional pre-purchase allowance hint. All fields optional / defensive. */
export interface ExtendAllowanceInfo {
  /** Messages remaining before the 30-message hard cap. */
  messagesUntilHardCap?: number;
  /** Paid messages granted per extension (usually 10). */
  paidMessagesAllowance?: number;
}

export function ExtendDialog({
  visible,
  onConfirm,
  onCancel,
  isPurchasing = false,
  allowanceInfo,
}: {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isPurchasing?: boolean;
  allowanceInfo?: ExtendAllowanceInfo | null;
}) {
  const zh = useZh();
  const remaining = allowanceInfo?.messagesUntilHardCap;
  return (
    <DialogShell visible={visible} onRequestClose={onCancel}>
      <Text style={styles.title}>{zh('此對話的免費訊息已用完')}</Text>
      <View style={styles.body}>
        <Text style={styles.bodyLine}>{zh('支付 1 點數可繼續對話 10 則')}</Text>
        <Text style={styles.bodyLine}>{zh('此對話最多可進行至第 30 則')}</Text>
        {typeof remaining === 'number' && remaining > 0 ? (
          <Text style={styles.bodyHint}>
            {zh('此對話最多可再進行')} {remaining} {zh('則')}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        <DialogBtn label={zh('結束此對話')} disabled={isPurchasing} onPress={onCancel} />
        <DialogBtn
          primary
          label={zh('支付 1 點數繼續')}
          busy={isPurchasing}
          onPress={onConfirm}
        />
      </View>
    </DialogShell>
  );
}

// ============================================================
// HardCapDialog — Dialog 5 (HARD_CAP_REACHED)
// ============================================================

export function HardCapDialog({
  visible,
  onNewSession,
  onClose,
}: {
  visible: boolean;
  onNewSession: () => void;
  onClose: () => void;
}) {
  const zh = useZh();
  return (
    <DialogShell visible={visible} onRequestClose={onClose}>
      <Text style={styles.title}>{zh('此對話已達 30 則上限')}</Text>
      <View style={styles.body}>
        <Text style={styles.bodyLine}>{zh('請開啟新對話繼續詢問')}</Text>
        <Text style={styles.bodyLine}>{zh('新對話 AI 會重新讀取完整命盤資料')}</Text>
      </View>
      <View style={styles.actionsSingle}>
        <DialogBtn primary label={zh('開啟新對話 (1 點數)')} onPress={onNewSession} />
      </View>
    </DialogShell>
  );
}

// ============================================================
// RefuseLimitDialog — Dialog 7 (REFUSE_LIMIT_REACHED)
// ============================================================

export function RefuseLimitDialog({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const zh = useZh();
  return (
    <DialogShell visible={visible} onRequestClose={onClose}>
      <Text style={styles.title}>{zh('超出範圍提醒')}</Text>
      <Text style={styles.warning}>{zh('您最近多個問題都超出本服務範圍')}</Text>
      <View style={styles.body}>
        <Text style={styles.bodyLine}>
          {zh(
            `前 ${CHAT_CONSECUTIVE_REFUSE_REFUND_LIMIT} 個超出範圍問題已自動退款，但後續超出範圍問題仍會扣除訊息額度`,
          )}
        </Text>
        <Text style={styles.bodyLine}>
          {zh('若想了解命格、感情、事業、流年等深入分析，請查閱對應的解讀服務')}
        </Text>
      </View>
      <View style={styles.actionsSingle}>
        <DialogBtn primary label={zh('我知道了')} onPress={onClose} />
      </View>
    </DialogShell>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  dialog: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontFamily: fonts.serifBold,
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.textAccent,
    textAlign: 'center',
  },
  warning: {
    fontSize: fontSize.sm,
    color: colors.warning,
    fontWeight: '600',
    textAlign: 'center',
  },
  body: { gap: spacing.xs },
  bodyLine: {
    fontSize: fontSize.base,
    color: colors.textPrimary,
    lineHeight: 26,
    textAlign: 'center',
  },
  bodyHint: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  actionsSingle: { marginTop: spacing.xs },
  btn: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  btnPrimary: { backgroundColor: colors.red },
  btnSecondary: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.borderMedium,
  },
  btnDisabled: { opacity: 0.5 },
  btnLabel: { fontSize: fontSize.base, fontWeight: '700', textAlign: 'center' },
  btnLabelPrimary: { color: colors.textOnRed },
  btnLabelSecondary: { color: colors.textSecondary },
});
