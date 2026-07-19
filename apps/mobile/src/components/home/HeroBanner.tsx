/**
 * HeroBanner — home carousel (RN port of apps/web/app/components/HeroBanner.tsx).
 *
 * Two data modes, exactly like web:
 *  - image mode: admin-managed slides from GET /api/banners (public, no token)
 *  - fallback mode: 3 built-in 命/運/緣 slides — shown WHILE LOADING and when no
 *    banner is configured, so the banner is never empty.
 *
 * Web → RN swaps:
 *  - scroll-snap track  → horizontal ScrollView + `pagingEnabled`
 *  - IntersectionObserver → onMomentumScrollEnd / onScrollEndDrag offset math
 *  - hover pause        → touch/drag pause
 *  - CSS linear-gradient → flat theme color (expo-linear-gradient is NOT a
 *    dependency; we don't add one for decoration). Each slide keeps the web
 *    gradient's anchor color + the oversized translucent ornament glyph.
 *  - prefers-reduced-motion → AccessibilityInfo.isReduceMotionEnabled()
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
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
import { useRouter, type Href } from 'expo-router';
import { colors, fonts, fontSize, radius, shadows, spacing } from '../../theme';
import { useLang, useZh } from '../../lib/language';
import { getActiveBanners, type BannerSlide } from '../../lib/banner-api';

interface GradientSlide {
  id: string;
  title: string;
  subtitle: string;
  cta?: { label: string; href: string };
  ornament?: string;
  /** Theme token standing in for the web slide's CSS gradient (see header). */
  bg: string;
}

/** Built-in fallback slides — mirrors web FALLBACK_SLIDES 1:1 (copy + hrefs). */
const FALLBACK_SLIDES: GradientSlide[] = [
  {
    id: 'welcome',
    title: 'AI 命理，精準解命',
    subtitle: '結合八字與紫微斗數，為您提供專業的命理分析',
    cta: { label: '開始分析', href: '#readings' },
    ornament: '命',
    bg: colors.red, // web: red → orange
  },
  {
    id: 'promo-credits',
    title: '新用戶專享體驗',
    subtitle: '首次分析免費，立即探索您的命運密碼',
    cta: { label: '了解更多', href: '/pricing' },
    ornament: '運',
    bg: colors.gold, // web: #B8860B → gold
  },
  {
    id: 'compatibility',
    title: '合盤分析上線',
    subtitle: '比較兩人八字，探索感情與事業的契合度',
    cta: { label: '立即體驗', href: '/reading/compatibility' },
    ornament: '緣',
    bg: colors.textAccent, // web: --text-accent → red
  },
];

const AUTO_PLAY_INTERVAL_MS = 5000;

/** Admin's recommended mobile crop is 1200×420 (apps/web/app/admin/banners/link-options.ts). */
const MOBILE_BANNER_ASPECT = 1200 / 420;

/** Web's ≤768px slide height — the gradient slides need room for title+subtitle+CTA. */
const FALLBACK_SLIDE_HEIGHT = 150;

/** Reading slugs that mobile's /reading/[type] actually accepts (see that file's VALID). */
const READING_ROUTE_TYPES = new Set(['lifetime', 'love', 'career', 'annual']);

/**
 * Web href → mobile route. Admins pick from a fixed dropdown
 * (apps/web/app/admin/banners/link-options.ts), so every option is mapped
 * explicitly. Anything unknown returns null → the tap is a safe no-op rather
 * than a crash or a dead-end navigation.
 */
export function mapHref(href: string): Href | null {
  switch (href) {
    // No mobile pricing page — subscriptions/credits both live in the store.
    case '/pricing':
    case '/store':
      return '/store';
    // 合盤 and 日/月/年運 are TABS on mobile, not /reading/* routes.
    case '/reading/compatibility':
      return '/(authenticated)/compat';
    case '/reading/fortune':
      return '/(authenticated)/fortune';
    case '/dashboard/profiles':
      return '/profiles';
    case '/dashboard/readings':
      return '/(authenticated)/readings';
    // Already on this screen: web's in-page anchor + home.
    case '#readings':
    case '/':
      return null;
    default:
      break;
  }
  const match = /^\/reading\/([a-z-]+)$/.exec(href);
  if (match && READING_ROUTE_TYPES.has(match[1])) {
    // Object form — typedRoutes rejects a dynamically-built path string.
    return { pathname: '/reading/[type]', params: { type: match[1] } };
  }
  return null;
}

export default function HeroBanner() {
  const lang = useLang();
  const zh = useZh();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();

  const [banners, setBanners] = useState<BannerSlide[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Seeded from the window so the first paint is close, then corrected by
  // onLayout — the parent screen pads horizontally, so the window width alone
  // would overflow the track and mis-snap every page.
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Once the user taps a CTA, autoplay stops for good (mirrors web). */
  const userInteractedRef = useRef(false);
  const reduceMotionRef = useRef(false);

  const width = measuredWidth ?? windowWidth;
  // Refs keep the latest values reachable from the interval without re-creating it.
  const widthRef = useRef(width);
  widthRef.current = width;
  const activeIndexRef = useRef(0);

  const imageSlides = banners && banners.length > 0 ? banners : null;
  const slideCount = imageSlides ? imageSlides.length : FALLBACK_SLIDES.length;
  const slideCountRef = useRef(slideCount);
  slideCountRef.current = slideCount;

  const slideHeight = imageSlides
    ? Math.round(width / MOBILE_BANNER_ASPECT)
    : FALLBACK_SLIDE_HEIGHT;

  // Fetch admin banners once. getActiveBanners never throws (returns [] on
  // failure) so we always settle into image OR fallback mode. Public endpoint →
  // no getToken(), so no Clerk fresh-ref dependency hazard here.
  useEffect(() => {
    let cancelled = false;
    getActiveBanners().then((slides) => {
      if (!cancelled) setBanners(slides);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setIndex = useCallback((i: number) => {
    activeIndexRef.current = i;
    setActiveIndex(i);
  }, []);

  const scrollToIndex = useCallback((i: number, animated = true) => {
    scrollRef.current?.scrollTo({ x: widthRef.current * i, y: 0, animated });
  }, []);

  const stopAutoPlay = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startAutoPlay = useCallback(() => {
    stopAutoPlay();
    if (reduceMotionRef.current || userInteractedRef.current) return;
    intervalRef.current = setInterval(() => {
      const count = slideCountRef.current;
      if (count <= 1) return; // nothing to advance
      const next = (activeIndexRef.current + 1) % count;
      setIndex(next);
      scrollToIndex(next);
    }, AUTO_PLAY_INTERVAL_MS);
  }, [stopAutoPlay, setIndex, scrollToIndex]);

  /** Resume after a touch/drag — but never after a CTA tap. */
  const resumeAutoPlay = useCallback(() => {
    if (!userInteractedRef.current) startAutoPlay();
  }, [startAutoPlay]);

  // Read the reduce-motion preference BEFORE the first autoplay start, so the
  // timer is never created for users who opted out of motion.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        reduceMotionRef.current = await AccessibilityInfo.isReduceMotionEnabled();
      } catch {
        // default: motion allowed
      }
      if (!cancelled) startAutoPlay();
    })();
    return () => {
      cancelled = true;
      stopAutoPlay();
    };
  }, [startAutoPlay, stopAutoPlay]);

  // Slide set changed (fallback → images): back to the first slide.
  useEffect(() => {
    setIndex(0);
    scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
  }, [imageSlides, slideCount, setIndex]);

  // Width changed (measure landed / rotation): the pixel offset is now stale.
  useEffect(() => {
    scrollToIndex(activeIndexRef.current, false);
  }, [width, scrollToIndex]);

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.round(w) !== Math.round(width)) setMeasuredWidth(w);
  };

  /** Replaces web's IntersectionObserver — derive the page from the offset. */
  const syncIndexFromScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const w = widthRef.current;
    if (w <= 0) return;
    const raw = Math.round(e.nativeEvent.contentOffset.x / w);
    const i = Math.max(0, Math.min(slideCountRef.current - 1, raw));
    if (i !== activeIndexRef.current) setIndex(i);
  };

  // Both handlers: onMomentumScrollEnd doesn't fire for a zero-velocity release.
  const handleScrollSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    syncIndexFromScroll(e);
    resumeAutoPlay();
  };

  const handleCtaPress = (href: string) => {
    userInteractedRef.current = true;
    stopAutoPlay();
    const target = mapHref(href);
    if (target) router.push(target);
  };

  const handleDotPress = (i: number) => {
    setIndex(i);
    scrollToIndex(i);
    resumeAutoPlay(); // restarts the countdown from the picked slide
  };

  const isCn = lang === 'zh-CN';

  return (
    // Shadow lives on the outer view: iOS drops shadows on a view that also
    // clips (overflow:hidden), so clipping happens on the inner one.
    <View style={styles.shadowWrap} onLayout={handleLayout}>
      <View style={styles.clip}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={stopAutoPlay}
          onScrollEndDrag={handleScrollSettled}
          onMomentumScrollEnd={handleScrollSettled}
          style={{ height: slideHeight }}
          accessibilityLabel={zh('精選服務')}
        >
          {imageSlides
            ? imageSlides.map((slide, i) => {
                // Banner text is baked into the pixels, so swapping the crop is
                // the only way to localize it (the converter can't touch images).
                const uri =
                  isCn && slide.imageUrlMobileSimplified
                    ? slide.imageUrlMobileSimplified
                    : slide.imageUrlMobile;
                return (
                  <Pressable
                    key={slide.id}
                    style={{ width, height: slideHeight }}
                    onPress={() => handleCtaPress(slide.linkHref)}
                    accessibilityRole="button"
                    accessibilityLabel={zh(slide.altText || `橫幅 ${i + 1}`)}
                  >
                    <Image
                      source={{ uri }}
                      style={styles.image}
                      contentFit="cover"
                      transition={150}
                    />
                  </Pressable>
                );
              })
            : FALLBACK_SLIDES.map((slide) => {
                const cta = slide.cta;
                return (
                  <View
                    key={slide.id}
                    style={[styles.slide, { width, height: slideHeight, backgroundColor: slide.bg }]}
                  >
                    {slide.ornament ? (
                      <Text style={styles.ornament} accessibilityElementsHidden importantForAccessibility="no">
                        {slide.ornament}
                      </Text>
                    ) : null}
                    <View style={styles.slideContent}>
                      <Text style={styles.slideTitle}>{zh(slide.title)}</Text>
                      <Text style={styles.slideSubtitle}>{zh(slide.subtitle)}</Text>
                      {cta ? (
                        <Pressable
                          style={styles.slideCta}
                          onPress={() => handleCtaPress(cta.href)}
                          accessibilityRole="button"
                          accessibilityLabel={zh(cta.label)}
                        >
                          <Text style={styles.slideCtaText}>{zh(`${cta.label} →`)}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })}
        </ScrollView>

        {slideCount > 1 ? (
          <View style={styles.dots} accessibilityRole="tablist">
            {Array.from({ length: slideCount }).map((_, i) => (
              <Pressable
                key={i}
                hitSlop={8}
                onPress={() => handleDotPress(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: i === activeIndex }}
                accessibilityLabel={zh(`切換至第 ${i + 1} 張`)}
              >
                <View style={[styles.dot, i === activeIndex && styles.dotActive]} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shadowWrap: { borderRadius: radius.lg, ...shadows.warmLg },
  clip: { borderRadius: radius.lg, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  slide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, overflow: 'hidden' },
  ornament: {
    position: 'absolute',
    right: spacing.lg,
    bottom: -12,
    fontFamily: fonts.serifBold,
    fontSize: 80,
    fontWeight: '700',
    lineHeight: 88,
    color: 'rgba(255,255,255,0.12)',
  },
  slideContent: { alignItems: 'center', gap: spacing.sm, maxWidth: 500 },
  slideTitle: {
    fontFamily: fonts.serifBold,
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.textOnRed,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.15)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  slideSubtitle: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    lineHeight: 22,
  },
  slideCta: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  slideCtaText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textOnRed },
  dots: {
    position: 'absolute',
    bottom: spacing.md,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { width: 20, borderRadius: 4, backgroundColor: colors.textOnRed },
});
