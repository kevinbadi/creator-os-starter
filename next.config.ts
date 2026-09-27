import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // proxy.ts clones every request body (default 10MB). /api/upload is excluded
  // from the matcher; this cap is the belt-and-suspenders limit for any other
  // large POST. Composer videos PUT straight to Zernio R2 (multi-GB).
  experimental: {
    proxyClientMaxBodySize: "2gb",
    serverActions: {
      bodySizeLimit: "2gb",
    },
    // Next 15+ defaults dynamic client cache to 0s, so every sidebar click
    // waits on a full RSC round-trip. 30s matches the server TTL window.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
