import { cookies } from "next/headers";
import { getProfileEmail } from "@/lib/gmail";

// Resolve child_process + path at RUNTIME (not a static import) so the bundler never instruments
// the spawn() call — Turbopack otherwise traces spawn's first arg as a module and fails the build.
// This route is nodejs-runtime + localhost-only; these builtins always exist where it actually runs.
const cp = process.getBuiltinModule("node:child_process");
const path = process.getBuiltinModule("node:path");

// LOCALHOST-ONLY balance agent. On click, this drives the merchant's "view gift card" page
// in a headless browser (Puppeteer, isolated in spike-balance/) and reveals the real balance +
// code the delivery email hides behind a button. Proven for Nike.
//
// HARD no-op in production: puppeteer is NOT a dependency of this app and spike-balance is
// .vercelignore'd — this route must never spawn on Vercel. The VERCEL guard below enforces it.
export const runtime = "nodejs"; // child_process + filesystem — never edge
export const maxDuration = 60; // the headless drive takes multiple seconds

const CHILD_TIMEOUT_MS = 50_000; // kill the browser child before the route's 60s ceiling

type NikeResult = { ok: boolean; amount?: string | null; cardNumber?: string | null; pin?: string | null; reason?: string };
type StarbucksResult = { ok: boolean; amount?: string | null; reason?: string };

// Paths assembled at runtime from cwd + parts (NOT string literals) — keeps puppeteer out of the
// bundle. The scripts live in spike-balance/ (.vercelignore'd; only present on the local machine).
const NIKE_SCRIPT = path.join(process.cwd(), "spike-balance", ["nike", "reveal.mjs"].join("-"));
const STARBUCKS_SCRIPT = path.join(process.cwd(), "spike-balance", ["starbucks", "balance.mjs"].join("-"));

// Spawn a spike-balance driver and resolve with its LAST printed JSON line (each prints one JSON
// object). Shared by every adapter — same ~50s kill ceiling, same last-line parse as the Nike path.
function runDriver<T>(script: string, args: string[], tag: string, onTimeout: () => T, onFail: (reason: string) => T): Promise<T> {
  return new Promise((resolve) => {
    const child = cp.spawn("node", [script, ...args], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let settled = false;
    const finish = (r: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(onTimeout());
    }, CHILD_TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => console.error(`[check-balance] ${tag} stderr:`, d.toString().trim()));
    child.on("error", (e) => {
      console.error(`[check-balance] ${tag} spawn error:`, e);
      finish(onFail("spawn_failed"));
    });
    child.on("close", () => {
      const lines = out.trim().split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          return finish(JSON.parse(lines[i]) as T);
        } catch {
          /* not the JSON line — keep scanning upward */
        }
      }
      finish(onFail("no_output"));
    });
  });
}

// Existing redeemUrl mode (Nike eGift "view gift card" reveal) — unchanged behavior.
const runNike = (redeemUrl: string, email: string) =>
  runDriver<NikeResult>(NIKE_SCRIPT, [redeemUrl, email], "nike", () => ({ ok: false, reason: "timeout" }), (reason) => ({ ok: false, reason }));

// New card+PIN mode (scanned physical card → drive the merchant's public balance form). Starbucks only today.
const runStarbucks = (code: string, pin: string) =>
  runDriver<StarbucksResult>(STARBUCKS_SCRIPT, [code, pin], "starbucks", () => ({ ok: false, reason: "timeout" }), (reason) => ({ ok: false, reason }));

// Only real nike.com addresses (nike.com itself or a subdomain). A substring check let
// "nike.com.evil.example" and "evilnike.com" through, and the agent types the user's Gmail
// address into whatever page it lands on.
function isNikeHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return h === "nike.com" || h.endsWith(".nike.com");
}

// The agent may only run on the developer's own machine: never on Vercel, only when the request
// itself arrived on a loopback host, and never in a production build unless explicitly enabled
// (ENABLE_BALANCE_AGENT=1 for someone running `next start` on their own laptop).
function localAgentAllowed(req: Request): boolean {
  if (process.env.VERCEL) return false;
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_BALANCE_AGENT !== "1") return false;
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export async function POST(req: Request) {
  // Local-only guard (see localAgentAllowed). Anywhere else this is a no-op.
  if (!localAgentAllowed(req)) return Response.json({ error: "local_only" }, { status: 501 });

  let body: { redeemUrl?: unknown; merchant?: unknown; code?: unknown; pin?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  // A connected session is required for BOTH modes (same as today).
  const token = (await cookies()).get("g_token")?.value;
  if (!token) return Response.json({ error: "not_connected" }, { status: 401 });
  const email = await getProfileEmail(token);
  if (!email) return Response.json({ error: "no_profile" }, { status: 401 });

  const noStore = { headers: { "Cache-Control": "no-store" } };

  // ── Mode B (new): scanned physical card → drive the merchant's public balance form ──────────
  // { merchant, code, pin }. Starbucks only today (Nike card+PIN lookup is a FUTURE adapter).
  if (typeof body.merchant === "string") {
    const merchant = body.merchant.trim();
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";
    // A physical card needs BOTH its number and its security code to query the form.
    if (!/^[a-z0-9 -]{8,30}$/i.test(code) || !/^[a-z0-9]{3,12}$/i.test(pin)) {
      return Response.json({ ok: false, reason: "bad_card" }, noStore);
    }
    if (/starbucks/i.test(merchant)) {
      const r = await runStarbucks(code, pin);
      return Response.json(
        r.ok ? { ok: true, amount: r.amount ?? null, store: "Starbucks" } : { ok: false, reason: r.reason ?? "failed", store: "Starbucks" },
        noStore,
      );
    }
    // No card+PIN adapter for this merchant yet (Nike etc. are future work).
    return Response.json({ ok: false, reason: "merchant_not_supported" }, noStore);
  }

  // ── Mode A (existing, unchanged): Nike eGift redeem URL → reveal hidden code + PIN + balance ──
  const redeemUrl = typeof body.redeemUrl === "string" ? body.redeemUrl : "";
  let host: string;
  try {
    const u = new URL(redeemUrl);
    if (u.protocol !== "https:") throw new Error("not https");
    host = u.hostname.toLowerCase();
  } catch {
    return Response.json({ error: "bad_url" }, { status: 400 });
  }

  // Only Nike has a proven redeem-URL adapter today. Be honest about everything else.
  if (isNikeHost(host)) {
    const r = await runNike(redeemUrl, email);
    if (r.ok) {
      return Response.json(
        { ok: true, amount: r.amount ?? null, cardNumber: r.cardNumber ?? null, pin: r.pin ?? null, store: "Nike" },
        noStore,
      );
    }
    return Response.json({ ok: false, reason: r.reason ?? "failed", store: "Nike" }, noStore);
  }

  return Response.json({ ok: false, reason: "merchant_not_supported" }, noStore);
}
