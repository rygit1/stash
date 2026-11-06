"use client";

// Only does anything inside the Stash phone app (see MOBILE.md); in a normal browser it renders
// nothing and returns straight away.
//  - Expiry reminders: plans them from the wallet (lib/expiryReminders.ts) and has the phone schedule
//    them as real lock-screen notifications. Re-plans when the wallet changes.
//  - Sign-in links: an email link opens the app at pro.stashinc.app://account; this finishes signing
//    in with the tokens in that link and opens the Account page.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import { accounts } from "@/lib/accountSync";
import { planReminders, walletReminderCards } from "@/lib/expiryReminders";

const REPLAN_EVERY_MS = 15_000;

export default function NativeBridge() {
  const router = useRouter();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let stopped = false;
    let lastPlan = "";

    const syncReminders = async () => {
      const plan = planReminders(walletReminderCards());
      const fingerprint = JSON.stringify(plan.map((r) => [r.id, r.at.getTime(), r.title]));
      if (fingerprint === lastPlan) return;
      // Ask for permission only once there is actually something to remind about.
      let perm = await LocalNotifications.checkPermissions();
      if (plan.length && perm.display === "prompt") perm = await LocalNotifications.requestPermissions();
      if (perm.display !== "granted") return;
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
      if (plan.length) {
        await LocalNotifications.schedule({
          notifications: plan.map((r) => ({ id: r.id, title: r.title, body: r.body, schedule: { at: r.at, allowWhileIdle: true } })),
        });
      }
      if (!stopped) lastPlan = fingerprint;
    };

    void syncReminders();
    const timer = setInterval(() => void syncReminders(), REPLAN_EVERY_MS);

    const linkListener = App.addListener("appUrlOpen", async ({ url }) => {
      if (!url.startsWith("pro.stashinc.app://account")) return;
      const params = new URLSearchParams(new URL(url).hash.slice(1));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const sb = accounts();
      if (sb && accessToken && refreshToken) await sb.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      router.push("/account");
    });

    return () => {
      stopped = true;
      clearInterval(timer);
      void linkListener.then((l) => l.remove());
    };
  }, [router]);

  return null;
}
