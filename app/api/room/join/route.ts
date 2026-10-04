import { addJoin, getState } from "@/lib/room";

// 1-tap "I'm in" — zero data, instant. Drives the room headcount.
export async function POST() {
  await addJoin();
  const state = await getState();
  return Response.json(state, { headers: { "Cache-Control": "no-store" } });
}
