/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable transpilation of monorepo packages
  transpilePackages: ["@repo/ui", "@repo/shared"],

  // Output standalone for Docker deployment
  output: "standalone",

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
    ],
  },
};

export default nextConfig;
