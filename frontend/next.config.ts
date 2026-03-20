import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@stacks/connect", "@stacks/network", "@stacks/transactions"],
  experimental: {
    esmExternals: "loose",
  },
};

export default nextConfig;