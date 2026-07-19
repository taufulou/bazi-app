/**
 * MascotViewer — the 角色卡 day-master mascot, swipeable between the FULL and
 * HALF body art (RN port of apps/web/app/components/MascotViewer.tsx).
 *
 * Web uses a scroll-snap track + IntersectionObserver + a dot indicator + a
 * "← 左右滑動切換視角 →" hint. Here we reuse the proven paging technique from
 * the home `HeroBanner`:
 *   - width seeded from useWindowDimensions, corrected by onLayout (a 0-width
 *     first paint would collapse the slides)
 *   - active dot synced on BOTH onMomentumScrollEnd AND onScrollEndDrag (a
 *     zero-velocity release never fires momentum)
 * Robustness: the two images are served remotely (EXPO_PUBLIC_ASSETS_URL), so
 * each slide tracks its OWN error state — if the half art is missing we collapse
 * to a single slide (no dots) rather than showing a broken second page. With no
 * resolvable art at all we fall back to the day-master glyph.
 */
import { useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { colors, fonts, fontSize, radius, spacing } from '../../theme';
import { useZh } from '../../lib/language';
import { env } from '../../lib/env';

const STEM_TO_PINYIN: Record<string, string> = {
  甲: 'jia', 乙: 'yi', 丙: 'bing', 丁: 'ding', 戊: 'wu',
  己: 'ji', 庚: 'geng', 辛: 'xin', 壬: 'ren', 癸: 'gui',
};

type MascotView = 'full' | 'half';

const VIEW_LABEL: Record<MascotView, string> = { full: '全身', half: '半身' };

const SLIDE_HEIGHT = 280;

function isValidStem(stem: unknown): stem is string {
  return typeof stem === 'string' && Object.prototype.hasOwnProperty.call(STEM_TO_PINYIN, stem);
}

/** `{assetsUrl}/mascots/{pinyin}-{gender}-{view}.png` — mirrors web getMascotImagePath. */
export function mascotUri(
  stem: string | undefined,
  gender: 'male' | 'female',
  view: MascotView,
): string | null {
  const pinyin = isValidStem(stem) ? STEM_TO_PINYIN[stem] : null;
  const base = (env.assetsUrl || '').replace(/\/+$/, '');
  if (!pinyin || !base) return null;
  return `${base}/mascots/${pinyin}-${gender}-${view}.png`;
}

export default function MascotViewer({
  stem,
  gender,
}: {
  stem?: string;
  gender: 'male' | 'female';
}) {
  const zh = useZh();
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);
  // Per-slide failure — a missing half asset must not blank the full one.
  const [failed, setFailed] = useState<Record<MascotView, boolean>>({ full: false, half: false });

  const width = measuredWidth ?? windowWidth;
  const widthRef = useRef(width);
  widthRef.current = width;

  const views: MascotView[] = (['full', 'half'] as const).filter(
    (v) => !!mascotUri(stem, gender, v) && !failed[v],
  );

  // Nothing renderable (invalid stem / no assets host / both images errored).
  if (views.length === 0) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackGlyph}>{isValidStem(stem) ? stem : '🎴'}</Text>
      </View>
    );
  }

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.round(w) !== Math.round(width)) setMeasuredWidth(w);
  };

  const handleScrollSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const w = widthRef.current;
    if (w <= 0) return;
    const raw = Math.round(e.nativeEvent.contentOffset.x / w);
    const i = Math.max(0, Math.min(views.length - 1, raw));
    if (i !== activeIndex) setActiveIndex(i);
    if (!hasInteracted) setHasInteracted(true);
  };

  return (
    <View onLayout={handleLayout} style={styles.wrap}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={views.length > 1}
        onScrollEndDrag={handleScrollSettled}
        onMomentumScrollEnd={handleScrollSettled}
        style={styles.track}
      >
        {views.map((view) => (
          <Image
            key={view}
            source={{ uri: mascotUri(stem, gender, view) as string }}
            style={{ width, height: SLIDE_HEIGHT }}
            contentFit="contain"
            cachePolicy="disk"
            accessibilityLabel={zh(`角色卡 ${VIEW_LABEL[view]}圖`)}
            onError={() => setFailed((prev) => ({ ...prev, [view]: true }))}
          />
        ))}
      </ScrollView>

      {views.length > 1 ? (
        <>
          <View style={styles.dots}>
            {views.map((view, i) => (
              <View key={view} style={[styles.dot, i === activeIndex && styles.dotActive]} />
            ))}
          </View>
          {!hasInteracted ? (
            <Text style={styles.hint}>{zh('← 左右滑動切換視角 →')}</Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  track: { borderRadius: radius.md },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderMedium },
  dotActive: { width: 20, borderRadius: 4, backgroundColor: colors.red },
  hint: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'center' },
  fallback: {
    width: '100%',
    height: 200,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderStyle: 'dashed',
  },
  fallbackGlyph: { fontFamily: fonts.serif, fontSize: 96, color: colors.textAccent },
});
