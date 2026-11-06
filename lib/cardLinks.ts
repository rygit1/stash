// "View your gift card" links found in gift-card emails (the scan keeps them as redeemUrl).
//
// Many stores hide the code and PIN behind that link instead of printing them in the email. Two
// things help:
//  - Some links carry the code themselves (Amazon's "Redeem now" goes to
//    amazon.com/gc/redeem?claimCode=…), so it can be read straight out of the link, exactly.
//  - Otherwise the link is the fastest way to the card: it opens the store's own page for that
//    exact card, which shows the code and PIN.
// Nothing here goes online: it only reads the link the scan already found.

// Query parameters that hold a gift card's code or PIN on store redeem links.
const CODE_PARAMS = ["claimcode", "claim_code", "gccode", "gc_code", "giftcode", "gift_code", "giftcardcode", "redemptioncode", "redemption_code", "cardnumber", "card_number"];
const PIN_PARAMS = ["pin", "cardpin", "card_pin", "giftcardpin", "securitycode", "security_code"];
// A bare "code" parameter only counts on a page that is clearly a gift card redeem page.
const REDEEM_PATH = /redeem|\/gc\b|gift-?card|giftcard|e-?gift|claim/i;

const looksLikeCode = (v: string) => /^[A-Z0-9][A-Z0-9-]{6,38}[A-Z0-9]$/i.test(v) && /\d/.test(v);
const looksLikePin = (v: string) => /^\d{3,10}$/.test(v);

/** Only plain https links are ever opened (never javascript: or other schemes from an email). */
export function safeLink(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "bestbuy.com" for a link, to show where it goes. */
export function linkDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the store's site";
  }
}

/**
 * The code (and PIN) carried inside a redeem link, if any. Click-tracking links often wrap the real
 * link in a parameter, so wrapped links are looked inside too (two levels deep).
 */
export function codeFromLink(url: string | null | undefined, depth = 0): { code: string | null; pin: string | null } | null {
  if (!url || depth > 2) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  let code: string | null = null;
  let pin: string | null = null;
  for (const [rawKey, rawValue] of u.searchParams) {
    const key = rawKey.toLowerCase();
    const value = rawValue.trim();
    if (!code && CODE_PARAMS.includes(key) && looksLikeCode(value)) code = value;
    else if (!code && key === "code" && REDEEM_PATH.test(u.pathname) && looksLikeCode(value)) code = value;
    else if (!pin && PIN_PARAMS.includes(key) && looksLikePin(value)) pin = value;
    else if (/^https?:\/\//i.test(value)) {
      const inner = codeFromLink(value, depth + 1);
      if (inner) {
        code ??= inner.code;
        pin ??= inner.pin;
      }
    }
  }
  return code || pin ? { code, pin } : null;
}

/** Fill a card's missing code / PIN from its redeem link, when the link carries them. */
export function withCodeFromLink<T extends { code: string | null; pin: string | null; redeemUrl: string | null }>(card: T): T {
  if (card.code && card.pin) return card;
  const found = codeFromLink(card.redeemUrl);
  if (!found) return card;
  return { ...card, code: card.code ?? found.code, pin: card.pin ?? found.pin };
}
