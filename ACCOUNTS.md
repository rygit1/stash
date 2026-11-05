# Accounts with encrypted sync (prototype)

**Status: local testing only. Do not merge into `main` until Google's verification and the CASA
assessment are finished, the privacy policy is updated, and Google has been told.**

Accounts let a person's wallet follow them to any device. Cards are locked (encrypted) on the device
before upload, so Stash's server only ever stores data it can't read. The design is in the
"Stash Accounts Plan" doc.

## How it works

What the person sees:

- **New account:** email → open the sign-in link → save the recovery code → their wallet.
- **New device:** email → open the sign-in link → type the recovery code → their wallet, cards
  already there.
- **After that:** a small "🔒 Synced · N cards" badge in the corner keeps the wallet synced in the
  background (every few seconds while the page is open). Cards added on one device show up on the
  others by themselves. The Account page (tap the badge) has sign-out and delete-account.

Under the hood:

- **Sign in** with an email link (or a 6-digit code where the email template includes one). No
  password. Sign in with Apple and Google come later.
- **The first sign-in** makes a random wallet key on the device and shows a **recovery code** once
  (`STASH-XXXX-XXXX-XXXX-XXXX-XXXX`). A copy of the wallet key, locked with that code, is uploaded.
- **Each part of the wallet** (the localStorage keys in `SYNC_KEYS`, `lib/accountSync.ts`) is
  encrypted with AES-256-GCM before upload. The newest change wins.
- **A new device** signs in, enters the recovery code, and downloads and unlocks the wallet.
- **The server** (Supabase) has two tables, `key_wraps` and `wallet_items`, with row-level security:
  each user can only touch their own rows, and signed-out visitors can't touch any.
  "Delete my account" removes the user and every stored row.

| File | What it does |
|---|---|
| `lib/vault.ts` | Encryption: wallet key, recovery code, locking and unlocking (runs on the device) |
| `lib/accountSync.ts` | Two-way sync between localStorage and the user's encrypted rows |
| `app/account/page.tsx` | The Account page: sign in, recovery code, unlock, sign out, delete |
| `app/SyncBadge.tsx` | The corner badge on the wallet that syncs in the background |
| `supabase/migrations/` | The tables, security rules and `delete_my_account()` |
| `supabase/templates/` | The sign-in email (6-digit code plus a link) |

Everything is switched off unless `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are
set. The live site sets neither, so it shows no Account link and its security policy is unchanged.

## Running it on your Mac

You need **Docker Desktop** (free, from docker.com). Install it and open it once, so the whale icon
appears in the menu bar.

```bash
cd ~/Desktop/stash-test
git fetch origin
git checkout accounts-prototype
git pull
npm install

# Start the local database (the first time downloads a few hundred MB; later starts take seconds)
npx supabase@3.0.0 start
```

When it finishes it prints a **Publishable key** (starts with `sb_publishable_`). Open your
env file with `open -e .env.local` and add these two lines (keep your existing lines):

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...the key it printed...
```

Then:

```bash
npm run dev
```

and open **http://localhost:3000/account** (use `localhost`, not `127.0.0.1`).

- **Emails aren't really sent.** Sign in with any address, even a made-up one, then open
  **http://127.0.0.1:54324** to see the sign-in email and its 6-digit code.
- **To test two devices,** use a second browser (Safari and Chrome), or a private window.
- **To see what the server stores,** open **http://127.0.0.1:54323** (Supabase Studio) and look at
  `wallet_items`: only scrambled text.

When you're done: press Ctrl+C in the `npm run dev` window, then run `npx supabase@3.0.0 stop`.

## Before this goes live

- [ ] Google verification and the CASA assessment are approved
- [ ] Privacy policy, terms and the Google submission updated for accounts (see the plan doc)
- [ ] A real Supabase project, held by a parent, with sign-in emails sent through a real email service
- [ ] Sign in with Apple (needs the Apple developer account) and Sign in with Google
- [ ] Per-card sync instead of whole localStorage keys, so edits to different cards on two devices
      both survive
- [ ] Switch sign-in links back to the stricter PKCE flow (the prototype uses "implicit" so a link
      works in any browser) and send a 6-digit code in the email
- [ ] A security review of the encryption and the database rules
