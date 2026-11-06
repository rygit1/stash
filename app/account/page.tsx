"use client";

// Account + encrypted sync (prototype, see ACCOUNTS.md). Off unless NEXT_PUBLIC_SUPABASE_URL and
// NEXT_PUBLIC_SUPABASE_ANON_KEY are set, so the live site shows nothing new.
//
// The flow is kept to as few screens as possible:
//   new account:  email → link → save your recovery code → wallet
//   new device:   email → link → enter your recovery code → wallet (cards already there)
// After that, app/SyncBadge.tsx keeps the wallet synced in the background.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { accounts, forgetSyncState, SYNC_KEYS, syncWallet, walletCardCount } from "@/lib/accountSync";
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
  | { kind: "insecure" }
  | { kind: "signedOut" }
  | { kind: "checkEmail"; email: string }
  | { kind: "saveCode"; code: string; key: CryptoKey; replacing: boolean }
  | { kind: "unlock"; wrap: KeyWrap }
  | { kind: "ready" };

const btn =
  "flex h-12 w-full items-center justify-center rounded-xl bg-zinc-900 px-4 text-base font-semibold text-white transition hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-40";
const btnQuiet =
  "flex h-11 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-40";
const input =
  "mt-1 h-12 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base text-zinc-900 outline-none transition focus:border-emerald-400";

export default function AccountPage() {
  const sb = accounts();
  const router = useRouter();
  const goToWallet = useCallback(() => router.push("/?wallet=1"), [router]);
  const [phase, setPhase] = useState<Phase>(sb ? { kind: "loading" } : { kind: "off" });
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Where is this person? Signed out, brand new (needs a recovery code), on a new device (needs to
  // unlock), or all set.
  const resolve = useCallback(
    async (u: User | null) => {
      setUser(u);
      if (!sb) return;
      if (!u) return setPhase({ kind: "signedOut" });
      const key = await loadDeviceKey(u.id);
      const { data: wrap, error: e } = await sb.from("key_wraps").select("wrapped_key, iv, salt").maybeSingle();
      if (e) return setError(e.message);
      if (!wrap) {
        // Sign-in can report itself more than once: keep the first code, so the one the person is
        // saving is never swapped out from under them.
        const fresh = { code: newRecoveryCode(), key: await newWalletKey() };
        return setPhase((p) => (p.kind === "saveCode" ? p : { kind: "saveCode", ...fresh, replacing: false }));
      }
      if (!key) return setPhase({ kind: "unlock", wrap });
      setPhase({ kind: "ready" });
    },
    [sb],
  );

  useEffect(() => {
    if (!sb) return;
    // The wallet is encrypted with the browser's built-in encryption, which only works on secure
    // (https) pages. The live site and the real app are https; the phone app while testing against a
    // Mac (http://192.168.x.x, see MOBILE.md) is not, so say so instead of failing halfway.
    if (!window.isSecureContext || !window.crypto?.subtle) {
      setPhase({ kind: "insecure" }); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
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

  return (
    <main className="mx-auto w-full max-w-md px-5 py-12 sm:py-16">
      <Link href="/" className="text-sm font-semibold text-emerald-600 hover:text-emerald-700">
        &larr; Back to Stash
      </Link>

      {error && (
        <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
          {error === "wrong_recovery_code" ? "That code doesn't match. Check it and try again." : error}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-4 text-[15px] leading-relaxed text-zinc-600">
        {phase.kind === "off" && (
          <>
            <Title>Accounts are coming soon</Title>
            <p>For now, your cards stay on this device.</p>
          </>
        )}

        {phase.kind === "insecure" && (
          <>
            <Title>Accounts need a secure connection</Title>
            <p>
              Your wallet is encrypted on this device, and phones only allow that on secure (https) pages. This
              test version is loading Stash from a computer without https, so accounts can&rsquo;t work here. The
              real app can.
            </p>
            <p className="mt-2 text-sm text-zinc-500">Your cards on this device are still saved.</p>
          </>
        )}

        {phase.kind === "loading" && <p>Loading&hellip;</p>}

        {phase.kind === "signedOut" && (
          <SignIn busy={busy} run={run} onSent={(email) => setPhase({ kind: "checkEmail", email })} />
        )}

        {phase.kind === "checkEmail" && (
          <CheckEmail email={phase.email} busy={busy} run={run} onBack={() => setPhase({ kind: "signedOut" })} />
        )}

        {phase.kind === "saveCode" && user && (
          <SaveCode
            code={phase.code}
            replacing={phase.replacing}
            busy={busy}
            onDone={() =>
              run(async () => {
                if (!sb) return;
                const wrap = await wrapWalletKey(phase.key, phase.code);
                const { error: e } = await sb.from("key_wraps").upsert({ ...wrap, updated_at: new Date().toISOString() });
                if (e) throw new Error(e.message);
                await saveDeviceKey(user.id, phase.key);
                if (phase.replacing) return setPhase({ kind: "ready" });
                await syncWallet(sb, user.id, phase.key);
                goToWallet();
              })
            }
          />
        )}

        {phase.kind === "unlock" && user && sb && (
          <Unlock
            email={user.email ?? ""}
            busy={busy}
            run={run}
            onUnlock={async (code) => {
              const key = await unwrapWalletKey(phase.wrap, code);
              await saveDeviceKey(user.id, key);
              await syncWallet(sb, user.id, key);
              goToWallet();
            }}
          />
        )}

        {phase.kind === "ready" && user && (
          <Ready
            email={user.email ?? ""}
            onOpenWallet={goToWallet}
            busy={busy}
            run={run}
            onNewCode={() =>
              run(async () => {
                const key = await loadDeviceKey(user.id);
                if (key) setPhase({ kind: "saveCode", code: newRecoveryCode(), key, replacing: true });
              })
            }
            onSignOut={async (removeCards) => {
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
        )}
      </div>
    </main>
  );
}

type Run = (fn: () => Promise<void>) => Promise<void>;

function Title({ children }: { children: React.ReactNode }) {
  return <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{children}</h1>;
}

function SignIn({ busy, run, onSent }: { busy: boolean; run: Run; onSent: (email: string) => void }) {
  const [email, setEmail] = useState("");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const { error } = await accounts()!.auth.signInWithOtp({
            email: email.trim(),
            // In the phone app the email link has to open the app, not Safari (see app/NativeBridge.tsx).
            options: {
              emailRedirectTo: Capacitor.isNativePlatform() ? "pro.stashinc.app://account" : `${window.location.origin}/account`,
              shouldCreateUser: true,
            },
          });
          if (error) throw new Error(error.message);
          onSent(email.trim());
        });
      }}
    >
      <Title>Your cards, on every device</Title>
      <p>
        Sign in with your email and your wallet follows you to your phone, laptop and tablet. It&rsquo;s locked before it
        leaves this device, so <strong className="text-zinc-800">only you can open it, not even Stash</strong>.
      </p>
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Email</span>
        <input className={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </label>
      <button className={btn} disabled={busy || !email.includes("@")}>
        Continue
      </button>
      <p className="text-center text-xs text-zinc-400">No password. We&rsquo;ll email you a link to sign in.</p>
    </form>
  );
}

function CheckEmail({ email, busy, run, onBack }: { email: string; busy: boolean; run: Run; onBack: () => void }) {
  const [code, setCode] = useState("");
  return (
    <div className="flex flex-col gap-4">
      <Title>Check your email 📬</Title>
      <p>
        We sent a sign-in link to <strong className="text-zinc-800">{email}</strong>. Open it on this device and you&rsquo;ll
        come right back here.
      </p>
      <details className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-700">Got a 6-digit code instead?</summary>
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const { error } = await accounts()!.auth.verifyOtp({ email, token: code.trim(), type: "email" });
              if (error) throw new Error(error.message);
            });
          }}
        >
          <input
            className={`${input} text-center font-mono tracking-[0.4em]`}
            aria-label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className={btn} disabled={busy || code.trim().length < 6}>
            Sign in
          </button>
        </form>
      </details>
      <button type="button" className="text-sm text-zinc-400 hover:text-zinc-600" onClick={onBack}>
        Use a different email
      </button>
    </div>
  );
}

function SaveCode({ code, replacing, busy, onDone }: { code: string; replacing: boolean; busy: boolean; onDone: () => void }) {
  const [saved, setSaved] = useState<null | "copied" | "downloaded" | "written">(null);
  const download = () => {
    const blob = new Blob(
      [`Your Stash recovery code:\n\n${code}\n\nYou need it to open your Stash wallet on a new device. Keep it somewhere safe.\n`],
      { type: "text/plain" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "stash-recovery-code.txt";
    a.click();
    URL.revokeObjectURL(a.href);
    setSaved("downloaded");
  };
  return (
    <div className="flex flex-col gap-4">
      <Title>{replacing ? "Your new recovery code" : "One last thing 🔑"}</Title>
      <p>
        This code unlocks your wallet on a new phone or computer. <strong className="text-zinc-800">Only you have it</strong>,
        so Stash can&rsquo;t read your cards, and can&rsquo;t recover this code if you lose it.
        {replacing && " Your old code stops working once you continue."}
      </p>
      <p
        className="select-all whitespace-nowrap rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50 px-3 py-5 text-center font-mono text-[15px] font-bold tracking-wide text-emerald-900 sm:text-lg"
        data-testid="recovery-code"
      >
        {code}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button
          className={btnQuiet}
          onClick={() =>
            void navigator.clipboard.writeText(code).then(
              () => setSaved("copied"),
              () => setSaved(null),
            )
          }
        >
          {saved === "copied" ? "Copied ✓" : "Copy"}
        </button>
        <button className={btnQuiet} onClick={download}>
          {saved === "downloaded" ? "Saved ✓" : "Save as file"}
        </button>
      </div>
      <button type="button" className="text-sm text-zinc-500 underline hover:text-zinc-700" onClick={() => setSaved("written")}>
        {saved === "written" ? "Wrote it down ✓" : "I wrote it down"}
      </button>
      <button className={btn} disabled={busy || !saved} onClick={onDone}>
        {replacing ? "Use this code" : "Open my wallet"}
      </button>
    </div>
  );
}

function Unlock({ email, busy, run, onUnlock }: { email: string; busy: boolean; run: Run; onUnlock: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => onUnlock(code));
      }}
    >
      <Title>Welcome back 👋</Title>
      <p>
        You&rsquo;re signed in as <strong className="text-zinc-800">{email}</strong>. Enter your recovery code to open your
        wallet on this device.
      </p>
      <input
        className={`${input} font-mono uppercase`}
        aria-label="Recovery code"
        placeholder="STASH-XXXX-XXXX-XXXX-XXXX-XXXX"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
      />
      <button className={btn} disabled={busy || !normalizeRecoveryCode(code)}>
        {busy ? "Unlocking…" : "Unlock my wallet"}
      </button>
    </form>
  );
}

function Ready({
  email,
  onOpenWallet,
  busy,
  run,
  onNewCode,
  onSignOut,
  onDelete,
}: {
  email: string;
  onOpenWallet: () => void;
  busy: boolean;
  run: Run;
  onNewCode: () => void;
  onSignOut: (removeCards: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [removeCards, setRemoveCards] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState("");
  // Only ever rendered in the browser (after sign-in is checked), so localStorage is available.
  const [cards] = useState(() => walletCardCount());
  return (
    <div className="flex flex-col gap-4">
      <Title>You&rsquo;re all set ✅</Title>
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-emerald-900">
        <p className="text-lg font-bold" data-testid="ready-cards">
          {`${cards} card${cards === 1 ? "" : "s"}`} on all your devices
        </p>
        <p className="mt-1 text-sm">Locked so only you can open them. Signed in as {email}.</p>
      </div>
      <button className={btn} onClick={onOpenWallet}>
        Open my wallet
      </button>

      <details className="mt-4 rounded-xl border border-zinc-200 bg-white px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-700">Manage account</summary>
        <div className="mt-4 flex flex-col gap-3">
          <button className={btnQuiet} disabled={busy} onClick={onNewCode}>
            Get a new recovery code
          </button>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-1" checked={removeCards} onChange={(e) => setRemoveCards(e.target.checked)} />
            Also remove my cards from this device (for shared computers)
          </label>
          <button className={btnQuiet} disabled={busy} onClick={() => run(() => onSignOut(removeCards))}>
            Sign out of this device
          </button>
          <div className="mt-2 border-t border-zinc-200 pt-4">
            <p className="text-sm">
              <strong className="text-red-700">Delete my account:</strong> permanently removes your account and the locked
              copy of your wallet. Cards already on this device stay here. Type <strong>DELETE</strong> to confirm.
            </p>
            <input className={input} aria-label="Type DELETE" value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} />
            <button
              className="mt-3 flex h-11 w-full items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
              disabled={busy || confirmDelete !== "DELETE"}
              onClick={() =>
                run(async () => {
                  await onDelete();
                  await onSignOut(false);
                })
              }
            >
              Permanently delete my account
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
