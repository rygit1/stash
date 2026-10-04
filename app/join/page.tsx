"use client";

import { useEffect, useRef, useState } from "react";
import { merchantAction } from "@/lib/merchants";

type Find = { store: string; amount: number; verified: boolean; at: number };
type RoomState = { joined: number; total: number; cards: number; feed: Find[] };
// Exact response shape of POST /api/extract (lib/extract.ts ExtractedCard).
type Card = {
  isGiftCard: boolean;
  store: string | null;
  amount: number | null;
  code: string | null;
  pin: string | null;
  dateReceived: string | null;
  expires: string | null;
  confidence: "high" | "medium" | "low";
};
type StashItem = {
  id: string;
  store: string | null;
  amount: number;
  code: string | null;
  pin: string | null;
  expires: string | null;
  at: number;
  source: "paste" | "manual";
};
type NoticeKind = "miss" | "noamount" | "dupe" | "error";

// Local copy of the wallet's brand map (app/page.tsx owns its own — keep them independent).
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

const STASH_KEY = "loot_stash_v1";
const CELEBRATED_KEY = "loot_stash_celebrated";
const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
const stashIdFor = (store: string | null, amount: number, code: string | null) =>
  code && code.trim() ? `c:${code.trim()}` : `s:${norm(store)}|${amount.toFixed(2)}`;

export default function Join() {
  const [room, setRoom] = useState<RoomState | null>(null);
  // Personal mini-wallet. Starts empty on the server render, hydrates from localStorage
  // after mount (no SSR mismatch), and survives crowd-wifi refreshes.
  const [stash, setStash] = useState<StashItem[]>([]);
  const [confetti, setConfetti] = useState(false);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/api/room", { cache: "no-store" });
        if (alive) setRoom(await r.json());
      } catch {}
    };
    pull();
    const int = setInterval(pull, 3000);
    return () => {
      alive = false;
      clearInterval(int);
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STASH_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const items = parsed.filter(
        (c): c is StashItem =>
          !!c && typeof c === "object" && typeof (c as StashItem).id === "string" &&
          typeof (c as StashItem).amount === "number" && Number.isFinite((c as StashItem).amount) &&
          (c as StashItem).amount > 0,
      );
      if (items.length) setStash(items);
    } catch {
      /* private mode — stash is session-only */
    }
  }, []);

  // Dedupe rules: exact code wins; otherwise store+amount. A pasted card with a code
  // UPGRADES a code-less manual entry for the same store+amount instead of double-counting.
  const addToStash = (input: {
    store: string | null;
    amount: number;
    code: string | null;
    pin: string | null;
    expires: string | null;
    source: "paste" | "manual";
  }): "added" | "dupe" => {
    const id = stashIdFor(input.store, input.amount, input.code);
    if (stash.some((s) => s.id === id)) return "dupe";
    const hasCode = Boolean(input.code && input.code.trim());
    const twin = stash.find((s) => norm(s.store) === norm(input.store) && Math.abs(s.amount - input.amount) < 0.005);
    if (!hasCode && twin) return "dupe";
    const item: StashItem = {
      id,
      store: input.store,
      amount: input.amount,
      code: input.code,
      pin: input.pin,
      expires: input.expires,
      at: Date.now(),
      source: input.source,
    };
    const next =
      hasCode && twin && !twin.code ? [item, ...stash.filter((s) => s.id !== twin.id)] : [item, ...stash];
    setStash(next);
    try {
      localStorage.setItem(STASH_KEY, JSON.stringify(next));
    } catch {
      /* private mode — session-only */
    }
    if (stash.length === 0) {
      let celebrated = false;
      try {
        celebrated = localStorage.getItem(CELEBRATED_KEY) === "1";
      } catch {}
      if (!celebrated) {
        setConfetti(true);
        try {
          localStorage.setItem(CELEBRATED_KEY, "1");
        } catch {}
      }
    }
    return "added";
  };

  // /api/extract already reported the find to the room server-side — this just pulls
  // the fresh total so the live bar ticks up immediately instead of on the next poll.
  const refreshRoom = () => {
    fetch("/api/room", { cache: "no-store" })
      .then((r) => r.json())
      .then(setRoom)
      .catch(() => {});
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col px-5 pb-16">
      {confetti && <ConfettiBurst onDone={() => setConfetti(false)} />}
      <LiveBar room={room} />
      <header className="pt-6">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-600">Loot</p>
        <h1 className="mt-2 text-[2.4rem] font-bold leading-[1.05] tracking-tight text-zinc-900">
          Take your money <span className="text-emerald-600">back.</span>
        </h1>
        <p className="mt-3 text-[1.05rem] leading-relaxed text-zinc-500">
          Companies make <span className="font-semibold text-zinc-700">$21 billion a year</span> betting you forget your
          gift cards. Let&rsquo;s prove how much is hiding in this room — right now.
        </p>
      </header>

      <JoinStep onJoined={setRoom} />
      <FindStep
        onReported={setRoom}
        onStash={(f) => addToStash({ store: f.store, amount: f.amount, code: null, pin: null, expires: null, source: "manual" })}
      />
      <StashStep stash={stash} onAdd={addToStash} onRoom={refreshRoom} />

      <p className="mt-10 text-center text-xs text-zinc-400">
        Real inboxes, real numbers — nothing here is faked.
      </p>
    </main>
  );
}

function LiveBar({ room }: { room: RoomState | null }) {
  return (
    <div className="sticky top-0 z-10 -mx-5 mb-1 flex items-center justify-between border-b border-zinc-100 bg-white/85 px-5 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        <span className="text-sm font-semibold text-zinc-900">
          ${room ? Math.round(room.total).toLocaleString() : "—"}
        </span>
        <span className="text-sm text-zinc-400">found in this room</span>
      </div>
      <span className="text-sm font-medium text-zinc-400">{room ? room.joined : "—"} here</span>
    </div>
  );
}

function StepCard({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
          {n}
        </span>
        <h2 className="text-lg font-bold text-zinc-900">{title}</h2>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function JoinStep({ onJoined }: { onJoined: (r: RoomState) => void }) {
  const [joined, setJoined] = useState(false);
  // Optimistic: flip instantly, sync in the background — 400 phones on venue wifi.
  const join = () => {
    setJoined(true);
    fetch("/api/room/join", { method: "POST" })
      .then((r) => r.json())
      .then(onJoined)
      .catch(() => {});
  };
  return (
    <StepCard n={1} title="Join the room">
      {joined ? (
        <div className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-emerald-50 text-base font-semibold text-emerald-700">
          ✓ You&rsquo;re in
        </div>
      ) : (
        <button
          onClick={join}
          className="flex h-14 w-full touch-manipulation items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-lg font-semibold text-white shadow-sm transition active:scale-[0.98]"
        >
          I&rsquo;m in →
        </button>
      )}
    </StepCard>
  );
}

function FindStep({
  onReported,
  onStash,
}: {
  onReported: (r: RoomState) => void;
  onStash: (f: { store: string | null; amount: number }) => void;
}) {
  const [amount, setAmount] = useState("");
  const [store, setStore] = useState("");
  const [found, setFound] = useState<number | null>(null);

  // Optimistic: celebrate instantly, sync in the background.
  const submit = () => {
    const n = parseFloat(amount.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return;
    setFound(n);
    onStash({ store: store.trim() ? store.trim() : null, amount: n });
    fetch("/api/room/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: n, store }),
    })
      .then((r) => r.json())
      .then(onReported)
      .catch(() => {});
  };

  if (found !== null) {
    return (
      <StepCard n={2} title="Find yours">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-6 text-center text-white">
          <div className="text-5xl">💸</div>
          <div className="mt-2 text-4xl font-bold tabular-nums">${found.toFixed(2)}</div>
          <p className="mt-2 text-emerald-50">
            That&rsquo;s <span className="font-semibold">yours</span>. It&rsquo;s in your stash below.
          </p>
        </div>
        <button
          onClick={() => { setFound(null); setAmount(""); setStore(""); }}
          className="mt-2 flex h-12 w-full touch-manipulation items-center justify-center rounded-2xl text-sm font-semibold text-zinc-400 active:bg-zinc-50"
        >
          + found another one
        </button>
      </StepCard>
    );
  }

  return (
    <StepCard n={2} title="Find yours — 20 seconds">
      <ol className="space-y-1.5 text-[0.95rem] text-zinc-600">
        <li>1. Open your email app.</li>
        <li>
          2. Search <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-emerald-700">gift card</code>
          <span className="text-zinc-400"> (also try egift, reward, e-gift)</span>
        </li>
        <li>3. Find one you forgot about. 👀</li>
      </ol>
      <div className="mt-4 flex gap-2">
        <div className="flex h-13 flex-1 items-center rounded-2xl border border-zinc-200 px-3 focus-within:border-emerald-400">
          <span className="text-lg font-semibold text-zinc-400">$</span>
          <input
            inputMode="decimal"
            enterKeyHint="done"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="amount"
            className="h-13 w-full bg-transparent px-1 text-lg font-semibold text-zinc-900 outline-none"
          />
        </div>
        <input
          value={store}
          onChange={(e) => setStore(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          enterKeyHint="done"
          autoCapitalize="words"
          autoCorrect="off"
          placeholder="store"
          className="h-13 w-28 rounded-2xl border border-zinc-200 px-3 text-base text-zinc-900 outline-none focus:border-emerald-400"
        />
      </div>
      <button
        onClick={submit}
        disabled={!amount}
        className="mt-3 flex h-13 w-full touch-manipulation items-center justify-center rounded-2xl bg-zinc-900 text-base font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
      >
        Drop it in the room
      </button>
    </StepCard>
  );
}

// Step 3 — the personal mini-wallet. Paste an email → Haiku reads it → the card lands
// HERE, in your stash, and (server-side, via /api/extract) on the room counter.
function StashStep({
  stash,
  onAdd,
  onRoom,
}: {
  stash: StashItem[];
  onAdd: (input: { store: string | null; amount: number; code: string | null; pin: string | null; expires: string | null; source: "paste" | "manual" }) => "added" | "dupe";
  onRoom: () => void;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<NoticeKind | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const headRef = useRef<HTMLDivElement>(null);

  const total = stash.reduce((s, c) => s + c.amount, 0);
  const shown = useCountUp(total, 1000);

  const run = async () => {
    if (busy || email.trim().length < 10) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!r.ok) {
        setNotice("error"); // keep their paste — retry is one tap
        return;
      }
      const card = (await r.json()) as Card;
      if (!card.isGiftCard) {
        setNotice("miss");
        setEmail("");
        return;
      }
      if (typeof card.amount !== "number" || card.amount <= 0) {
        setNotice("noamount"); // real card, no value in the text — keep paste so they can add to it
        return;
      }
      const outcome = onAdd({
        store: card.store,
        amount: card.amount,
        code: card.code,
        pin: card.pin,
        expires: card.expires,
        source: "paste",
      });
      if (outcome === "dupe") {
        setNotice("dupe");
        setEmail("");
        return;
      }
      // Payout moment: card lands in the stash, total counts up, room ticks.
      setEmail("");
      setOpen(false);
      const id = stashIdFor(card.store, card.amount, card.code);
      setFreshId(id);
      setTimeout(() => setFreshId((v) => (v === id ? null : v)), 2500);
      onRoom();
      const reduced =
        typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setTimeout(() => {
        headRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      }, 300);
    } catch {
      setNotice("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepCard n={3} title="Your stash">
      {stash.length > 0 && (
        <div ref={headRef}>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">You&rsquo;re sitting on</p>
          <p className="mt-0.5 text-4xl font-bold tracking-tight text-emerald-600 tabular-nums">
            ${shown.toFixed(2)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            across <span className="font-semibold text-zinc-700">{stash.length} card{stash.length === 1 ? "" : "s"}</span>
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {stash.map((c) => (
              <StashCardRow key={c.id} card={c} fresh={c.id === freshId} />
            ))}
          </div>
        </div>
      )}

      {stash.length === 0 && (
        <div className="mb-3 flex w-fit items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700">
          💸 The average person forgets ~$244 in gift cards
        </div>
      )}

      {!open ? (
        <button
          onClick={() => { setOpen(true); setNotice(null); }}
          className={`flex h-12 w-full touch-manipulation items-center rounded-2xl border border-emerald-200 bg-emerald-50/50 px-4 text-base font-semibold text-emerald-600 active:scale-[0.98] ${stash.length === 0 ? "justify-between" : "justify-center"}`}
        >
          {stash.length === 0 ? (
            <>Paste a real gift-card email <span>→</span></>
          ) : (
            <>+ stack another one</>
          )}
        </button>
      ) : (
        <div className={stash.length > 0 ? "mt-1" : ""}>
          <p className="text-sm text-zinc-500">
            Paste any gift-card email. Loot reads it — the money lands here, in your stash.
          </p>
          <textarea
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Paste the email text here…"
            rows={5}
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="mt-2 w-full rounded-2xl border border-zinc-200 p-3 text-base text-zinc-900 outline-none focus:border-emerald-400"
          />
          <button
            onClick={run}
            disabled={busy || email.trim().length < 10}
            className="mt-2 flex h-12 w-full touch-manipulation items-center justify-center rounded-2xl bg-emerald-600 text-base font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? "Reading…" : "Cash it in"}
          </button>
        </div>
      )}

      {notice && <Notice kind={notice} />}
    </StepCard>
  );
}

function StashCardRow({ card, fresh }: { card: StashItem; fresh: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const action = merchantAction(card.store, card.code);
  const b = brandFor(card.store);

  const useIt = async () => {
    if (card.code) {
      try {
        await navigator.clipboard.writeText(card.pin ? `${card.code}  (PIN ${card.pin})` : card.code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        /* clipboard blocked — page still opens */
      }
    }
    window.open(action.url, "_blank", "noopener");
  };

  return (
    <div
      className={`rounded-2xl border bg-white p-3 shadow-sm transition ${fresh ? "border-emerald-300 ring-2 ring-emerald-200" : "border-zinc-100"}`}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
          style={{ backgroundColor: b.color + "1A" }}
        >
          {b.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-zinc-900">{card.store ?? "Gift card"}</p>
          <p className="truncate text-xs text-zinc-400">
            {card.expires ? `expires ${card.expires}` : card.source === "paste" ? "read from your email" : "your find"}
          </p>
        </div>
        <p className="text-xl font-bold tabular-nums text-emerald-600">${card.amount.toFixed(2)}</p>
      </div>

      {(card.code || card.pin) && (
        <button
          onClick={() => setRevealed((v) => !v)}
          className="mt-2 flex h-11 w-full touch-manipulation items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 text-left text-sm transition active:bg-zinc-100"
        >
          {revealed ? (
            <span className="truncate font-mono text-zinc-900">
              {card.code}
              {card.pin ? ` · PIN ${card.pin}` : ""}
            </span>
          ) : (
            <span className="font-medium text-emerald-600">🎟️ Reveal code</span>
          )}
          <span className="shrink-0 text-zinc-400">{revealed ? "hide" : "tap"}</span>
        </button>
      )}

      <button
        onClick={useIt}
        className="mt-2 flex h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-xl bg-zinc-900 text-sm font-semibold text-white transition active:scale-[0.98]"
      >
        {copied ? "Code copied ✓ — opening…" : `${action.label} →`}
      </button>
    </div>
  );
}

function Notice({ kind }: { kind: NoticeKind }) {
  if (kind === "dupe") {
    return (
      <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
        Already in your stash ✓ — that money&rsquo;s counted. Find a different email.
      </div>
    );
  }
  const text =
    kind === "miss" ? (
      <>
        That one&rsquo;s not a gift card — try another · tip: search{" "}
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-emerald-700">gift card</code> in your email
      </>
    ) : kind === "noamount" ? (
      <>Real card, but no dollar amount in that text — paste the part of the email that shows the value.</>
    ) : (
      <>Couldn&rsquo;t read that one — wifi hiccup. Your paste is still here, tap <span className="font-semibold">Cash it in</span> again.</>
    );
  return <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">{text}</div>;
}

function useCountUp(target: number, duration: number) {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0); // animate from the last shown value so each new card adds on, not restarts at $0
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

// Dependency-free payout confetti — two bottom cannons, gravity falloff, ~1.5s, emerald/gold.
// Same feel as the main wallet's first-reveal burst.
function ConfettiBurst({ onDone }: { onDone: () => void }) {
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
    const parts = Array.from({ length: 120 }, (_, i) => {
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
