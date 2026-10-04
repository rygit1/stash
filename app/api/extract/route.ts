import { extractCard } from "@/lib/extract";
import { addFind, codeKey } from "@/lib/room";
import { rateLimit, bodyTooLarge } from "@/lib/ratelimit";

// Paste fallback (also the inbound-email-webhook target later). A confirmed card
// streams to the live room as a VERIFIED find. Same engine as the Gmail auto-scan.
export async function POST(req: Request) {
  // Unauthenticated + calls the paid model: cap request size (extractCard only reads 12k chars anyway)
  // and requests per IP, so nobody can burn the API key with a loop.
  const tooBig = bodyTooLarge(req, 100_000);
  if (tooBig) return tooBig;
  const limited = rateLimit(req, "extract", 20, 60_000); // 20 pastes / minute / IP
  if (limited) return limited;

  let body: { email?: unknown; from?: unknown; subject?: unknown; date?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email.length < 10) return Response.json({ error: "paste a gift-card email" }, { status: 400 });

  let card;
  try {
    card = await extractCard({
      body: email,
      from: typeof body.from === "string" ? body.from : undefined,
      subject: typeof body.subject === "string" ? body.subject : undefined,
      date: typeof body.date === "string" ? body.date : undefined,
    });
  } catch {
    return Response.json({ error: "extract_failed" }, { status: 500 });
  }

  if (card.isGiftCard && typeof card.amount === "number" && card.amount > 0) {
    await addFind({ store: card.store, amount: card.amount, verified: true, dedupeKey: codeKey(card.code) });
  }
  return Response.json(card, { headers: { "Cache-Control": "no-store" } });
}
