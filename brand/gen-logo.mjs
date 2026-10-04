import { readFileSync, writeFileSync } from "fs";
import path from "path";

const env = readFileSync("/Users/ryanyousefi/marketing/htk-v2/.env", "utf8");
const KEY = env.match(/OPENAI_API_KEY=(\S+)/)[1];
const OUT = path.dirname(new URL(import.meta.url).pathname);

const BASE = `Minimal flat vector logo design, solid white background, clean 2D graphic design, no 3D, no gradients except where stated, no shadows, no mockups, no extra text, centered, lots of white space. Brand colors: emerald green #10B981 and near-black #18181B only.`;

const LOGOS = [
  {
    name: "logo1-wordmark",
    prompt: `Logo wordmark for a fintech app called "Stash": the single word "Stash" in a bold, friendly rounded geometric sans-serif, near-black, where the "S" letters are emerald green. No icon, just beautiful typography. ${BASE}`,
  },
  {
    name: "logo2-app-icon",
    prompt: `App icon logo for a fintech app called "Stash": a rounded square in solid emerald green #10B981 containing a bold white lowercase letter "s" drawn like a simple smooth ribbon. iOS app icon style, flat. ${BASE}`,
  },
  {
    name: "logo3-card-stack",
    prompt: `Logo mark for a fintech app called "Stash": a minimal icon of three rounded gift cards stacked with a slight fan offset, the top card emerald green with a tiny white dollar sign, the others outlined in near-black. Next to it the word "Stash" in bold rounded sans-serif near-black. Horizontal lockup. ${BASE}`,
  },
  {
    name: "logo4-pocket",
    prompt: `Logo mark for a fintech app called "Stash": a minimal icon of a simple rounded pocket shape in emerald green with one card peeking out of the top, drawn with clean geometric lines. Below it the word "Stash" in bold rounded sans-serif near-black. Vertical lockup. ${BASE}`,
  },
];

async function gen(v) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-2", prompt: v.prompt, size: "1024x1024", quality: "high", n: 1 }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${v.name}: ${json.error?.message || res.status}`);
  writeFileSync(path.join(OUT, `${v.name}.png`), Buffer.from(json.data[0].b64_json, "base64"));
  console.log(`done ${v.name}`);
}

const results = await Promise.allSettled(LOGOS.map(gen));
for (const [i, r] of results.entries()) {
  if (r.status === "rejected") console.error(`FAIL ${LOGOS[i].name}: ${r.reason.message}`);
}
