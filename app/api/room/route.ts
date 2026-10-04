import { getState, backend } from "@/lib/room";

// The big screen polls this. Never cached — always the live room.
export async function GET() {
  const state = await getState();
  return Response.json({ ...state, backend }, { headers: { "Cache-Control": "no-store" } });
}
