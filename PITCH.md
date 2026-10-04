# Loot — Pitch Playbook

> The "what to say & build, and why." Study + rehearse from this. Actions live in **TODO.md**.
> Pitch: **Sat 2026-06-13** · Audience: ~400 (judges = students + some adults).

## The core reframe (the whole pitch in one idea)
Gift cards are boring. **Corporations quietly keeping your money is not.** We don't sell a finder — we expose a **$21B scam hiding in plain sight ("breakage")** and hand people the tool to take their money back. Robin Hood, not a utility. **The card is the proof, not the pitch.**

## Verified ammo (all checkable — say with confidence)
- **$21 billion/yr** unredeemed US gift cards → **~$666/second**, ~$40k/min, **~$240k per 6-min pitch**.
- **Starbucks made $207.6M in breakage in 2024** (their own filings) — the single best weapon. Amazon sits on ~$3B unredeemed.
- **$244 avg** unused per American · **43%** hold ≥1 unused card.
- Teen avg ~**$80** unused (Gen Z 46% have unused). $45.7B unredeemed 2005–2015.

## The 6-beat spine (exact lines)
1. **Hook (theft, personal):** "Everyone in this room is missing money right now. Not money you lost — money a company is keeping because they're betting you'll forget."
2. **Villain + stat:** "Last year Starbucks made $207 million from cards nobody used. They have a word for it — 'breakage.' They plan on you forgetting. Nationwide it's $21 billion a year."
3. **Live proof (peak):** "Don't take my word for it — watch it raid my own inbox. Live." → Connect Gmail on the big screen → 40-second scan → **$434.50 reveal** (count-up + confetti) → tap a card → **Email ↗** ("that's the real email") → "≈ $X left" estimate.
4. **Scale:** "That's ONE inbox — mine. Multiply it by every teen, every inbox in America. That's the $21 billion — and almost none comes back."
5. **Vision (wedge→empire):** "Gift cards are just the start. Loot becomes the one place that finds all the money quietly yours — store credit, refunds you're owed, subscriptions draining you."
6. **Ask (movement):** "You didn't watch a forecast. You watched a room take its money back. Come build it with us."

## Bulletproofing (so a sharp judge can't poke it)
- **Never say "stealing"/"illegal."** Cards legally can't expire fast (CARD Act). Say **"banking on you forgetting."** True + unattackable; breakage is in public filings.
- **Bridge $80 ↔ $21B out loud:** "$80 to you, $21B as a business." Don't let it read as "an $80 app."
- **Define "take back" early:** "taking it back means *using it* before they keep it."

## What "take back" actually IS (survive this question)
You CAN'T pull cash out of Starbucks — a gift card is store credit locked to the merchant. **"Take back" = USE IT before breakage eats it.** Redeeming defeats their bet. Product does:
1. **Find** it (auto, from email — the part you can't do yourself)
2. Hand you **balance + code + barcode**
3. **One-tap redeem** (Shop now / Add to Wallet where supported / show barcode)
4. **Expiry rescue** ("$15 Sephora, 9 days — use it or they keep it")

- Judge: *"isn't it just a reminder app?"* → "You can't remind yourself about money you forgot you had. We *find* it, then delete every excuse not to use it. Cal AI didn't invent calorie counting — it deleted the friction."
- Cash/resale path = **dropped** (lossy + money-transmitter licensing); phase-2 "vision" only if pushed.

## Live demo / MVP mechanics
- **/stage big screen:** red breakage ticker ($666/sec) vs green "taken back in this room" + live feed + **REAL scannable QR → /join**. Counter is dedupe-protected (same card can't count twice) — the green number is unfakeable by accident.
- **Synchronized 3-2-1 reveal** of pre-seeded piles = the gasp.
- **Personal stash on each phone (BUILT):** QR → /join → paste a gift-card email → YOUR card renders (brand + code + Use-it) + "You're sitting on $X" count-up + confetti. Survives refresh.
- **Hands beat (zero-tech insurance, do it right after the villain stat):** "Phone out. Open your email. Search 'gift card.' Hand up when you see one you own." Lands even if every server dies.
- **Proof beats on the hero scan:** Email ↗ opens the actual Gmail message ("don't take my word for it"); spent cards visibly drop to "Already used" (honesty on screen); **Nike agent balance check** = recorded clip primary, live only if rehearsal was clean.
- **Demo = PURE AUTOMATION, live (Ryan's 6/11 final call — /join, /stage, QR, paste all CUT from the show):**
  1. **Hero scan on the big screen:** Connect Gmail → live 40s scan → $434.50 materializes (codes + ≈balance estimates + already-used split). The product demos itself.
  2. **Optional second proof:** a second test-listed inbox seeded with a few real forwarded gift-card emails → scanned live = "works on anyone's inbox, not just mine." (Only reason to collect emails; Ryan's call.)
  3. **Hands beat stays** (zero tech): "search 'gift card', hand up" — the room feels the problem without touching our infra.
  4. **Credibility beats:** Email ↗ click (the actual Gmail message) + Nike agent balance clip (recorded primary, live if rehearsal clean).
  5. /join, /stage, QR, crowd counter: BUILT but **BENCHED** — not in the show; phase-2 talking points if asked.
- ⚠️ **NEVER simulate the green counter.** If caught, "it's real" flips to "they lied." (Red ticker is an honest national estimate — fine.)

## Red-team hedges (tail risk → cheap hedge)
- Small green vs huge red looks sad → frame as **"imagine every room,"** not "we won"; pre-seed for a strong floor.
- Live demo fails (wifi / in-app browser / empty inbox) → hero account pre-connected + **20–30s backup video** + ticker is client-side (wifi-proof) + "open in Safari/Chrome."
- **Make-or-break dependency → hero account connects fresh <1h before stage (test-user listed) + 20-30s backup video of a clean scan. No crowd infra, no deploy, no plants in the critical path.**

## Sources
- $21B / Starbucks $207.6M / Amazon: davemanuel.com (breakage, 2025) · finance.yahoo.com
- $244 / 43%: bankrate.com (gift-cards-survey)
