/**
 * ShareFortuneButton — «分享» button that opens a preview Modal of the
 * ShareableFortuneCard, then rasterizes it (react-native-view-shot captureRef)
 * and hands the PNG to the native share sheet (expo-sharing). RN counterpart of
 * the web html2canvas share flow (html2canvas is web-only; view-shot is the RN
 * equivalent for capturing a rendered View).
 */
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { View, Text, Pressable, Modal, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Share2, X } from 'lucide-react-native';
import { colors, fonts, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';

interface Props {
  /** Renders the capture-target card with the given ref attached (a forwardRef
   *  ShareableXFortuneCard). The button owns the ref + capture/share/modal. */
  renderCard: (ref: RefObject<View | null>) => ReactNode;
  /** Trigger + modal + share-dialog label. Defaults to «分享今日運勢» (daily). */
  label?: string;
}

export default function ShareFortuneButton({ renderCard, label = '分享今日運勢' }: Props) {
  const zh = useZh();
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef<View>(null);

  const onShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      // Give the modal card a tick to finish layout before capturing.
      const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert(zh('無法分享'), zh('此裝置不支援分享功能。'));
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: zh(label) });
    } catch {
      Alert.alert(zh('分享失敗'), zh('產生分享圖片時發生問題，請稍後再試。'));
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      <Pressable
        style={styles.trigger}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={zh(label)}
      >
        <Share2 size={16} strokeWidth={2} color={colors.red} />
        <Text style={styles.triggerText}>{zh(label)}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{zh(label)}</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10} accessibilityLabel={zh('關閉')}>
                <X size={22} strokeWidth={2} color={colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.previewWrap}>{renderCard(cardRef)}</ScrollView>

            <Pressable
              style={[styles.shareBtn, sharing && styles.shareBtnDisabled]}
              onPress={onShare}
              disabled={sharing}
              accessibilityRole="button"
            >
              {sharing ? (
                <ActivityIndicator color={colors.textOnRed} />
              ) : (
                <Text style={styles.shareBtnText}>{zh('分享圖片')}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderMedium,
  },
  triggerText: { fontSize: fontSize.base, fontWeight: '600', color: colors.red },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgPrimary,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '90%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  previewWrap: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  shareBtn: {
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginHorizontal: spacing.xl,
  },
  shareBtnDisabled: { opacity: 0.7 },
  shareBtnText: { color: colors.textOnRed, fontSize: fontSize.base, fontWeight: '700' },
});
