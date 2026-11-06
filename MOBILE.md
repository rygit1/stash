# Stash phone app (prototype)

The phone app is a native shell around the Stash website, built with [Capacitor](https://capacitorjs.com).
The same pages run inside it, plus two things only a phone can do:

- **Expiry reminders on the lock screen.** `lib/expiryReminders.ts` plans reminders 30 days, 7 days,
  1 day and on the day a card expires (10am local time). `app/NativeBridge.tsx` hands them to the
  phone, which schedules and shows them by itself. Nothing is sent to a server.
- **Sign-in links open the app.** The email link goes to `pro.stashinc.app://account`, and the app
  finishes signing in.

In a normal browser `NativeBridge` does nothing, so the website is unchanged.

| Piece | Where |
| --- | --- |
| App settings (id `pro.stashinc.app`, which site it loads) | `capacitor.config.ts` |
| iPhone project (open in Xcode) | `ios/` |
| Android project (open in Android Studio) | `android/` |
| Page shown when there's no internet | `mobile/www/index.html` |

Built normally, the app loads `https://stashinc.pro`. While testing, it loads the dev server on
your Mac instead (set with `CAP_SERVER_URL`, below).

> Accounts are still a prototype (see ACCOUNTS.md). Don't merge this to main until after the
> Google audit and the privacy policy update.

---

## Run it on your iPhone (Mac, free Apple ID)

You need: a Mac, your iPhone, its cable, and about 15 GB free.

### 1. Install Xcode (once)

1. Install **Xcode** from the Mac App Store (needs Xcode 15 or newer).
2. Open it. When it asks which platforms to download, **untick iOS simulator / leave only macOS**.
   You don't need simulators to run on a real phone, and they take 8+ GB.
3. Xcode → Settings → **Accounts** → **+** → Apple ID → sign in with your normal Apple ID.
   This gives you a free "Personal Team".

### 2. Get the code

```bash
cd ~/stash
git fetch origin
git checkout phone-app
git pull
npm install
```

### 3. Start Stash so your phone can reach it

Find your Mac's Wi-Fi address:

```bash
ipconfig getifaddr en0
```

It looks like `192.168.1.23`. Add this line to `.env.local` (use your number):

```
STASH_DEV_HOST=192.168.1.23
```

Then start the dev server so other devices on your Wi-Fi can open it:

```bash
npm run dev -- -H 0.0.0.0
```

Leave that window open. Your iPhone must be on the **same Wi-Fi** as the Mac.

### 4. Build the app and open it in Xcode

In a **new** Terminal window:

```bash
cd ~/stash
CAP_SERVER_URL=http://192.168.1.23:3000 npx cap sync ios
npx cap open ios
```

### 5. Run it on the iPhone

1. Plug the iPhone into the Mac. Tap **Trust** on the phone if asked.
2. In Xcode, click **App** in the left sidebar → **Signing & Capabilities** →
   **Team**: pick your name (Personal Team).
   If it says the bundle id is taken, change it to something like `pro.stashinc.app.luca`.
3. At the top of Xcode, pick your iPhone as the device, then press **▶ Run**.
4. First time only, on the iPhone:
   - Settings → Privacy & Security → **Developer Mode** → on (the phone restarts).
   - Settings → General → **VPN & Device Management** → your Apple ID → **Trust**.
5. Press **▶ Run** again. Stash opens on the phone.

With a free Apple ID the app stops opening after **7 days**. Plug in and press Run again to renew it.

### 6. Turn on sign-in links for the app (once)

In the hosted Supabase project: **Authentication → URL Configuration → Redirect URLs** → add

```
pro.stashinc.app://account
```

---

## Test the reminders

1. In the app, add a card whose expiry is **tomorrow** or **in 7 days**.
2. Within about 15 seconds the app asks to send notifications. Tap **Allow**.
3. Reminders show up at 10am on the right days, even when the app is closed.

Quickest check: before 10am, add a card that expires tomorrow. The "expires tomorrow" reminder
arrives at 10am today. After 10am, the soonest one is the "expires today" reminder at 10am tomorrow.

Marking a card used, or deleting it, cancels its reminders.

## When you change code

- Web code (pages, `lib/`, `app/`): just save. The app loads the dev server, so pull to refresh or
  reopen the app.
- `capacitor.config.ts`, plugins, or `ios/`: run `npx cap sync ios` again, then Run in Xcode.

## Not done yet

- Native card scanner (next).
- Gmail in the app. It needs new Google sign-in clients for iOS and Android, so it waits until
  Google finishes reviewing the project.
- App Store / Play Store release (needs the $99/year Apple developer account).
