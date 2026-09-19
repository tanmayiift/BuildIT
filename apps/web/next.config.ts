import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;

const config: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // X-Powered-By: Next.js names the framework and version to anyone scanning.
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: [...securityHeaders] }];
  },
  // /sandbox was renamed to /scan because "sandbox" already means the Vercel compute product the
  // review executor runs in, and one word for two unrelated things cost several rounds of genuine
  // confusion about which one a quota applied to. The old path still resolves: audit documents and
  // anything already shared point at it, and a rename that 404s those trades one confusion for
  // another. Permanent, because the old name is not coming back.
  async redirects() {
    return [{ source: "/sandbox", destination: "/scan", permanent: true }];
  },
};

export default config;
