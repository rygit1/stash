"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { merchantAction } from "@/lib/merchants";
import { decodeCardBarcode, frameQuality } from "@/lib/barcode";
import { code128Svg } from "@/lib/barcode128";

type Found = {
  id: string;
  store: string;
  amount: number;
  code: string | null;
  pin: string | null;
  expires: string | null;
  date: string | null;
  expiring: boolean;
  emoji: string;
  color: string;
  status: "available" | "likely_used";
  evidenceId: string | null;
  balanceEstimate: number | null;
  balanceAsOf: string | null;
  balanceEvidenceId: string | null;
  redeemUrl: string | null;
  sig: CardSig | null;
};
// Deterministic fingerprint of a card's own email, seeds client-side "not mine" pattern learning.
type CardSig = { from: string; sent: boolean; order: boolean };
type Stage = "landing" | "scanning" | "wallet" | "error";
type Stats = { matched: number; fetched: number; candidates: number; found: number; evidence: number; partial?: boolean };

// A card the user photographed, its face IS the (cropped) photo. Lives in localStorage,
// works with zero Gmail connection, and merges into the wallet as a first-class sibling.
type PhysicalCard = {
  id: string;
  store: string;
  amount: number | null; // null = value not printed on the card (the honest default)
  code: string | null;
  pin: string | null;
  expires: string | null; // printed expiry if the user entered one (most cards have none, the honest default)
  croppedFace: string | null; // ~640px JPEG dataURL, center-cropped to card aspect; null → brand-color face
  addedAt: string;
};

const PHYS_KEY = "loot_physical_v1";
const CARD_AR = 1.586; // credit-card aspect ratio
const normCode = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Manual spend log: user-logged purchases against a card. Keyed by normalized code
// (the same card found twice shares one log), falling back to the card's id.
type SpendEntry = { amount: number; at: string };
const SPEND_KEY = "loot_spend_v1";
const spendKeyOf = (code: string | null, id: string) => normCode(code) || id;

function loadSpends(): Record<string, SpendEntry[]> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SPEND_KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, SpendEntry[]> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const entries = v.flatMap((e): SpendEntry[] => {
        if (!e || typeof e !== "object") return [];
        const o = e as Record<string, unknown>;
        if (typeof o.amount !== "number" || !Number.isFinite(o.amount) || o.amount <= 0) return [];
        return [{ amount: o.amount, at: typeof o.at === "string" ? o.at : "" }];
      });
      if (entries.length) out[k] = entries;
    }
    return out;
  } catch {
    return {};
  }
}

function loadPhysical(): PhysicalCard[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PHYS_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((c): PhysicalCard[] => {
      if (!c || typeof c !== "object") return [];
      const o = c as Record<string, unknown>;
      if (typeof o.id !== "string" || typeof o.store !== "string") return [];
      return [
        {
          id: o.id,
          store: o.store,
          amount: typeof o.amount === "number" ? o.amount : null,
          code: typeof o.code === "string" ? o.code : null,
          pin: typeof o.pin === "string" ? o.pin : null,
          expires: typeof o.expires === "string" ? o.expires : null,
          croppedFace: typeof o.croppedFace === "string" ? o.croppedFace : null,
          addedAt: typeof o.addedAt === "string" ? o.addedAt : "",
        },
      ];
    });
  } catch {
    return [];
  }
}

// dataURL faces are heavy (~50-120KB each). On quota pressure: keep the 5 newest faces,
// then drop all faces, the card data itself always survives (brand-color fallback face).
function persistPhysical(cards: PhysicalCard[]) {
  const attempts = [
    cards,
    cards.map((c, i) => (i < 5 ? c : { ...c, croppedFace: null })),
    cards.map((c) => ({ ...c, croppedFace: null })),
  ];
  for (const a of attempts) {
    try {
      localStorage.setItem(PHYS_KEY, JSON.stringify(a));
      return;
    } catch {
      /* quota or private mode, retry lighter; worst case in-memory only */
    }
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode_failed"));
    img.src = src;
  });
}

// Downscale to ≤2200px long edge, JPEG 0.92 for the image SENT TO THE MODEL, vision models read
// small/embossed card text far better at higher res + less compression. Never upscales (Math.min(1,…)).
// Stays well under the /api/scan-card 8MB decoded guard. (The live auto-capture tick uses a separate
// ~480px frame, that's just for sharpness/barcode polling and is intentionally left small.)
async function fileToDownscaledJpeg(file: File, maxEdge = 2200, quality = 0.92): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error("decode_failed");
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_failed");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Center-crop the photo to credit-card aspect at ~640px wide, this becomes the card's face.
async function cropToCardFace(dataUrl: string, outW = 640, quality = 0.8): Promise<string | null> {
  try {
    const img = await loadImage(dataUrl);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;
    let sw = w;
    let sh = Math.round(w / CARD_AR);
    if (sh > h) {
      sh = h;
      sw = Math.round(h * CARD_AR);
    }
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = Math.round(outW / CARD_AR);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, Math.round((w - sw) / 2), Math.round((h - sh) / 2), sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return null;
  }
}

// u/0 assumes the connected account is the browser's first Google session, fine for the demo.
// Localhost-only gate for the live balance agent, it spawns a headless browser via a Node
// child process, which only exists on the local machine (no-op + hidden in production).
const isLocalhost = () =>
  typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

const gmailUrl = (id: string) => `https://mail.google.com/mail/u/0/#all/${id}`;
const keyOf = (c: Found) => c.code || c.id;

// Every on-device key that holds a saved card or its derived state. Shared by the /?reset=1
// demo wipe and the in-wallet "Clear all" button so the two can never drift out of sync.
const RESET_KEYS = [
  "loot_physical_v1", // scanned plastic cards
  "loot_used", // used/available overrides
  "loot_spend_v1", // manual spend log
  "loot_stash_v1", // last email-scan snapshot
  "loot_stash_celebrated", // celebration dedupe
  "loot_notmine_v1", // "not mine" taught patterns
  "loot_notified", // expiry-notification dedupe
] as const;

function wipeSavedCards() {
  for (const k of RESET_KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {}
  }
}

// "Not mine" pattern learning (per-user, on-device; the seed of the global classifier flywheel, future work).
const NOTMINE_KEY = "loot_notmine_v1";
type NotMineSig = { key: string; from: string; sent: boolean; order: boolean; at: string };
// A card is hidden if (a) it's the exact card the user flagged, OR (b) it shares the flagged email's
// SENDER **and** a distinguishing not-yours flag (sent / order). Sender alone NEVER hides, so flagging a
// sent gift card from amazon.com won't hide a genuine received gift card from amazon.com (sent=order=false).
function hiddenByNotMine(c: Found, list: NotMineSig[]): boolean {
  const k = keyOf(c);
  return list.some(
    (L) => L.key === k || (!!c.sig && !!L.from && c.sig.from === L.from && ((L.sent && c.sig.sent) || (L.order && c.sig.order))),
  );
}

// Honest value of a card: the latest receipt-stated balance when one exists, else the loaded value.
const worth = (c: Found) => c.balanceEstimate ?? c.amount;
const fmtAsOf = (s: string) => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? s : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const BRAND: Record<string, { emoji: string; color: string }> = {
  starbucks: { emoji: "☕", color: "#00704A" }, amazon: { emoji: "📦", color: "#FF9900" },
  target: { emoji: "🎯", color: "#CC0000" }, sephora: { emoji: "💄", color: "#D6336C" },
  roblox: { emoji: "🎮", color: "#1FA2FF" }, chipotle: { emoji: "🌯", color: "#A81612" },
  nike: { emoji: "👟", color: "#111111" }, apple: { emoji: "🍎", color: "#555555" },
  doordash: { emoji: "🚪", color: "#FF3008" }, spotify: { emoji: "🎧", color: "#1DB954" },
  walmart: { emoji: "🛒", color: "#0071CE" }, uber: { emoji: "🚗", color: "#111111" },
  nintendo: { emoji: "🎮", color: "#E60012" }, visa: { emoji: "💳", color: "#1A1F71" },
};
function brandFor(store: string | null) {
  const k = (store ?? "").toLowerCase();
  for (const key in BRAND) if (k.includes(key)) return BRAND[key];
  return { emoji: "🎁", color: "#10b981" };
}
function isExpiringSoon(expires: string | null) {
  if (!expires) return false;
  const t = Date.parse(expires);
  if (Number.isNaN(t)) return false;
  const days = (t - Date.now()) / 86_400_000;
  return days > 0 && days <= 30;
}
// Whole days until a real, upcoming expiry. null = no expiry, unparseable, or already elapsed,
// in every one of those cases we show nothing (most gift cards genuinely never expire).
function daysUntil(expires: string | null): number | null {
  if (!expires) return null;
  const t = Date.parse(expires);
  if (Number.isNaN(t)) return null;
  const d = Math.ceil((t - Date.now()) / 86_400_000);
  return d > 0 ? d : null;
}
const expTs = (expires: string | null) => {
  const t = expires ? Date.parse(expires) : NaN;
  return Number.isNaN(t) ? Infinity : t;
};
// Tiny countdown chip: amber if ≤30 days out, zinc if further, nothing if no/elapsed expiry.
function ExpiryBadge({ expires }: { expires: string | null }) {
  const d = daysUntil(expires);
  if (d === null) return null;
  const soon = d <= 30;
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        soon ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-500"
      }`}
    >
      expires in {d} day{d === 1 ? "" : "s"}
    </span>
  );
}

// Per-card auto-resolve status (localhost only): the hidden-code agent's progress for one card.
//   unlocking → the headless agent is opening the merchant page
//   unlocked  → code+pin merged in; the normal reveal UI now renders (brief pulse)
//   failed    → agent couldn't (e.g. merchant_not_supported) → manual ⚡ button stays as fallback
type ResolvePhase = "unlocking" | "unlocked" | "failed";

export default function Home() {
  const [stage, setStage] = useState<Stage>("landing");
  const [cards, setCards] = useState<Found[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [physical, setPhysical] = useState<PhysicalCard[]>([]);
  // Auto-resolve UI status per card id. Separate from the idempotency guard below.
  const [resolveStatus, setResolveStatus] = useState<Record<string, ResolvePhase>>({});
  // Idempotency: ids we've already started (in-flight OR done), so a re-render never re-fires.
  const resolveSeen = useRef<Set<string>>(new Set());
  // Mount guard for the async pool, only flips on real unmount, NOT on every cards re-render
  // (the merge below mutates cards by design; cancelling on it would strand the rest of the batch).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Load after mount so the SSR'd landing markup matches the first client render.
  useEffect(() => {
    setPhysical(loadPhysical());
  }, []);

  // Upsert + dedupe by code: re-scanning the same plastic card replaces it, never doubles it.
  const addPhysical = (card: PhysicalCard) => {
    setPhysical((prev) => {
      const k = normCode(card.code);
      const rest = k.length >= 4 ? prev.filter((p) => normCode(p.code) !== k) : prev;
      const next = [card, ...rest];
      persistPhysical(next);
      return next;
    });
  };

  // A card's hidden code+pin came back (auto-resolve OR the manual ⚡ fallback): merge them in and
  // flag it unlocked (drives the pulse). Keeps the wallet's existing amount as the headline.
  // Shared so a manual success replaces the ⚡ button with the same reveal/copy UI as auto-resolve.
  const mergeResolvedCode = (id: string, cardNumber: string | null, pin: string | null) => {
    if (!cardNumber && !pin) return;
    setCards((prev) => prev.map((p) => (p.id === id ? { ...p, code: cardNumber ?? p.code, pin: pin ?? p.pin } : p)));
    resolveSeen.current.add(id);
    setResolveStatus((s) => ({ ...s, [id]: "unlocked" }));
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    // Demo reset: /?reset=1 wipes every locally-stored card + flag and reloads clean.
    if (p.get("reset") === "1") {
      wipeSavedCards();
      window.location.replace("/");
      return;
    }
    if (p.get("error")) {
      setError(p.get("error"));
      setStage("error");
      window.history.replaceState({}, "", "/");
    } else if (p.get("connected") === "1") {
      window.history.replaceState({}, "", "/");
      setStage("scanning");
      runScan();
    }
  }, []);

  async function runScan() {
    // Fresh scan → let auto-resolve run again (Gmail message ids are stable, so reset the guards).
    resolveSeen.current = new Set();
    setResolveStatus({});
    try {
      const r = await fetch("/api/scan", { cache: "no-store" });
      if (r.status === 401) {
        setError("not_connected");
        setStage("error");
        return;
      }
      if (!r.ok) {
        setError("scan_failed");
        setStage("error");
        return;
      }
      const data = await r.json();
      type Raw = { id: string; store: string | null; amount: number | null; code: string | null; pin: string | null; expires: string | null; dateReceived: string | null; status: "available" | "likely_used"; evidenceId: string | null; balanceEstimate: number | null; balanceAsOf: string | null; balanceEvidenceId: string | null; redeemUrl: string | null; sig: CardSig | null };
      setCards(
        (data.cards as Raw[]).map((c) => ({
          id: c.id,
          store: c.store ?? "Gift card",
          amount: c.amount ?? 0,
          code: c.code,
          pin: c.pin,
          expires: c.expires,
          date: c.dateReceived,
          expiring: isExpiringSoon(c.expires),
          status: c.status ?? "available",
          evidenceId: c.evidenceId ?? null,
          balanceEstimate: c.balanceEstimate ?? null,
          balanceAsOf: c.balanceAsOf ?? null,
          balanceEvidenceId: c.balanceEvidenceId ?? null,
          redeemUrl: c.redeemUrl ?? null,
          sig: c.sig ?? null,
          ...brandFor(c.store),
        })),
      );
      setStats(data.stats);
      setStage("wallet");
    } catch {
      setError("scan_failed");
      setStage("error");
    }
  }

  // AUTO-RESOLVE (localhost only): once the wallet has cards, quietly drive the hidden-code agent
  // for every card that has a redeemUrl but no code yet, so codes land in the wallet WITHOUT a
  // click, shown in the same reveal/copy UI as email-embedded cards. Bounded: ≤2 in flight,
  // ≤6 per scan total; beyond that the manual ⚡ button remains. Idempotent via resolveSeen.
  useEffect(() => {
    if (!isLocalhost() || cards.length === 0) return;
    const MAX_TOTAL = 6;
    const CONCURRENCY = 2;
    const budget = MAX_TOTAL - resolveSeen.current.size;
    if (budget <= 0) return;
    const queue = cards
      .filter((c) => c.redeemUrl && !c.code && !resolveSeen.current.has(c.id))
      .slice(0, budget);
    if (queue.length === 0) return;
    for (const c of queue) resolveSeen.current.add(c.id); // claim before async so re-renders don't re-queue

    const resolveOne = async (card: Found) => {
      setResolveStatus((s) => ({ ...s, [card.id]: "unlocking" }));
      try {
        const r = await fetch("/api/check-balance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ redeemUrl: card.redeemUrl }),
        });
        const d = r.ok ? await r.json() : { ok: false };
        if (!mounted.current) return;
        if (d.ok && (d.cardNumber || d.pin)) {
          mergeResolvedCode(card.id, d.cardNumber ?? null, d.pin ?? null); // code+pin in; amount stays
        } else {
          setResolveStatus((s) => ({ ...s, [card.id]: "failed" })); // → manual ⚡ button stays
        }
      } catch {
        if (mounted.current) setResolveStatus((s) => ({ ...s, [card.id]: "failed" }));
      }
    };

    // Concurrency-limited pool over this batch. It runs to completion independently, the
    // setCards merge re-renders (and re-runs this effect), but resolveSeen makes those no-ops,
    // so the in-flight batch is never cancelled or re-queued.
    let i = 0;
    const worker = async () => {
      while (i < queue.length && mounted.current) await resolveOne(queue[i++]);
    };
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  }, [cards]);

  // The LANDING is a full-width marketing page. Every other stage is the phone-style
  // 440px wallet column, a wallet should look like a wallet, so it stays narrow.
  if (stage === "landing") {
    return (
      <Landing
        physicalCount={physical.length}
        onOpenWallet={() => setStage("wallet")}
        onAddPhysical={(c) => {
          addPhysical(c);
          setStage("wallet");
        }}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-5">
      {stage === "scanning" && <Scanning />}
      {stage === "wallet" && (
        <Wallet
          cards={cards}
          stats={stats}
          physical={physical}
          onAddPhysical={addPhysical}
          resolveStatus={resolveStatus}
          onResolveCode={mergeResolvedCode}
        />
      )}
      {stage === "error" && <ErrorView error={error} />}
    </main>
  );
}

// ── Landing brand kit ────────────────────────────────────────────────────────
// The emerald card glyph that doubles as the Stash logo.
function StashGlyph({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-[7px] bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-sm shadow-emerald-600/30 ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="h-[58%] w-[58%]" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
        <path d="M2.5 9.5h19" />
      </svg>
    </span>
  );
}

function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <StashGlyph className="h-7 w-7" />
      <span className={`text-[19px] font-semibold tracking-tight ${light ? "text-white" : "text-zinc-900"}`}>Stash</span>
    </span>
  );
}

// Section eyebrow, small uppercase label that segments the page.
function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">{children}</p>;
}

// One static gift-card row for the hero phone mockup, a faithful replica of a wallet
// CardRow (brand emoji + color + amount), NOT the live component. Safer + lighter.
function MiniCardRow({ emoji, color, store, amount }: { emoji: string; color: string; store: string; amount: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-100 bg-white px-3 py-2.5 shadow-sm">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
        style={{ backgroundColor: `${color}1a` }}
      >
        {emoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-zinc-900">{store}</p>
        <p className="text-[11px] text-zinc-400">tap to use</p>
      </div>
      <span className="shrink-0 text-[15px] font-bold tabular-nums text-emerald-600">{amount}</span>
    </div>
  );
}

// Static phone-frame mockup of the wallet, sells the product without the live UI.
function PhoneMockup() {
  const sb = brandFor("starbucks");
  const nk = brandFor("nike");
  const az = brandFor("amazon");
  return (
    <div className="stash-float relative mx-auto w-[280px] sm:w-[300px]">
      {/* ambient glow behind the phone */}
      <div className="pointer-events-none absolute -inset-10 -z-10 rounded-full bg-emerald-400/20 blur-3xl" aria-hidden="true" />
      <div className="rounded-[2.6rem] border border-zinc-200 bg-zinc-900 p-2.5 shadow-2xl shadow-emerald-900/20">
        <div className="relative overflow-hidden rounded-[2.1rem] bg-[#f5f8f6] px-5 pb-7 pt-9">
          {/* notch */}
          <div className="absolute left-1/2 top-3 h-1.5 w-16 -translate-x-1/2 rounded-full bg-zinc-300" aria-hidden="true" />
          <p className="text-[11px] font-medium text-zinc-400">Still yours</p>
          <p className="mt-0.5 text-[40px] font-bold leading-none tracking-tight text-emerald-600 tabular-nums">$434.50</p>
          <p className="mt-1.5 text-[11px] text-zinc-500">
            across <span className="font-semibold text-zinc-900">3 gift cards</span> hiding in your inbox
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <MiniCardRow emoji={sb.emoji} color={sb.color} store="Starbucks" amount="$50.00" />
            <MiniCardRow emoji={nk.emoji} color={nk.color} store="Nike" amount="$184.50" />
            <MiniCardRow emoji={az.emoji} color={az.color} store="Amazon" amount="$200.00" />
          </div>
          <div className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
            ⏰ $50 Starbucks expires in 12 days
          </div>
        </div>
      </div>
    </div>
  );
}

type Feature = { icon: string; title: string; body: string };
const FEATURES: Feature[] = [
  { icon: "📨", title: "Finds every card in your inbox", body: "Connect Gmail and AI digs out the gift cards hiding in years of email, automatically." },
  { icon: "📸", title: "Scan plastic cards", body: "Point your camera. It auto-captures when the shot is clear and reads the number off the barcode." },
  { icon: "⚡", title: "Fetches your real balance", body: "An agent checks the merchant for you, Nike, Starbucks, so there's nothing to type." },
  { icon: "✅", title: "Knows what you've used", body: "Spots redeemed cards from your receipts, so the total you see is honest." },
  { icon: "⏰", title: "Never lose one to expiry", body: "Countdowns and reminders before a card expires, the deadline companies hope you miss." },
  { icon: "🧠", title: "Learns what's yours", body: "Tap “not mine” once and Stash filters that pattern forever." },
];

type Step = { n: string; title: string; body: string };
const STEPS: Step[] = [
  { n: "1", title: "Connect your email", body: "Or scan a plastic card. Read-only access, Stash only ever looks for gift cards." },
  { n: "2", title: "Stash finds every card", body: "It surfaces each gift card hiding in your inbox and shows what's actually left on it." },
  { n: "3", title: "Use it before they keep it", body: "See your real total, the codes, and what's expiring, then go spend money you already had." },
];

const FAQ_ITEMS = [
  { q: "Is it safe to connect my email?", a: "Yes. Stash uses Google's read-only access, it can find your gift cards but can never send, delete, or change anything. We only look for gift-card emails, store nothing, and you can disconnect in one tap." },
  { q: "What if I don't use Gmail?", a: "Gmail works today, and Outlook is next (the same kind of connection). No email account? Scan a physical card with your camera, or forward a gift-card email to us." },
  { q: "Do gift cards actually expire?", a: "Most don't, which is exactly how companies bank on you forgetting. It's a $21-billion-a-year business they call “breakage.” For the ones that do expire, Stash counts down the days and reminds you." },
  { q: "What about physical, plastic cards?", a: "Point your camera at one. Stash auto-captures the moment the image is clear and reads the number right off the barcode, then keeps it in your wallet with the rest." },
  { q: "How does it know my balance?", a: "Honestly. It shows the value from your email, uses your latest receipt where one exists, and for supported stores an agent checks the merchant live, and it never shows you a number it made up." },
  { q: "Does it cost anything?", a: "Finding your forgotten cards is free." },
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="mx-auto w-full max-w-3xl scroll-mt-20 px-5 py-20 sm:px-8 sm:py-24">
      <div className="reveal text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">Questions</p>
        <h2 className="mt-4 text-[clamp(1.9rem,4.5vw,3rem)] font-bold leading-[1.1] tracking-tight text-zinc-900">
          Good questions, <span className="text-emerald-600">honest answers.</span>
        </h2>
      </div>
      <div className="reveal mt-12 flex flex-col gap-3">
        {FAQ_ITEMS.map((it, i) => {
          const isOpen = open === i;
          return (
            <div key={it.q} className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white transition-shadow hover:shadow-sm">
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="text-base font-semibold text-zinc-900">{it.q}</span>
                <span className={`shrink-0 text-2xl font-light leading-none text-emerald-600 transition-transform duration-300 ${isOpen ? "rotate-45" : ""}`} aria-hidden="true">
                  +
                </span>
              </button>
              <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                <div className="overflow-hidden">
                  <p className="px-5 pb-5 text-[15px] leading-relaxed text-zinc-500">{it.a}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Landing({
  physicalCount,
  onOpenWallet,
  onAddPhysical,
}: {
  physicalCount: number;
  onOpenWallet: () => void;
  onAddPhysical: (c: PhysicalCard) => void;
}) {
  const [scrolled, setScrolled] = useState(false);

  // Sticky-nav scroll state + scroll-reveal, both pure progressive enhancement.
  // `reveal-armed` is added only after mount so SSR/no-JS markup stays fully visible.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    document.documentElement.classList.add("reveal-armed");
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            obs.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    document.querySelectorAll<HTMLElement>(".reveal").forEach((el) => obs.observe(el));
    return () => {
      window.removeEventListener("scroll", onScroll);
      obs.disconnect();
      document.documentElement.classList.remove("reveal-armed");
    };
  }, []);

  return (
    <div className="flex min-h-dvh w-full flex-col bg-[#f5f8f6] text-zinc-900">
      {/* ── Sticky nav ─────────────────────────────────────────────────────── */}
      <header
        className={`sticky top-0 z-40 border-b transition-colors duration-300 ${
          scrolled ? "border-zinc-200/80 bg-[#f5f8f6]/90 backdrop-blur-md" : "border-transparent bg-transparent"
        }`}
      >
        <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <a href="#top" className="flex items-center" aria-label="Stash home">
            <Wordmark />
          </a>
          <div className="hidden items-center gap-8 text-sm font-medium text-zinc-500 md:flex">
            <a href="#how" className="transition-colors hover:text-zinc-900">How it works</a>
            <a href="#features" className="transition-colors hover:text-zinc-900">Features</a>
            <a href="#security" className="transition-colors hover:text-zinc-900">Security</a>
          </div>
          <a
            href="/api/google/start"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-zinc-900 px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 active:scale-[0.98] sm:px-4"
          >
            <GoogleIcon /> <span className="hidden sm:inline">Connect Gmail</span><span className="sm:hidden">Connect</span>
          </a>
        </nav>
      </header>

      <main id="top" className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute -top-32 right-[-10%] -z-10 h-[36rem] w-[36rem] rounded-full bg-emerald-300/25 blur-[120px]" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-40 left-[-15%] -z-10 h-[32rem] w-[32rem] rounded-full bg-emerald-200/30 blur-[120px]" aria-hidden="true" />
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-2 lg:gap-8 lg:py-28">
            <div className="reveal max-w-xl">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200/70 bg-emerald-100/70 px-3.5 py-1.5 text-sm font-medium text-emerald-700">
                💸 The average person forgets ~$244 in gift cards
              </div>
              <h1 className="mt-5 text-[clamp(2.4rem,6vw,4.25rem)] font-bold leading-[1.04] tracking-tight text-zinc-900">
                You&rsquo;ve got gift-card money you <span className="text-emerald-600">forgot</span> about.
              </h1>
              <p className="mt-5 max-w-lg text-lg leading-relaxed text-zinc-500 sm:text-xl">
                Connect your email and Stash digs out every gift card hiding in your inbox &mdash; automatically &mdash; so
                you use it before the company keeps it.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="/api/google/start"
                  className="inline-flex h-14 items-center justify-center gap-3 rounded-2xl bg-zinc-900 px-7 text-lg font-semibold text-white shadow-sm transition hover:bg-zinc-800 active:scale-[0.98]"
                >
                  <GoogleIcon /> Connect Gmail
                </a>
                <PlasticScanner
                  emailCodes={[]}
                  onAdd={onAddPhysical}
                  button={(open) => (
                    <button
                      onClick={open}
                      className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-7 text-lg font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 active:scale-[0.98]"
                    >
                      📷 Scan a plastic card
                    </button>
                  )}
                />
              </div>
              {physicalCount > 0 && (
                <button onClick={onOpenWallet} className="mt-5 text-sm font-semibold text-emerald-600 hover:text-emerald-700">
                  💳 {`${physicalCount} scanned ${physicalCount === 1 ? "card" : "cards"} in your wallet`} &rarr; open
                </button>
              )}
              <p className="mt-7 text-sm text-zinc-400">
                Read-only &middot; we only look for gift cards &middot; nothing else is stored
              </p>
            </div>
            <div className="reveal reveal-d1 order-first lg:order-last">
              <PhoneMockup />
            </div>
          </div>
        </section>

        {/* ── Verified stat band ───────────────────────────────────────────── */}
        <section className="border-y border-zinc-200/80 bg-white">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 divide-y divide-zinc-200/80 px-5 py-12 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-8 sm:py-14">
            {[
              { v: "$21B", l: "in gift cards go unredeemed every year" },
              { v: "$244", l: "the average person forgets they have" },
              { v: "43%", l: "of Americans are holding an unused card" },
            ].map((s, i) => (
              <div key={s.v} className={`reveal reveal-d${i} flex flex-col items-center py-6 text-center sm:px-6 sm:py-0`}>
                <span className="font-mono text-[clamp(2.5rem,6vw,4rem)] font-bold leading-none tracking-tight text-emerald-600">
                  {s.v}
                </span>
                <span className="mt-3 max-w-[15rem] text-sm text-zinc-500">{s.l}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Feature grid ─────────────────────────────────────────────────── */}
        <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-20 sm:px-8 sm:py-24">
          <div className="reveal max-w-2xl">
            <Eyebrow>What it does</Eyebrow>
            <h2 className="mt-3 text-[clamp(1.9rem,4vw,2.75rem)] font-bold leading-tight tracking-tight text-zinc-900">
              Everything it takes to get your money back.
            </h2>
            <p className="mt-4 text-lg text-zinc-500">
              Stash doesn&rsquo;t just list cards. It reads your inbox, checks balances, tracks what&rsquo;s spent, and
              warns you before a card expires.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={`reveal reveal-d${i % 3} group rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-emerald-200 hover:shadow-md`}
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-2xl transition group-hover:bg-emerald-100">
                  {f.icon}
                </span>
                <h3 className="mt-4 text-lg font-semibold tracking-tight text-zinc-900">{f.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-zinc-500">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section id="how" className="scroll-mt-20 border-y border-zinc-200/80 bg-white">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
            <div className="reveal max-w-2xl">
              <Eyebrow>How it works</Eyebrow>
              <h2 className="mt-3 text-[clamp(1.9rem,4vw,2.75rem)] font-bold leading-tight tracking-tight text-zinc-900">
                Three steps to money you forgot you had.
              </h2>
            </div>
            <div className="relative mt-12 grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-6">
              {STEPS.map((s, i) => (
                <div key={s.n} className={`reveal reveal-d${i} relative`}>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white shadow-sm shadow-emerald-600/30">
                    {s.n}
                  </div>
                  <h3 className="mt-5 text-xl font-semibold tracking-tight text-zinc-900">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-zinc-500">{s.body}</p>
                  {i < STEPS.length - 1 && (
                    <span className="pointer-events-none absolute right-[-22px] top-6 hidden text-2xl text-emerald-300 md:block" aria-hidden="true">
                      &rarr;
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Villain band ─────────────────────────────────────────────────── */}
        <section id="security" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-20 sm:px-8 sm:py-24">
          <div className="reveal">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">Privacy &amp; security</p>
            <h2 className="mt-4 max-w-2xl text-[clamp(1.9rem,4.5vw,3rem)] font-bold leading-[1.1] tracking-tight text-zinc-900">
              Your inbox stays <span className="text-emerald-600">yours.</span>
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-zinc-500">
              Stash is built to see as little as possible &mdash; and keep none of it. Your cards stay on your device; we
              never store your email.
            </p>
          </div>
          <div className="reveal mt-12 grid gap-5 sm:grid-cols-2">
            {[
              { icon: "🔒", title: "Read-only, always", body: "Google itself enforces it. Stash can read to find your cards, but it can never send, delete, or change a single thing in your inbox." },
              { icon: "🎯", title: "Only gift cards", body: "We search for gift-card emails and nothing else. The rest of your inbox is never opened, never read, never seen." },
              { icon: "📱", title: "Stored on your device", body: "Your cards live in your browser, on your device, not on our servers. We keep no copy and build no profile on you." },
              { icon: "🔐", title: "Encrypted & revocable", body: "Every connection is encrypted in transit (TLS), and you can disconnect or revoke access from your Google account in one tap." },
            ].map((p) => (
              <div key={p.title} className="rounded-2xl border border-zinc-200/80 bg-white p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-xl">{p.icon}</div>
                <h3 className="mt-4 text-lg font-bold text-zinc-900">{p.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-zinc-500">{p.body}</p>
              </div>
            ))}
          </div>
          <p className="reveal mt-6 text-center text-sm text-zinc-400">
            Each scan reads fresh and forgets &middot; nothing is kept &middot; disconnect anytime
          </p>
        </section>

        <Faq />

        <section id="breakage" className="scroll-mt-20 px-5 py-20 sm:px-8 sm:py-24">
          <div className="reveal relative mx-auto w-full max-w-6xl overflow-hidden rounded-[2rem] bg-zinc-900 px-8 py-16 text-center sm:px-12 sm:py-20">
            <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-emerald-500/20 blur-[100px]" aria-hidden="true" />
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">The $21 billion they bank on</p>
            <h2 className="mx-auto mt-4 max-w-3xl text-[clamp(1.9rem,4.5vw,3rem)] font-bold leading-[1.1] tracking-tight text-white">
              Companies call it &ldquo;breakage&rdquo; &mdash; <span className="text-emerald-400">$21 billion a year</span> they
              bank on you forgetting.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-zinc-400">
              Stash takes it back. Read-only access, scoped to gift cards only &mdash; nothing else in your inbox is touched
              or stored.
            </p>
            <a
              href="/api/google/start"
              className="mt-9 inline-flex h-14 items-center justify-center gap-3 rounded-2xl bg-emerald-500 px-8 text-lg font-semibold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 active:scale-[0.98]"
            >
              <GoogleIcon /> Connect Gmail &mdash; it&rsquo;s free
            </a>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-zinc-200/80 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-sm">
            <Wordmark />
            <p className="mt-3 text-sm leading-relaxed text-zinc-500">
              Read-only &middot; we only look for gift cards &middot; nothing else is stored.
            </p>
          </div>
          <a
            href="/api/google/start"
            className="inline-flex h-12 w-fit items-center gap-2.5 rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 active:scale-[0.98]"
          >
            <GoogleIcon /> Connect Gmail
          </a>
        </div>
        <div className="border-t border-zinc-200/80">
          <div className="mx-auto w-full max-w-6xl px-5 py-5 text-xs text-zinc-400 sm:px-8">
            &copy; {new Date().getFullYear()} Stash &middot; Find the gift-card money you forgot about.
          </div>
        </div>
      </footer>
    </div>
  );
}

function Scanning() {
  // Theater only, the real scan is keyword + AI, brand-agnostic and runs independently. A small,
  // curated sample checked off ONE AT A TIME at a calm cadence, so the cycle fills the wait instead
  // of clearing instantly. The "+ hundreds more" chip keeps it honest (not a checklist).
  const BRANDS = [
    { n: "Starbucks", e: "☕" }, { n: "Amazon", e: "📦" }, { n: "Target", e: "🎯" },
    { n: "Apple", e: "🍎" }, { n: "Nike", e: "👟" }, { n: "DoorDash", e: "🚪" },
    { n: "Sephora", e: "💄" }, { n: "Roblox", e: "🎮" }, { n: "Visa", e: "💳" },
  ];
  const STEP_MS = 700; // deliberate one-by-one cadence
  // i counts checks completed (0..BRANDS.length). After the last one we reveal "+ hundreds more".
  const [i, setI] = useState(0);
  // After the set is checked, gently sweep a highlight so a long scan still feels alive (looped, not new chips).
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v >= BRANDS.length ? v : v + 1)), STEP_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const done = i >= BRANDS.length;
  useEffect(() => {
    if (!done) return;
    const t = setInterval(() => setPulse((p) => (p + 1) % BRANDS.length), STEP_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  const current = BRANDS[Math.min(i, BRANDS.length - 1)];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-12">
      <div className="h-16 w-16 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-500" />
      <div className="text-center">
        <p className="text-lg font-semibold text-zinc-900">Reading your inbox&hellip;</p>
        <p className="mt-1 flex h-7 items-center justify-center gap-2 font-mono text-emerald-600">
          {done ? <span>+ hundreds more&hellip;</span> : (<><span>{current.e}</span> {current.n}</>)}
        </p>
      </div>
      <div className="flex max-w-[20rem] flex-wrap justify-center gap-2">
        {BRANDS.map((b, idx) => {
          const checked = idx < i;
          const highlight = done && idx === pulse;
          return (
            <span
              key={b.n}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                highlight
                  ? "bg-emerald-200 text-emerald-800"
                  : checked
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-zinc-100 text-zinc-400"
              }`}
            >
              {b.e} {b.n}
              {checked ? " ✓" : ""}
            </span>
          );
        })}
        {done && (
          <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
            ✨ + hundreds more
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-400">scanning every major brand, Gmail finds them all, not just these</p>
    </div>
  );
}

function Wallet({
  cards,
  stats,
  physical,
  onAddPhysical,
  resolveStatus,
  onResolveCode,
}: {
  cards: Found[];
  stats: Stats | null;
  physical: PhysicalCard[];
  onAddPhysical: (c: PhysicalCard) => void;
  resolveStatus: Record<string, ResolvePhase>;
  onResolveCode: (id: string, cardNumber: string | null, pin: string | null) => void;
}) {
  // localStorage is the final authority on used/available, it overrides server status both ways.
  const [overrides, setOverrides] = useState<Record<string, "used" | "available">>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem("loot_used") ?? "{}");
    } catch {
      return {};
    }
  });
  const markKey = (key: string, used: boolean) =>
    setOverrides((prev) => {
      const next: Record<string, "used" | "available"> = { ...prev, [key]: used ? "used" : "available" };
      try {
        localStorage.setItem("loot_used", JSON.stringify(next));
      } catch {
        /* private mode, session-only */
      }
      return next;
    });
  const mark = (c: Found, used: boolean) => markKey(keyOf(c), used);
  const isUsed = (c: Found) => (overrides[keyOf(c)] ?? (c.status === "likely_used" ? "used" : "available")) === "used";

  // Destructive: wipe every saved card from this device. Two-step so a stray tap can't nuke a wallet,
  // first tap arms the red warning, second tap confirms. Reloads clean to the landing page.
  const [confirmClear, setConfirmClear] = useState(false);
  const clearAll = () => {
    wipeSavedCards();
    window.location.replace("/");
  };
  // Physical cards share the same loot_used override map (key = code || id), so mark-as-used behaves identically.
  const markP = (p: PhysicalCard, used: boolean) => markKey(p.code || p.id, used);
  const isUsedP = (p: PhysicalCard) => (overrides[p.code || p.id] ?? "available") === "used";

  // Manual spend log, same lazy-load pattern as overrides; localStorage is the authority.
  const [spends, setSpends] = useState<Record<string, SpendEntry[]>>(() => {
    if (typeof window === "undefined") return {};
    return loadSpends();
  });
  const saveSpends = (next: Record<string, SpendEntry[]>) => {
    try {
      localStorage.setItem(SPEND_KEY, JSON.stringify(next));
    } catch {
      /* private mode, session-only */
    }
    return next;
  };
  const logSpend = (key: string, amount: number) =>
    setSpends((prev) => saveSpends({ ...prev, [key]: [...(prev[key] ?? []), { amount, at: new Date().toISOString() }] }));
  const removeSpend = (key: string, i: number) =>
    setSpends((prev) => {
      const left = (prev[key] ?? []).filter((_, j) => j !== i);
      const next = { ...prev };
      if (left.length) next[key] = left;
      else delete next[key];
      return saveSpends(next);
    });
  const clearSpends = (key: string) =>
    setSpends((prev) => {
      const next = { ...prev };
      delete next[key];
      return saveSpends(next);
    });

  const spendKey = (c: Found) => spendKeyOf(c.code, c.id);
  const spendKeyP = (p: PhysicalCard) => spendKeyOf(p.code, p.id);
  const spentOf = (key: string) => (spends[key] ?? []).reduce((s, e) => s + e.amount, 0);
  // A card's honest value after the purchases the user logged against it.
  const adjusted = (c: Found) => Math.max(0, worth(c) - spentOf(spendKey(c)));
  const adjustedP = (p: PhysicalCard) => (p.amount === null ? null : Math.max(0, p.amount - spentOf(spendKeyP(p))));
  // Spent down: logged purchases ate the whole balance, reads as used, undone by clearing the log.
  const isSpentDown = (c: Found) => !isUsed(c) && worth(c) > 0 && spentOf(spendKey(c)) > 0 && adjusted(c) === 0;
  const isSpentDownP = (p: PhysicalCard) =>
    !isUsedP(p) && p.amount !== null && p.amount > 0 && spentOf(spendKeyP(p)) > 0 && adjustedP(p) === 0;

  // "Not mine", user-taught pattern hiding. Per-user, on-device; localStorage is the authority.
  const [notMine, setNotMine] = useState<NotMineSig[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem(NOTMINE_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const [showHidden, setShowHidden] = useState(false);
  const saveNotMine = (next: NotMineSig[]) => {
    try {
      localStorage.setItem(NOTMINE_KEY, JSON.stringify(next));
    } catch {
      /* private mode, session-only */
    }
    return next;
  };
  const addNotMine = (c: Found) =>
    setNotMine((prev) => saveNotMine([...prev, { key: keyOf(c), from: c.sig?.from ?? "", sent: c.sig?.sent ?? false, order: c.sig?.order ?? false, at: new Date().toISOString() }]));
  const restoreNotMine = (key: string) => setNotMine((prev) => saveNotMine(prev.filter((l) => l.key !== key)));

  // Hidden cards drop out of EVERYTHING, total, counts, lists, before any other split.
  const visible = cards.filter((c) => !hiddenByNotMine(c, notMine));
  const hidden = cards.filter((c) => hiddenByNotMine(c, notMine));
  const avail = visible.filter((c) => !isUsed(c) && !isSpentDown(c));
  const used = visible.filter(isUsed);
  const spentDown = visible.filter(isSpentDown);
  // An email scan ran iff stats is set (runScan). Physical cards are a SEPARATE view, after an
  // email scan the wallet shows email cards ONLY (never a leftover plastic card), unless the user
  // explicitly opts into the stash view from the mailbox screen.
  const emailScanned = stats !== null;
  const [viewStash, setViewStash] = useState(false);
  const physShown = emailScanned && !viewStash ? [] : physical;
  const physAvail = physShown.filter((p) => !isUsedP(p) && !isSpentDownP(p));
  const physUsed = physShown.filter(isUsedP);
  const physSpentDown = physShown.filter(isSpentDownP);
  const emailCodes = visible.flatMap((c) => (c.code ? [c.code] : []));
  const total = avail.reduce((s, c) => s + adjusted(c), 0) + physAvail.reduce((s, p) => s + (adjustedP(p) ?? 0), 0);
  const usedTotal =
    used.concat(spentDown).reduce((s, c) => s + c.amount, 0) +
    physUsed.concat(physSpentDown).reduce((s, p) => s + (p.amount ?? 0), 0);
  const availCount = avail.length + physAvail.length;
  const found = useCountUp(total, 1200);
  const atRisk = avail.filter((c) => c.expiring);
  const atRiskTotal = atRisk.reduce((s, c) => s + worth(c), 0);

  // ── Status tabs ──────────────────────────────────────────────────────────────
  // Tabs filter the LIST only; the "Still yours" headline + count above always reflect `avail`.
  const [tab, setTab] = useState<"all" | "available" | "expiring" | "used">("all");
  // Cards with a REAL upcoming expiry (≤30d), email + physical, soonest-first.
  const emailExpiring = avail.filter((c) => isExpiringSoon(c.expires));
  const physExpiring = physAvail.filter((p) => isExpiringSoon(p.expires));
  type ExpItem = { k: "email"; c: Found } | { k: "phys"; p: PhysicalCard };
  const expiringList: ExpItem[] = [
    ...emailExpiring.map((c): ExpItem => ({ k: "email", c })),
    ...physExpiring.map((p): ExpItem => ({ k: "phys", p })),
  ].sort((a, b) => expTs(a.k === "email" ? a.c.expires : a.p.expires) - expTs(b.k === "email" ? b.c.expires : b.p.expires));
  // Cards within 7 days drive the on-open browser reminder.
  const soon7 = expiringList.filter((it) => {
    const d = daysUntil(it.k === "email" ? it.c.expires : it.p.expires);
    return d !== null && d <= 7;
  });
  const soon7Total = soon7.reduce((s, it) => s + (it.k === "email" ? worth(it.c) : it.p.amount ?? 0), 0);

  const usedN = used.length + physUsed.length + spentDown.length + physSpentDown.length;
  const showAvailList = tab === "all" || tab === "available";
  const showUsedSection = (tab === "all" || tab === "used") && usedN > 0;
  const TABS: { id: typeof tab; label: string; n: number }[] = [
    { id: "all", label: "All", n: availCount + usedN },
    { id: "available", label: "Available", n: availCount },
    { id: "expiring", label: "Expiring", n: expiringList.length },
    { id: "used", label: "Used", n: usedN },
  ];

  // On-open browser reminder (honest: fires only when Stash is open). Once per session.
  const remindedRef = useRef(false);
  const [notifyOn, setNotifyOn] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof Notification === "undefined") return;
    setNotifyOn(Notification.permission === "granted");
  }, []);
  useEffect(() => {
    if (typeof window === "undefined" || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted" || soon7.length === 0 || remindedRef.current) return;
    let already = false;
    try {
      already = sessionStorage.getItem("loot_notified") === "1";
    } catch {}
    if (already) return;
    remindedRef.current = true;
    try {
      sessionStorage.setItem("loot_notified", "1");
    } catch {}
    const names = soon7.map((it) => (it.k === "email" ? it.c.store : it.p.store));
    const lead = names.slice(0, 2).join(" & ") + (names.length > 2 ? ` +${names.length - 2} more` : "");
    try {
      new Notification(`⏰ Don't lose $${soon7Total.toFixed(0)}`, {
        body: `Expiring within a week: ${lead}. Open Stash to use ${soon7.length > 1 ? "them" : "it"}.`,
      });
    } catch {
      /* notification construction blocked, degrade silently */
    }
  }, [soon7, soon7Total]);

  const [notifyDenied, setNotifyDenied] = useState(false);
  const enableNotify = async () => {
    if (typeof Notification === "undefined") return; // API unavailable → degrade silently
    if (Notification.permission === "granted") {
      setNotifyOn(true);
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        setNotifyOn(true);
        setNotifyDenied(false);
      } else {
        setNotifyDenied(true);
      }
    } catch {
      setNotifyDenied(true);
    }
  };

  const [confetti, setConfetti] = useState(false);
  const [celebrateAmt, setCelebrateAmt] = useState<number | null>(null); // non-motion fallback banner, always lands
  const fired = useRef(false);
  // Cards arrive async after mount (total: 0 → >0), so this effect must catch that transition.
  // Fires exactly once via the ref; the celebrate banner guarantees a payout beat even when
  // confetti is suppressed by prefers-reduced-motion.
  useEffect(() => {
    if (fired.current || total <= 0) return;
    fired.current = true;
    setConfetti(true);
    setCelebrateAmt(total);
  }, [total]);

  // Adding a plastic card is a payout moment too.
  const handleAddPhysical = (c: PhysicalCard) => {
    onAddPhysical(c);
    setConfetti(true);
    setCelebrateAmt((adjustedP(c) ?? c.amount) ?? total);
  };

  // The dedicated "mailbox" result screen: an email scan ran and found no owned cards → show the
  // inbox stats ONLY, never a plastic card (those are a separate wallet view, reached via the link
  // below). Also the resting empty state when nothing has been scanned at all.
  if (cards.length === 0 && !viewStash && (emailScanned || physical.length === 0)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
        <div className="text-5xl">📭</div>
        <p className="mt-4 text-xl font-semibold text-zinc-900">
          {emailScanned ? "No gift cards in your inbox" : "No gift cards yet"}
        </p>
        <p className="mt-2 max-w-xs text-sm text-zinc-500">
          {emailScanned ? (
            <>
              Searched {stats?.matched ?? 0} gift-card emails, read {stats?.candidates ?? 0} with a dollar value. This
              inbox may just not have owned cards, most &ldquo;gift card&rdquo; mail is promos or ones you sent.
              {stats?.partial && <> The scan ran out of time before it finished, so scanning again may find more.</>}
            </>
          ) : (
            <>Connect Gmail and Stash digs out every gift card hiding in your inbox, or scan a plastic card.</>
          )}
        </p>
        <a href="/api/google/start" className="mt-6 text-sm font-semibold text-emerald-600">
          {emailScanned ? "Scan again →" : "Connect Gmail →"}
        </a>
        {physical.length > 0 && (
          <button
            onClick={() => setViewStash(true)}
            className="mt-3 text-sm font-semibold text-zinc-500 transition hover:text-zinc-700"
          >
            💳 View your {physical.length} scanned card{physical.length === 1 ? "" : "s"} →
          </button>
        )}
        <PlasticScanner
          emailCodes={emailCodes}
          onAdd={handleAddPhysical}
          button={(open) => (
            <button onClick={open} className="mt-3 text-sm font-semibold text-zinc-500 transition hover:text-zinc-700">
              📷 or scan a plastic card
            </button>
          )}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col py-10">
      {confetti && <Confetti onDone={() => setConfetti(false)} />}
      {celebrateAmt !== null && celebrateAmt > 0 && (
        <CelebrateBanner amount={celebrateAmt} onDone={() => setCelebrateAmt(null)} />
      )}
      {viewStash && emailScanned && (
        <button
          onClick={() => setViewStash(false)}
          className="mb-3 self-start text-sm font-semibold text-zinc-400 transition hover:text-zinc-600"
        >
          ← back to inbox results
        </button>
      )}
      <p className="text-sm font-medium text-zinc-400">Still yours</p>
      <div className="mt-1 text-6xl font-bold tracking-tight text-emerald-600 tabular-nums">${found.toFixed(2)}</div>
      {availCount > 0 ? (
        <p className="mt-2 text-lg text-zinc-500">
          across <span className="font-semibold text-zinc-900">{availCount} gift card{availCount === 1 ? "" : "s"}</span>{" "}
          {cards.length > 0 ? "hiding in your inbox" : "scanned from plastic"}
        </p>
      ) : (
        <p className="mt-2 text-lg text-zinc-500">every card we found looks spent &mdash; tap one below if not</p>
      )}
      <p className="mt-1.5 text-[11px] text-zinc-400">
        {cards.length > 0
          ? "uses your latest receipt where one exists, every number traced to a real email"
          : "every card scanned from your own plastic, you confirmed the numbers"}
      </p>
      {cards.length > 0 && (
        // Cap-agnostic on purpose: the scan cap may change, state the all-time reach honestly
        // without pinning an exact number that could drift out of sync.
        <p className="mt-1 text-[11px] text-zinc-400">
          🔎 Searched your inbox all-time
          {stats?.matched ? <>, found {stats.matched} gift-card email{stats.matched === 1 ? "" : "s"}</> : null}, up to the
          most recent gift-card emails.
        </p>
      )}
      {cards.length > 0 && stats?.partial && (
        <p className="mt-1 text-[11px] text-amber-600">
          ⏱ This scan ran out of time before finishing, so a few older cards may be missing. Scan again to fill in the rest.
        </p>
      )}

      {cards.length === 0 && (
        <a
          href="/api/google/start"
          className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-700 transition active:scale-[0.98]"
        >
          📧 Now find the ones hiding in your email →
        </a>
      )}

      {atRisk.length > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          ⚠️ ${atRiskTotal.toFixed(0)} expiring within 30 days &mdash; {atRisk.map((c) => c.store).join(" & ")}, use {atRisk.length > 1 ? "them" : "it"} now
        </div>
      )}

      <div className="mt-5 flex gap-1 rounded-full bg-zinc-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex h-9 flex-1 items-center justify-center gap-1 rounded-full px-2 text-[13px] font-semibold transition ${
              tab === t.id ? "bg-emerald-600 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            <span>{t.label}</span>
            <span className={tab === t.id ? "text-emerald-100" : "text-zinc-400"}>{t.n}</span>
          </button>
        ))}
      </div>

      {tab === "expiring" ? (
        <div className="mt-5 flex flex-col gap-3">
          <RemindToggle
            on={notifyOn}
            denied={notifyDenied}
            disabled={soon7.length === 0}
            onEnable={enableNotify}
          />
          {expiringList.length === 0 ? (
            <div className="rounded-2xl border border-zinc-100 bg-white px-4 py-6 text-center shadow-sm">
              <p className="text-base font-semibold text-zinc-900">Nothing expiring soon ✨</p>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">
                Most gift cards don&rsquo;t expire &mdash; companies bet you&rsquo;ll just forget. Stash makes sure you don&rsquo;t.
              </p>
            </div>
          ) : (
            expiringList.map((it) =>
              it.k === "phys" ? (
                <PhysicalCardRow
                  key={it.p.id}
                  card={it.p}
                  onMarkUsed={() => markP(it.p, true)}
                  spends={spends[spendKeyP(it.p)] ?? []}
                  onLogSpend={(amt) => logSpend(spendKeyP(it.p), amt)}
                  onRemoveSpend={(i) => removeSpend(spendKeyP(it.p), i)}
                />
              ) : (
                <CardRow
                  key={it.c.id}
                  card={it.c}
                  resolve={resolveStatus[it.c.id]}
                  onResolveCode={onResolveCode}
                  onMarkUsed={() => mark(it.c, true)}
                  onNotMine={() => addNotMine(it.c)}
                  spends={spends[spendKey(it.c)] ?? []}
                  onLogSpend={(amt) => logSpend(spendKey(it.c), amt)}
                  onRemoveSpend={(i) => removeSpend(spendKey(it.c), i)}
                />
              ),
            )
          )}
        </div>
      ) : (
      <div className="mt-5 flex flex-col gap-3" hidden={!showAvailList}>
        {physAvail.map((p) => (
          <PhysicalCardRow
            key={p.id}
            card={p}
            onMarkUsed={() => markP(p, true)}
            spends={spends[spendKeyP(p)] ?? []}
            onLogSpend={(amt) => logSpend(spendKeyP(p), amt)}
            onRemoveSpend={(i) => removeSpend(spendKeyP(p), i)}
          />
        ))}
        {avail.map((c) => (
          <CardRow
            key={c.id}
            card={c}
            resolve={resolveStatus[c.id]}
            onResolveCode={onResolveCode}
            onMarkUsed={() => mark(c, true)}
            onNotMine={() => addNotMine(c)}
            spends={spends[spendKey(c)] ?? []}
            onLogSpend={(amt) => logSpend(spendKey(c), amt)}
            onRemoveSpend={(i) => removeSpend(spendKey(c), i)}
          />
        ))}
        <PlasticScanner
          emailCodes={emailCodes}
          onAdd={handleAddPhysical}
          button={(open) => (
            <button
              onClick={open}
              className="flex h-14 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 text-sm font-semibold text-zinc-400 transition hover:border-emerald-300 hover:text-emerald-600"
            >
              📷 + Scan a plastic card
            </button>
          )}
        />
      </div>
      )}

      {showUsedSection && (
        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Already used &middot; ${usedTotal.toFixed(2)}</p>
          <div className="mt-3 flex flex-col gap-2">
            {physUsed.map((p) => (
              <UsedRow key={p.id} card={physAsFound(p)} onRestore={() => markP(p, false)} />
            ))}
            {used.map((c) => (
              <UsedRow key={c.id} card={c} onRestore={() => mark(c, false)} />
            ))}
            {physSpentDown.map((p) => (
              <UsedRow key={p.id} card={physAsFound(p)} label="spent down" hint="undo log? tap" onRestore={() => clearSpends(spendKeyP(p))} />
            ))}
            {spentDown.map((c) => (
              <UsedRow key={c.id} card={c} label="spent down" hint="undo log? tap" onRestore={() => clearSpends(spendKey(c))} />
            ))}
          </div>
        </div>
      )}

      {tab === "used" && usedN === 0 && (
        <div className="mt-5 rounded-2xl border border-zinc-100 bg-white px-4 py-6 text-center shadow-sm">
          <p className="text-base font-semibold text-zinc-900">Nothing used yet 🎉</p>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">Cards you spend down or mark as used will collect here.</p>
        </div>
      )}

      {hidden.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowHidden((v) => !v)} className="text-xs font-medium text-zinc-300 transition hover:text-zinc-500">
            {hidden.length} hidden as not yours &middot; {showHidden ? "collapse" : "show"}
          </button>
          {showHidden && (
            <div className="mt-2 flex flex-col gap-1.5">
              {hidden.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2 text-sm">
                  <span className="truncate text-zinc-500">
                    {c.store} &middot; ${c.amount.toFixed(2)}
                  </span>
                  <button onClick={() => restoreNotMine(keyOf(c))} className="shrink-0 text-xs font-semibold text-emerald-600">
                    actually mine, restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-zinc-400">
        {cards.length > 0 ? (
          <>Every value from a real email &middot; &asymp; = your latest receipt &middot; never a fake number</>
        ) : (
          <>Scanned by you &middot; values only when printed on the card &middot; never a fake number</>
        )}
      </p>
      <a href="/api/google/start" className="mt-3 text-center text-xs text-zinc-300 transition hover:text-zinc-500">
        re-scan
      </a>

      {/* Clear all, two-step destructive wipe of every saved card on this device. */}
      <div className="mt-10 border-t border-zinc-100 pt-5">
        {!confirmClear ? (
          <button
            onClick={() => setConfirmClear(true)}
            className="mx-auto flex items-center gap-1.5 text-xs font-medium text-zinc-300 transition hover:text-red-500"
          >
            🗑️ Clear all gift cards
          </button>
        ) : (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5">
            <p className="text-sm font-semibold text-red-700">Delete every saved card?</p>
            <p className="mt-1 text-xs leading-relaxed text-red-600/90">
              This permanently removes all {availCount + usedN} cards, scanned plastic, spend logs, and reminders from this
              device. It can&rsquo;t be undone, inbox cards return only on a fresh Gmail scan.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={clearAll}
                className="flex h-10 flex-1 items-center justify-center rounded-xl bg-red-600 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 active:scale-[0.98]"
              >
                Yes, clear everything
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="flex h-10 flex-1 items-center justify-center rounded-xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-600 transition hover:bg-zinc-50 active:scale-[0.98]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Coerce a physical card into the Found shape so UsedRow renders it unchanged.
function physAsFound(p: PhysicalCard): Found {
  const b = brandFor(p.store);
  return {
    id: p.id,
    store: p.store,
    amount: p.amount ?? 0,
    code: p.code,
    pin: p.pin,
    expires: p.expires,
    date: "scanned card",
    expiring: isExpiringSoon(p.expires),
    emoji: b.emoji,
    color: b.color,
    status: "available",
    evidenceId: null,
    balanceEstimate: null,
    balanceAsOf: null,
    balanceEvidenceId: null,
    redeemUrl: null,
    sig: null,
  };
}

// The realistic digital twin: the card face IS the user's cropped photo, at credit-card
// aspect with a plastic sheen, a first-class sibling of the email-found cards.
// Brand-canonical card art: chip + embossed number + brand layout = reads as a REAL card.
type CardFaceArt = { bg: string; ink: string; sub: string; mark?: ReactNode; motif?: ReactNode; wordCls?: string };
function cardArtFor(store: string | null): CardFaceArt {
  const s = (store ?? "").toLowerCase();
  const W = "rgba(255,255,255,";
  if (s.includes("starbucks"))
    return {
      bg: "radial-gradient(130% 170% at 18% 0%, #0d7a5b 0%, #00704A 48%, #003824 100%)",
      ink: "#fff", sub: `${W}.62)`,
      motif: (
        <div className="absolute right-[7%] top-1/2 flex h-24 w-24 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-white/25 bg-white/10">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-white/30 text-2xl">☕</div>
        </div>
      ),
    };
  if (s.includes("visa"))
    return {
      bg: "linear-gradient(135deg, #11154d 0%, #1a1f71 45%, #2b3aa0 100%)",
      ink: "#fff", sub: `${W}.6)`,
      mark: <span className="text-xl font-black italic tracking-tight text-white">VISA</span>,
    };
  if (s.includes("target"))
    return {
      bg: "linear-gradient(135deg, #b80000 0%, #CC0000 55%, #8f0000 100%)",
      ink: "#fff", sub: `${W}.65)`,
      motif: (
        <div className="absolute right-[8%] top-1/2 flex h-24 w-24 -translate-y-1/2 items-center justify-center rounded-full bg-white">
          <div className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-[#CC0000]">
            <div className="h-6 w-6 rounded-full bg-white" />
          </div>
        </div>
      ),
    };
  if (s.includes("amazon"))
    return {
      bg: "linear-gradient(140deg, #2b3a4a 0%, #232f3e 55%, #131a22 100%)",
      ink: "#fff", sub: `${W}.55)`,
      motif: <div className="absolute bottom-[26%] left-[7%] h-8 w-24 rounded-[50%] border-b-[5px] border-[#FF9900]" />,
      mark: <span className="text-base font-bold lowercase tracking-tight text-white">amazon</span>,
    };
  if (s.includes("nike"))
    return {
      bg: "linear-gradient(135deg, #1c1c1c 0%, #000 60%)",
      ink: "#fff", sub: `${W}.55)`,
      motif: <div className="absolute -right-10 top-[30%] h-40 w-56 -rotate-[18deg] bg-white/[0.07]" />,
      mark: <span className="text-xl font-black italic uppercase tracking-tighter text-white">Nike</span>,
      wordCls: "italic uppercase tracking-tight",
    };
  if (s.includes("apple") || s.includes("itunes"))
    return {
      bg: "linear-gradient(135deg, #f7f7f9 0%, #e4e4e9 55%, #cfcfd6 100%)",
      ink: "#111", sub: "rgba(0,0,0,.45)",
      motif: <div className="absolute right-[10%] top-1/2 -translate-y-1/2 text-6xl text-black/80"></div>,
    };
  if (s.includes("sephora"))
    return {
      bg: "#0a0a0a",
      ink: "#fff", sub: `${W}.55)`,
      motif: (
        <div
          className="absolute inset-y-0 right-0 w-[34%] opacity-90"
          style={{ background: "repeating-linear-gradient(90deg, #fff 0 7px, #0a0a0a 7px 22px)" }}
        />
      ),
      wordCls: "uppercase tracking-[0.22em]",
    };
  if (s.includes("walmart"))
    return {
      bg: "linear-gradient(135deg, #0a63b8 0%, #0071CE 55%, #005099 100%)",
      ink: "#fff", sub: `${W}.65)`,
      motif: <div className="absolute right-[9%] top-1/2 -translate-y-1/2 text-6xl text-[#FFC220]">✱</div>,
    };
  if (s.includes("spotify"))
    return {
      bg: "linear-gradient(140deg, #1e1e1e 0%, #121212 60%)",
      ink: "#fff", sub: `${W}.55)`,
      motif: <div className="absolute right-[9%] top-1/2 flex h-20 w-20 -translate-y-1/2 items-center justify-center rounded-full bg-[#1DB954] text-3xl text-black">≋</div>,
    };
  if (s.includes("roblox"))
    return {
      bg: "linear-gradient(135deg, #2a2a2e 0%, #17171a 60%)",
      ink: "#fff", sub: `${W}.55)`,
      motif: <div className="absolute right-[10%] top-1/2 h-16 w-16 -translate-y-1/2 rotate-12 rounded-lg border-[5px] border-white/70" />,
      wordCls: "uppercase tracking-tight font-black",
    };
  if (s.includes("chipotle"))
    return {
      bg: "linear-gradient(135deg, #5a1b0a 0%, #451400 60%)",
      ink: "#fff", sub: `${W}.55)`,
      motif: <div className="absolute right-[9%] top-1/2 -translate-y-1/2 text-6xl opacity-70">🌶️</div>,
    };
  const b = brandFor(store);
  return {
    bg: `linear-gradient(135deg, ${b.color} 0%, ${b.color} 45%, rgba(0,0,0,.55) 170%)`,
    ink: "#fff", sub: `${W}.6)`,
    motif: <div className="absolute right-[9%] top-1/2 -translate-y-1/2 text-6xl opacity-25">{b.emoji}</div>,
  };
}

// Scannable Code 128 of the card number, rendered as a real gift-card barcode strip.
// digitsOnly: card numbers scan as plain digits (Code C), strip spaces/dashes first.
// The encoder returns null for empty/unencodable values, so nothing renders for codeless cards.
function Barcode128({
  value,
  digitsOnly = true,
  height = 46,
  moduleWidth = 1.6,
  showHuman = true,
  className = "",
}: {
  value: string;
  digitsOnly?: boolean;
  height?: number;
  moduleWidth?: number;
  showHuman?: boolean;
  className?: string;
}) {
  const encoded = digitsOnly ? value.replace(/[^0-9]/g, "") : value.replace(/\s+/g, "");
  const svg = code128Svg(encoded, { height, moduleWidth, quietModules: 8 });
  if (!svg) return null;
  // Group the readable number in 4s so it reads like a card, not a wall of digits.
  const human = digitsOnly ? encoded.replace(/(.{4})/g, "$1 ").trim() : encoded;
  return (
    <div className={`rounded-md bg-white px-2.5 pb-1 pt-1.5 ${className}`}>
      <div
        className="w-full"
        style={{ height }}
        // SVG markup is built by our own encoder from the card number, no external/user HTML.
        dangerouslySetInnerHTML={{ __html: svg.replace("<svg", '<svg style="width:100%;height:100%;display:block"') }}
      />
      {showHuman && (
        <p className="mt-0.5 text-center font-mono text-[10px] leading-tight tracking-[0.18em] text-zinc-700">{human}</p>
      )}
    </div>
  );
}

function MockCardFace({ card }: { card: PhysicalCard }) {
  const art = cardArtFor(card.store);
  const last4 = card.code ? card.code.slice(-4) : null;
  const barcodeValue = card.code?.replace(/[^0-9]/g, "") ?? "";
  const hasBarcode = barcodeValue.length >= 4;
  return (
    <div className="absolute inset-0" style={{ background: art.bg }}>
      {art.motif}
      <div className="absolute inset-x-4 top-3.5">
        <p className={`truncate pr-16 text-lg font-bold drop-shadow-sm ${art.wordCls ?? ""}`} style={{ color: art.ink }}>
          {card.store}
        </p>
        <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.22em]" style={{ color: art.sub }}>
          Gift card
        </p>
      </div>
      {/* chip */}
      <div
        className="absolute left-4 top-[38%] h-7 w-10 rounded-md border border-black/20"
        style={{ background: "linear-gradient(135deg, #f3d27e 0%, #d4ab52 55%, #b9913e 100%)" }}
      >
        <div className="absolute inset-x-1 top-[9px] h-px bg-black/25" />
        <div className="absolute inset-x-1 top-[17px] h-px bg-black/25" />
        <div className="absolute inset-y-1 left-[13px] w-px bg-black/25" />
        <div className="absolute inset-y-1 right-[13px] w-px bg-black/25" />
      </div>
      {/* embossed number */}
      <p
        className={`absolute left-4 font-mono text-[15px] font-semibold tracking-[0.14em] ${hasBarcode ? "top-[40%]" : "top-[60%]"}`}
        style={{ color: art.ink, textShadow: "0 1px 0 rgba(255,255,255,.22), 0 -1px 1px rgba(0,0,0,.5)" }}
      >
        ••••&ensp;••••&ensp;••••&ensp;{last4 ?? "••••"}
      </p>
      {/* amount + brand mark: sits above the barcode strip when one is present */}
      <div className={`absolute inset-x-4 flex items-end justify-between gap-3 ${hasBarcode ? "bottom-[3.6rem]" : "bottom-2.5"}`}>
        {card.amount !== null ? (
          <p className="text-lg font-bold tabular-nums" style={{ color: art.ink }}>
            ${card.amount.toFixed(2)}
          </p>
        ) : (
          <p className="text-[11px] font-medium" style={{ color: art.sub }}>
            value not printed
          </p>
        )}
        <div className="shrink-0">{art.mark ?? null}</div>
      </div>
      {/* real gift-card barcode: white strip across the bottom, scannable Code 128 of the card number */}
      {hasBarcode && (
        <div className="absolute inset-x-2.5 bottom-1.5">
          <Barcode128 value={barcodeValue} height={30} moduleWidth={1.4} className="shadow-sm" />
          <p className="mt-0.5 text-center text-[8px] font-medium" style={{ color: art.sub }}>
            scan at checkout where supported
          </p>
        </div>
      )}
    </div>
  );
}

// Merchants with a card+PIN balance adapter (drives a public form on localhost). Starbucks only
// today, Nike/others are future adapters. Gates the ⚡ button so we never offer what can't run.
const physAdapterFor = (store: string | null) => (/starbucks/i.test(store ?? "") ? "starbucks" : null);

type PhysAgentState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "done"; amount: string | null; store: string }
  | { phase: "fail"; reason: string };

// Localhost-only live balance for a SCANNED physical card: POST {merchant, code, pin} → the route
// drives the merchant's public balance form headless. Mirrors the email BalanceAgent's states.
// onAmount lifts an agent-fetched balance up so the card can show it (clearly labeled, never silent).
function PhysicalBalanceAgent({
  store,
  code,
  pin,
  onAmount,
}: {
  store: string;
  code: string;
  pin: string;
  onAmount?: (amount: number, store: string) => void;
}) {
  const [state, setState] = useState<PhysAgentState>({ phase: "idle" });

  const run = async () => {
    setState({ phase: "checking" });
    try {
      const r = await fetch("/api/check-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: store, code, pin }),
      });
      if (r.status === 501) {
        setState({ phase: "idle" }); // production no-op, shouldn't hit on localhost; hide gracefully
        return;
      }
      const d = await r.json();
      if (d.ok) {
        setState({ phase: "done", amount: d.amount ?? null, store: d.store ?? store });
        const n = d.amount != null ? Number.parseFloat(d.amount) : NaN;
        if (Number.isFinite(n) && onAmount) onAmount(n, d.store ?? store);
      } else {
        setState({ phase: "fail", reason: d.reason ?? "failed" });
      }
    } catch {
      setState({ phase: "fail", reason: "network" });
    }
  };

  if (state.phase === "checking") {
    return (
      <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm">
        <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-500" />
        <span className="font-medium text-emerald-700">checking… <span className="font-normal text-emerald-600/80">the agent is opening Starbucks</span></span>
      </div>
    );
  }

  if (state.phase === "done") {
    const amt = state.amount ? `≈ $${Number.parseFloat(state.amount).toFixed(2)}` : "balance found";
    return (
      <div className="mt-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm">
        <p className="font-semibold text-emerald-700">✓ Agent checked {state.store}, {amt}</p>
        <p className="mt-0.5 text-[11px] font-medium text-emerald-600/70">live from the merchant balance page · just now</p>
      </div>
    );
  }

  if (state.phase === "fail") {
    const msg =
      state.reason === "invalid_card"
        ? "Couldn't auto-check, the card number / security code wasn't accepted"
        : state.reason === "merchant_not_supported"
          ? "Couldn't auto-check, merchant not supported yet"
          : state.reason === "timeout"
            ? "Couldn't auto-check, the merchant page timed out"
            : "Couldn't auto-check this one";
    return <p className="mt-2 px-1 text-[13px] font-medium text-zinc-400">{msg}</p>;
  }

  return (
    <button
      onClick={run}
      className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 active:scale-[0.98]"
    >
      ⚡ Check balance now
    </button>
  );
}

function PhysicalCardRow({
  card,
  onMarkUsed,
  spends,
  onLogSpend,
  onRemoveSpend,
}: {
  card: PhysicalCard;
  onMarkUsed: () => void;
  spends: SpendEntry[];
  onLogSpend: (amount: number) => void;
  onRemoveSpend: (i: number) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false); // designed card face by default; original photo on tap
  const [agentAmount, setAgentAmount] = useState<number | null>(null); // agent-fetched balance (clearly labeled below)
  const action = merchantAction(card.store, card.code);
  const brand = brandFor(card.store);
  const spent = spends.reduce((s, e) => s + e.amount, 0);
  // ⚡ live-check is offered only on localhost, for a card that has BOTH its code AND security code
  // (PIN), AND whose store has an adapter. A physical card can't be checked without its security code.
  const canLiveCheck = isLocalhost() && !!card.code && !!card.pin && physAdapterFor(card.store) !== null;
  const needsPinForCheck = isLocalhost() && !!card.code && !card.pin && physAdapterFor(card.store) !== null;

  const useIt = async () => {
    if (card.code) {
      try {
        await navigator.clipboard.writeText(card.pin ? `${card.code}  (PIN ${card.pin})` : card.code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        /* clipboard blocked, page still opens */
      }
    }
    window.open(action.url, "_blank", "noopener");
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-100 bg-white shadow-sm">
      <div
        className="relative w-full"
        style={{
          aspectRatio: CARD_AR,
          backgroundColor: brand.color,
          ...(showPhoto && card.croppedFace
            ? { backgroundImage: `url(${card.croppedFace})`, backgroundSize: "cover", backgroundPosition: "center" }
            : {}),
        }}
      >
        {!showPhoto && <MockCardFace card={card} />}
        {showPhoto && (
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/65 via-black/25 to-transparent px-3.5 pb-2.5 pt-10">
            <p className="min-w-0 truncate text-base font-bold text-white">{card.store}</p>
            {card.amount !== null ? (
              <p className="shrink-0 text-lg font-bold tabular-nums text-white">${card.amount.toFixed(2)}</p>
            ) : (
              <p className="shrink-0 text-[11px] font-medium text-white/80">value not printed</p>
            )}
          </div>
        )}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(115deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.07) 26%, rgba(255,255,255,0) 42%, rgba(255,255,255,0) 68%, rgba(255,255,255,0.14) 100%)",
          }}
        />
        {card.croppedFace ? (
          <button
            onClick={() => setShowPhoto((v) => !v)}
            className="absolute right-2.5 top-2.5 z-10 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white transition active:scale-95"
          >
            {showPhoto ? "💳 card" : "📷 photo"}
          </button>
        ) : (
          <span className="absolute right-2.5 top-2.5 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white">📷 scanned</span>
        )}
      </div>

      <div className="p-3">
        {daysUntil(card.expires) !== null && (
          <div className="mb-2">
            <ExpiryBadge expires={card.expires} />
          </div>
        )}
        {spent > 0 &&
          (card.amount !== null ? (
            <p className="mb-2 text-sm font-bold tabular-nums text-emerald-600">
              ${Math.max(0, card.amount - spent).toFixed(2)} left{" "}
              <span className="text-[11px] font-medium text-zinc-400">after ${spent.toFixed(2)} you logged</span>
            </p>
          ) : (
            // No printed value → never invent a balance; just show what's been logged.
            <p className="mb-2">
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-500">
                −${spent.toFixed(2)} spent
              </span>
            </p>
          ))}
        {(card.code || card.pin) && (
          <button
            onClick={() => setRevealed((v) => !v)}
            className="flex w-full items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-left text-sm transition hover:bg-zinc-100"
          >
            {revealed ? (
              <span className="truncate font-mono text-zinc-900">
                {card.code}
                {card.pin ? ` · PIN ${card.pin}` : ""}
              </span>
            ) : (
              <span className="font-medium text-emerald-600">🎟️ Reveal code</span>
            )}
            <span className="text-zinc-400">{revealed ? "hide" : "tap"}</span>
          </button>
        )}
        {/* Agent-fetched balance (clearly labeled as live, never silently treated as a printed value). */}
        {agentAmount !== null && (
          <p className="mt-2 text-sm font-bold tabular-nums text-emerald-600">
            ${agentAmount.toFixed(2)} <span className="text-[11px] font-medium text-zinc-400">agent-checked balance · live</span>
          </p>
        )}
        {/* Localhost-only live balance via the merchant form. Requires code + security code + adapter. */}
        {canLiveCheck && card.code && card.pin && (
          <PhysicalBalanceAgent store={card.store} code={card.code} pin={card.pin} onAmount={(n) => setAgentAmount(n)} />
        )}
        {needsPinForCheck && (
          <p className="mt-2 px-1 text-[11px] font-medium text-zinc-400">scan the back for the security code to auto-check the balance</p>
        )}
        <button
          onClick={useIt}
          className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 text-sm font-semibold text-white transition active:scale-[0.98]"
        >
          {copied ? "Code copied ✓, opening…" : `${action.label} →`}
        </button>
        <SpendFooter spends={spends} onLog={onLogSpend} onRemove={onRemoveSpend} onMarkUsed={onMarkUsed} />
      </div>
    </div>
  );
}

// Specific retake guidance per image-quality issue reported by the vision read.
const ISSUE_MSG: Record<string, string> = {
  glare: "Too much light, a reflection is washing out the text. Tilt the card away from the light and retake.",
  blur: "That shot's blurry, hold steady (tap to focus on phones) and retake.",
  too_dark: "Too dark to read, find more light, then retake.",
  too_far: "The card's too small in the frame, get closer so it fills the shot.",
  partial: "Part of the card is cut off, fit the whole card in the frame.",
  not_gift_card: "That reads like a different kind of card, not a gift card.",
};

// Photograph → downscale → Haiku vision → user confirms/corrects every field → wallet.
// The confirm step is the OCR honesty gate: nothing enters the wallet unreviewed.
function PlasticScanner({
  emailCodes,
  onAdd,
  button,
}: {
  emailCodes: string[];
  onAdd: (c: PhysicalCard) => void;
  button: (open: () => void) => ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"camera" | "reading" | "backprompt" | "confirm" | "miss" | "dupe">("reading");
  const [missMsg, setMissMsg] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [store, setStore] = useState("");
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [expires, setExpires] = useState(""); // optional, most cards don't print one
  const [confidence, setConfidence] = useState<"high" | "medium" | "low">("medium");
  const [issue, setIssue] = useState<string | null>(null);
  // Per-field trust. One overall "how sure am I" makes the confirm screen hedge about the whole
  // card; this points at the ONE box worth double checking. A barcode read is exact, so it is
  // never flagged here no matter what the reader thought.
  const [shaky, setShaky] = useState<Record<string, boolean>>({});
  // True when the card reader could not be reached and the on-device barcode carried the scan.
  const [readerDown, setReaderDown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shots, setShots] = useState<string[]>([]); // [front] or [front, back], front is always the card face
  const [barcode, setBarcode] = useState<string | null>(null); // exact code read off a barcode/QR in any shot
  const pickTarget = useRef<"front" | "back">("front");
  // ── Auto-capture (check-deposit style): the loop snaps a good frame by itself ──────────────
  const [scanHint, setScanHint] = useState<"looking" | "steady" | "got">("looking"); // live status copy
  const capturedRef = useRef(false); // fires exactly once per camera session
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickCanvasRef = useRef<HTMLCanvasElement | null>(null); // reused ~480px offscreen canvas for tick checks
  const goodTicksRef = useRef(0); // consecutive good-frame ticks (stability gate for the heuristic path)
  const camStartRef = useRef(0); // ms timestamp the camera stream attached, drives the warmup grace window

  // Desktop (fine pointer) gets an in-page live camera; phones keep the native camera sheet.
  const start = (target: "front" | "back") => {
    pickTarget.current = target;
    const inPageCamera =
      typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && !matchMedia("(pointer: coarse)").matches;
    if (inPageCamera) {
      setOpen(true);
      setPhase("camera");
    } else {
      fileRef.current?.click();
    }
  };
  const pick = () => start("front");
  const pickBack = () => start("back");

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const close = () => {
    stopLoop();
    stopStream();
    capturedRef.current = false;
    goodTicksRef.current = 0;
    setOpen(false);
    setPreview(null);
    setShots([]);
    setStore("");
    setAmount("");
    setCode("");
    setPin("");
    setExpires("");
    setBarcode(null);
  };

  useEffect(() => {
    if (phase !== "camera" || !open) return;
    let cancelled = false;
    // Fresh camera session: re-arm the once-guard, reset stability + hint, mark warmup start.
    capturedRef.current = false;
    goodTicksRef.current = 0;
    setScanHint("looking");
    camStartRef.current = Date.now();
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        camStartRef.current = Date.now(); // start warmup from when frames actually begin
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        setMissMsg("Camera blocked, allow camera access, or attach a photo instead.");
        setPhase("miss");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, open]);

  // AUTO-CAPTURE LOOP, only runs in the live camera phase. Every ~450ms it grabs the CURRENT
  // frame to a SMALL ~480px offscreen canvas (never full-res, that would jank the preview) and
  // checks two signals against the WARM, ready video:
  //   1) Barcode (primary): decodeCardBarcode on the small frame → a readable code means the card
  //      is well-framed AND the number is captured perfectly → fire immediately.
  //   2) Good-frame heuristic (secondary, for a barcode-free front): brightness in a sane mid band
  //      + focus score over threshold, held for 2 consecutive ticks → fire.
  // Guards: ~600ms warmup grace (autofocus), capturedRef makes it fire-once, interval cleared on
  // capture/unmount/phase-change. Skips the tick if the video isn't ready yet.
  useEffect(() => {
    if (phase !== "camera" || !open) return;
    const TICK_MS = 450;
    const WARMUP_MS = 600;
    const TICK_W = 480;
    const MIN_BRIGHT = 55; // too dark below this
    const MAX_BRIGHT = 232; // blown out above this
    const SHARP_MIN = 950; // focus floor (validated: blurry frames sit near 0, in-focus text/edges >>this)
    const STABLE_TICKS = 2; // heuristic must hold this many ticks so it can't fire mid-motion

    const id = setInterval(() => {
      void (async () => {
        if (capturedRef.current) return;
        const v = videoRef.current;
        if (!v || !v.videoWidth || v.readyState < 2) return; // not ready → skip tick
        if (Date.now() - camStartRef.current < WARMUP_MS) return; // let autofocus settle

        const cw = TICK_W;
        const ch = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * cw));
        const canvas = (tickCanvasRef.current ??= document.createElement("canvas"));
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, cw, ch);

        // Heuristic signals off the small frame's grayscale.
        const { data } = ctx.getImageData(0, 0, cw, ch);
        const gray = new Uint8ClampedArray(cw * ch);
        for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
          gray[i] = (data[p] * 306 + data[p + 1] * 601 + data[p + 2] * 117) >> 10;
        }
        const { brightness, sharpness } = frameQuality(gray, cw, ch);

        // 1) Barcode signal, strongest. A decode means readable + framed → snap now.
        const code = await decodeCardBarcode(canvas.toDataURL("image/jpeg", 0.7));
        if (capturedRef.current) return; // a concurrent tick / manual tap won
        if (code) {
          capture();
          return;
        }

        // 2) Good-frame heuristic with a 2-tick stability gate.
        const good = brightness >= MIN_BRIGHT && brightness <= MAX_BRIGHT && sharpness >= SHARP_MIN;
        goodTicksRef.current = good ? goodTicksRef.current + 1 : 0;
        if (goodTicksRef.current === 1) setScanHint("steady"); // near-good → "Hold steady…"
        else if (goodTicksRef.current === 0) setScanHint("looking");
        if (goodTicksRef.current >= STABLE_TICKS) capture();
      })();
    }, TICK_MS);
    loopRef.current = id;
    return () => {
      clearInterval(id);
      if (loopRef.current === id) loopRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, open]);

  // Hard stop on true unmount: kill any live loop + camera stream so nothing leaks if the
  // whole scanner is torn down while the camera is open (the phase/open effects cover the rest).
  useEffect(
    () => () => {
      stopLoop();
      stopStream();
    },
    [],
  );

  const stopLoop = () => {
    if (loopRef.current) clearInterval(loopRef.current);
    loopRef.current = null;
  };

  // The single capture path, manual button AND auto-capture both call this. Grabs the FULL-RES
  // frame, downscales to ≤2200px JPEG 0.92 (higher res/quality so the model reads small/embossed
  // text, same target as the file path), stops the stream + loop, hands the frame to processShot
  // (which runs its own barcode decode). capturedRef makes it idempotent so the two never double-fire.
  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth || capturedRef.current) return;
    capturedRef.current = true;
    stopLoop();
    setScanHint("got"); // brief "✓ Got it!" flash before the reading panel takes over
    const scale = Math.min(1, 2200 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    stopStream();
    void processShot(c.toDataURL("image/jpeg", 0.92));
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setOpen(true);
    setPhase("reading");
    let dataUrl: string;
    try {
      dataUrl = await fileToDownscaledJpeg(file);
    } catch {
      setMissMsg("Couldn't read that photo, try taking it again.");
      setPhase("miss");
      return;
    }
    await processShot(dataUrl);
  }

  // Shared by the file path and the live-camera shutter, dataUrl is already downscaled JPEG.
  // Reader card shape, kept local so a reader outage is a typed null rather than a thrown scan.
  type ReaderCard = {
    isGiftCard: boolean;
    store: string | null;
    amount: number | null;
    code: string | null;
    pin: string | null;
    confidence?: "high" | "medium" | "low";
    issue?: string | null;
  };

  // Call the card reader, with ONE retry on a server-side failure. Returns null when it cannot be
  // reached at all, so the caller can fall back to the barcode instead of throwing the scan away.
  // A 4xx means the request itself was wrong (image too big, wrong type) and retrying cannot help.
  async function callReader(images: string[]): Promise<ReaderCard | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch("/api/scan-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images }),
        });
        if (r.ok) return (await r.json()) as ReaderCard;
        if (r.status < 500) return null;
      } catch {
        /* network blip, fall through to the retry */
      }
      if (attempt === 0) await new Promise((res) => setTimeout(res, 700));
    }
    return null;
  }

  async function processShot(dataUrl: string) {
    const target = pickTarget.current;
    setPhase("reading");
    const nextShots = target === "back" && shots.length ? [shots[0], dataUrl] : [dataUrl];
    setShots(nextShots);
    setPreview(nextShots[0]);

    // THE BARCODE IS READ ON THIS DEVICE: free, offline, no key, and exact when it hits.
    // It is awaited OUTSIDE the reader call on purpose. The old code awaited it inside the try,
    // so any reader failure jumped to the catch and DISCARDED a perfect card number, showing
    // "couldn't reach the card reader" for a scan that never needed the reader at all.
    const decodedRaw = await decodeCardBarcode(dataUrl);
    const decoded = decodedRaw ?? (nextShots.length > 1 ? barcode : null);
    setBarcode(decoded);

    const card = await callReader(nextShots);
    const down = card === null;
    setReaderDown(down);

    // A miss ONLY when neither source gave us anything usable.
    if (!decoded && !card?.code && !card?.store) {
      const why = card?.issue ? ISSUE_MSG[card.issue] : undefined;
      setMissMsg(
        down
          ? "Couldn't read the card details, and there was no barcode to fall back on. Try again, or type the card in by hand."
          : (why ??
            (nextShots.length > 1
              ? "Still couldn't read it across both shots, retake with less glare."
              : "Couldn't read a gift card in that shot, try a flatter, brighter photo.")),
      );
      setPhase("miss");
      return;
    }

    setStore(card?.store ?? "");
    setAmount(typeof card?.amount === "number" ? String(card.amount) : "");
    setCode(decoded ?? card?.code ?? ""); // barcode is exact, it wins over the read
    setPin(card?.pin ?? "");
    setConfidence(down ? "low" : card?.confidence ?? "medium");
    setIssue(card?.issue ?? null);

    // Flag ONLY fields that actually hold a value AND came from a source we do not fully trust.
    // A barcode-read number is exact, so it is never flagged even when everything else is shaky.
    const eyeShaky = down || card?.confidence === "low" || Boolean(card?.issue);
    setShaky({
      code: !decoded && eyeShaky && Boolean(card?.code),
      pin: eyeShaky && Boolean(card?.pin),
      store: eyeShaky && Boolean(card?.store),
      amount: eyeShaky && typeof card?.amount === "number",
    });

    // With the reader down there is no second side worth shooting: it can only read a barcode,
    // and we already have that. Go straight to confirm so the person can fill in the rest.
    setPhase(down || nextShots.length > 1 ? "confirm" : "backprompt");
  }

  async function addToWallet() {
    if (saving) return;
    const cleanCode = code.replace(/[\s-]/g, "") || null;
    if (cleanCode && emailCodes.some((k) => normCode(k) === normCode(cleanCode))) {
      setPhase("dupe");
      return;
    }
    setSaving(true);
    const parsed = amount.trim() === "" ? NaN : Number.parseFloat(amount.replace(/[$,\s]/g, ""));
    const face = preview ? await cropToCardFace(preview) : null;
    onAdd({
      id: `phys_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      store: store.trim() || "Gift card",
      amount: Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null,
      code: cleanCode,
      pin: pin.trim() || null,
      expires: expires.trim() || null,
      croppedFace: face,
      addedAt: new Date().toISOString(),
    });
    setSaving(false);
    close();
  }

  const inputCls =
    "mt-1 h-12 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-base text-zinc-900 outline-none transition focus:border-emerald-400";
  // A flagged box is amber, so the eye lands on the ONE value worth re-reading off the card
  // instead of the person having to re-check all five.
  const fieldCls = (k: string) =>
    shaky[k] ? `${inputCls} border-amber-400 bg-amber-50 focus:border-amber-500` : inputCls;
  const CheckThis = ({ k }: { k: string }) =>
    shaky[k] ? (
      <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
        check this one
      </span>
    ) : null;

  return (
    <>
      {button(pick)}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
          <div className="max-h-[92dvh] w-full max-w-[440px] overflow-y-auto rounded-t-3xl bg-white px-5 pb-8 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-base font-bold text-zinc-900">📷 Scan a plastic card</p>
              <button onClick={close} className="rounded-full px-2 py-1 text-sm text-zinc-400 transition hover:text-zinc-600">
                ✕
              </button>
            </div>

            <div
              className="relative mt-3 w-full overflow-hidden rounded-2xl bg-zinc-100"
              style={{
                aspectRatio: CARD_AR,
                ...(preview ? { backgroundImage: `url(${preview})`, backgroundSize: "cover", backgroundPosition: "center" } : {}),
              }}
            >
              {phase === "camera" && (
                <>
                  <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />
                  {/* Calm auto-capture overlay: corner frame + a thin moving scan line. */}
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute inset-4 rounded-xl border-2 border-white/70 shadow-[0_0_0_100vmax_rgba(0,0,0,0.12)]" />
                    {scanHint !== "got" && (
                      <div className="absolute inset-x-6 top-1/2 h-0.5 animate-pulse rounded-full bg-emerald-400/80" />
                    )}
                    <div
                      className={`absolute inset-x-0 bottom-2 text-center text-xs font-semibold drop-shadow ${
                        scanHint === "got" ? "text-emerald-300" : scanHint === "steady" ? "text-white" : "text-white/80"
                      }`}
                    >
                      {scanHint === "got" ? "✓ Got it!" : scanHint === "steady" ? "Hold steady…" : "Looking for your card…"}
                    </div>
                  </div>
                </>
              )}
              {phase === "reading" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/60">
                  <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-emerald-100 border-t-emerald-500" />
                  <p className="text-sm font-semibold text-zinc-700">Reading card…</p>
                </div>
              )}
            </div>

            {phase === "camera" && (
              <div className="mt-4 flex flex-col items-center gap-2">
                <p className="text-xs text-zinc-400">
                  {pickTarget.current === "back" ? "Now the BACK of the card, fill the frame" : "Fill the frame with the card, it snaps itself"}
                </p>
                <button
                  onClick={capture}
                  className="flex h-12 w-full items-center justify-center rounded-xl bg-zinc-900 text-base font-semibold text-white transition active:scale-[0.98]"
                >
                  📸 Capture
                </button>
                <p className="text-center text-[11px] text-zinc-400">auto-captures when the image is clear, or tap Capture</p>
                <button onClick={() => fileRef.current?.click()} className="text-xs text-zinc-400 transition hover:text-zinc-600">
                  attach a photo instead
                </button>
              </div>
            )}

            {phase === "backprompt" && (
              <div className="mt-4 flex flex-col gap-2">
                <p className="text-center text-sm font-medium text-zinc-700">Got the front ✓, now the back</p>
                <p className="text-center text-xs text-zinc-400">PINs and security codes usually live on the back</p>
                <button
                  onClick={pickBack}
                  className="mt-1 flex h-12 w-full items-center justify-center rounded-xl bg-zinc-900 text-base font-semibold text-white transition active:scale-[0.98]"
                >
                  📸 Scan the back
                </button>
                <button onClick={() => setPhase("confirm")} className="text-center text-xs text-zinc-400 transition hover:text-zinc-600">
                  skip, everything's on one side
                </button>
              </div>
            )}

            {phase === "confirm" && (
              <div className="mt-4 flex flex-col gap-3">
                {readerDown && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-relaxed text-amber-800">
                    <span className="font-semibold">Read the number straight off the barcode.</span> The part that reads
                    the store name and value was unreachable, so fill those in yourself below.
                  </div>
                )}
                <p className="text-xs text-zinc-400">
                  {Object.values(shaky).some(Boolean)
                    ? "The amber boxes are the ones it was unsure about. Check those against the real card."
                    : confidence === "low"
                      ? `${issue && ISSUE_MSG[issue] ? ISSUE_MSG[issue].split(",")[0].trim() + ", " : ""}fix anything wrong below, or retake.`
                      : "Check every digit against the real card, cameras can misread."}
                </p>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Store</span><CheckThis k="store" />
                  <input value={store} onChange={(e) => setStore(e.target.value)} placeholder="e.g. Starbucks" className={fieldCls("store")} />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Card number</span><CheckThis k="code" />
                  {barcode && normCode(code) === normCode(barcode) && (
                    <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      ‖ read from barcode ✓
                    </span>
                  )}
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="long number on the back"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    className={`${fieldCls("code")} font-mono`}
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Amount (if printed)</span><CheckThis k="amount" />
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode="decimal"
                      placeholder="blank = unknown"
                      className={fieldCls("amount")}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">PIN</span><CheckThis k="pin" />
                    <input
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="if visible"
                      className={`${fieldCls("pin")} font-mono`}
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Expires (only if printed)</span>
                  <input
                    type="date"
                    value={expires}
                    onChange={(e) => setExpires(e.target.value)}
                    className={inputCls}
                  />
                </label>
                {shots.length < 2 && (!code.trim() || !pin.trim()) && (
                  <button
                    onClick={pickBack}
                    className="flex h-11 w-full items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50 text-sm font-semibold text-emerald-700 transition active:scale-[0.98]"
                  >
                    📷 {!code.trim() ? "Number" : "PIN"} might be on the back, scan the back side
                  </button>
                )}
                <button
                  onClick={addToWallet}
                  disabled={(!store.trim() && !code.trim()) || saving}
                  className="mt-1 flex h-12 w-full items-center justify-center rounded-xl bg-zinc-900 text-base font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
                >
                  {saving ? "Adding…" : "Add to wallet"}
                </button>
                <button onClick={pick} className="text-center text-xs font-medium text-zinc-400 transition hover:text-zinc-600">
                  retake photo
                </button>
              </div>
            )}

            {phase === "miss" && (
              <div className="mt-5 text-center">
                <p className="text-sm font-medium text-zinc-700">🙈 {missMsg}</p>
                <p className="mt-1 text-xs text-zinc-400">flat surface, bright light, fill the frame with the card</p>
                <button
                  onClick={pick}
                  className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-zinc-900 text-base font-semibold text-white transition active:scale-[0.98]"
                >
                  Retake photo
                </button>
                <button
                  onClick={() => {
                    setStore(""); setCode(""); setPin(""); setAmount(""); setExpires("");
                    setShaky({}); setReaderDown(false); setPhase("confirm");
                  }}
                  className="mt-2 flex h-11 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-700 transition active:scale-[0.98]"
                >
                  ⌨️ Type it in by hand instead
                </button>
                <button onClick={close} className="mt-2 text-xs text-zinc-400 transition hover:text-zinc-600">
                  cancel
                </button>
              </div>
            )}

            {phase === "dupe" && (
              <div className="mt-5 text-center">
                <p className="text-sm font-medium text-zinc-700">✋ This card is already in your wallet, we found it in your email.</p>
                <button
                  onClick={close}
                  className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-zinc-900 text-base font-semibold text-white transition active:scale-[0.98]"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// LOCALHOST DEMO: the agent actually opens the merchant page and reads back the real balance.
// The checking → result transition is deliberately paced so it reads as "the agent went and did it",
// not an instant fake. Honest on failure; hidden entirely off localhost.
type AgentState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "done"; amount: string | null; cardNumber: string | null; pin: string | null; store: string }
  | { phase: "fail"; reason: string };

function maskCard(n: string | null): string | null {
  if (!n) return null;
  const d = n.replace(/\D/g, "");
  return d.length >= 3 ? `••••${d.slice(-3)}` : n;
}

function BalanceAgent({
  redeemUrl,
  store,
  onResolved,
}: {
  redeemUrl: string;
  store: string;
  // Lift a manual success up so the card gets its code+pin and the normal reveal/copy UI takes
  // over (this whole button then unmounts), same end-state as auto-resolve. Called only when a
  // code/pin actually came back.
  onResolved?: (cardNumber: string | null, pin: string | null) => void;
}) {
  const [state, setState] = useState<AgentState>({ phase: "idle" });

  const run = async () => {
    setState({ phase: "checking" });
    try {
      const r = await fetch("/api/check-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redeemUrl }),
      });
      if (r.status === 501) {
        // Production no-op, should never hit on localhost. Hide gracefully.
        setState({ phase: "idle" });
        return;
      }
      const d = await r.json();
      if (d.ok) {
        // A code/pin came back → hand it up; the reveal UI replaces this button. Otherwise (balance
        // only, no code) keep the inline result box.
        if ((d.cardNumber || d.pin) && onResolved) {
          onResolved(d.cardNumber ?? null, d.pin ?? null);
          return;
        }
        setState({ phase: "done", amount: d.amount ?? null, cardNumber: d.cardNumber ?? null, pin: d.pin ?? null, store: d.store ?? store });
      } else {
        setState({ phase: "fail", reason: d.reason ?? "failed" });
      }
    } catch {
      setState({ phase: "fail", reason: "network" });
    }
  };

  if (state.phase === "checking") {
    return (
      <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm">
        <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-500" />
        <span className="font-medium text-emerald-700">checking… <span className="font-normal text-emerald-600/80">the agent is opening the merchant page</span></span>
      </div>
    );
  }

  if (state.phase === "done") {
    const amt = state.amount ? `≈ $${Number.parseFloat(state.amount).toFixed(2)}` : "balance found";
    const masked = maskCard(state.cardNumber);
    return (
      <div className="mt-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm">
        <p className="font-semibold text-emerald-700">✓ Agent checked {state.store}, {amt}</p>
        {(masked || state.pin) && (
          <p className="mt-0.5 font-mono text-[13px] text-emerald-700/90">
            {masked && <>card {masked}</>}
            {masked && state.pin && <span className="text-emerald-600/60"> · </span>}
            {state.pin && <>PIN {state.pin}</>}
          </p>
        )}
      </div>
    );
  }

  if (state.phase === "fail") {
    const msg =
      state.reason === "merchant_not_supported"
        ? "Couldn't auto-check, merchant not supported yet"
        : state.reason === "timeout"
          ? "Couldn't auto-check, the merchant page timed out"
          : state.reason === "email_not_on_order"
            ? "Couldn't auto-check, this card isn't tied to your email"
            : "Couldn't auto-check this one";
    return <p className="mt-2 px-1 text-[13px] font-medium text-zinc-400">{msg}</p>;
  }

  return (
    <button
      onClick={run}
      className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 active:scale-[0.98]"
    >
      ⚡ Check balance now
    </button>
  );
}

// Optional scannable barcode for an email-found code. Collapsed by default; only offered when the
// code has enough digits to encode (numeric gift-card codes), silent otherwise, never overpromises.
function CardBarcode({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const digits = code.replace(/[^0-9]/g, "");
  if (digits.length < 4) return null; // non-numeric / too short → no scannable barcode to show
  return (
    <div className="mt-1 px-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-emerald-600 transition hover:text-emerald-700"
      >
        {open ? "⊟ hide barcode" : "⊞ show barcode"}
      </button>
      {open && (
        <div className="mt-1.5">
          <Barcode128 value={digits} height={42} moduleWidth={1.6} className="border border-zinc-100" />
          <p className="mt-1 text-center text-[10px] text-zinc-400">scan at checkout where supported</p>
        </div>
      )}
    </div>
  );
}

function CardRow({
  card,
  resolve,
  onResolveCode,
  onMarkUsed,
  onNotMine,
  spends,
  onLogSpend,
  onRemoveSpend,
}: {
  card: Found;
  resolve?: ResolvePhase; // auto-resolve status for this card (localhost only); undefined = not attempted
  onResolveCode: (id: string, cardNumber: string | null, pin: string | null) => void;
  onMarkUsed: () => void;
  onNotMine: () => void;
  spends: SpendEntry[];
  onLogSpend: (amount: number) => void;
  onRemoveSpend: (i: number) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedField, setCopiedField] = useState<"code" | "pin" | null>(null);
  const copyField = async (text: string, field: "code" | "pin") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1800);
    } catch {
      /* clipboard blocked */
    }
  };
  // One-time celebratory pulse when the agent fills this card's code on its own.
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (resolve !== "unlocked") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fire-and-clear pulse on the resolve→unlocked transition
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 1700);
    return () => clearTimeout(t);
  }, [resolve]);
  const action = merchantAction(card.store, card.code);
  const spent = spends.reduce((s, e) => s + e.amount, 0);
  const shown = Math.max(0, worth(card) - spent);
  // Auto-resolve attempts every card with a redeem link. While it works, show the unlock chip.
  // If it can't resolve (unsupported merchant / failed), the card just keeps its estimate, no
  // button, no error: the headline number is the answer.
  const unlocking = resolve === "unlocking" && !card.code;

  const useIt = async () => {
    if (card.code) {
      try {
        await navigator.clipboard.writeText(card.pin ? `${card.code}  (PIN ${card.pin})` : card.code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        /* clipboard blocked, page still opens */
      }
    }
    window.open(action.url, "_blank", "noopener");
  };

  return (
    <div
      className={`rounded-2xl border bg-white p-3 shadow-sm transition-all duration-700 ${
        pulse ? "border-emerald-400 ring-2 ring-emerald-300/60" : "border-zinc-100 ring-0"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl" style={{ backgroundColor: card.color + "1A" }}>
          {card.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-zinc-900">{card.store}</p>
            <ExpiryBadge expires={card.expires} />
          </div>
          <p className="truncate text-sm text-zinc-400">{card.date ?? "received"}</p>
        </div>
        {card.balanceEstimate !== null || spent > 0 ? (
          <div className="shrink-0 text-right">
            <p className="text-lg font-bold tabular-nums text-emerald-600">
              {card.balanceEstimate !== null && <>&asymp; </>}${shown.toFixed(2)}
            </p>
            {spent > 0 && <p className="text-[11px] font-medium text-zinc-400">after ${spent.toFixed(2)} you logged</p>}
            {card.balanceEvidenceId && (
              <a
                href={gmailUrl(card.balanceEvidenceId)}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[11px] font-medium text-emerald-700/70 transition hover:text-emerald-700"
              >
                left &middot; as of {card.balanceAsOf ? fmtAsOf(card.balanceAsOf) : "latest receipt"} ↗
              </a>
            )}
            <p className="text-[11px] tabular-nums text-zinc-400 line-through">loaded ${card.amount.toFixed(2)}</p>
          </div>
        ) : (
          <p className="text-lg font-bold tabular-nums text-emerald-600">${card.amount.toFixed(2)}</p>
        )}
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {unlocking ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
            <div className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-500" />
            <span className="font-medium text-emerald-700">🔓 unlocking code&hellip;</span>
          </div>
        ) : card.code || card.pin ? (
          revealed ? (
            // Expanded: full code + PIN, each tap-to-copy, nothing truncated.
            <div className="rounded-xl bg-zinc-50 p-2">
              {card.code && (
                <button onClick={() => copyField(card.code!, "code")} className="flex w-full items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-zinc-100">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Code</span>
                    <span className="block break-all font-mono text-sm text-zinc-900">{card.code}</span>
                  </span>
                  <span className="shrink-0 pt-3 text-xs font-semibold text-emerald-600">{copiedField === "code" ? "copied ✓" : "tap to copy"}</span>
                </button>
              )}
              {card.pin && (
                <button onClick={() => copyField(card.pin!, "pin")} className="mt-1 flex w-full items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-zinc-100">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">PIN</span>
                    <span className="block break-all font-mono text-sm text-zinc-900">{card.pin}</span>
                  </span>
                  <span className="shrink-0 pt-3 text-xs font-semibold text-emerald-600">{copiedField === "pin" ? "copied ✓" : "tap to copy"}</span>
                </button>
              )}
              {card.code && <CardBarcode code={card.code} />}
              <div className="mt-1 flex items-center justify-between px-2">
                <button onClick={() => setRevealed(false)} className="text-xs font-medium text-zinc-400 transition hover:text-zinc-600">hide</button>
                <a href={gmailUrl(card.id)} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-zinc-400 transition hover:text-zinc-600">Email ↗</a>
              </div>
            </div>
          ) : (
            <div className="flex items-stretch gap-2">
              <button
                onClick={() => setRevealed(true)}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-left text-sm transition hover:bg-zinc-100"
              >
                <span className="font-medium text-emerald-600">{pulse ? "✓ code unlocked, reveal" : "🎟️ Reveal code"}</span>
                <span className="text-zinc-400">tap</span>
              </button>
              <a href={gmailUrl(card.id)} target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center rounded-xl bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600">Email ↗</a>
            </div>
          )
        ) : (
          <div className="flex justify-end">
            <a href={gmailUrl(card.id)} target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center rounded-xl bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600">Email ↗</a>
          </div>
        )}
      </div>

      <button
        onClick={useIt}
        className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 text-sm font-semibold text-white transition active:scale-[0.98]"
      >
        {copied ? "Code copied ✓, opening…" : `${action.label} →`}
      </button>
      <SpendFooter spends={spends} onLog={onLogSpend} onRemove={onRemoveSpend} onMarkUsed={onMarkUsed} onNotMine={onNotMine} />
    </div>
  );
}

const fmtSpendAt = (s: string) => {
  const t = Date.parse(s);
  if (Number.isNaN(t)) return "";
  return new Date(t).toDateString() === new Date().toDateString() ? "today" : fmtAsOf(s);
};

// Quiet inline purchase log, a whisper under the Use-it button, never competing with it.
function SpendFooter({
  spends,
  onLog,
  onRemove,
  onMarkUsed,
  onNotMine,
}: {
  spends: SpendEntry[];
  onLog: (amount: number) => void;
  onRemove: (i: number) => void;
  onMarkUsed: () => void;
  onNotMine?: () => void; // only email cards teach a "not mine" pattern; physical cards omit it
}) {
  const [open, setOpen] = useState(false);
  const [amt, setAmt] = useState("");
  const parsed = Number.parseFloat(amt.replace(/[$,\s]/g, ""));
  const valid = Number.isFinite(parsed) && parsed > 0;
  const save = () => {
    if (!valid) return;
    onLog(Math.round(parsed * 100) / 100);
    setAmt("");
    setOpen(false);
  };
  return (
    <>
      <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] font-medium text-zinc-300">
        <button onClick={() => setOpen((v) => !v)} className="transition hover:text-zinc-500">
          − log a purchase
        </button>
        <span>&middot;</span>
        <button onClick={onMarkUsed} className="transition hover:text-zinc-500">
          already spent? mark as used
        </button>
        {onNotMine && (
          <>
            <span>&middot;</span>
            <button onClick={onNotMine} className="transition hover:text-zinc-500">
              not mine
            </button>
          </>
        )}
      </div>
      {open && (
        <div className="mt-2 rounded-xl bg-zinc-50 p-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-400">$</span>
            <input
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              inputMode="decimal"
              placeholder="0.00"
              autoFocus
              className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-base text-zinc-900 outline-none transition focus:border-emerald-400"
            />
            <button
              onClick={save}
              disabled={!valid}
              className="h-10 shrink-0 rounded-lg bg-zinc-900 px-3.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
            >
              Log
            </button>
            <button onClick={() => { setOpen(false); setAmt(""); }} className="px-1 text-sm text-zinc-400 transition hover:text-zinc-600">
              ✕
            </button>
          </div>
          {spends.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {spends.map((e, i) => (
                <div key={i} className="flex items-center justify-between text-xs text-zinc-500">
                  <span className="tabular-nums">
                    −${e.amount.toFixed(2)} &middot; {fmtSpendAt(e.at)}
                  </span>
                  <button onClick={() => onRemove(i)} className="px-1 text-zinc-300 transition hover:text-zinc-500">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function UsedRow({
  card,
  onRestore,
  label = "✓ used",
  hint = "not used? tap",
}: {
  card: Found;
  onRestore: () => void;
  label?: string;
  hint?: string;
}) {
  return (
    <div onClick={onRestore} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-zinc-100 bg-white p-3 opacity-60 shadow-sm transition hover:opacity-80">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg grayscale" style={{ backgroundColor: card.color + "1A" }}>
        {card.emoji}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-zinc-500">{card.store}</p>
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">{label}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span>{hint}</span>
          {card.balanceEstimate !== null && <span className="shrink-0">&asymp; ${card.balanceEstimate.toFixed(2)} left</span>}
          {card.evidenceId && (
            <a
              href={gmailUrl(card.evidenceId)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="transition hover:text-zinc-600"
            >
              receipt ↗
            </a>
          )}
        </div>
      </div>
      <p className="text-base font-bold tabular-nums text-zinc-400 line-through">${card.amount.toFixed(2)}</p>
    </div>
  );
}

// Honest browser reminder toggle. Fires only when Stash is OPEN (on-load), so the caption says so
// plainly, no implication of background push. Hidden entirely when the Notification API is absent.
function RemindToggle({
  on,
  denied,
  disabled,
  onEnable,
}: {
  on: boolean;
  denied: boolean;
  disabled: boolean; // nothing within 7 days → nothing to remind about
  onEnable: () => void;
}) {
  if (typeof window !== "undefined" && typeof Notification === "undefined") return null;
  return (
    <div className="rounded-2xl border border-zinc-100 bg-white px-3.5 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-zinc-700">🔔 Remind me about expiring cards</span>
        {on ? (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">on ✓</span>
        ) : (
          <button
            onClick={onEnable}
            disabled={disabled}
            className="h-8 shrink-0 rounded-full bg-zinc-900 px-3.5 text-xs font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
          >
            Turn on
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-zinc-400">fires when you open Stash, background reminders are coming</p>
      {denied && (
        <p className="mt-1 text-[11px] leading-snug text-amber-700">
          Notifications are blocked in your browser, enable them in site settings to get reminders.
        </p>
      )}
      {!denied && disabled && !on && (
        <p className="mt-1 text-[11px] leading-snug text-zinc-400">nothing&rsquo;s within 7 days right now, so there&rsquo;s nothing to remind about yet</p>
      )}
    </div>
  );
}

function ErrorView({ error }: { error: string | null }) {
  const msg =
    error === "not_connected" || error === "token_exchange"
      ? "Couldn't connect to Gmail. Token may have expired (test mode expires every 7 days), reconnect."
      : error === "no_client_id"
        ? "Google credentials aren't wired up yet."
        : error === "scan_failed"
          ? "The scan hit a snag. Try reconnecting."
          : "Something went wrong.";
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      <div className="text-5xl">🔌</div>
      <p className="mt-4 text-xl font-semibold text-zinc-900">Not connected</p>
      <p className="mt-2 max-w-xs text-sm text-zinc-500">{msg}</p>
      <a href="/api/google/start" className="mt-6 flex h-12 items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-6 text-base font-semibold text-white">
        <GoogleIcon /> Connect Gmail
      </a>
    </div>
  );
}

function useCountUp(target: number, duration: number) {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0); // animate from the last shown value so mark-as-used doesn't restart at $0
  useEffect(() => {
    const from = fromRef.current;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const v = from + (target - from) * (1 - Math.pow(1 - t, 3));
      fromRef.current = v;
      setVal(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

// Dependency-free payout confetti, two bottom cannons, gravity falloff, ~1.5s, emerald/gold.
function Confetti({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      doneRef.current();
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const COLORS = ["#10b981", "#34d399", "#059669", "#f59e0b", "#fbbf24", "#fde68a"];
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const parts = Array.from({ length: 140 }, (_, i) => {
      const left = i % 2 === 0;
      const angle = ((left ? -65 : -115) * Math.PI) / 180 + rand(-0.28, 0.28);
      const speed = rand(620, 1150);
      return {
        x: left ? rand(-10, W * 0.18) : rand(W * 0.82, W + 10),
        y: H + rand(0, 30),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: rand(5, 9),
        h: rand(8, 14),
        rot: rand(0, Math.PI * 2),
        vr: rand(-12, 12),
        color: COLORS[i % COLORS.length],
        delay: rand(0, 0.12),
      };
    });
    const LIFE = 1.5;
    const t0 = performance.now();
    let last = t0;
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const dt = Math.min((now - last) / 1000, 0.032);
      last = now;
      ctx.clearRect(0, 0, W, H);
      if (t > LIFE) {
        doneRef.current();
        return;
      }
      for (const p of parts) {
        if (t < p.delay) continue;
        p.vy += 1500 * dt;
        p.vx *= 0.985;
        p.vy *= 0.992;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, (LIFE - t) / 0.4));
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-50" aria-hidden="true" />;
}

// Non-motion payout beat: a brief emerald "you took back $X" banner that ALWAYS lands,
// the celebration that survives prefers-reduced-motion (when canvas confetti is suppressed).
// Gentle entrance is animation-only; the banner itself shows either way, then auto-dismisses.
function CelebrateBanner({ amount, onDone }: { amount: number; onDone: () => void }) {
  const [shown, setShown] = useState(false);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    const t = setTimeout(onDone, 2600);
    return () => {
      cancelAnimationFrame(r);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-5 z-[60] flex justify-center px-5">
      <div
        className={`flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-base font-bold text-white shadow-lg shadow-emerald-600/25 transition-all duration-500 ${
          reduce ? "" : shown ? "translate-y-0 scale-100 opacity-100" : "-translate-y-3 scale-95 opacity-0"
        }`}
      >
        🎉 You took back ${amount.toFixed(2)}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.3 0-9.7-2.6-11.3-7l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.4l6.2 5.2C39.9 35.9 44 30.5 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}
