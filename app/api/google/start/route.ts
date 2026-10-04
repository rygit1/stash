import { NextResponse } from "next/server";
import { authUrl } from "@/lib/gmail";

// Kicks off the OAuth flow — full redirect to Google's consent screen.
// A random `state` is stored in a short-lived httpOnly cookie and echoed back by Google;
// the callback rejects the login if the two don't match.
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.redirect(new URL("/?error=no_client_id", origin));
  }
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authUrl(origin, state));
  res.cookies.set("g_state", state, {
    httpOnly: true,
    secure: origin.startsWith("https:"),
    sameSite: "lax", // must survive the top-level redirect back from accounts.google.com
    maxAge: 600,
    path: "/",
  });
  return res;
}
