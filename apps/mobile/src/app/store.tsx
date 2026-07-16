/**
 * 購買點數與方案 — the in-app store (credit packs + subscription tiers).
 *
 * Products + prices come from RevenueCat offerings (the store is the source of
 * truth for price/period). A purchase is kicked off client-side; the RC webhook
 * grants credits/tier server-side, so after a successful purchase we POLL
 * `/api/users/me` until the balance/tier reflects (optimistic 處理中 → success).
 *
 * Graceful when RC isn't configured yet (no platform key) OR returns no
 * offering — shows a friendly "即將推出" state instead of crashing.
 *
 * NOTE: react-native-purchases is a native module — the dev client must be
 * rebuilt after install before this screen runs on-device.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Linking,
  Alert,
} from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { colors, spacing, fontSize, radius, shadows } from '../theme';
import { useZh } from '../lib/language';
import { getUserProfile, type SubscriptionTier } from '../lib/api';
import {
  isPurchasesSupported,
  configurePurchases,
  getCurrentOffering,
  purchasePackage,
  restorePurchases,
  openManageSubscriptions,
} from '../lib/purchases';

const EULA_URL = 'https://baziapp.com/terms';
const PRIVACY_URL = 'https://baziapp.com/privacy';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

type LoadState = 'loading' | 'unsupported' | 'empty' | 'ready' | 'error';

export default function StoreScreen() {
  const { getToken, userId, isSignedIn } = useAuth();
  const zh = useZh();

  const [state, setState] = useState<LoadState>('loading');
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [tier, setTier] = useState<SubscriptionTier>('FREE');
  const [busyPackageId, setBusyPackageId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refreshProfile = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return null;
      const p = await getUserProfile(token);
      setCredits(p.credits);
      setTier(p.subscriptionTier);
      return p;
    } catch {
      return null;
    }
    // getToken is an unstable Clerk ref each render — exclude from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setState('loading');
    if (!isPurchasesSupported()) {
      await refreshProfile();
      setState('unsupported');
      return;
    }
    try {
      if (userId) await configurePurchases(userId);
      const [off] = await Promise.all([getCurrentOffering(), refreshProfile()]);
      setOffering(off);
      setState(off && off.availablePackages.length > 0 ? 'ready' : 'empty');
    } catch {
      setState('error');
    }
    // getToken/userId handled explicitly; refreshProfile is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, refreshProfile]);

  useEffect(() => {
    if (isSignedIn) void load();
  }, [isSignedIn, load]);

  /** Poll /api/users/me until credits or tier changes from the pre-purchase snapshot. */
  const pollForEntitlement = useCallback(
    async (before: { credits: number | null; tier: SubscriptionTier }) => {
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const p = await refreshProfile();
        if (p && (p.credits !== before.credits || p.subscriptionTier !== before.tier)) return true;
      }
      return false;
    },
    [refreshProfile],
  );

  const handlePurchase = useCallback(
    async (pkg: PurchasesPackage) => {
      setBusyPackageId(pkg.identifier);
      const before = { credits, tier };
      try {
        const res = await purchasePackage(pkg);
        if (res.userCancelled) return;
        if (!res.success) {
          Alert.alert(zh('購買未完成'), res.error ?? zh('請稍後再試'));
          return;
        }
        // Purchased — entitlements are granted server-side via the RC webhook.
        setSyncing(true);
        const reflected = await pollForEntitlement(before);
        Alert.alert(
          zh('購買成功'),
          reflected
            ? zh('您的點數／方案已更新。')
            : zh('款項已收到，點數將於數分鐘內更新。'),
        );
      } finally {
        setBusyPackageId(null);
        setSyncing(false);
      }
    },
    [credits, tier, pollForEntitlement, zh],
  );

  const handleRestore = useCallback(async () => {
    setSyncing(true);
    try {
      const info = await restorePurchases();
      await refreshProfile();
      Alert.alert(
        zh('恢復購買'),
        info ? zh('已恢復您的購買記錄。') : zh('找不到可恢復的購買。'),
      );
    } finally {
      setSyncing(false);
    }
  }, [refreshProfile, zh]);

  // ---- render states ----
  if (state === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.red} />
      </View>
    );
  }

  const subs = offering?.availablePackages.filter((p) => p.product.productCategory === 'SUBSCRIPTION') ?? [];
  const packs = offering?.availablePackages.filter((p) => p.product.productCategory !== 'SUBSCRIPTION') ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Balance */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>{zh('目前點數')}</Text>
        <Text style={styles.balanceValue}>{credits ?? '—'}</Text>
        {tier !== 'FREE' ? <Text style={styles.tierBadge}>{tierLabel(zh, tier)}</Text> : null}
      </View>

      {state === 'unsupported' || state === 'error' || state === 'empty' ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{zh('商店即將推出')}</Text>
          <Text style={styles.emptyBody}>
            {state === 'error'
              ? zh('暫時無法載入商店，請稍後再試。')
              : zh('內購項目正在準備中，敬請期待。')}
          </Text>
          {state === 'error' ? (
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => void load()} accessibilityRole="button">
              <Text style={styles.secondaryBtnText}>{zh('重試')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <>
          {subs.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{zh('訂閱方案')}</Text>
              {subs.map((pkg) => (
                <PackageRow
                  key={pkg.identifier}
                  pkg={pkg}
                  cta={zh('訂閱')}
                  busy={busyPackageId === pkg.identifier}
                  disabled={!!busyPackageId}
                  onPress={() => void handlePurchase(pkg)}
                />
              ))}
            </View>
          ) : null}

          {packs.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{zh('點數包')}</Text>
              {packs.map((pkg) => (
                <PackageRow
                  key={pkg.identifier}
                  pkg={pkg}
                  cta={zh('購買')}
                  busy={busyPackageId === pkg.identifier}
                  disabled={!!busyPackageId}
                  onPress={() => void handlePurchase(pkg)}
                />
              ))}
            </View>
          ) : null}

          <TouchableOpacity style={styles.secondaryBtn} onPress={() => void handleRestore()} accessibilityRole="button" disabled={syncing}>
            <Text style={styles.secondaryBtnText}>{zh('恢復購買')}</Text>
          </TouchableOpacity>

          {tier !== 'FREE' ? (
            <TouchableOpacity style={styles.linkRow} onPress={() => void openManageSubscriptions()} accessibilityRole="button">
              <Text style={styles.linkText}>{zh('管理訂閱')}</Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}

      {/* Compliance copy (App Store 3.1.2 / Google Play) */}
      {subs.length > 0 ? (
        <Text style={styles.compliance}>
          {zh(
            '訂閱為自動續訂，除非於當期結束前至少 24 小時取消，否則將自動續期並扣款。您可於 App Store／Google Play 帳戶設定中管理或取消訂閱。',
          )}
        </Text>
      ) : null}
      <View style={styles.legalRow}>
        <TouchableOpacity onPress={() => void Linking.openURL(EULA_URL)} accessibilityRole="link">
          <Text style={styles.legalLink}>{zh('使用條款')}</Text>
        </TouchableOpacity>
        <Text style={styles.legalDot}>·</Text>
        <TouchableOpacity onPress={() => void Linking.openURL(PRIVACY_URL)} accessibilityRole="link">
          <Text style={styles.legalLink}>{zh('隱私政策')}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.disclaimer}>
        {zh('本服務僅供參考與娛樂用途，不構成任何專業建議')}
      </Text>

      {syncing ? (
        <View style={styles.syncOverlay} pointerEvents="none">
          <View style={styles.syncBox}>
            <ActivityIndicator color={colors.red} />
            <Text style={styles.syncText}>{zh('處理中…')}</Text>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function PackageRow({
  pkg,
  cta,
  busy,
  disabled,
  onPress,
}: {
  pkg: PurchasesPackage;
  cta: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.pkgRow}>
      <View style={styles.pkgInfo}>
        <Text style={styles.pkgTitle}>{pkg.product.title}</Text>
        {pkg.product.description ? (
          <Text style={styles.pkgDesc}>{pkg.product.description}</Text>
        ) : null}
      </View>
      <TouchableOpacity
        style={[styles.buyBtn, disabled && styles.buyBtnDisabled]}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${cta} ${pkg.product.title}`}
      >
        {busy ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.buyBtnText}>{pkg.product.priceString}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function tierLabel(zh: (s: string) => string, tier: SubscriptionTier): string {
  const map: Record<SubscriptionTier, string> = {
    FREE: '',
    BASIC: '基礎會員',
    PRO: '專業會員',
    MASTER: '大師會員',
  };
  return zh(map[tier] || '會員');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl, gap: spacing.lg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgPrimary },
  balanceCard: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center', gap: spacing.xs, ...shadows.warm },
  balanceLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  balanceValue: { fontSize: 40, fontWeight: '800', color: colors.red },
  tierBadge: { fontSize: fontSize.sm, color: colors.gold, fontWeight: '700' },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textAccent },
  pkgRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, backgroundColor: colors.bgCard, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.borderLight },
  pkgInfo: { flex: 1, gap: 2 },
  pkgTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  pkgDesc: { fontSize: fontSize.sm, color: colors.textSecondary },
  buyBtn: { minWidth: 88, alignItems: 'center', backgroundColor: colors.red, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  buyBtnDisabled: { opacity: 0.5 },
  buyBtnText: { color: '#fff', fontWeight: '700', fontSize: fontSize.sm },
  secondaryBtn: { alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderMedium, backgroundColor: colors.bgCard },
  secondaryBtnText: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  linkRow: { alignItems: 'center', paddingVertical: spacing.sm },
  linkText: { fontSize: fontSize.sm, color: colors.textAccent, fontWeight: '600' },
  emptyCard: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.sm, alignItems: 'center', ...shadows.warm },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  emptyBody: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  compliance: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 18 },
  legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.sm },
  legalLink: { fontSize: fontSize.xs, color: colors.textAccent },
  legalDot: { color: colors.textMuted },
  disclaimer: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
  syncOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.15)' },
  syncBox: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center', gap: spacing.sm, ...shadows.warm },
  syncText: { fontSize: fontSize.sm, color: colors.textPrimary },
});
