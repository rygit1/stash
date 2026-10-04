import { extractCardImage, type ImageMediaType } from "@/lib/extract";
import { rateLimit, bodyTooLarge } from "@/lib/ratelimit";

// Photographed plastic card → Haiku vision → ExtractedCard JSON. Accepts one photo or
// front+back of the same card. The client downscales to ~1600px JPEG before upload,
// so the size guard here is a backstop, not the norm.

const MAX_DECODED_BYTES = 8 * 1024 * 1024; // ~8MB decoded, per image
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function parseOne(raw: unknown, fallbackType: string): { base64: string; mediaType: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  let base64 = raw;
  let mediaType = fallbackType;
  const dataUrl = raw.match(/^data:([a-z0-9/+.-]+);base64,([\s\S]*)$/i);
  if (dataUrl) {
    mediaType = dataUrl[1].toLowerCase();
    base64 = dataUrl[2];
  }
  base64 = base64.replace(/\s+/g, "");
  return base64 ? { base64, mediaType } : null;
}

export async function POST(req: Request) {
  // Unauthenticated + calls the most expensive model with up to two images: cap the raw body
  // (2 images x 8MB decoded ~ 22MB as base64 JSON) BEFORE parsing it, and cap requests per IP.
  const tooBig = bodyTooLarge(req, 22 * 1024 * 1024);
  if (tooBig) return tooBig;
  const limited = rateLimit(req, "scan-card", 10, 60_000); // 10 card scans / minute / IP
  if (limited) return limited;

  let body: { image?: unknown; mediaType?: unknown; images?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const fallbackType = typeof body.mediaType === "string" ? body.mediaType.toLowerCase() : "image/jpeg";
  const rawList = Array.isArray(body.images) ? body.images.slice(0, 2) : [body.image];
  const images = rawList.map((r) => parseOne(r, fallbackType)).filter((x): x is { base64: string; mediaType: string } => x !== null);

  if (!images.length) return Response.json({ error: "no image" }, { status: 400 });
  for (const img of images) {
    if (!MEDIA_TYPES.has(img.mediaType)) return Response.json({ error: "unsupported image type" }, { status: 415 });
    if (img.base64.length * 0.75 > MAX_DECODED_BYTES) return Response.json({ error: "image too large (8MB max)" }, { status: 413 });
  }

  try {
    const card = await extractCardImage({ images: images.map((i) => ({ base64: i.base64, mediaType: i.mediaType as ImageMediaType })) });
    return Response.json(card, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // Surface the real reason in server logs — a silent catch hid model outages as "check your connection".
    console.error("[scan-card] extract failed:", e instanceof Error ? e.stack ?? e.message : e);
    return Response.json({ error: "scan_failed" }, { status: 500 });
  }
}
