"use client";

// Account + encrypted sync (prototype, see ACCOUNTS.md). Off unless NEXT_PUBLIC_SUPABASE_URL and
// NEXT_PUBLIC_SUPABASE_ANON_KEY are set, so the live site shows nothing new.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { accounts, forgetSyncState, SYNC_KEYS, syncWallet } from "@/lib/accountSync";
import {
  forgetDeviceKey,
  loadDeviceKey,
  newRecoveryCode,
  newWalletKey,
  normalizeRecoveryCode,
  saveDeviceKey,
  unwrapWalletKey,
  wrapWalletKey,
  type KeyWrap,
} from "@/lib/vault";

type Phase =
  | { kind: "loading" }
  | { kind: "off" }
  | { kind: "signedOut" }
  | { kind: "codeSent"; email: string }
  | { kind: "setup" } // signed in, no encrypted wallet yet
  | { kind: "showCode"; code: string; key: CryptoKey; replacing: boolean } // a new recovery code to save
  | { kind: "unlock"; wrap: KeyWrap } // wallet exists, this device doesn't have the key yet
  | { kind: "ready"; key: CryptoKey };

const btn =
  "flex h-12 w-full items-center justify-center rounded-xl bg-zinc-900 px-4 text-base font-semibold text-white transition hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-50";
const btnQuiet =
  "flex h-11 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50";
const input =
  "mt-1 h-12 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-base text-zinc-900 outline-none transition focus:border-emerald-400";

export default function AccountPage() {
  const sb = accounts();
  const [phase, setPhase] = useState<Phase>(sb ? { kind: "loading" } : { kind: "off" });
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<{ at: Date; pulled: number; pushed: number; stored: number } | null>(null);

  // Work out where this person is: signed out, needs setup, needs to unlock, or ready.
  const resolve = useCallback(
    async (u: User | null) => {
      setUser(u);
      if (!sb) return;
      if (!u) return setPhase({ kind: "signedOut" });
      const key = await loadDeviceKey(u.id);
      const { data: wrap, error: e } = await sb.from("key_wraps").select("wrapped_key, iv, salt").maybeSingle();
      if (e) return setError(e.message);
      if (!wrap) return setPhase({ kind: "setup" });
      if (key) return setPhase({ kind: "ready", key });
      setPhase({ kind: "unlock", wrap });
    },
    [sb],
  );

  useEffect(() => {
    if (!sb) return;
    void sb.auth.getSession().then(({ data }) => resolve(data.session?.user ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      // Defer: the Supabase client must not be called from inside this callback.
      setTimeout(() => void resolve(session?.user ?? null), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [sb, resolve]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doSync = useCallback(
    async (key: CryptoKey) => {
      if (!sb || !user) return;
      const r = await syncWallet(sb, user.id, key);
      setLastSync({ at: new Date(), pulled: r.pulled.length, pushed: r.pushed.length, stored: r.stored });
    },
    [sb, user],
  );

  // While ready: sync now, every 20 seconds, and whenever the tab comes back into view.
  const readyKey = phase.kind === "ready" ? phase.key : null;
  const syncing = useRef(false);
  useEffect(() => {
    if (!readyKey) return;
    const tick = async () => {
      if (syncing.current) return;
      syncing.current = true;
      try {
        await doSync(readyKey);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        syncing.current = false;
      }
    };
    void tick();
    const id = setInterval(tick, 20_000);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [readyKey, doSync]);

  return (
    <main className="mx-auto w-full max-w-md px-5 py-12 sm:py-16">
      <Link href="/" className="text-sm font-semibold text-emerald-600 hover:text-emerald-700">
        &larr; Back to Stash
      </Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-zinc-900">Your account</h1>
      <p className="mt-2 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
        Prototype · local testing only
      </p>

      {error && (
        <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
          {error === "wrong_recovery_code" ? "That recovery code doesn't match. Check it and try again." : error}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-4 text-[15px] leading-relaxed text-zinc-600">
        {phase.kind === "off" && <p>Accounts aren&rsquo;t switched on here. See ACCOUNTS.md to run them locally.</p>}

        {phase.kind === "loading" && <p>Loading&hellip;</p>}

        {phase.kind === "signedOut" && <SignIn busy={busy} run={run} onSent={(email) => setPhase({ kind: "codeSent", email })} />}

        {phase.kind === "codeSent" && (
          <VerifyCode email={phase.email} busy={busy} run={run} onBack={() => setPhase({ kind: "signedOut" })} />
        )}

        {phase.kind === "setup" && (
          <>
            <p>
              Turn on encrypted sync to keep your wallet on every device you sign in to. Your cards are locked on this device
              before they&rsquo;re uploaded, so Stash can&rsquo;t read them.
            </p>
            <button
              className={btn}
              disabled={busy}
              onClick={() =>
                run(async () => setPhase({ kind: "showCode", code: newRecoveryCode(), key: await newWalletKey(), replacing: false }))
              }
            >
              Turn on encrypted sync
            </button>
          </>
        )}

        {phase.kind === "showCode" && user && (
          <SaveCode
            code={phase.code}
            replacing={phase.replacing}
            busy={busy}
            onConfirm={() =>
              run(async () => {
                if (!sb) return;
                const wrap = await wrapWalletKey(phase.key, phase.code);
                const { error: e } = await sb.from("key_wraps").upsert({ ...wrap, updated_at: new Date().toISOString() });
                if (e) throw new Error(e.message);
                await saveDeviceKey(user.id, phase.key);
                setPhase({ kind: "ready", key: phase.key });
              })
            }
          />
        )}

        {phase.kind === "unlock" && user && (
          <Unlock
            busy={busy}
            run={run}
            onUnlock={async (code) => {
              const key = await unwrapWalletKey(phase.wrap, code);
              await saveDeviceKey(user.id, key);
              setPhase({ kind: "ready", key });
            }}
          />
        )}

        {phase.kind === "ready" && user && (
          <>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-emerald-900">
              <p className="font-semibold">🔒 Encrypted sync is on</p>
              <p className="mt-1 text-sm">Signed in as {user.email}</p>
              <p className="mt-1 text-sm" data-testid="sync-status">
                {!lastSync
                  ? "Syncing…"
                  : lastSync.pulled + lastSync.pushed === 0
                    ? `Up to date (checked ${lastSync.at.toLocaleTimeString()})`
                    : `Synced ${lastSync.at.toLocaleTimeString()}: ${lastSync.pulled} downloaded, ${lastSync.pushed} uploaded`}
              </p>
              <p className="mt-1 text-sm">
                {lastSync && (lastSync.stored === 0 ? "Nothing saved in your account yet." : `${lastSync.stored} part${lastSync.stored === 1 ? "" : "s"} of your wallet saved, encrypted.`)}
              </p>
            </div>
            {lastSync && lastSync.pulled > 0 && (
              <p className="text-sm">
                Your wallet was updated from another device.{" "}
                <Link href="/" className="font-semibold text-emerald-700 underline">
                  Open your wallet
                </Link>
              </p>
            )}
            <button className={btn} disabled={busy} onClick={() => run(() => doSync(phase.key))}>
              Sync now
            </button>
            <button
              className={btnQuiet}
              disabled={busy}
              onClick={() => setPhase({ kind: "showCode", code: newRecoveryCode(), key: phase.key, replacing: true })}
            >
              Get a new recovery code
            </button>
            <SignOutAndDelete
              busy={busy}
              run={run}
              onDone={async (removeCards) => {
                await forgetDeviceKey(user.id);
                forgetSyncState(user.id);
                if (removeCards) for (const k of SYNC_KEYS) localStorage.removeItem(k);
                // "local": sign out this device only, leaving the person's other devices signed in.
                await sb?.auth.signOut({ scope: "local" });
              }}
              onDelete={async () => {
                const { error: e } = await sb!.rpc("delete_my_account");
                if (e) throw new Error(e.message);
              }}
            />
          </>
        )}
      </div>
    </main>
  );
}

type Run = (fn: () => Promise<void>) => Promise<void>;

function SignIn({ busy, run, onSent }: { busy: boolean; run: Run; onSent: (email: string) => void }) {
  const [email, setEmail] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const { error } = await accounts()!.auth.signInWithOtp({
            email: email.trim(),
            options: { emailRedirectTo: `${window.location.origin}/account`, shouldCreateUser: true },
          });
          if (error) throw new Error(error.message);
          onSent(email.trim());
        });
      }}
    >
      <p>Sign in or create an account with your email. No password: we&rsquo;ll email you a sign-in code.</p>
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Email</span>
        <input className={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </label>
      <button className={btn} disabled={busy || !email.includes("@")}>
        Email me a sign-in code
      </button>
    </form>
  );
}

function VerifyCode({ email, busy, run, onBack }: { email: string; busy: boolean; run: Run; onBack: () => void }) {
  const [code, setCode] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const { error } = await accounts()!.auth.verifyOtp({ email, token: code.trim(), type: "email" });
          if (error) throw new Error(error.message);
        });
      }}
    >
      <p>
        We sent a code to <strong>{email}</strong>. Enter it below, or tap the link in the email.
      </p>
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Code</span>
        <input
          className={`${input} font-mono tracking-[0.3em]`}
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      <button className={btn} disabled={busy || code.trim().length < 6}>
        Sign in
      </button>
      <button type="button" className="text-sm text-zinc-400 hover:text-zinc-600" onClick={onBack}>
        Use a different email
      </button>
    </form>
  );
}

function SaveCode({ code, replacing, busy, onConfirm }: { code: string; replacing: boolean; busy: boolean; onConfirm: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <>
      <p>
        {replacing ? "Your new recovery code. Once you save it, the old one stops working." : "This is your recovery code."} You
        need it to open your wallet on a new phone or computer. <strong>Stash can&rsquo;t recover it for you</strong>, so save it
        somewhere safe: a password manager, a screenshot, or on paper.
      </p>
      <p
        className="select-all whitespace-nowrap rounded-2xl border-2 border-dashed border-zinc-300 bg-white px-3 py-5 text-center font-mono text-[15px] font-bold tracking-wide text-zinc-900 sm:text-lg"
        data-testid="recovery-code"
      >
        {code}
      </p>
      <button
        className={btnQuiet}
        onClick={() =>
          void navigator.clipboard.writeText(code).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? "Copied ✓" : "Copy code"}
      </button>
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-1" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I saved my recovery code somewhere safe.
      </label>
      <button className={btn} disabled={busy || !saved} onClick={onConfirm}>
        {replacing ? "Use this new code" : "Turn on sync"}
      </button>
    </>
  );
}

function Unlock({ busy, run, onUnlock }: { busy: boolean; run: Run; onUnlock: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => onUnlock(code));
      }}
    >
      <p>Your wallet is locked on this device. Enter your recovery code to unlock it here.</p>
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Recovery code</span>
        <input
          className={`${input} font-mono uppercase`}
          placeholder="STASH-XXXX-XXXX-XXXX-XXXX-XXXX"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>
      <button className={btn} disabled={busy || !normalizeRecoveryCode(code)}>
        Unlock my wallet
      </button>
    </form>
  );
}

function SignOutAndDelete({
  busy,
  run,
  onDone,
  onDelete,
}: {
  busy: boolean;
  run: Run;
  onDone: (removeCards: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [removeCards, setRemoveCards] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState("");
  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-zinc-200 pt-6">
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-1" checked={removeCards} onChange={(e) => setRemoveCards(e.target.checked)} />
        Also remove my cards from this device (for shared computers)
      </label>
      <button className={btnQuiet} disabled={busy} onClick={() => run(() => onDone(removeCards))}>
        Sign out of this device
      </button>

      <details className="mt-4 rounded-xl border border-red-200 px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-red-700">Delete my account</summary>
        <p className="mt-2 text-sm">
          This permanently deletes your account and the encrypted copy of your wallet from Stash. Cards already on this device
          stay here. Type <strong>DELETE</strong> to confirm.
        </p>
        <input className={input} value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} />
        <button
          className="mt-3 flex h-11 w-full items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
          disabled={busy || confirmDelete !== "DELETE"}
          onClick={() =>
            run(async () => {
              await onDelete();
              await onDone(false);
            })
          }
        >
          Permanently delete my account
        </button>
      </details>
    </div>
  );
}
