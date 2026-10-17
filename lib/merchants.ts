// Registry of exact redeem / balance-check URLs per merchant — MVP-honest, no fake balances.
// Add a new merchant by dropping ONE row into REGISTRY (keys = lowercase substrings of the store name).
// Unknown merchants fall back to a search that reliably lands on the official balance page.
// Phase-2: auto-discover links for unknown merchants + a processor balance API (the moat).

type Entry = { keys: string[]; label: string; url: (code: string | null) => string };

const REGISTRY: Entry[] = [
  // Amazon can't be balance-checked by code (anti-fraud) → the action is APPLY it (= use it).
  { keys: ["amazon"], label: "Apply to your Amazon balance", url: (c) => (c ? `https://www.amazon.com/gc/redeem?claimCode=${encodeURIComponent(c)}` : "https://www.amazon.com/gc/redeem") },
  { keys: ["roblox"], label: "Redeem on Roblox", url: () => "https://www.roblox.com/redeem" },
  { keys: ["nike"], label: "Check your Nike balance", url: () => "https://www.nike.com/orders/gift-card-lookup" },
  { keys: ["nift", "gonift"], label: "Redeem your Nift gift", url: () => "https://www.gonift.com/" },
  // Old /card/balance 404s (verified 6/11) — the check-balance entry point lives on /gift now.
  { keys: ["starbucks"], label: "Check your Starbucks balance", url: () => "https://www.starbucks.com/gift" },
  { keys: ["target"], label: "Check your Target balance", url: () => "https://www.target.com/guest/gift-card-balance" },
  { keys: ["apple", "itunes", "app store"], label: "Redeem your Apple Gift Card", url: () => "https://apps.apple.com/redeem" },
];

export function merchantAction(store: string | null, code: string | null): { label: string; url: string } {
  const s = (store ?? "").toLowerCase();
  const hit = REGISTRY.find((e) => e.keys.some((k) => s.includes(k)));
  if (hit) return { label: hit.label, url: hit.url(code) };
  return {
    label: "Check balance & use it",
    url: `https://www.google.com/search?q=${encodeURIComponent(`${store ?? "gift card"} check gift card balance`)}`,
  };
}

// Cards you can't take into a shop: online-only brands and bank-network cards (usable anywhere).
// For these there's no "nearest store", so the Find-nearby link is hidden.
const ONLINE_ONLY = [
  "amazon", "roblox", "nift", "gonift", "itunes", "app store", "google play", "steam", "xbox", "playstation",
  "nintendo", "netflix", "spotify", "hulu", "disney+", "doordash", "uber", "lyft", "grubhub", "instacart",
  "airbnb", "ebay", "etsy", "visa", "mastercard", "amex", "american express", "discover", "tremendous",
  "tango", "prezzee", "giftcards.com", "giftcardmall", "egifter", "giftrocket", "gyft", "giftbit",
];

// A maps search for the nearest location of this store. The phone's own maps app works out where the
// person is, so Stash never sees their location. null = generic or online-only card, nothing to find.
export function nearbyMapsUrl(store: string | null, apple: boolean): string | null {
  const name = (store ?? "").trim();
  const s = name.toLowerCase();
  if (!name || s === "gift card" || ONLINE_ONLY.some((k) => s.includes(k))) return null;
  return apple
    ? `https://maps.apple.com/?q=${encodeURIComponent(name)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
}
