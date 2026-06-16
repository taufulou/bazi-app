"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { getActiveBanners, type BannerSlide } from "../lib/banner-api";
import styles from "./HeroBanner.module.css";

interface GradientSlide {
  id: string;
  title: string;
  subtitle: string;
  cta?: { label: string; href: string };
  ornament?: string;
}

// Built-in fallback slides — shown while banners load OR when the admin has
// not configured any active banner. Keeps today's look (no empty banner).
const FALLBACK_SLIDES: GradientSlide[] = [
  {
    id: "welcome",
    title: "AI 命理，精準解命",
    subtitle: "結合八字與紫微斗數，為您提供專業的命理分析",
    cta: { label: "開始分析", href: "#readings" },
    ornament: "命",
  },
  {
    id: "promo-credits",
    title: "新用戶專享體驗",
    subtitle: "首次分析免費，立即探索您的命運密碼",
    cta: { label: "了解更多", href: "/pricing" },
    ornament: "運",
  },
  {
    id: "compatibility",
    title: "合盤分析上線",
    subtitle: "比較兩人八字，探索感情與事業的契合度",
    cta: { label: "立即體驗", href: "/reading/compatibility" },
    ornament: "緣",
  },
];

// Type-safe gradient class mapping — avoids fragile dynamic styles[key] lookup
const SLIDE_BG_CLASSES: Record<string, string | undefined> = {
  welcome: styles.slideWelcome,
  "promo-credits": styles.slidePromo,
  compatibility: styles.slideCompat,
};

const AUTO_PLAY_INTERVAL = 5000;

export default function HeroBanner() {
  const [banners, setBanners] = useState<BannerSlide[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Once user clicks a CTA, permanently disable autoplay (intentional — no need to
  // auto-advance while user has scrolled away from the banner)
  const userInteractedRef = useRef(false);

  // Fetch admin-managed banners once on mount. getActiveBanners never throws
  // (returns [] on failure) so we always settle into image OR fallback mode.
  useEffect(() => {
    let cancelled = false;
    getActiveBanners().then((slides) => {
      if (!cancelled) setBanners(slides);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const useImages = !!banners && banners.length > 0;
  const slideCount = useImages ? banners!.length : FALLBACK_SLIDES.length;

  // Keep the latest slide count available to the autoplay interval without
  // re-creating the interval each render.
  const slideCountRef = useRef(slideCount);
  slideCountRef.current = slideCount;

  // Scroll to a specific slide
  const scrollToSlide = useCallback((index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const slideWidth = track.offsetWidth;
    track.scrollTo({ left: slideWidth * index, behavior: "smooth" });
  }, []);

  // Auto-play controls
  const stopAutoPlay = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startAutoPlay = useCallback(() => {
    stopAutoPlay();
    // Check prefers-reduced-motion inside function (not module scope — window undefined during SSR)
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    intervalRef.current = setInterval(() => {
      const count = slideCountRef.current;
      if (count <= 1) return; // nothing to advance
      setActiveIndex((prev) => {
        const next = (prev + 1) % count;
        const track = trackRef.current;
        if (track) {
          const slideWidth = track.offsetWidth;
          track.scrollTo({ left: slideWidth * next, behavior: "smooth" });
        }
        return next;
      });
    }, AUTO_PLAY_INTERVAL);
  }, [stopAutoPlay]);

  // When the slide set changes (fallback → images), reset to the first slide.
  useEffect(() => {
    setActiveIndex(0);
    const track = trackRef.current;
    if (track) track.scrollTo({ left: 0, behavior: "auto" });
  }, [useImages, slideCount]);

  // IntersectionObserver to track visible slide (root = scroll container).
  // Re-runs when the slide count changes (new DOM nodes).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (!isNaN(index)) setActiveIndex(index);
          }
        }
      },
      { root: track, threshold: 0.6 }
    );

    const slides = track.querySelectorAll("[data-index]");
    slides.forEach((slide) => observer.observe(slide));

    return () => observer.disconnect();
  }, [useImages, slideCount]);

  // Start auto-play on mount, cleanup on unmount
  useEffect(() => {
    startAutoPlay();
    return stopAutoPlay;
  }, [startAutoPlay, stopAutoPlay]);

  // Hover pause/resume (only resume if user hasn't clicked a CTA)
  const handleMouseEnter = useCallback(() => stopAutoPlay(), [stopAutoPlay]);
  const handleMouseLeave = useCallback(() => {
    if (!userInteractedRef.current) startAutoPlay();
  }, [startAutoPlay]);

  // CTA / image click — permanently stop autoplay (user navigated away from banner)
  const handleCtaClick = useCallback(() => {
    userInteractedRef.current = true;
    stopAutoPlay();
  }, [stopAutoPlay]);

  // Dot click — user takes permanent control
  const handleDotClick = (index: number) => {
    stopAutoPlay();
    scrollToSlide(index);
    setActiveIndex(index);
  };

  return (
    <section
      className={styles.banner}
      aria-label="精選服務"
      aria-roledescription="carousel"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className={styles.track} ref={trackRef} aria-live="off">
        {useImages
          ? banners!.map((slide, i) => (
              <Link
                key={slide.id}
                href={slide.linkHref}
                className={`${styles.slide} ${styles.slideImage}`}
                data-index={i}
                aria-roledescription="slide"
                aria-label={slide.altText || `橫幅 ${i + 1}，共 ${banners!.length} 張`}
                onClick={handleCtaClick}
              >
                <picture className={styles.picture}>
                  <source media="(max-width: 768px)" srcSet={slide.imageUrlMobile} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={slide.imageUrlDesktop}
                    alt={slide.altText ?? ""}
                    className={styles.image}
                  />
                </picture>
              </Link>
            ))
          : FALLBACK_SLIDES.map((slide, i) => (
              <div
                key={slide.id}
                className={`${styles.slide} ${SLIDE_BG_CLASSES[slide.id] || ""}`}
                data-index={i}
                role="group"
                aria-roledescription="slide"
                aria-label={`第 ${i + 1} 張，共 ${FALLBACK_SLIDES.length} 張`}
              >
                {slide.ornament && (
                  <span className={styles.ornament}>{slide.ornament}</span>
                )}
                <div className={styles.slideContent}>
                  <h2 className={styles.slideTitle}>{slide.title}</h2>
                  <p className={styles.slideSubtitle}>{slide.subtitle}</p>
                  {slide.cta && (
                    <Link
                      href={slide.cta.href}
                      className={styles.slideCta}
                      onClick={handleCtaClick}
                    >
                      {slide.cta.label} &rarr;
                    </Link>
                  )}
                </div>
              </div>
            ))}
      </div>
      {/* Dot indicators — hidden when there's only one slide */}
      {slideCount > 1 && (
        <div className={styles.dots} role="group" aria-label="投影片控制">
          {Array.from({ length: slideCount }).map((_, i) => (
            <button
              key={i}
              type="button"
              className={`${styles.dot} ${i === activeIndex ? styles.dotActive : ""}`}
              onClick={() => handleDotClick(i)}
              aria-label={`切換至第 ${i + 1} 張`}
              aria-current={i === activeIndex ? "true" : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}
