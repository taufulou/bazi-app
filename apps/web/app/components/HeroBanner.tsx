"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import styles from "./HeroBanner.module.css";

interface Slide {
  id: string;
  title: string;
  subtitle: string;
  cta?: { label: string; href: string };
  ornament?: string;
}

const SLIDES: Slide[] = [
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
const SLIDE_BG_CLASSES: Record<string, string> = {
  welcome: styles.slideWelcome,
  "promo-credits": styles.slidePromo,
  compatibility: styles.slideCompat,
};

const AUTO_PLAY_INTERVAL = 5000;

export default function HeroBanner() {
  const [activeIndex, setActiveIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Once user clicks a CTA, permanently disable autoplay (intentional — no need to
  // auto-advance while user has scrolled away from the banner)
  const userInteractedRef = useRef(false);

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
      setActiveIndex((prev) => {
        const next = (prev + 1) % SLIDES.length;
        const track = trackRef.current;
        if (track) {
          const slideWidth = track.offsetWidth;
          track.scrollTo({ left: slideWidth * next, behavior: "smooth" });
        }
        return next;
      });
    }, AUTO_PLAY_INTERVAL);
  }, [stopAutoPlay]);

  // IntersectionObserver to track visible slide (root = scroll container)
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
  }, []);

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

  // CTA click — permanently stop autoplay (user navigated away from banner)
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
        {SLIDES.map((slide, i) => (
          <div
            key={slide.id}
            className={`${styles.slide} ${SLIDE_BG_CLASSES[slide.id] || ""}`}
            data-index={i}
            role="group"
            aria-roledescription="slide"
            aria-label={`第 ${i + 1} 張，共 ${SLIDES.length} 張`}
          >
            {slide.ornament && (
              <span className={styles.ornament}>{slide.ornament}</span>
            )}
            <div className={styles.slideContent}>
              <h2 className={styles.slideTitle}>{slide.title}</h2>
              <p className={styles.slideSubtitle}>{slide.subtitle}</p>
              {slide.cta && (
                <Link href={slide.cta.href} className={styles.slideCta} onClick={handleCtaClick}>
                  {slide.cta.label} &rarr;
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
      {/* Dot indicators */}
      <div className={styles.dots} role="group" aria-label="投影片控制">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            className={`${styles.dot} ${i === activeIndex ? styles.dotActive : ""}`}
            onClick={() => handleDotClick(i)}
            aria-label={`切換至第 ${i + 1} 張`}
            aria-current={i === activeIndex ? "true" : undefined}
          />
        ))}
      </div>
    </section>
  );
}
