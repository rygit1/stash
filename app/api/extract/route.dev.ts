import { extractCard } from "@/lib/extract";
import { rateLimit, bodyTooLarge } from "@/lib/ratelimit";

// Developer-only: runs the email reader on pasted text. test-scan.mjs (the extraction quality
// harness) calls it against a local `npm run dev`. The .dev.ts name keeps it out of production
// builds (see next.config.ts), so it is never a public endpoint that spends Anthropic credits.
function devOnly(): boolean {
  return !process.env.VERCEL && process.env.NODE_ENV !== "production";
}

export async function POST(req: Request) {
  if (!devOnly()) return Response.json({ error: "not_found" }, { status: 404 });

  const tooBig = bodyTooLarge(req, 100_000);
  if (tooBig) return tooBig;
  const limited = rateLimit(req, "extract", 60, 60_000);
  if (limited) return limited;

  let body: { email?: unknown; from?: unknown; subject?: unknown; date?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email.length < 10) return Response.json({ error: "paste a gift-card email" }, { status: 400 });

  try {
    const card = await extractCard({
      body: email,
      from: typeof body.from === "string" ? body.from : undefined,
      subject: typeof body.subject === "string" ? body.subject : undefined,
      date: typeof body.date === "string" ? body.date : undefined,
    });
    return Response.json(card, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // Developer-only route: show why, so a dead key or a rejected request is obvious in the dev server.
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[extract] failed:", reason);
    return Response.json({ error: "extract_failed", reason }, { status: 500 });
  }
}
