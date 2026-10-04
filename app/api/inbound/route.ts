import { extractCard } from "@/lib/extract";
import { addFind, codeKey } from "@/lib/room";

// Forward-email webhook: Cloudflare Email Worker POSTs {from, to, subject, text} here
// (see SETUP-FORWARD.md). Confirmed cards land in the room as VERIFIED finds — same
// path as /api/extract. Locked behind a shared secret so randoms can't spoof finds.
export async function POST(req: Request) {
  const secret = process.env.INBOUND_SECRET;
  if (!secret) return Response.json({ error: "inbound disabled" }, { status: 503 });
  if (req.headers.get("x-inbound-secret") !== secret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { from?: unknown; to?: unknown; subject?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject : undefined;
  if (text.length < 10 && !subject) return Response.json({ error: "empty email" }, { status: 400 });

  let card;
  try {
    card = await extractCard({
      body: text,
      subject,
      from: typeof body.from === "string" ? body.from : undefined,
    });
  } catch {
    return Response.json({ error: "extract_failed" }, { status: 500 });
  }

  const found = card.isGiftCard && typeof card.amount === "number" && card.amount > 0;
  if (found) await addFind({ store: card.store, amount: card.amount!, verified: true, dedupeKey: codeKey(card.code) });
  return Response.json({ found, card }, { headers: { "Cache-Control": "no-store" } });
}
