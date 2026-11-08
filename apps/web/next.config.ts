import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  transpilePackages: ["@offmap/core"],
  webpack(cfg) {
    // @offmap/core is TypeScript with NodeNext style ".js" import specifiers.
    cfg.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return cfg;
  },
};

export default config;
