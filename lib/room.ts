// The live room: every join + every find is one append-only event.
// Phones WRITE events; the big screen READS the aggregate. No OAuth, no per-device auth.
//
// Backend is swappable by env:
//   - Supabase (SUPABASE_URL + SUPABASE_SERVICE_KEY) → real, durable, cross-device. Use for the live pitch.
//   - In-memory (default)                            → dev + rehearsal + emergency fallback.
//
// Honest floor: LOOT_BASE_* lets us seed REAL pre-collected totals (not faked live numbers)
// so a small live turnout still shows a strong, true number. Never inflate the live deltas.

export type Find = { store: string; amount: number; verified: boolean; at: number };
export type RoomState = { joined: number; total: number; cards: number; feed: Find[] };

type Kind = "join" | "find";
type Event = { kind: Kind; amount: number; store: string | null; verified: boolean; at: number; dedupeKey?: string | null };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

const BASE_TOTAL = Number(process.env.LOOT_BASE_TOTAL ?? 0);
const BASE_CARDS = Number(process.env.LOOT_BASE_CARDS ?? 0);
const BASE_JOINED = Number(process.env.LOOT_BASE_JOINED ?? 0);

// ---- in-memory backend (survives hot reload via globalThis) ----
const g = globalThis as unknown as { __lootRoom?: { events: Event[] } };
g.__lootRoom ??= { events: [] };
const memEvents = () => g.__lootRoom!.events;

// ---- supabase REST (PostgREST) backend — no extra dependency ----
// dedupe_key (unique index, NULLs pass freely) makes re-submitting the same card a no-op.
// PostgREST error codes: PGRST204 = column not in schema cache, 42703 = undefined column,
// 42P10 = ON CONFLICT names a column with no unique index.
async function isMissingDedupeSchema(res: Response): Promise<boolean> {
  try {
    const body = (await res.clone().json()) as { code?: string };
    return body.code === "PGRST204" || body.code === "42703" || body.code === "42P10";
  } catch {
    return false;
  }
}

async function sbInsert(ev: Event) {
  const withKey = Boolean(ev.dedupeKey);
  const url = `${SUPABASE_URL}/rest/v1/room_events${withKey ? "?on_conflict=dedupe_key" : ""}`;
  const headers = {
    apikey: SUPABASE_KEY!,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: withKey ? "return=minimal,resolution=ignore-duplicates" : "return=minimal",
  };
  const row = { kind: ev.kind, amount: ev.amount, store: ev.store, verified: ev.verified, ...(withKey ? { dedupe_key: ev.dedupeKey } : {}) };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(row) });
  // Retry WITHOUT the dedupe key only when the failure is "that column/constraint doesn't exist yet"
  // (migration not run). Any other failure (bad key, outage) must not be retried plain, or a re-pasted
  // card would be counted twice.
  if (!res.ok && withKey && (await isMissingDedupeSchema(res))) {
    await fetch(`${SUPABASE_URL}/rest/v1/room_events`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ kind: ev.kind, amount: ev.amount, store: ev.store, verified: ev.verified }),
    });
  }
}

// Read EVERY event, page by page. A single `limit=2000` query was silently capped by the server's
// max-rows setting (Supabase defaults to 1000), so the totals stopped growing past that.
const PAGE = 1000;
const MAX_PAGES = 50; // 50k events is far beyond any room; stops a runaway loop
async function sbAll(): Promise<Event[]> {
  const out: Event[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/room_events?select=kind,amount,store,verified,created_at&order=created_at.desc,id.desc&limit=${PAGE}&offset=${page * PAGE}`,
      { headers: { apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: "no-store" },
    );
    if (!res.ok) break; // partial data beats no data for a live screen
    const rows = (await res.json()) as Array<{ kind: Kind; amount: number; store: string | null; verified: boolean; created_at: string }>;
    for (const r of rows) out.push({ kind: r.kind, amount: Number(r.amount) || 0, store: r.store, verified: r.verified, at: Date.parse(r.created_at) });
    if (rows.length < PAGE) break;
  }
  return out;
}

async function push(ev: Event) {
  if (useSupabase) await sbInsert(ev);
  else {
    if (ev.dedupeKey && memEvents().some((e) => e.dedupeKey === ev.dedupeKey)) return;
    memEvents().push(ev);
  }
}

export async function addJoin(): Promise<void> {
  await push({ kind: "join", amount: 0, store: null, verified: false, at: Date.now() });
}

// Stable key for a claim code so the same card can't be counted twice (paste + re-paste, forward + paste).
export function codeKey(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.replace(/[\s-]/g, "").toLowerCase();
  return c.length >= 6 ? `code:${c}` : null;
}

export async function addFind(f: { store: string | null; amount: number; verified: boolean; dedupeKey?: string | null }): Promise<void> {
  await push({ kind: "find", amount: Math.max(0, Number(f.amount) || 0), store: f.store, verified: f.verified, at: Date.now(), dedupeKey: f.dedupeKey ?? null });
}

function aggregate(events: Event[]): RoomState {
  let joined = BASE_JOINED;
  let total = BASE_TOTAL;
  let cards = BASE_CARDS;
  for (const e of events) {
    if (e.kind === "join") joined++;
    else {
      total += e.amount;
      cards++;
    }
  }
  const feed = events
    .filter((e) => e.kind === "find")
    .sort((a, b) => b.at - a.at)
    .slice(0, 12)
    .map((e) => ({ store: e.store ?? "a store", amount: e.amount, verified: e.verified, at: e.at }));
  return { joined, total, cards, feed };
}

export async function getState(): Promise<RoomState> {
  const events = useSupabase ? await sbAll() : memEvents();
  return aggregate(events);
}

export const backend = useSupabase ? "supabase" : "memory";
