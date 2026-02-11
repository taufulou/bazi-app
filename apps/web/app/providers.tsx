'use client';

import posthog from 'posthog-js';
import { useEffect, useRef, useCallback } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { identifyUser, resetUser, trackScrollDepth, trackTimeOnPage } from './lib/analytics';

// Initialize PostHog
if (
  typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_POSTHOG_KEY &&
  !posthog.__loaded
) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    capture_pageview: false, // We capture manually for SPA navigation
    capture_pageleave: true,
  });
}

function PostHogPageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname && posthog.__loaded) {
      const search = searchParams.toString();
      const fullUrl = window.origin + pathname + (search ? `?${search}` : '');
      posthog.capture('$pageview', { $current_url: fullUrl });
    }
  }, [pathname, searchParams]);

  return null;
}

/** Identify user in PostHog when Clerk auth resolves */
function PostHogIdentify() {
  const { user, isSignedIn } = useUser();
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    if (isSignedIn && user && user.id !== previousUserId.current) {
      identifyUser(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
      });
      previousUserId.current = user.id;
    } else if (!isSignedIn && previousUserId.current) {
      resetUser();
      previousUserId.current = null;
    }
  }, [isSignedIn, user]);

  return null;
}

/** Track scroll depth milestones (25%, 50%, 75%, 100%) per page */
function ScrollDepthTracker() {
  const pathname = usePathname();
  const milestonesHit = useRef<Set<number>>(new Set());
  const rafPending = useRef(false);

  useEffect(() => {
    milestonesHit.current = new Set();

    // Fire 100% for pages that fit within viewport (no scrolling needed)
    requestAnimationFrame(() => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0 && !milestonesHit.current.has(100)) {
        milestonesHit.current.add(100);
        trackScrollDepth({ page: pathname, depth: 100 });
      }
    });

    function handleScroll() {
      if (rafPending.current) return;
      rafPending.current = true;

      requestAnimationFrame(() => {
        rafPending.current = false;
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        if (docHeight <= 0) return;
        const pct = Math.round((scrollTop / docHeight) * 100);

        for (const milestone of [25, 50, 75, 100]) {
          if (pct >= milestone && !milestonesHit.current.has(milestone)) {
            milestonesHit.current.add(milestone);
            trackScrollDepth({ page: pathname, depth: milestone });
          }
        }
      });
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [pathname]);

  return null;
}

/** Track active (visible) time spent on each page */
function TimeOnPageTracker() {
  const pathname = usePathname();
  const activeTimeMs = useRef<number>(0);
  const lastVisibleAt = useRef<number>(Date.now());
  const isVisible = useRef(true);

  const pauseTimer = useCallback(() => {
    if (isVisible.current) {
      activeTimeMs.current += Date.now() - lastVisibleAt.current;
      isVisible.current = false;
    }
  }, []);

  const resumeTimer = useCallback(() => {
    if (!isVisible.current) {
      lastVisibleAt.current = Date.now();
      isVisible.current = true;
    }
  }, []);

  useEffect(() => {
    activeTimeMs.current = 0;
    lastVisibleAt.current = Date.now();
    isVisible.current = !document.hidden;

    function handleVisibility() {
      if (document.hidden) {
        pauseTimer();
      } else {
        resumeTimer();
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      // Flush final active time
      if (isVisible.current) {
        activeTimeMs.current += Date.now() - lastVisibleAt.current;
      }
      if (activeTimeMs.current > 1000) {
        trackTimeOnPage({ page: pathname, durationMs: activeTimeMs.current });
      }
    };
  }, [pathname, pauseTimer, resumeTimer]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PostHogPageview />
      <PostHogIdentify />
      <ScrollDepthTracker />
      <TimeOnPageTracker />
      {children}
    </>
  );
}
