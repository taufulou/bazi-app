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
    // ⚠️ C2 — autocapture records `$el_text` of whatever was clicked, and in
    // THIS app every cell of the Bazi chart is clickable (十神/天干/地支/藏干/
    // 納音/神煞…, all nine types). A user exploring their own chart would emit
    // one event per cell, each carrying that cell's 干支, under a single
    // distinct_id — reconstructing the pillar set in PostHog. That set is a
    // reversible encoding of the birth datetime, which is precisely what the
    // Sentry scrubber exists to keep out of third-party telemetry; there is no
    // reason it should be acceptable here.
    //
    // Masking text keeps autocapture's useful half (which element, which page,
    // interaction counts) and drops the half that carries content. Left
    // autocapture ON deliberately — turning it off is a product-analytics
    // decision; removing PII from it is not.
    mask_all_text: true,
    // Masks `attr__*` on autocaptured elements — including a clicked anchor's
    // `attr__href`, which on this app carries `?profileId=…`.
    mask_all_element_attributes: true,
    // ⚠️ That setting alone does NOT cover it. `$current_url` and `$referrer`
    // are TOP-LEVEL event properties derived from `window.location`, not element
    // attributes, so every autocaptured event re-attached the full query string
    // regardless — the manual `$pageview` below strips it, autocapture did not.
    // A profile id is a correlatable identifier for a person's birth record, so
    // it does not belong in third-party analytics even though it is not the
    // birth data itself.
    sanitize_properties: (properties) => {
      const stripQuery = (value: unknown): unknown => {
        if (typeof value !== 'string') return value;
        const cut = value.search(/[?#]/);
        return cut === -1 ? value : value.slice(0, cut);
      };
      return {
        ...properties,
        $current_url: stripQuery(properties.$current_url),
        $referrer: stripQuery(properties.$referrer),
      };
    },
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
