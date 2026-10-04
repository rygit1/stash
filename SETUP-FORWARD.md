# Forward-an-email → it lands on the big screen

Goal: anyone forwards a gift-card email to **find@yourdomain.com** → Cloudflare catches it → POSTs it to the app → Loot reads it → a **verified** find drops into the live room on /stage.

Total time: ~15 minutes. You need: a domain on Cloudflare (free plan is fine) and the app deployed (see DEPLOY.md).

## 1. Turn on Email Routing (3 min)

1. Cloudflare dashboard → pick your domain → **Email** → **Email Routing**.
2. Click **Get started** / **Enable Email Routing**. Accept the DNS records it wants to add (MX + TXT) — one click.
3. If it asks for a destination address, add your personal email and click the verification link it sends. (You won't use it for finds, but Cloudflare wants one verified address.)

## 2. Create the Email Worker (5 min)

1. Dashboard → **Workers & Pages** → **Create** → **Create Worker**. Name it `loot-inbound`. Deploy the hello-world it gives you.
2. Click **Edit code**, delete everything, paste this (change `YOUR-APP` to your real Vercel URL):

```js
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).text();
    // drop the top-level headers, undo quoted-printable line breaks + =XX escapes
    const text = raw.replace(/\r\n/g, "\n").split("\n\n").slice(1).join("\n\n")
      .replace(/=\n/g, "")
      .replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    await fetch("https://YOUR-APP.vercel.app/api/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-inbound-secret": env.INBOUND_SECRET },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        subject: message.headers.get("subject") || "",
        text: text.slice(0, 20000),
      }),
    });
  },
};
```

3. **Save and deploy**.
4. Worker → **Settings** → **Variables and Secrets** → **Add** → type **Secret**, name `INBOUND_SECRET`, value = the exact same string you set as `INBOUND_SECRET` on Vercel. Deploy.

## 3. Point find@ at the Worker (2 min)

1. Back to your domain → **Email** → **Email Routing** → **Routing rules**.
2. **Create address** → custom address `find` → action **Send to a Worker** → pick `loot-inbound` → Save.

## 4. Test (2 min)

1. Forward any real gift-card email (Amazon/Starbucks/etc.) to `find@yourdomain.com`.
2. Open `https://YOUR-APP.vercel.app/stage` — within ~30s a green **✓ read by Loot** find appears in the feed and the room total jumps.
3. Not showing? Check in order:
   - Worker → **Logs** (live tail) — did the email event fire? Any fetch error?
   - Secrets match exactly on both sides (Worker secret vs Vercel `INBOUND_SECRET`).
   - `POST /api/inbound` answers `401` = secret mismatch, `503` = `INBOUND_SECRET` not set on Vercel.
   - Email Routing → **Overview** shows the email as delivered to the Worker (not dropped).

## Notes

- The app endpoint is `POST /api/inbound`, JSON `{from, to, subject, text}`, auth header `x-inbound-secret`. Anything without the header is rejected — nobody can spoof finds.
- Only emails that Haiku confirms as a real owned gift card **with a dollar amount** count; promos get ignored (the endpoint replies `{found:false}`).
- The regex body-cleanup is deliberately crude — the extractor is an LLM and reads through MIME noise fine. If you ever want pristine parsing, swap in `postal-mime` via Wrangler; not needed for the demo.
