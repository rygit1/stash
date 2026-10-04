import Anthropic from "@anthropic-ai/sdk";

// Shared gift-card extractor — the proven engine (test-extract.mjs). Used by both
// /api/scan (Gmail auto-scan) and /api/extract (paste fallback).

// Tried in order until one answers, so a single model outage can never take the scanner down again
// (it used to hard-depend on Fable → "Couldn't reach the card reader"). Fable 5 is currently RETIRED
// (hard 404 → "Please use Opus 4.8"), so Opus 4.8 leads and we don't waste a failing round-trip on it.
// Fable stays last as a no-op for now; promote it back to the front if/when it returns.
// ANTHROPIC_VISION_MODEL overrides the primary without a code change.
const SMART_MODELS = [process.env.ANTHROPIC_VISION_MODEL, "claude-opus-4-8", "claude-fable-5"].filter(
  (m): m is string => Boolean(m),
);

export type ExtractedCard = {
  isGiftCard: boolean;
  store: string | null;
  amount: number | null;
  code: string | null;
  pin: string | null;
  dateReceived: string | null;
  expires: string | null;
  confidence: "high" | "medium" | "low";
  issue?: string | null; // vision scans only: glare | blur | too_dark | too_far | partial | not_gift_card
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    isGiftCard: { type: "boolean" },
    store: { type: ["string", "null"] },
    amount: { type: ["number", "null"] },
    code: { type: ["string", "null"] },
    pin: { type: ["string", "null"] },
    dateReceived: { type: ["string", "null"] },
    expires: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["isGiftCard", "store", "amount", "code", "pin", "dateReceived", "expires", "confidence"],
} as const;

const SYSTEM = `You extract gift-card details from a single email.

The ONE test for ownership: was a redeemable gift card delivered TO this recipient (a claim code / card number / PIN that THEY can use), versus sent BY them to someone else? Only a card delivered TO them counts.

isGiftCard=true: an e-gift / eGift / e-gift card, gift certificate, digital gift, or store gift card DELIVERED TO the recipient with a redeemable claim code, card number, or PIN they can use — or a "you received a gift card" / "a gift card for you" delivery. The redeemable code (theirs to use) is the signal of ownership. The literal words "gift card" are NOT required. A real eGift delivered TO the user still counts even if a footer says "order".

isGiftCard=true also for a BALANCE or account statement of the recipient's OWN existing gift card — "your [Store] gift card balance is $X", "your gift card ending 8841 has a balance", a card/access number they already hold. This is THEIR card (no fresh claim code because they already have it), not a purchase or a send-to-someone notice.

If the merchant HIDES the code behind a "View gift card" / "Reveal code" / "Claim your gift" button or link (the code is NOT in the email text), it is still the user's owned card → isGiftCard=true, store and amount as stated, but code=null and pin=null (never invent a code) and confidence="low".

Set isGiftCard=false for:
- the BUYER'S own order/purchase confirmation of a gift card THEY bought to give away — signalled by "thanks for your order", "your order", "order #", "order confirmation", "grand total", "estimated delivery", "qty". This is the sender's receipt copy, not an owned card. The actual recipient gets a separate email.
- a SENT / delivery-to-a-recipient notice — "your gift card was sent to", "sent to <phone/email/name>", "send to:", "delivered to", "on its way to <someone>". The user is the SENDER here, not the owner.
- promotions the recipient must EARN ("earn a $25 gift card", "get a gift card when you sign up", "free $10 when you spend $50", "we sent you a $50 reward — activate", "bonus card with any $50 purchase"),
- plain store credit / merchandise credit from a return (not a gift card).

Disambiguation when an email looks like both: if it is a purchase/order receipt ("order #", "grand total", "estimated delivery") OR a send-to-someone notice ("sent to <recipient>", "send to:", "on its way to"), it is NOT owned (isGiftCard=false) even if it shows a dollar amount — the recipient's own redeemable code or their own balance is what proves ownership, and these have neither. A plain balance statement of the user's existing card is NOT a purchase receipt and stays owned.

code = the redeemable claim code / card number, read from the email even when it appears AFTER a label like "Gift card number", "Card number", "Claim code", "Redemption code", or "Redeem at" — capture the value next to that label. If the code is only behind a button/link (not in the text), code=null.

amount = the dollar value loaded on the card (number only). Use null for anything not present. Be precise.`;

// ——— Deterministic evidence layer (zero Haiku) — shared by /api/scan and test-scan.mjs ———
// Redemption detection + email-derived balance estimates. Pure regex on real emails; never invents a number.

// Redemption language — past/perfect only, so "will be applied" / "apply your card" never match.
const REDEEMED_RE = new RegExp(
  [
    String.raw`(?:has\s+been|have\s+been|had\s+been|was|were)\s+(?:automatically\s+|auto[- ]?|successfully\s+)?(?:applied|added|redeemed|credited|deposited)\s+to\s+your[^.!?\n]{0,30}(?:account|balance|wallet|card)`,
    String.raw`(?:gift\s?-?\s?card|e-?\s?gift(?:\s?card)?)\s+(?:has\s+been|was)\s+(?:successfully\s+)?redeemed`,
    String.raw`successfully\s+redeemed`,
    String.raw`redemption\s+(?:was\s+)?(?:successful|confirmed|complete)`,
    String.raw`balance\s+was\s+applied`,
  ].join("|"),
  "gi",
);
// Kill instructional/conditional framing ("Once your gift card has been redeemed, …").
const CONDITIONAL_RE = /\b(?:if|once|after|when|whether|until|unless|before|will|would|should|could|may|might|cannot|can[’']t|won[’']t|not)\b[^.!?\n]{0,44}$/i;

export function hasRedemption(text: string): boolean {
  for (const m of text.matchAll(REDEEMED_RE))
    if (!CONDITIONAL_RE.test(text.slice(Math.max(0, m.index - 48), m.index))) return true;
  return false;
}

export function amountRe(amount: number): RegExp {
  const [d, c] = amount.toFixed(2).split(".");
  return new RegExp(c === "00" ? `\\$\\s?${d}(?:\\.00)?(?!\\.?\\d)` : `\\$\\s?${d}\\.${c}(?!\\d)`);
}

const STORE_STOP = new Set(["gift", "card", "cards", "giftcard", "egift", "gifts", "digital", "store", "online", "your", "from", "with", "shop"]);
export function storeToken(store: string | null): string | null {
  for (const w of (store ?? "").toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 4 && !STORE_STOP.has(w)) return w;
  return null;
}

// Explicit balance statements only ("New balance: $12.40", "remaining balance of $X", "$X left").
// "definitive" phrasings (new/remaining/now/left) outrank generic ones ("gift card balance is $X"),
// so a "Previous balance $50 → New balance $12.40" receipt resolves to 12.40.
const AMT = String.raw`\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)`;
const BAL_PATTERNS: { re: RegExp; definitive: boolean }[] = [
  { re: new RegExp(String.raw`(?:new|remaining|current|updated)\s+(?:gift\s?-?card\s+|e-?gift(?:\s?card)?\s+|card\s+)?balance(?:\s+(?:is|was|of))?(?:\s+now)?\s*:?\s*` + AMT, "gi"), definitive: true },
  { re: new RegExp(String.raw`balance\s+(?:remaining|left)(?:\s+(?:is|of))?\s*:?\s*` + AMT, "gi"), definitive: true },
  { re: new RegExp(String.raw`balance\s+is\s+now\s*:?\s*` + AMT, "gi"), definitive: true },
  { re: new RegExp(AMT + String.raw`\s+(?:remaining|left)\b`, "gi"), definitive: true },
  { re: new RegExp(String.raw`(?:gift\s?-?card|card)\s+now\s+has\s+(?:a\s+balance\s+of\s+)?` + AMT, "gi"), definitive: true },
  { re: new RegExp(String.raw`(?:gift\s?-?card|e-?gift(?:\s?card)?|available)\s+balance(?:\s+(?:is|was|of))?\s*:?\s*` + AMT, "gi"), definitive: false },
];
// Future/conditional framing and non-card balances ("account balance", "previous balance") never count.
const BAL_BLOCK_RE = /\b(?:if|will|would|could|may|might|until|unless|account|previous|prior|original|starting|beginning)\b[^.!?\n]{0,32}$/i;

export function balanceAmount(text: string): number | null {
  const def: number[] = [];
  const gen: number[] = [];
  for (const { re, definitive } of BAL_PATTERNS)
    for (const m of text.matchAll(re)) {
      if (BAL_BLOCK_RE.test(text.slice(Math.max(0, m.index - 48), m.index))) continue;
      (definitive ? def : gen).push(Number(m[1].replace(/,/g, "")));
    }
  const pool = def.length ? def : gen;
  if (pool.length === 0) return null;
  const v = pool[0];
  return pool.every((x) => Math.abs(x - v) < 0.005) ? Math.round(v * 100) / 100 : null; // conflicting amounts → ambiguous → null
}

export type EvidenceMsg = { id: string; date: string | null; text: string };
export type BalanceTie = { estimate: number; asOf: string | null; evidenceId: string } | null;

// Strict evidence tying: exact code match is gold; else merchant token + date ≥ received + estimate ≤ loaded.
// An email that could belong to 2+ cards ties to NONE. Redemption receipts are skipped (their "new balance"
// is the ACCOUNT's, not the card's). Latest qualifying email wins.
export function tieBalance(
  cards: { code: string | null; store: string | null; amount: number | null; dateReceived: string | null }[],
  msgs: EvidenceMsg[],
): BalanceTie[] {
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const codes = cards.map((c) => {
    const n = flat(c.code ?? "");
    return n.length >= 8 ? n : null;
  });
  const tokens = cards.map((c) => storeToken(c.store));
  const best: ({ estimate: number; asOf: string | null; evidenceId: string; t: number } | null)[] = cards.map(() => null);
  for (const m of msgs) {
    const estimate = balanceAmount(m.text);
    if (estimate === null || hasRedemption(m.text)) continue;
    const t = Date.parse(m.date ?? "");
    const norm = flat(m.text);
    const lower = m.text.toLowerCase();
    const byCode = codes.flatMap((k, i) => (k && norm.includes(k) ? [i] : []));
    let owner = -1;
    if (byCode.length === 1) owner = byCode[0];
    else if (byCode.length === 0) {
      const byName = cards.flatMap((c, i) => {
        const recv = Date.parse(c.dateReceived ?? "");
        return tokens[i] &&
          lower.includes(tokens[i]!) &&
          typeof c.amount === "number" &&
          estimate <= c.amount + 0.005 &&
          Number.isFinite(t) &&
          Number.isFinite(recv) &&
          t >= recv
          ? [i]
          : [];
      });
      if (byName.length === 1) owner = byName[0];
    }
    if (owner < 0) continue;
    const time = Number.isFinite(t) ? t : 0;
    const cur = best[owner];
    if (!cur || time >= cur.t) best[owner] = { estimate, asOf: m.date, evidenceId: m.id, t: time };
  }
  return best.map((b) => (b ? { estimate: b.estimate, asOf: b.asOf, evidenceId: b.evidenceId } : null));
}

// ——— Physical-card vision extraction (scan a plastic card with the phone camera) ———
// Same ExtractedCard contract + json_schema output as extractCard, but the input is a PHOTO.

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

// Vision-only schema: SCHEMA + a structured image-quality issue so the UI can say WHY a read failed.
const VISION_SCHEMA = {
  ...SCHEMA,
  properties: { ...SCHEMA.properties, issue: { type: ["string", "null"] } },
  required: [...SCHEMA.required, "issue"],
} as const;

const VISION_SYSTEM = `You read ONE physical gift card from one or two photos (the second photo, when present, is the BACK of the SAME card) and report ONLY what is actually printed or handwritten on it. Merge what you see across the photos — e.g. number from the front, PIN from the back.

ACCURACY IS SACRED. Read codes character-by-character. If glare, angle, blur, or distance makes ANY character uncertain, do NOT guess: set that field to null and confidence to "low". A null is always better than one wrong digit. Never autocomplete, never fill gaps with plausible digits.

FIND THE NUMBER even when it's hard. The long card/gift-card NUMBER and the PIN are often on the BACK of the card, surrounded by legal fine print, terms, a customer-service phone number, or a website — read them out of that clutter anyway. They may be embossed (raised, same-color, low-contrast) or printed small near the barcode or a scratch-off panel — work to read them. Return \`store\` and \`code\` whenever they are legibly present, EVEN IF you are unsure whether the object is strictly a "gift card" (the user is scanning a gift card and a later step confirms ownership — your job is to read what's there). This DOES NOT relax accuracy: an unreadable character still means that field = null, confidence = "low", and the appropriate \`issue\` — read hard, but never invent a digit.

isGiftCard=true for: store gift cards / gift certificates / prepaid store cards, AND bank-network PREPAID GIFT cards — Visa, Mastercard, or Amex cards labeled "Gift Card" are gift cards, not bank cards. isGiftCard=false for: personal credit/debit/bank cards (cardholder name + bank branding, no "gift" wording), loyalty/membership/rewards, insurance, ID, business cards, coupons, or when no readable card is in the photo. When unsure, still report store/code as above — set isGiftCard to your best read and let the downstream confirm step decide.

store = the brand on the card (e.g. "Starbucks", "Target"; for bank-network gift cards use the network, e.g. "Visa").
code = the long card number EXACTLY as printed, spaces and dashes removed. Any unreadable character → code = null.
pin = the short security/PIN/CSC code ONLY if every character is clearly readable (labeled PIN, CSC, EAN, often near a scratch-off or barcode). Partially visible, covered, or uncertain → null.
amount = a dollar value ONLY if literally printed or handwritten on the card (e.g. "$25"). Phrases like "treat this card like cash" are NOT an amount. Most physical cards show NO value — then amount MUST be null.
expires = printed expiration only (YYYY-MM-DD when fully known), else null.
dateReceived = null — a photo cannot tell you when the card was received.
confidence = "high" only when EVERY character you reported is crisp; "medium" = readable with minor doubt; "low" = any glare, blur, or partial view affected what you reported.
issue = the PRIMARY image-quality problem, or null when the read was clean. Exactly one of: "glare" (light reflecting off the card washes out text — very common under ceiling lights), "blur" (out of focus or motion), "too_dark", "too_far" (card too small in the frame), "partial" (card partly out of frame), "not_gift_card" (readable, but not a gift card). Set issue whenever any field is null or confidence is below high BECAUSE of the image.`;

export async function extractCardImage(input: { images: { base64: string; mediaType: ImageMediaType }[] }): Promise<ExtractedCard> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });
  // Physical scans are rare single events — use the strongest available vision model; OCR accuracy is
  // everything. Walk SMART_MODELS in order so a single model being down (Fable) auto-falls-back to Opus.
  const content = [
    ...input.images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 } })),
    {
      type: "text" as const,
      text:
        input.images.length > 1
          ? "Front and back of the same physical gift card. Merge them — extract only what is visibly printed or handwritten."
          : "Read this physical gift card. Extract only what is visibly printed or handwritten on it.",
    },
  ];

  let lastErr: unknown;
  for (const model of SMART_MODELS) {
    try {
      const resp = await client.messages.create({
        model,
        max_tokens: 400,
        system: VISION_SYSTEM,
        messages: [{ role: "user", content }],
        output_config: { format: { type: "json_schema", schema: VISION_SCHEMA } },
      });
      const tb = resp.content.find((b) => b.type === "text");
      return JSON.parse(tb && "text" in tb ? tb.text : "{}") as ExtractedCard;
    } catch (e) {
      lastErr = e;
      console.error(`[scan-card] vision model ${model} failed:`, e instanceof Error ? e.message : e);
    }
  }
  throw lastErr ?? new Error("all vision models failed");
}

// One email → one SCHEMA-constrained extraction on the given model. Prompt + parse are
// identical for Haiku and Fable so escalation is a pure model swap (SYSTEM/SCHEMA never weaken).
async function runExtract(client: Anthropic, model: string, prompt: string): Promise<ExtractedCard> {
  const resp = await client.messages.create({
    model,
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });
  const tb = resp.content.find((b) => b.type === "text");
  return JSON.parse(tb && "text" in tb ? tb.text : "{}") as ExtractedCard;
}

// Buyer / sent / promo tells — the exact shapes where the cheap model most often misjudges
// (the Amazon order-confirm and reward-promo false positives).
const ESCALATE_SIGNAL_RE = /\b(order\s*#|order\s+confirmation|sent\s+to|thanks for your order|earn a|reward)\b/i;

// Worth a second, smarter look ONLY when Haiku committed to a card (isGiftCard OR a real amount)
// AND the email carries a not-yours/promo tell — i.e. the hard cases. Plain rejects don't escalate.
function isAmbiguous(card: ExtractedCard, text: string): boolean {
  if (card.confidence === "low") return true;
  const committed = card.isGiftCard === true || (typeof card.amount === "number" && card.amount > 0);
  return committed && ESCALATE_SIGNAL_RE.test(text);
}

export async function extractCard(input: { from?: string; date?: string; subject?: string; body: string }): Promise<ExtractedCard> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("missing ANTHROPIC_API_KEY");

  const prompt = `${input.from ? `From: ${input.from}\n` : ""}${input.date ? `Date: ${input.date}\n` : ""}${input.subject ? `Subject: ${input.subject}\n\n` : ""}${input.body}`.slice(0, 12000);

  const client = new Anthropic({ apiKey });
  const card = await runExtract(client, "claude-haiku-4-5", prompt);

  // Confidence escalation: re-judge the hard cases on Fable (better judgment, same SYSTEM/SCHEMA)
  // and return its verdict. Fires only on ambiguous emails (~few per inbox), so it's cheap.
  // NO_ESCALATE pins to Haiku (lets the battery measure the cheap model alone).
  if (!process.env.NO_ESCALATE && isAmbiguous(card, prompt)) {
    for (const model of SMART_MODELS) {
      try {
        return await runExtract(client, model, prompt);
      } catch (e) {
        console.error(`[scan] escalation model ${model} failed:`, e instanceof Error ? e.message : e);
      }
    }
    return card; // every smart model down → keep Haiku's verdict rather than 500 the whole scan
  }
  return card;
}
