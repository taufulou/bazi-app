"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import styles from "./MascotViewer.module.css";
import {
  getMascotImagePath,
  getMascotAltText,
  type MascotView,
  type MascotGender,
} from "../lib/mascot-utils";
import type { HeavenlyStem } from "@repo/shared";

interface MascotViewerProps {
  stem: HeavenlyStem;
  gender: MascotGender;
  onViewChange?: (view: MascotView) => void;
}

export default function MascotViewer({
  stem,
  gender,
  onViewChange,
}: MascotViewerProps) {
  const [activeView, setActiveView] = useState<MascotView>("full");
  const [hasInteracted, setHasInteracted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const activeViewRef = useRef<MascotView>("full");
  const onViewChangeRef = useRef(onViewChange);

  // Keep ref in sync with latest callback (no effect re-subscription needed)
  useEffect(() => {
    onViewChangeRef.current = onViewChange;
  });

  // Resolve image paths
  const fullImagePath = getMascotImagePath(stem, gender, "full");
  const halfImagePath = getMascotImagePath(stem, gender, "half");

  // Attach scroll listener once — read activeView and callback from refs
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      // Debounce: wait 150ms after last scroll event (ensures snap animation is settled)
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        if (!el || el.clientWidth === 0) return;
        const newView: MascotView =
          el.scrollLeft > el.clientWidth * 0.5 ? "half" : "full";
        if (newView !== activeViewRef.current) {
          activeViewRef.current = newView;
          setActiveView(newView);
          setHasInteracted(true);
          onViewChangeRef.current?.(newView);
        }
      }, 150);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll listener subscribes once; callback read via onViewChangeRef
  }, []);

  // If invalid stem (paths are null), render nothing
  if (!fullImagePath || !halfImagePath) return null;

  return (
    <div className={styles.mascotContainer}>
      <div className={styles.scrollArea} ref={scrollRef}>
        {/* Full body view */}
        <div className={styles.imageSlide}>
          <Image
            src={fullImagePath}
            alt={getMascotAltText(stem, "full")}
            fill
            style={{ objectFit: "contain" }}
            sizes="(max-width: 768px) 100vw, 600px"
            priority
          />
        </div>

        {/* Half body view */}
        <div className={styles.imageSlide}>
          <Image
            src={halfImagePath}
            alt={getMascotAltText(stem, "half")}
            fill
            style={{ objectFit: "contain" }}
            sizes="(max-width: 768px) 100vw, 600px"
          />
        </div>
      </div>

      {/* Dot indicator */}
      <div className={styles.dotIndicator}>
        <span
          className={`${styles.dot} ${activeView === "full" ? styles.dotActive : ""}`}
        />
        <span
          className={`${styles.dot} ${activeView === "half" ? styles.dotActive : ""}`}
        />
      </div>

      {/* Swipe hint — fades after first interaction */}
      <div
        className={`${styles.swipeHint} ${hasInteracted ? styles.swipeHintHidden : ""}`}
      >
        ← 左右滑動切換視角 →
      </div>
    </div>
  );
}
