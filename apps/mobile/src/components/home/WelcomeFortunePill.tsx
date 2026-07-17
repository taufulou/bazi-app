/**
 * WelcomeFortunePill — compact daily-fortune glance beside the greeting.
 * RN port of apps/web/app/components/WelcomeFortunePill.tsx.
 *
 * Richer than a bare chip: «能量 <score> · 今日運勢：<label>», so a returning user
 * sees today's status the moment the home screen loads. Tap → the 運勢 tab.
 * The full HomeDailyFortuneCard strip still renders below, so first-timers
 * scrolling the product also land on it.
 *
 * Uses `fetchDailyFortune({ engineOnly: true })` — the pill only needs score +
 * label, never the AI narrative (skips the ~3-5s Anthropic call on cold cache).
 *
 * Renders nothing when signed out, when there's no primary profile, or on service
 * failure — the greeting row must never break because fortune is down.
 */
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { colors, fonts, fontSize, spacing } from '../../theme';
import { useZh } from '../../lib/language';
import {
  fetchDailyFortune,
  resolveBaziToday,
  tierOf,
  type DailyFortuneResponse,
} from '../../lib/fortune-api';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: DailyFortuneResponse }
  | { kind: 'hidden' };

type Tier = ReturnType<typeof tierOf>;

/** Dot color per tier — mirrors the web CSS (gold default / orange / muted). */
const DOT_COLOR: Record<Tier, string> = {
  positive: colors.gold,
  neutral: colors.orange,
  negative: colors.textMuted,
};

export default function WelcomeFortunePill() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const zh = useZh();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;

    void (async () => {
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) setState({ kind: 'hidden' });
          return;
        }
        const data = await fetchDailyFortune({
          token,
          date: resolveBaziToday(),
          engineOnly: true,
        });
        if (!cancelled) setState({ kind: 'ready', data });
      } catch {
        // Any failure (incl. 404 / NO_PRIMARY_PROFILE) → hide. The greeting row
        // must never surface a fortune error.
        if (!cancelled) setState({ kind: 'hidden' });
      }
    })();

    return () => {
      cancelled = true;
    };
    // getToken is a fresh ref each render (Clerk) — omit it to avoid a fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn]);

  if (!isLoaded || !isSignedIn) return null;
  // Same footprint as the pill — avoids a layout shift when it resolves.
  if (state.kind === 'loading') return <View style={styles.skeleton} />;
  if (state.kind === 'hidden') return null;

  const { engineOutput } = state.data;
  const tier = tierOf(engineOutput.auspiciousness);

  return (
    <Pressable
      onPress={() => router.push('/(authenticated)/fortune')}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={zh(
        `今日運勢 ${engineOutput.auspiciousness}，能量 ${engineOutput.energyScore}。查看完整日運`,
      )}
    >
      {/* Compact vs web (which spells out 今日運勢：). The phone shares this row
          with the greeting + quick link — the full label overflows a 402pt screen,
          and the 吉/凶 label already reads as the fortune. Full text stays in the
          accessibilityLabel above. */}
      <View style={styles.pill}>
        <View style={[styles.dot, { backgroundColor: DOT_COLOR[tier] }]} />
        <Text style={styles.energyWord}>{zh('能量')}</Text>
        <Text style={styles.score}>{engineOutput.energyScore}</Text>
        <Text style={styles.sep}>·</Text>
        {/* Soft-trigger framing: gentle muted tone on inauspicious days, never red. */}
        <Text style={[styles.label, tier === 'negative' ? styles.labelNegative : null]}>
          {zh(engineOutput.auspiciousness)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderLight,
    // Frosted white — matches the web pill over the warm-cream background.
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
  dot: { width: 7, height: 7, borderRadius: 999 },
  energyWord: { fontSize: 11, color: colors.textMuted },
  score: {
    fontFamily: fonts.serifBold,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sep: { fontSize: fontSize.xs, color: colors.textMuted },
  statusWord: { fontSize: fontSize.xs, color: colors.textSecondary },
  label: {
    fontFamily: fonts.serif,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textAccent,
  },
  labelNegative: { color: colors.textSecondary },
  skeleton: {
    alignSelf: 'flex-start',
    width: 148,
    height: 28,
    borderRadius: 999,
    backgroundColor: colors.borderLight,
  },
});
