// MVP correctness harness — THE quality gate. Three independent layers per case:
//   1) QUERY COVERAGE — would pass 1 (keywords) or pass 2 (eGift delivery channels) even surface this email?
//      (a real card missed by BOTH = a silent, invisible miss)
//   2) EXTRACTION — does Haiku classify/extract it as intended? (real card vs promo vs not-yours)
//   3) DETERMINISTIC — balance-estimate regex + evidence tying + redemption detection, run against the
//      REAL functions imported from lib/extract.ts (zero drift between test and production).
// Run against the live dev server: node test-scan.mjs   (server must be on :3000)
import { balanceAmount, tieBalance, hasRedemption } from "./lib/extract.ts";

const BASE = "http://localhost:3000";

// ——— Layer 1: query approximations (Gmail tokenizes; substring match is close enough to reveal gaps) ———
const PASS1 = ["gift card", "giftcard", "egift", "e-gift", "gift certificate", "digital gift", "redemption code"];
const NEGATIVE = ["you sent", "was received", "buy a gift card", "extra value"];
// Pass 2 — eGift delivery channels: known platform domains + gifting subject shapes.
const DOMAINS = ["cashstar.com", "giftcards.com", "giftcardmall.com", "wgiftcard.com", "sendoso.com", "tangocard.com", "tremendous.com", "egifter.com", "giftrocket.com", "prezzee.com", "vanillagift.com", "gyft.com", "giftbit.com"];
const SHAPES = ["sent you", "gifted you", "a gift for you", "your gift is", "you received a gift", "you've received a gift"];

const negative = (text) => NEGATIVE.some((k) => text.toLowerCase().includes(k));
const coveredPass1 = (c) => PASS1.some((k) => `${c.subject} ${c.body}`.toLowerCase().includes(k)) && !negative(`${c.subject} ${c.body}`);
const coveredPass2 = (c) =>
  (DOMAINS.some((d) => (c.from ?? "").toLowerCase().includes(d)) || SHAPES.some((s) => c.subject.toLowerCase().includes(s))) &&
  !negative(`${c.subject} ${c.body}`);

// ——— Layer 2 cases. expect.kind: "card" (real, owned) | "promo" | "notyours" | "outofscope" (all three = reject) ———
const CASES = [
  { label: "Amazon eGift (real)", subject: "An Amazon.com Gift Card for you!", body: "You've received a $25.00 Amazon.com Gift Card from Grandma! Claim code: 4PXG-7H2K9L-QWER. Apply it at amazon.com/redeem.", expect: { kind: "card", amount: 25 } },
  { label: "Starbucks eGift +PIN (real)", subject: "Sarah sent you a Starbucks eGift", body: "You received a $15.00 Starbucks eGift Card. Card number: 6010 5612 3456 7890 PIN: 4421. Add it to the Starbucks app.", expect: { kind: "card", amount: 15 } },
  { label: "Olive Garden GIFT CERTIFICATE (real)", subject: "You've received a $50 Gift Certificate", body: "Congratulations! You have a $50 Gift Certificate to Olive Garden. Present this at any location. Certificate #OG-44821.", expect: { kind: "card", amount: 50 } },
  { label: "Target GiftCard balance (real, one-word)", subject: "Your Target GiftCard balance", body: "Your Target GiftCard ending 8841 has a balance of $12.40. Access number: 0394 8821 5532 1180.", expect: { kind: "card", amount: 12.4 } },
  { label: "Sephora eGift (real)", subject: "A gift for you", body: "You've received a $50 Sephora eGift. Use it online or in store. Card: 6276-1182-9930. PIN 9921.", expect: { kind: "card", amount: 50 } },
  { label: "Apple Gift Card (real)", subject: "Your Apple Gift Card", body: "Here is your $50.00 Apple Gift Card. Code: XGRET8H2KL90QW. Redeem in the App Store or apple.com.", expect: { kind: "card", amount: 50 } },
  { label: "Generic 'Maria sent you $25' eGift (real, no card wording)", subject: "🎁 Maria sent you $25", body: "Maria sent you $25 to spend at Lululemon. Tap to claim your gift before it expires.", expect: { kind: "card", amount: 25 } },
  { label: "Chase promo 'earn $300' (REJECT)", subject: "Earn a $300 bonus", body: "Open a new Chase checking account and earn a $300 gift card bonus! Limited-time offer. Terms apply.", expect: { kind: "promo" } },
  { label: "Spend-$50 marketing (REJECT)", subject: "Free $10 gift card inside", body: "Get a free $10 gift card when you spend $50 this weekend. While supplies last.", expect: { kind: "promo" } },
  { label: "You GIFTED it to someone else (REJECT)", subject: "Your gift card order confirmation", body: "Thanks for your order! You sent John a $100 Nike gift card. It was delivered to john@email.com.", expect: { kind: "notyours" } },
  { label: "Nordstrom store credit / return (out-of-scope?)", subject: "Your return is complete", body: "We've processed your return. A $42.75 store credit (merchandise credit) has been added to your account.", expect: { kind: "outofscope" } },
  // —— New: recall targets for the eGift-channel pass (no "gift card" wording anywhere) ——
  { label: "NEW CashStar delivery, zero card wording (real)", from: "Cold Stone Creamery <coldstone@e.cashstar.com>", subject: "Alex sent you a treat 🍦", body: "Alex sent you $20 to enjoy at Cold Stone Creamery! Show this in store or redeem online. Card number: 6006 4922 1180 3344 7765. Message from Alex: happy birthday!", expect: { kind: "card", amount: 20 } },
  { label: "NEW GiftRocket peer cash gift, brand-less (real)", from: "GiftRocket <hello@giftrocket.com>", subject: "Sam sent you $25 🎉", body: "Sam Chen sent you $25! Pick how you want it and spend it anywhere. Claim your money by July 1, 2026 or it goes back to Sam.", expect: { kind: "card", amount: 25 } },
  { label: "NEW Vanilla Visa prepaid eGift (real)", from: "Vanilla Gift <noreply@vanillagift.com>", subject: "Your Vanilla Visa eGift Card is here", body: "Your $50.00 Vanilla eGift Card is ready to use. Card number: 4111 2200 3344 5566, Expiration 12/2028, CVV 412. Use it anywhere Visa debit is accepted online.", expect: { kind: "card", amount: 50 } },
  // —— New: aggressive promo lookalikes that pass 2 WILL surface — Haiku must hold the precision line ——
  { label: "NEW 'We sent you a $50 reward — activate' promo (REJECT)", from: "Rewards Center <offers@dealblast.com>", subject: "We sent you a $50 reward — activate now", body: "You've been selected! Activate your $50 reward when you make your next purchase of $100 or more. Hurry, this offer ends Sunday.", expect: { kind: "promo" } },
  { label: "NEW 'A gift for you' bonus-card promo (REJECT)", from: "StyleHub <promo@stylehub.com>", subject: "A gift for you: your $10 bonus card is waiting", body: "Shop this weekend and get a $10 bonus gift card with any $50 purchase. In stores and online. While supplies last.", expect: { kind: "promo" } },
  // —— Real-inbox false positives: gift cards the USER BOUGHT/SENT to someone else (REJECT) ——
  { label: "Amazon BUYER order confirmation — bought to give away (REJECT)", from: "auto-confirm@amazon.com", subject: "Thanks for your order!", body: "Thanks for your order! Amazon eGift Card - Happy Birthday. Qty 1. $100.00. Grand Total: $100.00. Order # 113-2884719-5520264. Estimated delivery: under 1 hour.", expect: { kind: "notyours" } },
  { label: "Amazon SENT-to-recipient delivery notice (REJECT)", from: "do-not-reply@amazon.com", subject: "Your gift card was sent to +13109130200", body: "Hello Jordan, Your gift card was sent to +13109130200. 1 Amazon eGift Card $100.00 each. Send to: +13109130200. We'll let you know once it's been delivered.", expect: { kind: "notyours" } },
  { label: "Starbucks eGift SENT to a friend (REJECT)", from: "Starbucks <gifts@starbucks.com>", subject: "Your Starbucks eGift was sent to Jamie", body: "Thanks for your order! Your $25.00 Starbucks eGift Card was sent to jamie@email.com. Order #SB-99213. It's on its way to Jamie.", expect: { kind: "notyours" } },
  // —— TRUE-POSITIVE GUARD: a real Amazon eGift DELIVERED to the user WITH a claim code must still be FOUND ——
  { label: "Amazon eGift DELIVERED to user + claim code, 'order' in footer (real)", from: "gc-orders@gc.email.amazon.com", subject: "An Amazon.com Gift Card is here for you", body: "Hi Jordan, You've received a $100.00 Amazon.com Gift Card! Claim code: 5XPT-9KH2QL-4WER. Apply it to your account at amazon.com/redeem. (Order reference 113-555 in the footer.)", expect: { kind: "card", amount: 100 } },
];

const isReal = (k) => k === "card";

async function extract(c) {
  const r = await fetch(`${BASE}/api/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: c.body, subject: c.subject, from: c.from }),
  });
  if (!r.ok) return { isGiftCard: false, _err: r.status };
  return r.json();
}

// ——— Layer 3: deterministic cases against the real lib/extract.ts functions ———
const sbux = { code: "SBUX771BAL2256", store: "Starbucks", amount: 50, dateReceived: "2026-05-01" };
const DET = [
  {
    label: "Balance chain: $50 delivery → receipt 'Remaining balance: $12.40' (code-tied)",
    run: () => tieBalance([sbux], [{ id: "r1", date: "Sat, 2 May 2026 10:15:00 -0700", text: "Receipt from Starbucks\nThanks for your purchase. Gift card SBUX771BAL2256 was used today. Remaining balance: $12.40." }])[0],
    want: { estimate: 12.4, evidenceId: "r1" },
  },
  {
    label: "Latest receipt wins: $31.05 (May 3) then $12.40 (May 9)",
    run: () =>
      tieBalance(
        [sbux],
        [
          { id: "r_old", date: "Sun, 3 May 2026 11:00:00 -0700", text: "Starbucks receipt. Gift card SBUX771BAL2256. Remaining balance: $31.05." },
          { id: "r_new", date: "Sat, 9 May 2026 14:00:00 -0700", text: "Starbucks receipt. Gift card SBUX771BAL2256. Remaining balance: $12.40." },
        ],
      )[0],
    want: { estimate: 12.4, evidenceId: "r_new" },
  },
  {
    label: "Ambiguity: balance email matches TWO cards (Nike+Adidas, same $) → null for both",
    run: () =>
      tieBalance(
        [
          { code: null, store: "Nike", amount: 50, dateReceived: "2026-04-01" },
          { code: null, store: "Adidas", amount: 50, dateReceived: "2026-04-01" },
        ],
        [{ id: "amb1", date: "Tue, 2 Jun 2026 09:00:00 -0700", text: "Your SneakerHub order\nYour gift card balance is $12.40. Applies to Nike and Adidas purchases." }],
      ),
    want: [null, null],
  },
  {
    label: "Zero balance → estimate 0 (scan maps 0 ⇒ likely_used)",
    run: () => tieBalance([{ code: "NIKEGC99X22AB7", store: "Nike", amount: 25, dateReceived: "2026-03-10" }], [{ id: "z1", date: "Fri, 20 Mar 2026 08:00:00 -0700", text: "Nike gift card NIKEGC99X22AB7 update. Current balance: $0.00." }])[0],
    want: { estimate: 0, evidenceId: "z1" },
  },
  {
    label: "Redemption chain: 'has been applied to your account' = used; 'Once…redeemed' = NOT",
    run: () => [hasRedemption("Your $25 Starbucks gift card has been applied to your account."), hasRedemption("Once your gift card has been redeemed, you can check your balance anytime.")],
    want: [true, false],
  },
  {
    label: "Bank noise: 'account available balance is $1,532.18' → no estimate",
    run: () => [balanceAmount("Chase Alert\nYour account available balance is $1,532.18 as of today."), balanceAmount("Your account balance is $1,234.56.")],
    want: [null, null],
  },
  {
    label: "Previous $50 / New $12.40 statement → resolves to 12.40",
    run: () => balanceAmount("Gift card statement\nPrevious balance: $50.00\nNew balance: $12.40"),
    want: 12.4,
  },
  {
    label: "Date guard: balance email OLDER than card delivery → null (merchant-tied)",
    run: () => tieBalance([{ code: null, store: "Target", amount: 50, dateReceived: "2026-05-10" }], [{ id: "old1", date: "Wed, 1 Apr 2026 10:00:00 -0700", text: "Your Target GiftCard balance is $12.40. Access number 0394." }])[0],
    want: null,
  },
  {
    label: "Amount guard: 'New balance: $80' > $25 loaded (account reload, not the card) → null",
    run: () => tieBalance([{ code: null, store: "Starbucks", amount: 25, dateReceived: "2026-05-01" }], [{ id: "re1", date: "Wed, 20 May 2026 10:00:00 -0700", text: "Your Starbucks Card was reloaded today. New balance: $80.00." }])[0],
    want: null,
  },
];

const eq = (a, b) => JSON.stringify(stripAsOf(a)) === JSON.stringify(stripAsOf(b));
function stripAsOf(v) {
  if (Array.isArray(v)) return v.map(stripAsOf);
  if (v && typeof v === "object") {
    const { asOf: _asOf, ...rest } = v;
    return rest;
  }
  return v;
}

// ——— Run ———
const silentMiss = [];
const extractionMiss = [];
let tp = 0, fn = 0, fp = 0, tn = 0;

console.log("\n  CASE                                              | q1 q2 | extract");
console.log("  " + "-".repeat(86));
for (const c of CASES) {
  const q1 = coveredPass1(c);
  const q2 = coveredPass2(c);
  const d = await extract(c);
  const gotReal = !!d.isGiftCard;
  const wantReal = isReal(c.expect.kind);
  const amtOK = !wantReal || Math.abs((d.amount ?? 0) - c.expect.amount) < 0.005;
  const extractOK = gotReal === wantReal && amtOK;

  if (wantReal) gotReal && amtOK ? tp++ : fn++;
  else gotReal ? fp++ : tn++;
  if (wantReal && !q1 && !q2) silentMiss.push(c.label);
  if (!extractOK) extractionMiss.push(`${c.label} → got isGiftCard=${gotReal} amount=${d.amount ?? "—"} (wanted ${c.expect.kind}${wantReal ? " $" + c.expect.amount : ""})`);

  console.log(`  ${c.label.padEnd(49).slice(0, 49)} | ${q1 ? "✓" : "·"}  ${q2 ? "✓" : "·"}  | ${extractOK ? "OK" : "‼ FAIL"}  ${gotReal ? `$${d.amount ?? "?"}` : "(rejected)"}`);
}

console.log("\n  DETERMINISTIC (real lib/extract.ts functions)");
console.log("  " + "-".repeat(86));
const detMiss = [];
for (const t of DET) {
  let ok = false;
  let got;
  try {
    got = t.run();
    ok = eq(got, t.want);
  } catch (e) {
    got = `threw: ${e.message}`;
  }
  if (!ok) detMiss.push(`${t.label} → got ${JSON.stringify(got)} wanted ${JSON.stringify(t.want)}`);
  console.log(`  ${t.label.padEnd(76).slice(0, 76)} | ${ok ? "OK" : "‼ FAIL"}`);
}

const mismatches = extractionMiss.length + detMiss.length + silentMiss.length;
console.log("\n  ── SUMMARY ─────────────────────────────────────────");
console.log(`  Cases: ${CASES.length} extraction + ${DET.length} deterministic = ${CASES.length + DET.length}   ·   mismatches: ${mismatches}`);
console.log(`  Extraction recall ${tp}/${tp + fn} (${((100 * tp) / (tp + fn)).toFixed(0)}%)   precision ${tp}/${tp + fp} (${((100 * tp) / (tp + fp)).toFixed(0)}%)   promos rejected ${tn}/${tn + fp}`);
console.log(`  Real cards NEITHER search pass would surface (${silentMiss.length}):`);
silentMiss.forEach((m) => console.log(`     ✗ ${m}`));
console.log(`  Extraction mismatches (${extractionMiss.length}):`);
extractionMiss.forEach((m) => console.log(`     ‼ ${m}`));
console.log(`  Deterministic mismatches (${detMiss.length}):`);
detMiss.forEach((m) => console.log(`     ‼ ${m}`));
console.log("");
process.exitCode = mismatches ? 1 : 0;
