// Proves the core engine: gift-card email -> structured card, with Haiku 4.5.
// Includes a PROMO email to confirm we reject "earn a gift card" marketing.
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const env = fs.readFileSync(new URL("./.env.local", import.meta.url), "utf8");
const apiKey = env.match(/ANTHROPIC_API_KEY=(.+)/)[1].trim();
const client = new Anthropic({ apiKey });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    isGiftCard: { type: "boolean" },
    store: { type: ["string", "null"] },
    amount: { type: ["number", "null"] },
    code: { type: ["string", "null"] },
    pin: { type: ["string", "null"] },
    dateReceived: { type: ["string", "null"] },
    expires: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["isGiftCard", "store", "amount", "code", "pin", "dateReceived", "expires", "confidence"],
};

const SYSTEM = `You extract gift-card details from a single email.
Return a card ONLY if the recipient actually RECEIVED or OWNS it (an e-gift card delivered to them, or a purchase/balance confirmation).
Set isGiftCard=false for marketing/promotions like "earn a $25 gift card", "get a gift card when you sign up", or "bonus offer" — those are NOT cards they own.
amount = the dollar value loaded on the card (number only). Use null for anything not present. Be precise.`;

async function extract(email) {
  const resp = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: "user", content: `From: ${email.from}\nDate: ${email.date}\nSubject: ${email.subject}\n\n${email.body}` }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });
  const text = resp.content.find((b) => b.type === "text").text;
  return { data: JSON.parse(text), usage: resp.usage };
}

const EMAILS = [
  {
    label: "Amazon e-gift (real)",
    from: "Amazon.com Gift Cards <gc-orders@gc.email.amazon.com>",
    date: "Dec 25, 2025",
    subject: "An Amazon.com Gift Card for you!",
    body: "Hi Ryan,\nYou've received a $25.00 Amazon.com Gift Card from Grandma!\nClaim code: 4PXG-7H2K9L-QWER\nApply it to your account at amazon.com/redeem. This gift card does not expire.",
  },
  {
    label: "Starbucks eGift (real, has PIN)",
    from: "Starbucks <egift@starbucks.com>",
    date: "Feb 2, 2026",
    subject: "Sarah sent you a Starbucks eGift",
    body: "You received a $15.00 Starbucks eGift Card.\nMessage: Happy birthday!! \nCard number: 6010 5612 3456 7890\nPIN: 4421\nAdd it to the Starbucks app to start using it.",
  },
  {
    label: "Chase promo (should be REJECTED)",
    from: "Chase <no-reply@chase.com>",
    date: "Jan 10, 2026",
    subject: "Earn a $300 bonus",
    body: "Open a new Chase checking account and earn a $300 gift card bonus! Limited-time offer. Terms and conditions apply.",
  },
];

let inTok = 0, outTok = 0;
for (const email of EMAILS) {
  const { data, usage } = await extract(email);
  inTok += usage.input_tokens; outTok += usage.output_tokens;
  console.log(`\n— ${email.label}`);
  if (data.isGiftCard) {
    console.log(`  ✅ ${data.store} — $${data.amount}  (code: ${data.code ?? "n/a"}, pin: ${data.pin ?? "n/a"}, conf: ${data.confidence})`);
  } else {
    console.log(`  🚫 not a real card (confidence: ${data.confidence}) — filtered out`);
  }
}
const cost = (inTok / 1e6) * 1 + (outTok / 1e6) * 5; // Haiku 4.5: $1 in / $5 out
console.log(`\nTokens: ${inTok} in / ${outTok} out  ·  cost for these 3 emails: $${cost.toFixed(5)}`);
