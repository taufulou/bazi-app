/**
 * HomeDailyFortuneCard — 首頁 今日運勢 strip: energy score (tier-colored circle),
 * auspiciousness label, a 1-line mood keyword, today's date, and a 查看 CTA.
 * Tap → the 運勢 tab (day scope). RN port of apps/web HomeDailyFortuneCard.
 *
 * Uses `fetchDailyFortune({ engineOnly: true })` — skips the ~3-5s AI call so the
 * homepage widget paints fast (~500ms cold). No AI narrative / dim bars here;
 * those live on the full 日運 page.
 *
 * States: loading (skeleton) · no_profile (setup prompt → /profiles) · error
 * (render nothing — graceful degradation) · ready.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fonts, fontSize, spacing, radius, shadows } from '../theme';
import { useZh } from '../lib/language';
import {
  fetchDailyFortune,
  resolveBaziToday,
  civilTodayTaipei,
  moodKeywordFromLabel,
  tierOf,
  FortuneApiError,
  type DailyFortuneResponse,
} from '../lib/fortune-api';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: DailyFortuneResponse }
  | { kind: 'no_profile' }
  | { kind: 'error' };

function tierColor(t: 'positive' | 'neutral' | 'negative'): string {
  if (t === 'positive') return colors.success;
  if (t === 'neutral') return colors.gold;
  return colors.red;
}

function formatDateZH(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[2])}月${Number(m[3])}日`;
}

export default function HomeDailyFortuneCard() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const zh = useZh();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) setState({ kind: 'error' });
          return;
        }
        const data = await fetchDailyFortune({ token, date: resolveBaziToday(), engineOnly: true });
        if (!cancelled) setState({ kind: 'ready', data });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof FortuneApiError && (err.status === 404 || err.code === 'NO_PRIMARY_PROFILE')) {
          setState({ kind: 'no_profile' });
        } else {
          setState({ kind: 'error' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // getToken is a fresh ref each render (Clerk) — omit to avoid a fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn]);

  if (!isLoaded || !isSignedIn) return null;
  if (state.kind === 'error') return null; // silent failure — render nothing

  const heading = <Text style={styles.heading}>{zh('今日運勢')}</Text>;

  if (state.kind === 'loading') {
    return (
      <View style={styles.section}>
        {heading}
        <View style={[styles.card, styles.skeleton]} />
      </View>
    );
  }

  if (state.kind === 'no_profile') {
    return (
      <View style={styles.section}>
        {heading}
        <Pressable style={styles.setupCard} onPress={() => router.push('/profiles')} accessibilityRole="button">
          <Text style={styles.setupIcon}>🌅</Text>
          <View style={styles.setupBody}>
            <Text style={styles.setupTitle}>{zh('建立出生資料以查看每日運勢')}</Text>
            <Text style={styles.setupSub}>{zh('完成後即可解鎖「今日能量」')}</Text>
          </View>
          <Text style={styles.setupArrow}>→</Text>
        </Pressable>
      </View>
    );
  }

  const { engineOutput } = state.data;
  const tColor = tierColor(tierOf(engineOutput.auspiciousness));
  const moodKeyword = moodKeywordFromLabel(engineOutput.auspiciousness);
  const civilDate = civilTodayTaipei();
  const isZiShiRollover = state.data.date !== civilDate;

  return (
    <View style={styles.section}>
      {heading}
      <Pressable
        testID="home-daily-fortune-card"
        style={styles.card}
        onPress={() =>
          // Deep-link to TODAY's fortune. `n` (nonce) makes the fortune tab reset
          // to today even on a repeat tap + even if it was showing a picked date.
          router.navigate({
            pathname: '/(authenticated)/fortune',
            params: { day: state.data.date, n: String(Date.now()) },
          })
        }
        accessibilityRole="button"
        accessibilityLabel={zh(`今日運勢 ${engineOutput.auspiciousness}，查看`)}
      >
        <View style={[styles.scoreRing, { borderColor: tColor }]}>
          <Text style={[styles.scoreNumber, { color: tColor }]}>{engineOutput.energyScore}</Text>
          <Text style={styles.scoreUnit}>{zh('能量')}</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.headerRow}>
            <Text style={[styles.label, { color: tColor }]}>{zh(engineOutput.auspiciousness)}</Text>
            <Text style={styles.mood}>{zh(moodKeyword)}</Text>
          </View>
          <Text style={styles.meta}>
            {zh(isZiShiRollover ? '命理日' : '今天')} · {formatDateZH(state.data.date)}
          </Text>
          {isZiShiRollover ? (
            <Text style={styles.ziShiNote}>
              {zh(`八字晚上 11 點換日，現已進入 ${formatDateZH(state.data.date)} 的運勢`)}
            </Text>
          ) : null}
        </View>

        <Text style={styles.cta}>{zh('查看 →')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  heading: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textAccent },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.warm,
  },
  skeleton: { height: 92, opacity: 0.5 },
  scoreRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreNumber: { fontFamily: fonts.serifBold, fontSize: fontSize.xl, fontWeight: '800' },
  scoreUnit: { fontSize: 10, color: colors.textMuted },
  body: { flex: 1, gap: spacing.xs },
  headerRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, flexWrap: 'wrap' },
  label: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700' },
  mood: { fontSize: fontSize.sm, color: colors.textSecondary },
  meta: { fontSize: fontSize.sm, color: colors.textMuted },
  ziShiNote: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 18 },
  cta: { fontSize: fontSize.sm, color: colors.red, fontWeight: '600' },
  setupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.warm,
  },
  setupIcon: { fontSize: 28 },
  setupBody: { flex: 1, gap: 2 },
  setupTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  setupSub: { fontSize: fontSize.xs, color: colors.textSecondary },
  setupArrow: { fontSize: fontSize.lg, color: colors.red },
});
