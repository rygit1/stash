# Loot — Command Center (open this first)

> Source of truth. **Actions live here**; the pitch script/stats/mechanics live in **PITCH.md**.
> Claude reads + updates both every session. Pitch: **Sat 2026-06-13.**
> Status: ✅ done · 🟡 Claude builds · ⛔ blocked on Ryan

## 🎯 Critical path (in order)
> **6/10 priority flip (Ryan):** manual entry isn't the product — the MVP is the AUTOMATIC Gmail scan. Test on Ryan's own inbox FIRST, then the crowd demo.
1. ✅ **AUTOMATIC GMAIL SCAN — WORKING LIVE + DEEP 6/10:** Ryan's real Gmail → **$434.50 across 6 cards** (Cos Bar, Nike ×2, Amazon, Nift, Roblox). Pipeline: deep paginated search (CAP_IDS=200, noise-filtered `-"you sent"`/`-"was received"`/promos) → fetch → $-value pre-filter → Haiku (CAP=100) → dedupe → wallet (amount + tap-to-reveal code + "Use it"). **Fixed the shallow-scan bug** (was only 50 newest → just 2 cards). `lib/merchants.ts` = exact redeem/balance-URL registry (Amazon/Roblox/Nike/Nift/Starbucks/Target/Apple direct; rest = search fallback; add a merchant = one row). Files: `lib/gmail+extract+merchants`, `/api/google/*`, `/api/scan`, `app/page.tsx`.
2. ✅ **Google OAuth creds wired** (`GOOGLE_CLIENT_ID`+`SECRET` in `.env.local`; Google app named "Stash"). ⚠️ test-mode → "unverified app" screen (Continue) + tokens expire every 7 days.
3. ✅ **Scan tuned + "Use it" built 6/10.** Broadened QUERY (+`giftcard` one-word, `gift certificate`, `e-gift card`, `digital gift`), CAP 50, conc 8, `maxDuration=60`. Fixed an extraction false-negative (was rejecting real eGifts). Validated by `test-scan.mjs` (11 cases, **0 mismatches**). "Use it" per card (`lib/merchants.ts`) = copy code + open merchant balance/redeem page (Amazon=apply, Target=balance, rest=official-page search; verified deep-links + processor API = phase-2). Known gap: brand-less peer eGifts ("sent you $25") — keyword search can't catch (phase-2: sender heuristics).
4. ✅ **Crowd loop (secondary, OAuth-free):** `/join` (Join + paste→extract) → `/stage` real room. Built 6/10. The manual "report $ found" path is de-emphasized — it's a participation gimmick, not the product.
5. ✅ **6/11 SHIP DAY (prod build green, all live-tested):** wallet truth (redemption-evidence used-detection, zero extra Haiku + "Still yours" split + mark-as-used + Email↗ + confetti) · **/join = personal stash** (paste → YOUR card + "You're sitting on $X" count-up + confetti; localStorage; feeds room) · real QR on /stage · forward-email webhook `/api/inbound` (secret-gated; live-tested; SETUP-FORWARD.md) · **counter dedupe by claim code** (re-paste can't inflate — verified live, needs the 2-line dedupe SQL in Supabase) · **Nike balance-agent spike = DRIVABLE** (`spike-balance/VERDICT.md`; Target login-gated; Starbucks /card/balance was 404 → fixed to /gift).
6. ✅ **ACCURACY SPRINT LANDED + DEPLOYED 6/11 PM:** battery 25 cases / **0 mismatches** (recall 10/10, precision 10/10, promos 6/6 rejected); 2nd Gmail pass catches brand-less peer eGifts (13 platform domains + gift subjects); **≈balance estimate** from receipt emails (strict evidence-tied: code=gold, else merchant+date+≤loaded; ambiguous→null; 0⇒likely_used) live in wallet ("≈ $12.40 left · as of May 2 ↗" + struck "loaded $50"). **SITE LIVE: https://giftcard-finder-ryan-y-s-projects.vercel.app** (deploy protection off, env set, room ledger wiped clean). ⚠️ Demo-email guidance: balance receipts must literally say "remaining/new balance $X" (deduction-only lines give no estimate by design); two same-merchant cards (Nike ×2!) can't tie a merchant-only receipt — needs the code in it. NEXT: Ryan's Google console 2 steps → live-URL scan test → Nike recording → rehearse.
6b. ✅ **PHYSICAL-CARD SCANNER LIVE 6/11 (stashloot.vercel.app):** 📷 photo → Haiku vision → editable confirm (OCR honesty gate) → card joins wallet with the real photo as the card face (1.586:1, sheen, tap-to-reveal, Use-it, counts in "Still yours"); **front+back two-shot** (contextual "PIN might be on the back" nudge, both images in ONE vision call, merged); works WITHOUT Gmail (anyone on the URL can scan plastic — not just test users); localStorage `loot_physical_v1` w/ quota fallback ladder. **URL = stashloot.vercel.app** (claimed; long URL deprecated for sharing). OAuth = NEW "StashLoot" client wired in Vercel env (verified: client_id + redirect match). UNTESTED: real card on a real phone camera — Ryan's first scan is the test.
6c. ✅ **6/11 PM ROUND 2 (all deployed to stashloot.vercel.app):** Fable vision on /api/scan-card (Haiku misread Starbucks digits + invented PIN/$50 → fixed; Visa prepaid now = gift card; live-retested by Ryan = exact 16-digit match) · front+back two-shot DEFAULT ("Got the front ✓ — now the back") · desktop in-page camera (getUserMedia + 📸 Capture) · brand-canonical card art (chip + embossed last-4 + 12 brand layouts; photo on 📷 toggle) · issue diagnostics (glare/blur/too_dark/too_far/partial → specific retake guidance) · "📧 find the ones in your email" tab on physical-only wallet · demo reset **`/?reset=1`** (wipes physical+used+stash+spend localStorage) · **TEAMMATE LOVABLE AUDIT** (`~/Gift Card Buddy` ≈80% copy of our code; absorbed the 2 real deltas): **ZXing barcode decode** (exact number when barcode present, beats OCR, "read from barcode ✓" badge, QR self-test 3/3) + **spend logger** ("− log a purchase", `loot_spend_v1`, spent-to-zero → used section "spent down"); geo-nudge = vision-slide LINE only; their Stripe shop = Stash Store Q&A ammo. Codebase zip → `~/Desktop/stashloot-codebase-2026-06-11.zip` (+ codebase.txt; secrets excluded).
6d. ✅ **6/11 LATE — LOCAL AUTO-CHECK AGENT + chip recut (deployed):** `app/api/check-balance` (localhost-only; HARD `VERCEL→501 local_only` guard, verified live on prod; runtime `process.getBuiltinModule` so Turbopack never bundles puppeteer — prod build green). Flow: scan attaches `redeemUrl` per card (regex on email body, lib/extract UNtouched) → on **localhost only**, a card with a redeem link shows "⚡ Check balance now" → route reads g_token → Gmail profile email (`getProfileEmail`) → spawns `spike-balance/nike-reveal.mjs` → inline "✓ Agent checked Nike — ≈$50 · ••288 · PIN 339072". Nike adapter only; others = honest "not supported yet". Brand chips recut: 24→9, one-at-a-time 700ms cadence + looped sweep + "✨ + hundreds more". **TEST (Ryan, localhost): `npm run dev` → localhost:3000 → Connect Gmail (mom's, test-listed) → scan → Nike card shows ⚡ → click = live agent fetch.** NOT on the deployed site (browser can't run on Vercel — by design).
7. ⛔ **Ryan (shrunk 6/11):** mom email back (MUST be in Google test-user list; connect <1h before stage) · one Nike code+PIN for the agent recording · clear `loot_used` localStorage after rehearsal · rehearse PITCH.md. Optional: `! vercel login` (public URL) · seed a 2nd test-listed inbox with forwarded gift-card emails for a "works on anyone" second scan.

## ⛔ Blocked on Ryan
- **Brand name decision:** Google app named **"Stash"** — but Stash = existing US investing/banking app (trademark/confusion risk). Rec still **Loot** (matches "take your money back"). Cosmetic in Google (Branding tab); decide before any public launch.
- ✅ Supabase WIRED + E2E verified 6/11 (`backend:"supabase"`, write+delete proven, ledger clean). Dedupe SQL **NO LONGER NEEDED** — crowd counter benched 6/11. (If ever revived: `alter table room_events add column dedupe_key text;` + `create unique index room_events_dedupe on room_events (dedupe_key);` — code already handles it.)
- Rotate `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_SECRET` **and** `SUPABASE_SERVICE_KEY` after pitch (all pasted in chat).

## 🧠 Balance + verification reality (verified 6/10 — bulletproof the pitch)
- **No universal gift-card balance API** (Quora/api2cart). Remaining balance lives with the merchant, per-merchant, commercially. The email gives ORIGINAL loaded value only.
- 3 cases: (a) merchant has a balance page → deep-link/pre-fill card#+PIN (buildable now); (b) merchant KILLED public check — **Amazon** (anti-bot fraud) → can't check without redeeming → frame as "apply it = use it"; (c) processor API (Blackhawk / InComm / Tillo / Square) = partner deal + registered business = the **MOAT / phase-2**.
- **Checkability is a property of the MERCHANT, not the card.**
- **Pitch correction:** drop the universal "one tap = exact balance" claim (Amazon breaks it). Safe line: "FIND it + hand you the code + one-tap to USE it; exact-balance is per-merchant." Breakage is mostly fully-unused cards → original value is the honest rally number. → update PITCH.md "What 'take back' IS".
- **`gmail.readonly` = RESTRICTED scope** → public launch needs Google OAuth verification + CASA security assessment (weeks + $ + annual review). Sidestep = **forwarding model** (no OAuth / no verification / no scary screen). For the pitch: hero account + OAuth-free crowd path, NOT 400 strangers through the unverified screen (also a 100-test-user cap).

## 🟡 Build queue (Claude)
- ✅ Audience interactive loop: 1-tap Join + search-inbox→report + paste→extract (`/join`) wired to real room + `/stage` (6/10)
- ✅ Room store w/ swappable backend (`lib/room.ts`): in-memory now, Supabase-via-REST ready (just add keys) + honest `LOOT_BASE_*` floor
- 🔜 Real QR on `/stage` (`npm i qrcode`)
- 🔜 Forward-an-email inbound webhook → POST `/api/extract` (needs a domain + Cloudflare Email Routing)
- Gmail end-to-end (optional hero path; OAuth) — folds in `test-extract.mjs`
- "Use it" action: balance + code + barcode + Shop-now + Add-to-Wallet + expiry countdown
- Personal heist-payout reveal (confetti + "you took back $X")
- Diagnostic empty-state (new vs established inbox) for low/zero live results
- Deploy Vercel

## ✅ Locked decisions
- Product = gift-card finder; find forgotten cards from email, make them usable
- Brand = **Loot** · "take your money back" (= USE IT before breakage; **not** cash)
- Badge = world-fact ("avg teen forgets ~$80"); never benchmark personal results vs the average
- Balance = 2 tiers, **never fake a number**: email gives original value (Haiku-proven) → one tap = exact
- Audience = forward/paste + waitlist, NOT Google login (allowlist ≤100, verify = weeks)
- Green counter must be **REAL** (pre-loaded from real connections); `/stage` mock = dev only
- Monetization = ads (minor) + sell eGift cards + % commission (Tango/Tremendous/Blackhawk); don't charge teens
- Vision = Gmail → Outlook (same API) → Yahoo/iCloud (IMAP) → forward-anything → processor API for auto-balance (moat)
- Dropped: cash-out / resale / swap marketplace (lossy + licensing) — phase-2 vision only if pushed

## 🗂️ Build state
**— Automatic Gmail scan (THE product, primary) —**
- `lib/gmail.ts` — **NEW.** OAuth (authUrl/exchangeCode) + Gmail read (search/get/decode MIME→text), plain fetch, no SDK. Scope gmail.readonly.
- `lib/extract.ts` — **NEW.** Shared Haiku engine (extracted from test-extract); used by `/api/scan` + `/api/extract`.
- `app/api/google/start/route.ts` + `callback/route.ts` — **NEW.** OAuth redirect → token → httpOnly `g_token` cookie → `/?connected=1`. Guards verified (no_client_id redirect) 6/10.
- `app/api/scan/route.ts` — **NEW.** cookie→Gmail search (QUERY, CAP=40, conc=6)→Haiku extract→sorted real cards + stats. 401 without token (verified).
- `app/page.tsx` — **NOW REAL.** Connect Gmail → scanning → wallet of real cards (amount + tap-to-reveal code/PIN + expiring flag) + empty/error states. tsc clean. ⏳ awaiting creds for live run.
**— Crowd loop (secondary) —**
- `app/join/page.tsx` — **the crowd page (QR target).** 1-tap Join · search-inbox→report · paste→Haiku extract. Real, OAuth-free. ✅ tested.
- `lib/room.ts` — **NEW · live room store.** append-only join/find events; backend = Supabase-REST if keys else in-memory; honest `LOOT_BASE_*` floor; verified (Haiku) vs self-reported finds.
- `app/api/room/route.ts` (GET state) · `room/join` · `room/report` · `app/api/extract/route.ts` (Haiku; folds in test-extract) — **NEW · ✅ all tested 6/10.**
- `app/stage/page.tsx` — big screen, **now polls real `/api/room`** (red ticker still client-side/wifi-proof). `?demo=1` = synthetic activity for rehearsal. Real QR pending.
- `test-extract.mjs` — Haiku extraction **PROVEN** (~8¢/inbox); engine now lives in `lib/extract.ts`.
- `.env.local` — `ANTHROPIC_API_KEY` set. **NEXT: add `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`** (the live-scan unblock). Later/optional: `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`, `LOOT_BASE_*`, `NEXT_PUBLIC_JOIN_URL`.
- Stack: Next.js 16 (⚠️ read `node_modules/next/dist/docs` before new code) + Tailwind; Supabase via REST (no SDK dep); planned: Vercel.

## 🟢 Make the counter real (Ryan: ~2 min → live on 400 phones)
1. supabase.com → New project (free). Project Settings → API: copy **Project URL** + **service_role** key.
2. SQL editor → run:
   ```sql
   create table room_events (
     id bigint generated always as identity primary key,
     kind text not null,            -- 'join' | 'find'
     amount numeric not null default 0,
     store text,
     verified boolean not null default false,
     created_at timestamptz not null default now()
   );
   ```
3. Add to `.env.local` (and Vercel env vars):
   ```
   SUPABASE_URL=...                 # Project URL
   SUPABASE_SERVICE_KEY=...         # service_role key
   # optional honest floor from pre-collected totals:
   LOOT_BASE_TOTAL=8400  LOOT_BASE_CARDS=210  LOOT_BASE_JOINED=70
   # NEXT_PUBLIC_JOIN_URL=getloot.app/join   # shown under the QR on the big screen
   ```
4. Restart. `/api/room` now reports `"backend":"supabase"`. Every phone writes a real, durable row.

## ❓ Open questions
- Sharpen headline label ("received" vs "available")?
- Next build: personal payout · or Supabase counter + Join · or "Use it" action?
- Want a global `/todo` skill (cross-project)?
