import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      "xdelta3-wasm": "./src/stubs/xdelta3-wasm.js",
    },
  },
};

export default nextConfig;
