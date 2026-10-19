import { NextResponse, type NextRequest } from "next/server";

// Content-Security-Policy with a fresh nonce on every page request. Next.js reads the nonce from
// this header and stamps it on its own scripts, so only scripts we ship can run: an injected
// <script> has no nonce and is blocked. That matters here because card numbers and PINs live in
// the browser (localStorage). Styles keep 'unsafe-inline' because the app renders many inline
// style attributes, which a nonce cannot cover.
// The other security headers are set for every route in next.config.ts.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    // Dev only: React needs eval for its debugging stacks. Never sent in production.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Pages only: API routes return JSON and get the other headers from next.config.ts.
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|tesseract).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
