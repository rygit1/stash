import { cookies } from "next/headers";
import { searchMessages, getMessage } from "@/lib/gmail";
import { extractCard, hasRedemption, amountRe, storeToken, tieBalance, type ExtractedCard, type EvidenceMsg } from "@/lib/extract";

// Find EVERY forgotten card, not just the recent ones. Pipeline:
//   search (deep, all-time, paginated up to CAP_IDS/CAP_IDS2 newest, noise-filtered, 2 passes: keywords + eGift delivery channels) → fetch bodies
//   → keep only those with a $ value → Haiku → dedupe → redemption-evidence pass (deterministic regex, zero Haiku)
//   → balance-estimate pass (latest balance receipt, evidence-tied, zero Haiku) → status per card.
export const maxDuration = 60;

// Positive gift-card terms, MINUS the two biggest noise sources in a real inbox:
//   -"you sent" / -"was received"  → kills "An Amazon Gift Card you sent was received" (cards YOU gave away)
//   -"buy a gift card" / -"extra value" → kills "buy a gift card, get bonus" promos
const QUERY =
  `("gift card" OR giftcard OR egift OR "e-gift" OR "e-gift card" OR "gift certificate" OR "digital gift" OR "redemption code" OR "your gift card") ` +
  `-"you sent" -"was received" -"buy a gift card" -"extra value"`;

// Pass 2 — brand-less peer eGifts ("Maria sent you $25") never say "gift card", so keywords can't see them.
// Target the DELIVERY channel instead: known eGift platforms + gifting subject shapes. Haiku still judges every hit.
const QUERY2 =
  `(from:(cashstar.com OR giftcards.com OR giftcardmall.com OR wgiftcard.com OR sendoso.com OR tangocard.com OR tremendous.com OR egifter.com OR giftrocket.com OR prezzee.com OR vanillagift.com OR gyft.com OR giftbit.com ` +
  `OR nike.com OR nikemail.com OR adidas.com OR lululemon.com OR sephora.com OR nordstrom.com OR bestbuy.com OR doordash.com OR ubereats.com OR airbnb.com) ` +
  `OR subject:("sent you" OR "gifted you" OR "a gift for you" OR "your gift is" OR "you received a gift" OR "you've received a gift" OR "gift card is here" OR "here is your gift")) ` +
  `-"you sent" -"was received" -"buy a gift card" -"extra value"`;

const CAP_IDS = 700; // how deep we page through matches (pass 1) — all-time, up to 700 newest
const CAP_IDS2 = 200; // eGift-channel pass (narrow) — up to 200 newest
const CAP_EXTRACT = 250; // max Haiku calls per scan (cost/time guard) — raised so older real cards aren't truncated
const CONCURRENCY = 24; // fetch + extract fan-out — high enough to keep a deep scan under the 60s function limit
const CAP_EVIDENCE_IDS = 8; // per claim-code search (Strategy A)
const CAP_SWEEP_IDS = 30; // redemption-phrase sweep (Strategy B)
const CAP_EVIDENCE_FETCH = 60; // total extra bodies fetched for evidence + balance (time guard)
const CAP_BALANCE_IDS = 6; // per-card balance search
const CAP_BALANCE_CARDS = 12; // how many cards get their own balance search

// Time budget inside the 60s function limit (maxDuration). Each stage stops STARTING new work once its
// cutoff passes and the scan returns what it has with stats.partial = true, instead of the platform
// killing the request and the user getting nothing. Emails are processed newest-first, so a cut-off
// drops the OLDEST ones. Cutoffs are ms since the request started.
const FETCH_UNTIL_MS = 30_000; // stop pulling more email bodies
const EXTRACT_UNTIL_MS = 46_000; // stop starting more model calls
const EVIDENCE_UNTIL_MS = 54_000; // stop the used/balance follow-up searches (cards then stay "available")

// One Gmail sweep for redemption receipts (Strategy B).
const SWEEP_QUERY =
  `"has been applied to your" OR "was applied to your" OR "applied to your balance" OR ` +
  `"has been added to your" OR "gift card was redeemed" OR "gift card has been redeemed" OR "successfully redeemed"`;

// Balance-receipt search terms (balance pass) — explicit statements only; the regex in lib/extract does the judging.
const BAL_TERMS = `("new balance" OR "remaining balance" OR "gift card balance" OR "balance remaining" OR "current balance" OR "balance is now")`;

// Deterministic, zero-AI fingerprint of a card's own email — the seed of client-side
// pattern-learning. `from` = sender domain; `sent`/`order` = the same not-yours signals the
// extractor SYSTEM prompt reads, mirrored here as plain regex so the wallet can learn to
// auto-hide look-alikes the user taps "not mine" on. No extraction/SCHEMA change.
type CardSig = { from: string; sent: boolean; order: boolean };

type CardOut = ExtractedCard & {
  id: string;
  status: "available" | "likely_used";
  evidenceId: string | null;
  balanceEstimate: number | null;
  balanceAsOf: string | null;
  balanceEvidenceId: string | null;
  redeemUrl: string | null;
  sig: CardSig | null;
};

// Sender DOMAIN only ("Amazon Gift Cards <gc@amazon.com>" → "amazon.com"): strip the display
// name + angle brackets, take the part after the last @, drop any trailing >.
function fromDomain(from: string): string {
  const at = from.lastIndexOf("@");
  if (at < 0) return "";
  return from
    .slice(at + 1)
    .replace(/[>"'\s].*$/, "")
    .toLowerCase()
    .trim();
}
// "sent to someone else" signal — a card the user GAVE AWAY, not one they own.
const SENT_RE = /\b(sent to|send to:|delivered to|on its way to|gift(?:ed)? to)\b/i;
// buyer's purchase/order-confirmation signal — the giver's receipt copy, not an owned card.
const ORDER_RE = /\b(thanks for your order|your order|order #|order confirmation|grand total|estimated delivery)\b/i;
function sigFrom(from: string, text: string): CardSig {
  return { from: fromDomain(from), sent: SENT_RE.test(text), order: ORDER_RE.test(text) };
}

// The merchant "view / redeem / check gift card" link inside a card's own email — what the
// localhost balance agent drives. Prefer a URL whose own path says redeem/gift-card; else fall
// back to the first link decodeBody curated onto the "Links:" line (redeemLinks now also captures
// click-tracking wrappers whose ANCHOR TEXT was a redeem CTA — those won't match the path regex).
const REDEEM_LINK_RE = /https?:\/\/[^\s"'<>]*(?:redeem|gift-?card|view[^\s"'<>]*gift)[^\s"'<>]*/i;
const LINKS_LINE_RE = /\nLinks:\s*(\S+)/i; // decodeBody appends "Links: url1 url2 …"; take the first
function redeemUrlFrom(body: string): string | null {
  return body.match(REDEEM_LINK_RE)?.[0] ?? body.match(LINKS_LINE_RE)?.[1] ?? null;
}

// Cheap gate before spending a Haiku call: a real card states a dollar value.
// Targeted on purpose — bare numbers must NOT pass, or junk floods the CAP_EXTRACT=100 AI budget.
// Three accepted shapes: (1) $-prefixed; (2) explicit usd/dollars unit ("USD 25", "25.00 USD");
// (3) a number within ~12 chars of a value word ("Value: 25.00", "amount of 50", "$50 loaded").
const VALUE_WORD = String.raw`value|amount|worth|balance|total|loaded|load|credit|gift`;
function hasValue(text: string): boolean {
  return (
    /\$\s?\d/.test(text) ||
    /\b(?:usd|dollars)\s?\d+(?:\.\d{2})?\b/i.test(text) || // "USD 25", "USD 25.00"
    /\b\d+(?:\.\d{2})?\s?(?:usd|dollars)\b/i.test(text) || // "25 USD", "25.00 USD"
    new RegExp(String.raw`(?:${VALUE_WORD})\b[\s:$]{0,12}\d`, "i").test(text) || // value word → number
    new RegExp(String.raw`\d(?:[\d.,\s$]{0,12})(?:${VALUE_WORD})\b`, "i").test(text) // number → value word
  );
}

// Runs fn over items with n workers. Stops handing out NEW items once `deadline` (epoch ms) passes.
// Returns true if it stopped early (some items were never started).
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>, deadline?: number): Promise<boolean> {
  let i = 0;
  let cutOff = false;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        if (deadline !== undefined && Date.now() > deadline) {
          cutOff = true;
          return;
        }
        await fn(items[i++]);
      }
    }),
  );
  return cutOff;
}

export async function GET() {
  const t0 = Date.now();
  const fetchDeadline = t0 + FETCH_UNTIL_MS;
  const extractDeadline = t0 + EXTRACT_UNTIL_MS;
  const evidenceDeadline = t0 + EVIDENCE_UNTIL_MS;
  let partial = false;

  const token = (await cookies()).get("g_token")?.value;
  if (!token) return Response.json({ error: "not_connected" }, { status: 401 });

  let ids: string[];
  let egiftIds = 0;
  let pass1 = 0;
  try {
    const [a, b] = await Promise.all([
      searchMessages(token, QUERY, CAP_IDS, fetchDeadline),
      searchMessages(token, QUERY2, CAP_IDS2, fetchDeadline).catch((e) => {
        console.error("[scan] egift-channel search failed:", e);
        return [] as string[]; // pass 2 is recall gravy — never sink the scan
      }),
    ]);
    pass1 = a.length;
    egiftIds = b.length;
    ids = [...new Set([...a, ...b])];
  } catch (e) {
    console.error("[scan] gmail search failed:", e);
    return Response.json({ error: "gmail_search_failed" }, { status: 502 });
  }
  console.log(
    `[scan] matched ids=${ids.length} (pass1=${pass1}${pass1 >= CAP_IDS ? ` ⚠️CAPPED@${CAP_IDS} — older emails dropped before fetch` : ""}, egift=${egiftIds}${egiftIds >= CAP_IDS2 ? ` ⚠️CAPPED@${CAP_IDS2}` : ""})`,
  );

  // Fetch bodies (free, just slow), then keep only emails that name a dollar value.
  const msgs: { id: string; from: string; date: string; subject: string; body: string }[] = [];
  const fetchCut = await pool(
    ids,
    CONCURRENCY,
    async (id) => {
      try {
        msgs.push({ id, ...(await getMessage(token, id, fetchDeadline)) });
      } catch (e) {
        console.error("[scan] fetch error:", id, e instanceof Error ? e.message : e);
      }
    },
    fetchDeadline,
  );
  if (fetchCut) {
    partial = true;
    console.warn(`[scan] ⚠️PARTIAL: fetch stopped at ${FETCH_UNTIL_MS}ms with ${msgs.length}/${ids.length} bodies`);
  }
  // Workers finish out of order; restore Gmail's newest-first order so CAP_EXTRACT (and any cut-off) drops the OLDEST.
  const order = new Map(ids.map((id, i) => [id, i]));
  msgs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const valued = msgs.filter((m) => hasValue(`${m.subject} ${m.body}`));
  const candidates = valued.slice(0, CAP_EXTRACT);
  console.log(
    `[scan] fetched=${msgs.length} valued=${valued.length} candidates=${candidates.length}${valued.length > candidates.length ? ` ⚠️TRUNCATED ${valued.length - candidates.length} by CAP_EXTRACT=${CAP_EXTRACT}` : ""}`,
  );

  // Haiku decides real-card vs promo vs not-yours on each candidate.
  const found: (ExtractedCard & { id: string })[] = [];
  const extractCut = await pool(
    candidates,
    CONCURRENCY,
    async (m) => {
      try {
        const card = await extractCard(m);
        if (card.isGiftCard && typeof card.amount === "number" && card.amount > 0) found.push({ ...card, id: m.id });
      } catch (e) {
        console.error("[scan] extract error:", m.id, e instanceof Error ? e.message : e);
      }
    },
    extractDeadline,
  );
  if (extractCut) {
    partial = true;
    console.warn(`[scan] ⚠️PARTIAL: extraction stopped at ${EXTRACT_UNTIL_MS}ms`);
  }

  // Dedupe (the same card often arrives as both a "waiting" notice and the real delivery).
  const seen = new Set<string>();
  const cards = found.filter((c) => {
    const key = c.code || `${(c.store ?? "").toLowerCase()}|${c.amount}`;
    if (seen.has(key)) {
      console.log(`[scan][dedup-drop] store=${JSON.stringify(c.store)} amt=${c.amount} code=${c.code ?? "null"} key=${key}`);
      return false;
    }
    seen.add(key);
    return true;
  });
  console.log(`[scan] found=${found.length} afterDedup=${cards.length} → ${cards.map((c) => `${c.store}:$${c.amount}`).join(", ")}`);
  cards.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

  // Redemption-evidence pass. Default is honest: no evidence → "available". Never guess.
  const out: CardOut[] = cards.map((c) => ({ ...c, status: "available" as const, evidenceId: null, balanceEstimate: null, balanceAsOf: null, balanceEvidenceId: null, redeemUrl: null, sig: null }));
  const ownIds = new Set(found.map((f) => f.id)); // delivery emails of owned cards are never evidence
  const msgCache = new Map<string, { text: string; date: string | null }>(msgs.map((m) => [m.id, { text: `${m.subject}\n${m.body}`, date: m.date || null }]));
  let extraFetches = 0;
  const fetchEvidence = async (id: string): Promise<{ text: string; date: string | null } | null> => {
    const hit = msgCache.get(id);
    if (hit !== undefined) return hit;
    if (extraFetches >= CAP_EVIDENCE_FETCH || Date.now() > evidenceDeadline) return null;
    extraFetches++;
    const m = await getMessage(token, id, evidenceDeadline);
    const entry = { text: `${m.subject}\n${m.body}`, date: m.date || null };
    msgCache.set(id, entry);
    return entry;
  };

  // Strategy A — search the exact claim code; another email with the code + redemption language = used.
  const withCode = out.filter((c) => c.code && c.code.replace(/[^a-z0-9]/gi, "").length >= 8); // short codes = search noise
  await pool(withCode, CONCURRENCY, async (c) => {
    try {
      const hits = (await searchMessages(token, `"${c.code!.replace(/"/g, "")}"`, CAP_EVIDENCE_IDS, evidenceDeadline)).filter((id) => !ownIds.has(id));
      for (const id of hits) {
        const e = await fetchEvidence(id);
        if (e && hasRedemption(e.text)) {
          c.status = "likely_used";
          c.evidenceId = id;
          break;
        }
      }
    } catch (e) {
      console.error("[scan] evidence search error:", c.id, e instanceof Error ? e.message : e);
    }
  }, evidenceDeadline);

  // Strategy B — one sweep for redemption receipts, matched to remaining cards by merchant + exact amount.
  const pendingB = out.filter((c) => c.status === "available" && storeToken(c.store) && typeof c.amount === "number");
  if (pendingB.length > 0 && Date.now() < evidenceDeadline) {
    try {
      const sweepIds = (await searchMessages(token, SWEEP_QUERY, CAP_SWEEP_IDS, evidenceDeadline)).filter((id) => !ownIds.has(id));
      const receipts: { id: string; text: string }[] = [];
      await pool(sweepIds, CONCURRENCY, async (id) => {
        try {
          const e = await fetchEvidence(id);
          if (e && hasRedemption(e.text)) receipts.push({ id, text: e.text.toLowerCase() });
        } catch {
          /* skip unfetchable */
        }
      });
      // A receipt only marks a card used when it points at EXACTLY ONE pending card. If two cards share
      // the merchant and amount (two $25 Targets), the receipt can't say which was spent, so both stay
      // "available" rather than hiding real money on a guess.
      for (const r of receipts) {
        const matches = pendingB.filter((c) => c.status === "available" && r.text.includes(storeToken(c.store)!) && amountRe(c.amount!).test(r.text));
        if (matches.length === 1) {
          matches[0].status = "likely_used";
          matches[0].evidenceId = r.id;
        }
      }
    } catch (e) {
      console.error("[scan] evidence sweep error:", e instanceof Error ? e.message : e);
    }
  }

  // Balance-estimate pass — the LATEST explicit balance receipt per card, evidence-tied (code, else merchant+date),
  // deterministic regex only. Estimate 0 ⇒ the card is spent. Never a number without a real evidence email.
  try {
    const balIds = new Set<string>();
    const searchable = out.filter((c) => storeToken(c.store)).slice(0, CAP_BALANCE_CARDS);
    await pool(searchable, CONCURRENCY, async (c) => {
      try {
        for (const id of await searchMessages(token, `"${storeToken(c.store)!}" ${BAL_TERMS}`, CAP_BALANCE_IDS, evidenceDeadline)) balIds.add(id);
      } catch {
        /* narrow search is best-effort */
      }
    }, evidenceDeadline);
    await pool([...balIds].filter((id) => !ownIds.has(id) && !msgCache.has(id)), CONCURRENCY, async (id) => {
      try {
        await fetchEvidence(id);
      } catch {
        /* skip unfetchable */
      }
    }, evidenceDeadline);
    // Candidates = every body we already hold (main fetch + code hits + sweep + balance searches), minus deliveries.
    const evidenceMsgs: EvidenceMsg[] = [...msgCache].filter(([id]) => !ownIds.has(id)).map(([id, e]) => ({ id, date: e.date, text: e.text }));
    const ties = tieBalance(out.map((c) => ({ code: c.code, store: c.store, amount: c.amount, dateReceived: c.dateReceived })), evidenceMsgs);
    ties.forEach((tie, i) => {
      if (!tie) return;
      const c = out[i];
      c.balanceEstimate = tie.estimate;
      c.balanceAsOf = tie.asOf;
      c.balanceEvidenceId = tie.evidenceId;
      if (tie.estimate === 0) {
        c.status = "likely_used";
        c.evidenceId ??= tie.evidenceId;
      }
    });
  } catch (e) {
    console.error("[scan] balance pass error:", e instanceof Error ? e.message : e);
  }

  // Attach each card's own merchant redeem/view-gift-card link (for the localhost balance agent).
  // Pulled straight from the body we already fetched — no extra calls, doesn't touch extraction.
  const bodyById = new Map(msgs.map((m) => [m.id, `${m.subject}\n${m.body}`]));
  const fromById = new Map(msgs.map((m) => [m.id, m.from]));
  for (const c of out) {
    const body = bodyById.get(c.id);
    c.redeemUrl = body ? redeemUrlFrom(body) : null;
    c.sig = body ? sigFrom(fromById.get(c.id) ?? "", body) : null;
  }

  // Ran past the follow-up cutoff: cards are all here, but some "used"/balance checks were skipped.
  if (Date.now() > evidenceDeadline) partial = true;

  const evidence = new Set(out.filter((c) => c.evidenceId).map((c) => c.evidenceId as string)).size;
  const balances = out.filter((c) => c.balanceEstimate !== null).length;

  console.log(
    `[scan] done ids=${ids.length} fetched=${msgs.length} candidates=${candidates.length} found=${out.length} used=${out.filter((c) => c.status === "likely_used").length} evidence=${evidence} balances=${balances} extraFetches=${extraFetches} partial=${partial} ms=${Date.now() - t0}`,
  );
  return Response.json(
    { cards: out, stats: { matched: ids.length, fetched: msgs.length, candidates: candidates.length, found: out.length, evidence, balances, partial } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
