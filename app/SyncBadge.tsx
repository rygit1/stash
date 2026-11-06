"use client";

// A small badge in the corner of the wallet (not the landing page, where it would cover the page) that keeps it synced in the background (accounts
// prototype, see ACCOUNTS.md). Renders nothing unless accounts are configured, so the live site is
// unaffected. When another device's changes arrive it fires WALLET_SYNCED_EVENT so the page can
// re-read the wallet from localStorage.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { accounts, syncWallet, walletCardCount, WALLET_SYNCED_EVENT } from "@/lib/accountSync";
import { loadDeviceKey } from "@/lib/vault";

type State =
  | { kind: "hidden" }
  | { kind: "signedOut" }
  | { kind: "locked" }
  | { kind: "syncing" }
  | { kind: "synced"; cards: number }
  | { kind: "paused" };

const SYNC_EVERY_MS = 5_000;

export default function SyncBadge() {
  const [state, setState] = useState<State>({ kind: "hidden" });
  const busy = useRef(false);

  useEffect(() => {
    const sb = accounts();
    if (!sb) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cleanupListeners = () => {};

    const tick = async (userId: string, key: CryptoKey) => {
      if (busy.current || stopped || document.visibilityState === "hidden") return;
      busy.current = true;
      try {
        const r = await syncWallet(sb, userId, key);
        if (r.pulled.length) window.dispatchEvent(new Event(WALLET_SYNCED_EVENT));
        if (!stopped) setState({ kind: "synced", cards: walletCardCount() });
      } catch {
        if (!stopped) setState({ kind: "paused" });
      } finally {
        busy.current = false;
      }
    };

    void (async () => {
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      if (stopped) return;
      if (!user) return setState({ kind: "signedOut" });
      const key = await loadDeviceKey(user.id);
      if (stopped) return;
      if (!key) return setState({ kind: "locked" });
      setState({ kind: "syncing" });
      void tick(user.id, key);
      timer = setInterval(() => void tick(user.id, key), SYNC_EVERY_MS);
      const onVisible = () => void tick(user.id, key);
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", onVisible);
      cleanupListeners = () => {
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("focus", onVisible);
      };
    })();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      cleanupListeners();
    };
  }, []);

  if (state.kind === "hidden") return null;
  const label =
    state.kind === "signedOut"
      ? "☁️ Keep your cards on every device"
      : state.kind === "locked"
        ? "🔒 Unlock your synced wallet"
        : state.kind === "syncing"
          ? "Syncing…"
          : state.kind === "paused"
            ? "⚠️ Sync paused"
            : `🔒 Synced · ${state.cards} card${state.cards === 1 ? "" : "s"}`;
  return (
    <Link
      href="/account"
      data-testid="sync-badge"
      style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
      className="fixed right-4 z-50 rounded-full border border-zinc-200 bg-white/95 px-3.5 py-2 text-xs font-semibold text-zinc-700 shadow-md backdrop-blur transition hover:bg-white"
    >
      {label}
    </Link>
  );
}
