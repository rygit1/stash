// Tiny per-IP sliding-window limiter for the routes that spend Anthropic credits.
//
// HONEST LIMITS: state lives in this server instance's memory. On Vercel each serverless instance
// has its own copy, so this is a speed bump against casual abuse and runaway loops, NOT a hard cap.
// The hard cap is a monthly spend limit on the API key (console.anthropic.com → Limits). For a real
// shared limit, swap `hits` for Upstash/Redis or a Supabase table; the call sites won't change.

const g = globalThis as unknown as { __rateHits?: Map<string, number[]> };
const hits = (g.__rateHits ??= new Map<string, number[]>());
const MAX_KEYS = 5000; // memory guard: forget the oldest clients past this

function clientIp(req: Request): string {
  // Vercel sets x-forwarded-for itself. On localhost there is no header, so everyone shares "local".
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || req.headers.get("x-real-ip") || "local";
}

/** Returns a 429 Response if this client is over the limit, else null (request may proceed). */
export function rateLimit(req: Request, name: string, max: number, windowMs: number): Response | null {
  const now = Date.now();
  const key = `${name}:${clientIp(req)}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

  if (recent.length >= max) {
    hits.set(key, recent);
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
    return Response.json(
      { error: "rate_limited", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
    );
  }

  recent.push(now);
  hits.delete(key); // re-insert so Map order tracks recency
  hits.set(key, recent);
  if (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value as string);
  return null;
}

/** 413 Response if the declared body size is over `maxBytes`. Checked BEFORE req.json() reads it. */
export function bodyTooLarge(req: Request, maxBytes: number): Response | null {
  const len = Number(req.headers.get("content-length"));
  if (Number.isFinite(len) && len > maxBytes) {
    return Response.json({ error: "payload_too_large" }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }
  return null;
}
