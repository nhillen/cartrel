import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone', // Enable standalone output for Docker
  experimental: {
    outputFileTracingRoot: undefined, // Use default tracing
  },
};

export default nextConfig;
