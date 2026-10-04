# Deploy to Vercel

## 1. Push + import

1. Push this repo to GitHub (private is fine).
2. [vercel.com](https://vercel.com) → **Add New → Project** → import the repo. Framework auto-detects as Next.js — defaults are correct, don't change build settings.
3. Before clicking **Deploy**, add the env vars below (Project → Settings → Environment Variables also works, but you'll need a redeploy after).

## 2. Environment variables

Required:

| Var | Value |
|---|---|
| `ANTHROPIC_API_KEY` | same key as `.env.local` — powers all extraction |
| `GOOGLE_CLIENT_ID` | from Google Cloud console (the "Stash" OAuth client) |
| `GOOGLE_CLIENT_SECRET` | same place |

Optional (the live-room demo wants these):

| Var | Value |
|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | **effectively required for the real pitch** — without them the room store is in-memory, and on Vercel each serverless instance has its own memory, so 400 phones and the stage screen will NOT see one shared room. Locally in-memory is fine; deployed it isn't. See §3. |
| `LOOT_BASE_TOTAL` / `LOOT_BASE_CARDS` / `LOOT_BASE_JOINED` | honest pre-seeded floor for the room counters (real pre-collected totals, e.g. `434` / `6` / `1`) |
| `NEXT_PUBLIC_JOIN_URL` | leave unset — /stage builds the QR from its own origin automatically. Only set this if the crowd URL differs from the stage URL (e.g. a short custom domain). **Build-time inlined: changing it requires a redeploy.** |
| `INBOUND_SECRET` | any long random string; enables `POST /api/inbound` (forward-email webhook, see SETUP-FORWARD.md). Without it that route answers 503 and nothing else changes. |

## 3. Supabase (10 min, do it for the pitch)

1. [supabase.com](https://supabase.com) → New project (free tier fine).
2. SQL Editor → run:

```sql
create table room_events (
  id bigint generated always as identity primary key,
  kind text not null,
  amount numeric not null default 0,
  store text,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
alter table room_events enable row level security; -- no policies: only the service key can touch it
```

3. Project Settings → API: copy **Project URL** → `SUPABASE_URL`, and the **service_role** key → `SUPABASE_SERVICE_KEY` (server-only, never exposed to clients — the app talks straight PostgREST, no extra npm dependency).
4. To reset the room before the pitch: `delete from room_events;` in SQL Editor.

## 4. Google Cloud console (after first deploy)

The OAuth client currently only allows localhost. In [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials → the "Stash" OAuth client:

1. **Authorized redirect URIs** → add exactly:
   `https://<your-app>.vercel.app/api/google/callback`
   (the code derives the redirect from the request origin — this path is fixed, only the host changes; keep the localhost one for dev)
2. The app is in **Testing** mode → OAuth consent screen → **Test users**: every Gmail account that will be scanned live on stage must be listed (Ryan's demo account, dad's, any volunteer's). Unlisted accounts get a hard Google error mid-pitch. Max 100 test users; adding one takes effect immediately.

## 5. Smoke test (5 min, on the deployed URL)

- [ ] `/` loads; **Connect Gmail** → Google consent → lands back on `/?connected=1` and the scan runs (test-user account!)
- [ ] `/join` on a phone: tap **I'm in** → instant ✓; report `$5 starbucks` → 💸 card shows
- [ ] `/stage` on a laptop: QR renders, room counters reflect the join + the $5 within ~2s, URL under the QR is the prod domain
- [ ] Scan the on-screen QR with a phone camera → opens `/join`
- [ ] `curl https://<app>.vercel.app/api/room` → JSON with `"backend":"supabase"` (if it says `"memory"`, the Supabase keys aren't set — cross-device room will not work)
- [ ] Paste a gift-card email into /join step 3 → extracts store + amount, find appears on /stage as **✓ read by Loot**
- [ ] If `INBOUND_SECRET` set: `curl -X POST .../api/inbound -H 'x-inbound-secret: <secret>' -H 'Content-Type: application/json' -d '{"subject":"x","text":"y"}'` → `{"found":false,...}` (proves auth + extraction wiring)

## Day-of notes

- Open `/stage?demo` while rehearsing — synthetic feed, touches nothing real.
- Reset the room right before doors: clear `room_events` (and/or set the `LOOT_BASE_*` floor).
- The breakage ticker on /stage is client-side — it keeps running even if venue wifi dies.
