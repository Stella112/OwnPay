import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) for a lean Docker image.
  output: "standalone",
  distDir: process.env.OWNPAY_BUILD_DIR || ".next",
  experimental: {
    cpus: 1,
    webpackMemoryOptimizations: true,
    webpackBuildWorker: true,
  },
  // Opt-in release build on the shared VPS: do not retain Webpack's cache.
  webpack: (config, { dev }) => {
    if (!dev && process.env.OWNPAY_LOW_MEMORY_BUILD === 'true') config.cache = false;
    return config;
  },
};

export default nextConfig;
