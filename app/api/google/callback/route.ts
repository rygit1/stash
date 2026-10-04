import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode } from "@/lib/gmail";

// Google redirects back here with ?code=... → swap it for an access token,
// stash it in an httpOnly cookie, bounce to the wallet which kicks off the scan.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  const expectedState = (await cookies()).get("g_state")?.value;
  const fail = (reason: string) => {
    const r = NextResponse.redirect(new URL(`/?error=${encodeURIComponent(reason)}`, url.origin));
    r.cookies.delete("g_state");
    return r;
  };
  if (err || !code) return fail(err ?? "no_code");
  // Login-CSRF guard: the state Google echoes back must be the one WE set for THIS browser.
  const returnedState = url.searchParams.get("state");
  if (!expectedState || !returnedState || returnedState !== expectedState) return fail("bad_state");
  try {
    const tokens = await exchangeCode(code, url.origin);
    const res = NextResponse.redirect(new URL("/?connected=1", url.origin));
    res.cookies.delete("g_state");
    res.cookies.set("g_token", tokens.access_token, {
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      maxAge: tokens.expires_in ?? 3600,
      path: "/",
    });
    return res;
  } catch {
    return fail("token_exchange");
  }
}
