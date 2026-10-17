import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revokeToken } from "@/lib/gmail";

// "Disconnect Gmail": revoke the token at Google, then clear the cookie that holds it.
// POST only, so another site can't disconnect someone with a plain link (the cookie is
// sameSite=lax, which isn't sent on a cross-site POST).
export async function POST() {
  const token = (await cookies()).get("g_token")?.value;
  let revoked = true;
  if (token) {
    try {
      revoked = await revokeToken(token);
    } catch {
      revoked = false; // Google unreachable: still clear the cookie below
    }
  }
  const res = NextResponse.json({ ok: true, revoked }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.delete("g_token");
  return res;
}
