// Minimal Gmail OAuth + read client — plain fetch, no SDK dependency.
// Scope: gmail.readonly. For the personal self-test we keep the access token in an
// httpOnly cookie (no DB). Production multi-user → store refresh tokens in Supabase.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const redirectUri = (origin: string) => `${origin}/api/google/callback`;

// `state` is a random per-login value the callback checks against a cookie, so a link an attacker
// crafted can't sign the victim's browser into the attacker's Gmail. We also no longer ask for
// access_type=offline / prompt=consent: nothing here ever uses a refresh token, and that pair
// only made the consent screen scarier.
export function authUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPE,
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

export async function exchangeCode(code: string, origin: string): Promise<{ access_token: string; expires_in?: number; refresh_token?: string }> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri(origin),
    grant_type: "authorization_code",
  });
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error(`token exchange ${r.status}: ${await r.text()}`);
  return r.json();
}

// The connected account's own email — so the balance agent authenticates as whoever's inbox
// is connected (never a hardcoded address). One cheap profile GET.
export async function getProfileEmail(token: string): Promise<string | null> {
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const d = (await r.json()) as { emailAddress?: string };
  return d.emailAddress ?? null;
}

// Gmail answers 429 ("slow down") when many gets run at once, and the occasional 5xx. Retry those
// with exponential backoff (honouring Retry-After) instead of silently dropping the email.
// `deadline` (epoch ms) stops us waiting past the caller's time budget.
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function gmailFetch(url: string, token: string, deadline?: number): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let wait = Math.min(4000, 400 * 2 ** attempt) + Math.random() * 250;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!RETRY_STATUS.has(r.status)) return r;
      const ra = Number(r.headers.get("retry-after"));
      if (Number.isFinite(ra) && ra > 0) wait = Math.min(5000, ra * 1000);
      lastErr = new Error(`gmail ${r.status}`);
      if (attempt === MAX_ATTEMPTS - 1) return r; // out of retries: hand the real response back
    } catch (e) {
      lastErr = e; // network blip
    }
    if (deadline !== undefined && Date.now() + wait > deadline) break; // no time left to wait
    if (attempt < MAX_ATTEMPTS - 1) await sleep(wait);
  }
  throw lastErr instanceof Error ? lastErr : new Error("gmail fetch failed");
}

export async function searchMessages(token: string, q: string, max: number, deadline?: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", q);
    url.searchParams.set("maxResults", String(Math.min(100, max - ids.length)));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const r = await gmailFetch(url.toString(), token, deadline);
    if (!r.ok) throw new Error(`gmail search ${r.status}`);
    const d = (await r.json()) as { messages?: { id: string }[]; nextPageToken?: string };
    for (const m of d.messages ?? []) ids.push(m.id);
    pageToken = d.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids;
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };

function b64url(data: string): string {
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Pull redeem / view-gift-card URLs out of the RAW html before tags are stripped — otherwise
// a link that only lives in <a href="…"> is lost, and the balance-agent has no URL to drive.
//
// Two passes, most-reliable first:
//   1) bare URL whose PATH says redeem/giftcard/view-gift — the direct merchant link.
//   2) anchor-text match: the href of any <a> whose VISIBLE text reads "view your gift card" /
//      "redeem" / "view gift" — catches click-tracking wrappers (click.nikemail.com/…) that lead
//      to a gift card but hide it behind a tracking domain. Conservative: only fires on that
//      specific CTA text, never a generic "shop now" link. A wrong link just makes the agent
//      return ok:false (graceful), so mild over-capture is acceptable; runaway capture is not.
// Broadened for max extraction: CTA text like view/redeem/claim/activate/access/see + gift|card|e-gift.
const REDEEM_TEXT_RE = /(?:view|redeem|claim|activate|access|see|get|use|open)[\s\S]{0,16}(?:gift|e-?gift|card|balance)|gift\s*card|e-?gift/i;
function redeemLinks(html: string): string[] {
  const out = new Set<string>();
  // URLs whose PATH itself signals a redeem/gift page (covers most direct links + many trackers).
  const pathRe = /https?:\/\/[^\s"'<>]*(?:redeem|gift-?card|giftcard|e-?gift|\/gc\/|claim|activate|card[-_]?balance|view[^\s"'<>]*gift)[^\s"'<>]*/gi;
  for (const m of html.matchAll(pathRe)) out.add(m[0].replace(/&amp;/g, "&"));

  // <a href="URL" ...>TEXT</a> pairs — capture URL when TEXT matches the redeem CTA.
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchorRe)) {
    if (out.size >= 5) break;
    const href = m[1].replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(href)) continue; // skip mailto:/tel:/anchors
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (REDEEM_TEXT_RE.test(text)) out.add(href);
  }
  return [...out].slice(0, 5);
}

// Was 4000: a claim code or amount sitting below a long marketing header got cut off before the
// value filter or the model ever saw it. extractCard itself still trims its prompt to 12,000 chars.
export const BODY_CAP = 8000;

export function decodeBody(payload: Part | undefined): string {
  const acc = { plain: "", html: "" };
  const walk = (p?: Part) => {
    if (!p) return;
    if (p.mimeType === "text/plain" && p.body?.data) acc.plain += b64url(p.body.data) + "\n";
    else if (p.mimeType === "text/html" && p.body?.data) acc.html += b64url(p.body.data) + "\n";
    p.parts?.forEach(walk);
  };
  walk(payload);
  const text = (acc.plain.trim() || stripHtml(acc.html)).slice(0, BODY_CAP);
  const links = redeemLinks(acc.html || acc.plain).filter((l) => !text.includes(l));
  return links.length ? `${text}\nLinks: ${links.join(" ")}` : text;
}

export async function getMessage(token: string, id: string, deadline?: number): Promise<{ from: string; date: string; subject: string; body: string }> {
  const r = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, token, deadline);
  if (!r.ok) throw new Error(`gmail get ${r.status}`);
  const m = (await r.json()) as { snippet?: string; payload?: { headers?: { name: string; value: string }[] } & Part };
  const header = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  return { from: header("from"), date: header("date"), subject: header("subject"), body: decodeBody(m.payload) || m.snippet || "" };
}
