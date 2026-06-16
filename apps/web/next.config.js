import { withSentryConfig } from '@sentry/nextjs';

// Cloudflare R2 public host for admin-managed banner images (e.g.
// "pub-<hash>.r2.dev" or a custom domain). Added to BOTH images.remotePatterns
// AND the CSP img-src directive below — the latter is load-bearing: without it
// the browser blocks the R2 <img> outright (remotePatterns alone does NOT
// affect CSP and isn't consulted by raw <picture>/<img>).
const r2Host = process.env.NEXT_PUBLIC_R2_PUBLIC_HOST?.trim();
const r2ImgSrc = r2Host ? ` https://${r2Host}` : '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable transpilation of monorepo packages
  transpilePackages: ["@repo/ui", "@repo/shared"],

  // Tree-shake icon libraries (per UX refactor R1.15) — pulls only the
  // specific icons we import from `lucide-react` instead of the full set.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },

  // Output standalone for Docker deployment
  output: "standalone",

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
      ...(r2Host
        ? [{ protocol: "https", hostname: r2Host }]
        : []),
    ],
  },

  // Security headers
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    return [
      {
        source: "/(.*)",
        headers: [
          // HSTS only in production — in dev it forces HTTPS upgrade on
          // http://localhost which has no TLS cert and breaks the browser.
          ...(isProd
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.accounts.dev https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://img.clerk.com https://*.clerk.accounts.dev" + r2ImgSrc,
              "font-src 'self' data:",
              `connect-src 'self' https://*.clerk.accounts.dev https://api.clerk.com https://api.stripe.com wss://*.clerk.accounts.dev ${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'} https://*.ingest.sentry.io https://*.i.posthog.com`,
              "frame-src https://*.clerk.accounts.dev https://challenges.cloudflare.com https://js.stripe.com",
              "worker-src 'self' blob:",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Suppress source map upload warnings when SENTRY_AUTH_TOKEN is not set
  silent: !process.env.SENTRY_AUTH_TOKEN,
  // Disable source map upload in development
  disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
});
