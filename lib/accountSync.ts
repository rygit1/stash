// Account sync (prototype, see ACCOUNTS.md). The wallet lives in this browser's localStorage, as it
// always has; sync copies each part of it, encrypted, to the user's account and back. The server
// only ever stores ciphertext (lib/vault.ts) and row-level security keeps each user to their own rows.
//
// Conflict rule for the prototype: per localStorage key, the most recent change wins.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decryptRecord, encryptRecord } from "./vault";

// The parts of the wallet that follow the user between devices. Device-only bookkeeping
// (celebration and notification dedupe) stays local.
export const SYNC_KEYS = [
  "loot_physical_v1", // scanned plastic cards
  "loot_stash_v1", // last email-scan snapshot
  "loot_used", // used/available overrides
  "loot_spend_v1", // manual spend log
  "loot_checked_v1", // balances the person checked
  "loot_notmine_v1", // "not mine" patterns
] as const;

let client: SupabaseClient | null = null;

/** The Supabase client, or null when accounts aren't configured (they are off unless the two
 *  NEXT_PUBLIC_SUPABASE_* variables are set, so the live site is unaffected). */
export function accounts(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, {
    auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
  });
  return client;
}

// What this device last synced, per key: a fingerprint of the value and the server's timestamp.
type Meta = Record<string, { hash: string; serverAt: string | null; changedAt: string | null }>;
const metaKey = (userId: string) => `stash_sync_meta_v1:${userId}`;
const readMeta = (userId: string): Meta => {
  try {
    return JSON.parse(localStorage.getItem(metaKey(userId)) ?? "{}");
  } catch {
    return {};
  }
};
const writeMeta = (userId: string, m: Meta) => localStorage.setItem(metaKey(userId), JSON.stringify(m));

async function fingerprint(value: string | null): Promise<string> {
  if (value === null) return "none";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type SyncResult = { pulled: string[]; pushed: string[]; stored: number };

/** Two-way sync of the wallet with the signed-in user's account. */
export async function syncWallet(sb: SupabaseClient, userId: string, walletKey: CryptoKey): Promise<SyncResult> {
  const meta = readMeta(userId);
  const now = new Date().toISOString();

  // 1. What changed on this device since the last sync?
  const local: Record<string, string | null> = {};
  for (const k of SYNC_KEYS) {
    local[k] = localStorage.getItem(k);
    const h = await fingerprint(local[k]);
    if (!meta[k]) meta[k] = { hash: "none", serverAt: null, changedAt: null };
    if (h !== meta[k].hash) {
      meta[k].hash = h;
      meta[k].changedAt = now; // dirty: needs pushing
    }
  }

  // 2. Pull: take the server's copy where it is newer than both our last sync and our own change.
  const { data: rows, error } = await sb.from("wallet_items").select("item_id, ciphertext, iv, updated_at");
  if (error) throw new Error(`pull failed: ${error.message}`);
  const pulled: string[] = [];
  for (const row of rows ?? []) {
    const k = row.item_id as string;
    if (!(SYNC_KEYS as readonly string[]).includes(k)) continue;
    const m = meta[k];
    const newerThanSynced = !m.serverAt || row.updated_at > m.serverAt;
    const localDirty = m.changedAt !== null;
    if (!newerThanSynced) continue;
    if (localDirty && m.changedAt! > row.updated_at) continue; // our edit is newer; it gets pushed below
    const value = await decryptRecord(walletKey, userId, k, row);
    localStorage.setItem(k, value);
    meta[k] = { hash: await fingerprint(value), serverAt: row.updated_at, changedAt: null };
    pulled.push(k);
  }

  // 3. Push what changed here and wasn't overwritten by a newer copy.
  const pushed: string[] = [];
  for (const k of SYNC_KEYS) {
    if (meta[k].changedAt === null || local[k] === null) continue;
    const sealed = await encryptRecord(walletKey, userId, k, local[k]!);
    const { data, error: upErr } = await sb
      .from("wallet_items")
      .upsert({ item_id: k, ...sealed, updated_at: new Date().toISOString() })
      .select("updated_at")
      .single();
    if (upErr) throw new Error(`push failed: ${upErr.message}`);
    meta[k].serverAt = data.updated_at;
    meta[k].changedAt = null;
    pushed.push(k);
  }

  writeMeta(userId, meta);
  // How many parts of the wallet are now saved (encrypted) in the account.
  const stored = SYNC_KEYS.filter((k) => meta[k].serverAt !== null).length;
  return { pulled, pushed, stored };
}

/** Forget this device's sync bookkeeping (on sign-out or account deletion). */
export const forgetSyncState = (userId: string) => localStorage.removeItem(metaKey(userId));
