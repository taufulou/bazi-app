/**
 * AccountPanel — low-credit warning + tier-aware CTA card. RN port of the
 * `compact` variant of apps/web/app/components/AccountPanel.tsx (the variant the
 * home screen uses).
 *
 * Compact deliberately omits the web's tier + credit "topRow" — that information
 * already lives in the header CreditBadge / the home credit card, so repeating it
 * here would be noise. The full (non-compact) variant is NOT ported.
 *
 * Fallback contract (kept from web): signed out OR a failed profile fetch renders
 * the StaticCTA marketing banner — never an error message.
 *
 * Routing: web links to /pricing + /dashboard/subscription + /store; mobile has
 * one /store screen (credit packs + subscription tiers), so all targets go there.
 */
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { colors, fonts, fontSize, spacing, radius, shadows } from '../../theme';
import { useZh } from '../../lib/language';
import { getUserProfile, type SubscriptionTier } from '../../lib/api';

/** Balance at/below which the 點數即將用完 bar shows. Mirrors the web threshold. */
const LOW_CREDIT_THRESHOLD = 3;

/**
 * Warning-bar palette — mirrors the web CSS 1:1. No theme token exists for a
 * deep-orange warning (colors.warning #ffc107 is an amber fill, too light for
 * text on cream); a token should be added to theme/index.ts if this is reused.
 */
const WARNING_BG = 'rgba(255, 152, 0, 0.08)';
const WARNING_BORDER = 'rgba(255, 152, 0, 0.2)';
const WARNING_TEXT = '#E65100';

/** Blue "buy credits" outline — mirrors the web rgba over colors.info. */
const INFO_BORDER = 'rgba(33, 150, 243, 0.25)';

/** Static marketing banner — the fallback when signed out or the API fails. */
function StaticCTA() {
  const router = useRouter();
  const zh = useZh();
  return (
    <View style={styles.panel}>
      <Text style={styles.staticTitle}>{zh('🔓 解鎖完整命理分析')}</Text>
      <Text style={styles.staticText}>
        {zh('訂閱會員即可查看所有分析的完整內容，包括詳細的性格分析、事業指引、感情建議等。')}
      </Text>
      <Pressable
        style={styles.ctaBtn}
        onPress={() => router.push('/store')}
        accessibilityRole="button"
      >
        <Text style={styles.ctaBtnText}>{zh('查看訂閱方案')}</Text>
      </Pressable>
    </View>
  );
}

export default function AccountPanel() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const router = useRouter();
  const zh = useZh();
  const [credits, setCredits] = useState<number | null>(null);
  const [tier, setTier] = useState<SubscriptionTier>('FREE');
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) setHasError(true);
          return;
        }
        const profile = await getUserProfile(token);
        if (cancelled) return;
        setCredits(profile.credits);
        setTier(profile.subscriptionTier);
      } catch {
        if (!cancelled) setHasError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // getToken is a fresh ref each render (Clerk) — omit it to avoid a fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn]);

  // Not signed in — static CTA.
  if (isLoaded && !isSignedIn) return <StaticCTA />;

  if (isLoading) {
    return (
      <View style={styles.panel}>
        <View style={styles.skeletonBtn} />
      </View>
    );
  }

  // API error — fall back to the static CTA (never an error message).
  if (hasError || credits === null) return <StaticCTA />;

  const showLowWarning = credits <= LOW_CREDIT_THRESHOLD;

  return (
    <View style={styles.panel}>
      {showLowWarning ? (
        <View style={styles.warningBar}>
          <Text style={styles.warningText}>{zh('⚠️ 點數即將用完')}</Text>
          <Pressable
            onPress={() => router.push('/store')}
            hitSlop={10}
            accessibilityRole="button"
          >
            <Text style={styles.warningBuyLink}>{zh('立即購買 →')}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.ctaRow}>
        {tier === 'FREE' ? (
          <>
            <Pressable
              style={styles.ctaBtn}
              onPress={() => router.push('/store')}
              accessibilityRole="button"
            >
              <Text style={styles.ctaBtnText}>{zh('升級方案')}</Text>
            </Pressable>
            <Pressable
              style={styles.buyCreditsSecondary}
              onPress={() => router.push('/store')}
              accessibilityRole="button"
            >
              <Text style={styles.buyCreditsSecondaryText}>{zh('或直接購買點數')}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              style={styles.ctaBtnOutline}
              onPress={() => router.push('/store')}
              accessibilityRole="button"
            >
              <Text style={styles.ctaBtnOutlineText}>{zh('管理訂閱')}</Text>
            </Pressable>
            <Pressable
              style={styles.buyCreditsBtn}
              onPress={() => router.push('/store')}
              accessibilityRole="button"
            >
              <Text style={styles.buyCreditsBtnText}>{zh('💎 購買點數')}</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.warm,
  },

  // ---- Low-credit warning ----
  warningBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    alignSelf: 'stretch',
    backgroundColor: WARNING_BG,
    borderWidth: 1,
    borderColor: WARNING_BORDER,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  warningText: { fontSize: fontSize.sm, color: WARNING_TEXT },
  warningBuyLink: { fontSize: fontSize.sm, fontWeight: '600', color: WARNING_TEXT },

  // ---- CTAs ----
  ctaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  ctaBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.sm,
    backgroundColor: colors.red,
  },
  ctaBtnText: { fontSize: fontSize.base, fontWeight: '600', color: colors.textOnRed },
  ctaBtnOutline: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderMedium,
  },
  ctaBtnOutlineText: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  buyCreditsBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: INFO_BORDER,
  },
  buyCreditsBtnText: { fontSize: fontSize.base, fontWeight: '600', color: colors.info },
  // flexBasis 100% -> wraps onto its own line under the primary CTA (web parity).
  buyCreditsSecondary: {
    flexBasis: '100%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buyCreditsSecondaryText: { fontSize: fontSize.sm, color: colors.textSecondary },

  // ---- Static CTA fallback ----
  staticTitle: {
    fontFamily: fonts.serifBold,
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.textAccent,
    textAlign: 'center',
  },
  staticText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },

  // ---- Skeleton (static, matching HomeDailyFortuneCard's no-shimmer pattern) ----
  skeletonBtn: {
    width: 140,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.borderLight,
  },
});
