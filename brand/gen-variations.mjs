import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";

const env = readFileSync("/Users/ryanyousefi/marketing/htk-v2/.env", "utf8");
const KEY = env.match(/OPENAI_API_KEY=(\S+)/)[1];
const OUT = path.dirname(new URL(import.meta.url).pathname);
mkdirSync(OUT, { recursive: true });

const BASE_STYLE = `Style: soft glossy claymorphism 3D render, rounded edges, studio lighting, gentle shadows. Background: clean off-white (#F5F8F6) with a subtle emerald gradient glow. Color palette strictly: emerald green #10B981, white, near-black, small warm accents. Mood: playful but trustworthy — like Cash App meets a toy commercial. Lots of clean negative space, no clutter, no people, no real brand logos.`;

const VARIATIONS = [
  {
    name: "v1-envelope-hero",
    size: "1024x1024",
    prompt: `A premium 3D-rendered hero image for a teen fintech app called "Stash". Center: a floating smartphone displaying a clean white wallet app with a large emerald-green number "$434.50" and the small caption "found in your inbox", with three small gift-card rows below it. Behind and around the phone, an open white email envelope tilts open and colorful glossy gift cards (green, orange, red, blue — generic) fly out toward the phone, leaving soft trails of tiny green dollar-sign sparkles and floating coins. The word "Stash" in bold dark rounded sans-serif at the top. ${BASE_STYLE} Square composition.`,
  },
  {
    name: "v2-wide-deck",
    size: "1536x1024",
    prompt: `A premium wide 3D-rendered title-slide background for a teen fintech app called "Stash". Right third: a floating smartphone showing a clean white wallet app with a large emerald-green number "$434.50". From the left, an open white email envelope releases a stream of colorful glossy generic gift cards and gold coins that arc across the frame into the phone, with tiny green dollar-sign sparkles along the path. The left half stays mostly empty clean space for slide text. The word "Stash" small in bold dark rounded sans-serif in the top-left corner. ${BASE_STYLE} Wide 16:9 cinematic composition.`,
  },
  {
    name: "v3-hoodie-pocket",
    size: "1024x1024",
    prompt: `A fun premium 3D-rendered image for a teen fintech app called "Stash". Center: a gray teen hoodie's front pocket (just the hoodie torso, no face or head visible) overflowing with colorful glossy generic gift cards and gold coins spilling out, glowing softly emerald green from inside the pocket, as if the pocket is full of forgotten money. A few cards float upward with tiny green dollar-sign sparkles. The word "Stash" in bold dark rounded sans-serif at the top, with the small tagline "find the money you forgot you own" beneath it. ${BASE_STYLE} Square composition.`,
  },
  {
    name: "v4-vault-stash",
    size: "1024x1024",
    prompt: `A premium 3D-rendered brand image for a teen fintech app called "Stash". Center: a cute rounded emerald-green mini safe / vault with its door swung open, glowing warmly from inside, neatly stacked with colorful glossy generic gift cards and gold coins. A floating smartphone leans against the safe showing a clean white wallet app with a large emerald-green number "$434.50". A few coins and one gift card hover above with tiny green sparkles. The word "Stash" in bold dark rounded sans-serif at the top. ${BASE_STYLE} Square composition.`,
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

const results = await Promise.allSettled(VARIATIONS.map(gen));
for (const [i, r] of results.entries()) {
  if (r.status === "rejected") console.error(`FAIL ${VARIATIONS[i].name}: ${r.reason.message}`);
}
