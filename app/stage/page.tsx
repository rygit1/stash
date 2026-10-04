"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

// $21B / year in unredeemed gift cards → ≈ $666 every second into corporate breakage.
// This ticker is client-side only (an honest national estimate) so it runs even if venue wifi dies.
const BREAKAGE_PER_SEC = 21_000_000_000 / (365 * 24 * 60 * 60);

type Find = { store: string; amount: number; verified: boolean; at: number };
type RoomState = { joined: number; total: number; cards: number; feed: Find[] };

const EMOJI: Record<string, string> = {
  starbucks: "☕", target: "🎯", amazon: "📦", sephora: "💄", roblox: "🎮",
  chipotle: "🌯", nike: "👟", doordash: "🚪", apple: "🍎", spotify: "🎧",
};
const emojiFor = (s: string) => EMOJI[s.toLowerCase()] ?? "🎁";

const DEMO_POOL = Object.keys(EMOJI);

export default function Stage() {
  const kept = useBreakageTicker();
  const [room, setRoom] = useState<RoomState>({ joined: 0, total: 0, cards: 0, feed: [] });

  useEffect(() => {
    const demo = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");

    if (demo) {
      // Rehearsal only — synthetic activity so the screen looks alive while practicing.
      let id = 0;
      const int = setInterval(() => {
        setRoom((r) => {
          const store = DEMO_POOL[Math.floor(Math.random() * DEMO_POOL.length)];
          const amount = Math.round((5 + Math.random() * 45) * 100) / 100;
          const f: Find = { store, amount, verified: Math.random() > 0.6, at: id++ };
          return { joined: r.joined + 1, total: r.total + amount, cards: r.cards + 1, feed: [f, ...r.feed].slice(0, 8) };
        });
      }, 1400);
      return () => clearInterval(int);
    }

    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch("/api/room", { cache: "no-store" });
        if (alive) setRoom(await res.json());
      } catch {}
    };
    pull();
    const int = setInterval(pull, 1500);
    return () => {
      alive = false;
      clearInterval(int);
    };
  }, []);

  const shownTotal = useLerp(room.total);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-between bg-zinc-950 px-10 py-12 text-white">
      <header className="text-center">
        <p className="text-3xl font-bold tracking-tight">
          Loot <span className="font-medium text-emerald-400">· take your money back</span>
        </p>
      </header>

      <div className="grid w-full max-w-6xl grid-cols-2 gap-8">
        <div className="rounded-3xl border border-rose-900/50 bg-rose-950/20 p-10 text-center">
          <p className="text-base font-semibold uppercase tracking-[0.2em] text-rose-400/80">
            Kept by companies since I started talking
          </p>
          <div className="mt-5 text-7xl font-bold tabular-nums text-rose-500">
            ${Math.floor(kept).toLocaleString()}
          </div>
          <p className="mt-5 text-base text-zinc-500">$21 billion a year in forgotten gift cards → pure profit</p>
        </div>

        <div className="rounded-3xl border border-emerald-800/50 bg-emerald-950/20 p-10 text-center">
          <p className="text-base font-semibold uppercase tracking-[0.2em] text-emerald-400/80">
            Taken back in this room
          </p>
          <div className="mt-5 text-7xl font-bold tabular-nums text-emerald-400">
            ${shownTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="mt-5 text-base text-zinc-500">
            {room.cards} cards found &middot; {room.joined} people in the room
          </p>
        </div>
      </div>

      <div className="h-52 w-full max-w-3xl overflow-hidden">
        <div className="flex flex-col gap-2">
          {room.feed.map((f) => (
            <div key={f.at} className="flex items-center rounded-xl bg-zinc-900/80 px-5 py-3 text-lg">
              <span className="mr-3 text-2xl">{emojiFor(f.store)}</span>
              <span>
                Someone just found <span className="font-bold text-emerald-400">${f.amount.toFixed(2)}</span>
                {f.store && f.store !== "a store" ? ` at ${f.store}` : ""}
              </span>
              {f.verified && <span className="ml-3 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300">✓ read by Loot</span>}
            </div>
          ))}
          {room.feed.length === 0 && (
            <p className="px-5 py-3 text-lg text-zinc-600">Waiting for the room to start finding money…</p>
          )}
        </div>
      </div>

      <footer className="flex items-center gap-8">
        <JoinQR />
      </footer>
    </main>
  );
}

// Real scannable QR — computed client-side from NEXT_PUBLIC_JOIN_URL or this page's own
// origin, so it works on localhost and the deployed URL with zero config.
function JoinQR() {
  const [qr, setQr] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = process.env.NEXT_PUBLIC_JOIN_URL || `${window.location.origin}/join`;
    setUrl(u);
    QRCode.toDataURL(u, { width: 1024, margin: 4, errorCorrectionLevel: "M" })
      .then(setQr)
      .catch(() => {});
  }, []);
  return (
    <>
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt={`QR code — ${url}`} className="h-60 w-60 rounded-2xl bg-white" />
      ) : (
        <div className="h-60 w-60 rounded-2xl bg-white/10" />
      )}
      <div>
        <p className="text-4xl font-semibold">
          Scan to find <span className="text-emerald-400">your</span> money
        </p>
        <p className="mt-2 font-mono text-2xl text-zinc-400">{url.replace(/^https?:\/\//, "")}</p>
      </div>
    </>
  );
}

function useBreakageTicker() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      setV(((now - start) / 1000) * BREAKAGE_PER_SEC);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return v;
}

// Smoothly counts the green total toward its latest real value between polls.
function useLerp(target: number) {
  const [shown, setShown] = useState(target);
  const ref = useRef(shown);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const diff = target - ref.current;
      if (Math.abs(diff) < 0.01) {
        ref.current = target;
        setShown(target);
        return;
      }
      ref.current += diff * 0.12;
      setShown(ref.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}
