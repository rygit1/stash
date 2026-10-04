import { readFileSync, writeFileSync } from "fs";
import path from "path";

const env = readFileSync("/Users/ryanyousefi/marketing/htk-v2/.env", "utf8");
const KEY = env.match(/OPENAI_API_KEY=(\S+)/)[1];
const OUT = path.dirname(new URL(import.meta.url).pathname);

const UI_STYLE = `UI design language: clean white background app, emerald green #10B981 as the only accent color, near-black text, rounded-2xl cards, bold friendly rounded sans-serif, generous spacing — like Cash App / Apple Wallet quality. Phone: modern iPhone, front view, floating on a clean off-white studio background with a soft emerald glow shadow. High-fidelity app mockup render, crisp legible UI text, no real brand logos (use simple colored icons: orange shopping bag, blue gamepad, green coffee cup, black sneaker). No people, no clutter.`;

const SHOTS = [
  {
    name: "shop1-home",
    size: "1024x1536",
    prompt: `High-fidelity phone mockup of the "Stash Shop" screen in a teen fintech app called Stash. Top: small "Stash" wordmark and the screen title "Shop". Below: a section header "Picked for you" with the small subtitle "from your inbox", showing a horizontal row of three gift cards: a black sneaker-icon card "$25", a blue gamepad-icon card "$10", an orange shopping-bag-icon card "$50". Below that: a section "Send a gift" with two smaller cards. Bottom tab bar with two tabs: "Wallet" and "Shop" (Shop highlighted in emerald green). ${UI_STYLE} Tall portrait composition, single centered phone.`,
  },
  {
    name: "shop2-buy",
    size: "1024x1536",
    prompt: `High-fidelity phone mockup of a gift-card purchase screen in a teen fintech app called Stash, titled "Stash Shop". Centered: one large black gift card with a white sneaker icon, amount selector pills "$10 $25 $50" with $25 selected in emerald green, a line of text "Maya gets it instantly by email", and a big emerald-green rounded button "Send Gift". Small note at the bottom: "Stash earns a commission — you never pay extra". ${UI_STYLE} Tall portrait composition, single centered phone.`,
  },
  {
    name: "shop3-loop",
    size: "1536x1024",
    prompt: `High-fidelity mockup of two iPhones side by side for a teen fintech app called Stash. Left phone: the "Wallet" screen — big emerald-green number "$434.50", caption "found in your inbox", and three gift-card rows below. Right phone: the "Stash Shop" screen — header "Picked for you" and a grid of four colorful generic gift cards with simple icons. Between the phones, a subtle emerald arrow looping from the wallet to the shop. Small "Stash" wordmark top center. ${UI_STYLE} Wide composition, both phones fully visible.`,
  },
  {
    name: "shop4-hero",
    size: "1536x1024",
    prompt: `Premium marketing hero image for "Stash Shop", a teen fintech gift-card shop. A single modern iPhone floating at a slight angle showing the "Stash Shop" screen (title "Shop", "Picked for you", a row of colorful gift cards with simple icons — orange shopping bag, black sneaker, blue gamepad, green coffee cup). Around the phone, three or four colorful gift cards float in mid-air with a soft emerald-green glow and gentle drop shadows, as if bursting out of the screen. Clean off-white studio background, lots of empty space on the LEFT side for headline text. Small "Stash" wordmark. ${UI_STYLE.replace("Phone: modern iPhone, front view, floating on a clean off-white studio background with a soft emerald glow shadow. ", "")} Wide cinematic product-shot composition, polished and aspirational.`,
  },
];

async function gen(v) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-2", prompt: v.prompt, size: v.size, quality: "high", n: 1 }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${v.name}: ${json.error?.message || res.status}`);
  writeFileSync(path.join(OUT, `${v.name}.png`), Buffer.from(json.data[0].b64_json, "base64"));
  console.log(`done ${v.name}`);
}

const results = await Promise.allSettled(SHOTS.map(gen));
for (const [i, r] of results.entries()) {
  if (r.status === "rejected") console.error(`FAIL ${SHOTS[i].name}: ${r.reason.message}`);
}
