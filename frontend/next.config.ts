import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@stacks/connect", "@stacks/network", "@stacks/transactions"],
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    }
    return config
  },
};

export default nextConfig;