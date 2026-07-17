/**
 * CreditBadge — tier pill + credit-balance pill, with an optional 訂閱/升級方案 CTA.
 * RN port of apps/web/app/components/CreditBadge.tsx.
 *
 * Silent-degrade contract (kept from web): renders null when signed out AND when
 * the profile fetch fails — a header badge must never break the screen because
 * the API is down. `ref.refresh()` re-pulls the balance after a purchase.
 *
 * Routing: web links to 3 routes (/dashboard/subscription, /store, /pricing);
 * mobile has one /store screen (credit packs + subscription tiers), so all three
 * targets point there.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { colors, fontSize, spacing, radius } from '../../theme';
import { useZh } from '../../lib/language';
import { getUserProfile, type SubscriptionTier } from '../../lib/api';

const TIER_LABELS: Record<SubscriptionTier, string> = {
  FREE: '免費',
  BASIC: '基本',
  PRO: '專業',
  MASTER: '大師',
};

/**
 * Per-tier pill palette. Text/bg are theme tokens; the border rgba mirrors the web
 * CSS 1:1 (no theme token exists for those) — same local-rgba pattern as InlineAskCard.
 */
const TIER_STYLE: Record<
  SubscriptionTier,
  { color: string; backgroundColor: string; borderColor: string }
> = {
  FREE: {
    color: colors.tierFreeText,
    backgroundColor: colors.tierFreeBg,
    borderColor: 'rgba(117, 117, 117, 0.3)',
  },
  BASIC: {
    color: colors.tierBasicText,
    backgroundColor: colors.tierBasicBg,
    borderColor: 'rgba(25, 118, 210, 0.3)',
  },
  PRO: {
    color: colors.tierProText,
    backgroundColor: colors.tierProBg,
    borderColor: 'rgba(123, 31, 162, 0.3)',
  },
  MASTER: {
    color: colors.tierMasterText,
    backgroundColor: colors.tierMasterBg,
    borderColor: colors.tierMasterBorder,
  },
};

/** Imperative handle so a parent can refresh the balance after a credit change. */
export interface CreditBadgeHandle {
  refresh: () => Promise<void>;
}

export interface CreditBadgeProps {
  /** Show the 訂閱方案 / 升級方案 CTA beside the pills. Hidden for MASTER. */
  showPricingLink?: boolean;
}

const CreditBadge = forwardRef<CreditBadgeHandle, CreditBadgeProps>(function CreditBadge(
  { showPricingLink = false },
  ref,
) {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const router = useRouter();
  const zh = useZh();
  const [credits, setCredits] = useState<number | null>(null);
  const [tier, setTier] = useState<SubscriptionTier>('FREE');
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchProfile = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return; // no session token — silent degrade (badge hides)
      const profile = await getUserProfile(token);
      if (!mounted.current) return;
      setCredits(profile.credits);
      setTier(profile.subscriptionTier);
    } catch {
      // Silent degrade — the badge hides rather than surfacing an error.
      // An expired session already fired apiFetch's global 401 handler.
    }
    // getToken is a NEW reference every render (Clerk). Listing it would make this
    // callback unstable → the effect below re-runs after every setState → infinite
    // fetch loop. Clerk's getToken reads the live session, so capturing it once is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setIsLoading(false);
      return;
    }
    void (async () => {
      await fetchProfile();
      if (mounted.current) setIsLoading(false);
    })();
    // fetchProfile is stable (useCallback with []), so this cannot loop.
  }, [isLoaded, isSignedIn, fetchProfile]);

  useImperativeHandle(ref, () => ({ refresh: fetchProfile }), [fetchProfile]);

  if (!isSignedIn) return null;

  if (isLoading) {
    return (
      <View style={styles.row}>
        <View style={styles.skeleton} />
      </View>
    );
  }

  // API failed — silent degrade.
  if (credits === null) return null;

  const tierStyle = TIER_STYLE[tier] ?? TIER_STYLE.FREE;
  const tierLabel = TIER_LABELS[tier] ?? TIER_LABELS.FREE;
  const showPricing = showPricingLink && tier !== 'MASTER';
  const pricingLabel = tier === 'FREE' ? '💎 訂閱方案' : '⬆ 升級方案';

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => router.push('/store')}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={zh(`管理訂閱方案（目前：${tierLabel}）`)}
      >
        <View
          style={[
            styles.tierBadge,
            { backgroundColor: tierStyle.backgroundColor, borderColor: tierStyle.borderColor },
          ]}
        >
          <Text style={[styles.tierText, { color: tierStyle.color }]}>{zh(tierLabel)}</Text>
        </View>
      </Pressable>

      <Pressable
        onPress={() => router.push('/store')}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={zh(`購買點數（目前餘額：${credits} 點）`)}
      >
        <View style={styles.creditBadge}>
          <Text style={styles.creditIcon}>💎</Text>
          <Text style={styles.creditCount}>{credits}</Text>
        </View>
      </Pressable>

      {showPricing ? (
        <Pressable
          onPress={() => router.push('/store')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={zh(pricingLabel)}
        >
          <View style={styles.pricingLink}>
            <Text style={styles.pricingText}>{zh(pricingLabel)}</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
});

export default CreditBadge;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  skeleton: {
    width: 80,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.borderLight,
  },
  tierBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  tierText: { fontSize: 11, fontWeight: '600' },
  creditBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: 'rgba(212, 160, 23, 0.06)',
  },
  creditIcon: { fontSize: 11 },
  creditCount: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textPrimary },
  pricingLink: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(226, 61, 40, 0.35)',
    backgroundColor: colors.bgCard,
  },
  pricingText: { fontSize: fontSize.sm, color: colors.textAccent, fontWeight: '600' },
});
