"use client";

import { useEffect, useRef } from "react";
import {
  trackDashboardViewed,
  trackReadingCardClicked,
  trackSubscriptionCtaClicked,
} from "../lib/analytics";

/**
 * Client-side analytics tracker for the dashboard page.
 * Renders nothing — only fires events.
 */
export function DashboardViewTracker({
  readingTypesCount,
}: {
  readingTypesCount: number;
}) {
  const tracked = useRef(false);

  useEffect(() => {
    if (!tracked.current) {
      tracked.current = true;
      trackDashboardViewed({ readingTypesCount });
    }
  }, [readingTypesCount]);

  return null;
}

/**
 * Wrapper for reading card links that fires tracking on click.
 * Uses a span (inline) to avoid breaking flex/grid layout from the parent Link.
 */
export function ReadingCardTracker({
  readingType,
  system,
  cardPosition,
  children,
}: {
  readingType: string;
  system: "bazi" | "zwds";
  cardPosition: number;
  children: React.ReactNode;
}) {
  return (
    <span
      onClick={() =>
        trackReadingCardClicked({ readingType, system, cardPosition })
      }
    >
      {children}
    </span>
  );
}

/**
 * Wrapper for subscription CTA that fires tracking on click.
 * Uses a span to avoid breaking layout.
 */
export function SubscriptionCtaTracker({
  location,
  children,
}: {
  location: "dashboard_banner" | "header_link";
  children: React.ReactNode;
}) {
  return (
    <span onClick={() => trackSubscriptionCtaClicked({ location })}>
      {children}
    </span>
  );
}
