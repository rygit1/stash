// Encryption for account sync (prototype, see ACCOUNTS.md). Everything here runs on the user's own
// device with the browser's built-in Web Crypto. Stash's server only ever receives the output.
//
// - The wallet key: 32 random bytes, AES-256-GCM. Made on the device, kept on the device.
// - The recovery code: 20 random characters shown to the user once. It turns (via HKDF) into the
//   key that locks a copy of the wallet key, so a new device can unlock the wallet. Stash never
//   sees the code.
// - Each synced record is encrypted with the wallet key, bound (as AES-GCM "additional data") to the
//   user and the record's name, so a stored ciphertext can't be swapped into another user or record.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
export const fromB64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

// Crockford base32: no I, L, O or U, so the code is easy to read aloud and type.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 20; // 100 bits of randomness

/** A fresh recovery code, e.g. "STASH-7KQ2-M9XP-4RTW-H8DN-2B6C". */
export function newRecoveryCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  const chars = Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
  return `STASH-${chars.match(/.{4}/g)!.join("-")}`;
}

/** The 20 code characters from whatever the person typed: case, spaces, dashes and the
 *  "STASH-" prefix are ignored, and look-alike letters are read as the digits they resemble. */
export function normalizeRecoveryCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/^\s*STASH[\s-]*/, "")
    .replace(/[\s-]/g, "")
    .replace(/[OIL]/g, (c) => (c === "O" ? "0" : "1"));
  if (cleaned.length !== CODE_LENGTH || [...cleaned].some((c) => !ALPHABET.includes(c))) return null;
  return cleaned;
}

async function recoveryKey(code: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) throw new Error("bad_recovery_code");
  const base = await crypto.subtle.importKey("raw", enc.encode(normalized), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: enc.encode("stash-recovery-v1") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** A new wallet key. Extractable only so it can be locked again under a new recovery code; it is
 *  kept on this device and never leaves it unencrypted. */
export function newWalletKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export type KeyWrap = { wrapped_key: string; iv: string; salt: string };

/** Lock the wallet key with a recovery code, for upload. */
export async function wrapWalletKey(walletKey: CryptoKey, code: string): Promise<KeyWrap> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", walletKey));
  const locked = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await recoveryKey(code, salt), raw);
  raw.fill(0);
  return { wrapped_key: toB64(new Uint8Array(locked)), iv: toB64(iv), salt: toB64(salt) };
}

/** Unlock the wallet key with a recovery code. Throws "wrong_recovery_code" if it doesn't match. */
export async function unwrapWalletKey(wrap: KeyWrap, code: string): Promise<CryptoKey> {
  const key = await recoveryKey(code, fromB64(wrap.salt));
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(wrap.iv) }, key, fromB64(wrap.wrapped_key)));
  } catch {
    throw new Error("wrong_recovery_code");
  }
  const walletKey = await crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
  raw.fill(0);
  return walletKey;
}

const recordAad = (userId: string, itemId: string) => enc.encode(`stash-v1|${userId}|${itemId}`);

/** Encrypt one record's text for upload. */
export async function encryptRecord(walletKey: CryptoKey, userId: string, itemId: string, plaintext: string) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: recordAad(userId, itemId) },
    walletKey,
    enc.encode(plaintext),
  );
  return { ciphertext: toB64(new Uint8Array(ct)), iv: toB64(iv) };
}

/** Decrypt one downloaded record. Throws if it was tampered with or belongs to another user/record. */
export async function decryptRecord(walletKey: CryptoKey, userId: string, itemId: string, rec: { ciphertext: string; iv: string }) {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(rec.iv), additionalData: recordAad(userId, itemId) },
    walletKey,
    fromB64(rec.ciphertext),
  );
  return dec.decode(pt);
}

// ── Keeping the wallet key on this device (IndexedDB; a CryptoKey is stored as-is, not as text) ──

const DB = "stash-vault";
const STORE = "keys";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const saveDeviceKey = (userId: string, key: CryptoKey) => withStore("readwrite", (s) => s.put(key, `wallet:${userId}`));
export const loadDeviceKey = (userId: string) =>
  withStore<CryptoKey | undefined>("readonly", (s) => s.get(`wallet:${userId}`) as IDBRequest<CryptoKey | undefined>);
export const forgetDeviceKey = (userId: string) => withStore("readwrite", (s) => s.delete(`wallet:${userId}`));
