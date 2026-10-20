import type { NextConfig } from "next";

// Security headers on every route. The Content-Security-Policy is set per request in proxy.ts,
// because it carries a fresh nonce each time.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The card scanner needs the camera on our own pages. Nothing else is used.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
];

// Developer-only routes are named route.dev.ts (app/api/extract, app/api/check-balance). Only
// `next dev` treats ".dev.ts" as a route file, so `next build` leaves them out entirely and their
// code is never deployed to the live site.
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  pageExtensions: isDev ? ["dev.ts", "tsx", "ts", "jsx", "js"] : ["tsx", "ts", "jsx", "js"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
