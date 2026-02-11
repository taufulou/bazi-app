'use client';

import posthog from 'posthog-js';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
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

  useEffect(() => {
    if (pathname && posthog.__loaded) {
      posthog.capture('$pageview', { $current_url: window.origin + pathname });
    }
  }, [pathname]);

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

  useEffect(() => {
    milestonesHit.current = new Set();

    function handleScroll() {
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
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [pathname]);

  return null;
}

/** Track time spent on each page (fires on navigation away) */
function TimeOnPageTracker() {
  const pathname = usePathname();
  const pageEnterTime = useRef<number>(Date.now());

  useEffect(() => {
    pageEnterTime.current = Date.now();

    return () => {
      const duration = Date.now() - pageEnterTime.current;
      if (duration > 1000) { // Only track if > 1s (ignore instant redirects)
        trackTimeOnPage({ page: pathname, durationMs: duration });
      }
    };
  }, [pathname]);

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
