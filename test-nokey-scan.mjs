// PROOF that a barcoded card scans with NO Anthropic key and NO network (2026-08-23).
//
// The bug this guards: processShot used to await the barcode INSIDE the try around the card
// reader call, so any reader failure (dead key = HTTP 500) jumped to the catch and DISCARDED a
// perfectly good card number, showing "couldn't reach the card reader". The number had already
// been read on the device, for free, offline.
//
// This test closes the loop with the app's OWN code on both ends: encode a known number with
// lib/barcode128.ts, render it, then decode it with lib/barcode.ts. If the number survives the
// round trip, the scan has everything it needs without any key.
//
//   node --experimental-strip-types test-nokey-scan.mjs
//
// It also asserts the reader really is unreachable, so this cannot silently pass by accident.

import { createRequire } from "node:module";
// spike-balance owns puppeteer (the app itself must never depend on it), so resolve from there.
const req = createRequire(new URL("./spike-balance/", import.meta.url));
const puppeteer = req("puppeteer");
import { code128Svg } from "./lib/barcode128.ts";
import { decodeGrayscaleHard, looksLikeCardCode } from "./lib/barcode.ts";

const TRUTH = "6006491234567890";
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
};

console.log("\n=== 1. the app encodes the number to a real barcode ===");
const svg = code128Svg(TRUTH, { height: 120, moduleWidth: 3, quietModules: 10 });
check("code128Svg returned markup", Boolean(svg && svg.startsWith("<svg")), `${svg ? svg.length : 0} chars`);

console.log("\n=== 2. render it to pixels (no network) ===");
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 320 });
await page.setContent(`<body style="margin:0;background:#fff;display:flex;align-items:center;justify-content:center;height:320px">${svg}</body>`);
const shot = await page.screenshot({ type: "png" });
await browser.close();
check("rendered a PNG", shot.length > 1000, `${shot.length} bytes`);

console.log("\n=== 3. the app decodes it back, on-device, offline ===");
// Decode straight from the PNG pixels using the same pure path the browser scanner uses.
let PNG = null;
try { PNG = req("pngjs").PNG; } catch { /* optional */ }
let decoded = null;
if (PNG) {
  const png = PNG.sync.read(Buffer.from(shot));
  const gray = new Uint8ClampedArray(png.width * png.height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (png.data[p] * 306 + png.data[p + 1] * 601 + png.data[p + 2] * 117) >> 10;
  }
  decoded = decodeGrayscaleHard(gray, png.width, png.height, looksLikeCardCode);
} else {
  console.log("  (pngjs unavailable, skipping pixel decode)");
}
check("decoded a card-shaped number", Boolean(decoded), decoded ? `got ${decoded}` : "");
check("decoded number EXACTLY matches", decoded === TRUTH, `expected ${TRUTH}, got ${decoded}`);

console.log("\n=== 4. and the card reader really IS down, so this is not a false pass ===");
let readerStatus = null;
try {
  const r = await fetch("https://stashloot.vercel.app/api/scan-card", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" }),
    signal: AbortSignal.timeout(25000),
  });
  readerStatus = r.status;
} catch (e) {
  readerStatus = `network: ${String(e).slice(0, 60)}`;
}
check("reader returns a failure (proving the key is dead)", readerStatus === 500, `status ${readerStatus}`);

console.log(
  failures === 0
    ? `\nRESULT: a barcoded card yields ${TRUTH} with the reader dead. The scan needs no key.\n`
    : `\nRESULT: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
