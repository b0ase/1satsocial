import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      "xdelta3-wasm": "./src/stubs/xdelta3-wasm.js",
    },
  },
  images: {
    // Inscription content is immutable per outpoint, so optimised copies can be cached for a year.
    remotePatterns: [{ protocol: "https", hostname: "ordfs.network", pathname: "/content/**" }],
    formats: ["image/avif", "image/webp"],
    qualities: [40, 75],
    minimumCacheTTL: 31_536_000,
  },
  async redirects() {
    // One canonical host: www.1satsocial.online -> 1satsocial.online
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.1satsocial.online" }],
        destination: "https://1satsocial.online/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
