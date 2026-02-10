'use client';

import posthog from 'posthog-js';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

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

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PostHogPageview />
      {children}
    </>
  );
}
