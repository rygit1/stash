import { addFind, getState } from "@/lib/room";

// Self-reported find from the "search your own inbox" treasure hunt.
// Honest by construction: it's their claim about their own real inbox. Marked unverified
// (vs. the Haiku-extracted verified finds from /api/extract).
export async function POST(req: Request) {
  let body: { amount?: unknown; store?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return Response.json({ error: "invalid amount" }, { status: 400 });
  }
  const store = typeof body.store === "string" && body.store.trim() ? body.store.trim().slice(0, 40) : null;
  await addFind({ store, amount, verified: false });
  const state = await getState();
  return Response.json(state, { headers: { "Cache-Control": "no-store" } });
}
