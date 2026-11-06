// Lock-screen expiry reminders for the phone app (see MOBILE.md). This file only works out WHEN and
// WHAT to remind; app/NativeBridge.tsx hands the plan to the phone. Everything happens on the device:
// the phone itself schedules and shows the reminders, and nothing is sent to a server.

export type ReminderCard = {
  key: string; // stable per card (its code, else its id)
  store: string;
  amount: number | null;
  expires: string | null;
  used: boolean;
};

export type Reminder = { id: number; at: Date; title: string; body: string };

// Days before the expiry day to remind, and the wording for each.
const OFFSETS: { days: number; when: string }[] = [
  { days: 30, when: "in 30 days" },
  { days: 7, when: "in a week" },
  { days: 1, when: "tomorrow" },
  { days: 0, when: "today" },
];
const REMIND_AT_HOUR = 10; // 10am local time
const MAX_PENDING = 60; // iOS keeps at most 64 scheduled notifications per app

/** The expiry as a local calendar day ("2026-11-02" is all of Nov 2 where the person is). */
export function expiryDay(expires: string | null): Date | null {
  if (!expires) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expires);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = Date.parse(expires);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// A stable 31-bit id per card and offset, so re-planning replaces reminders instead of doubling them.
function reminderId(key: string, days: number): number {
  let h = 2166136261;
  for (const ch of `${key}|${days}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 1) || 1;
}

/** Every reminder still to come for these cards, soonest first, capped at what iOS allows. */
export function planReminders(cards: ReminderCard[], now = new Date()): Reminder[] {
  const out: Reminder[] = [];
  for (const c of cards) {
    if (c.used) continue;
    const day = expiryDay(c.expires);
    if (!day) continue;
    const worth = c.amount !== null ? `$${c.amount % 1 === 0 ? c.amount.toFixed(0) : c.amount.toFixed(2)} ` : "";
    for (const o of OFFSETS) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate() - o.days, REMIND_AT_HOUR);
      if (at.getTime() <= now.getTime() + 60_000) continue;
      out.push({
        id: reminderId(c.key, o.days),
        at,
        title: `⏰ Your ${worth}${c.store} gift card expires ${o.when}`,
        body: "Open Stash to use it before it's gone.",
      });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_PENDING);
}

/** The cards in this device's wallet, read from the same localStorage the wallet uses. */
export function walletReminderCards(): ReminderCard[] {
  const read = <T,>(k: string, fallback: T): T => {
    try {
      return (JSON.parse(localStorage.getItem(k) ?? "null") as T) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const used = read<Record<string, string>>("loot_used", {});
  type Saved = { id: string; store: string; amount: number | null; code: string | null; expires: string | null; status?: string };
  const physical = read<Saved[]>("loot_physical_v1", []);
  const email = read<{ cards?: Saved[] }>("loot_stash_v1", {}).cards ?? [];
  const toCard = (c: Saved, defaultUsed: boolean): ReminderCard => {
    const key = c.code || c.id;
    return { key, store: c.store, amount: c.amount, expires: c.expires, used: (used[key] ?? (defaultUsed ? "used" : "available")) === "used" };
  };
  return [...physical.map((c) => toCard(c, false)), ...email.map((c) => toCard(c, c.status === "likely_used"))];
}
