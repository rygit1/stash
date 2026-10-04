// Drives the REAL scanner UI end to end with the card reader dead, and screenshots what a person
// actually sees (2026-08-23). This is the design gate evidence, and it is also the test that
// proves the three new UI pieces work rather than merely compile:
//   1. the reader-down banner
//   2. the card number arriving from the barcode with no key and no network
//   3. the amber "check this one" flags
//
//   node --experimental-strip-types test-scanner-ui.mjs
//
// It uploads a generated card image through the scanner's own file input, so nothing is mocked:
// the same processShot runs, the same /api/scan-card call fails on the dead key, and the barcode
// has to carry the scan by itself.

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const req = createRequire(new URL("./spike-balance/", import.meta.url));
const puppeteer = req("puppeteer");
import { code128Svg } from "./lib/barcode128.ts";

const BASE = "http://localhost:3000";
const TRUTH = "6006491234567890";
const OUT = "/private/tmp/claude-501/-Users-ryanyousefi/6f1ef3e1-d3a9-474c-afcb-3b76f61ffca9/scratchpad";
let failures = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "  PASS" : "  FAIL"}  ${n}${d ? "  " + d : ""}`); if (!ok) failures++; };

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });

// --- build a card photo carrying a real scannable barcode -------------------------------------
const maker = await browser.newPage();
await maker.setViewport({ width: 1012, height: 638 });
await maker.setContent(`<body style="margin:0"><div style="width:1012px;height:638px;background:linear-gradient(135deg,#0d7a5b,#00704A 55%,#003824);position:relative;font-family:Arial">
  <div style="position:absolute;left:60px;top:44px;color:#fff;font-size:56px;font-weight:800">STARBUCKS</div>
  <div style="position:absolute;left:60px;top:118px;color:#cfe8de;font-size:26px;letter-spacing:6px">GIFT CARD</div>
  <div style="position:absolute;left:60px;top:250px;width:120px;height:84px;border-radius:10px;background:linear-gradient(135deg,#f3d27e,#d4ab52 55%,#b9913e)"></div>
  <div style="position:absolute;left:56px;bottom:34px;background:#fff;padding:12px 16px;border-radius:6px">${code128Svg(TRUTH, { height: 90, moduleWidth: 2, quietModules: 8 })}</div>
</div></body>`);
const cardPng = await maker.screenshot({ type: "png" });
const cardPath = `${OUT}/card-with-barcode.png`;
writeFileSync(cardPath, cardPng);
await maker.close();
console.log(`\nbuilt a test card carrying barcode ${TRUTH}`);

async function run(label, width, height, mobile) {
  console.log(`\n=== ${label} (${width}x${height}) ===`);
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/?reset=1`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));

  // Open the scanner via its real button, then hand it the card through its own file input.
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /scan a plastic card/i.test(x.innerText || ""));
    if (!b) return false;
    b.click();
    return true;
  });
  check("scanner button found and clicked", opened);
  await new Promise((r) => setTimeout(r, 1200));

  const input = await page.$('input[type="file"]');
  check("scanner file input present", Boolean(input));
  if (input) await input.uploadFile(cardPath);

  // processShot now runs for real: barcode decodes on-device, /api/scan-card 500s on the dead key.
  await new Promise((r) => setTimeout(r, 12000));

  const state = await page.evaluate(() => {
    const txt = document.body.innerText.replace(/\s+/g, " ");
    const vals = [...document.querySelectorAll("input")].map((i) => i.value).filter(Boolean);
    const amber = [...document.querySelectorAll("input")].filter((i) => /amber/.test(i.className)).length;
    const flags = [...document.querySelectorAll("span")].filter((s) => /check this one/i.test(s.innerText || "")).length;
    return { txt: txt.slice(0, 400), vals, amber, flags, readerDown: /straight off the barcode/i.test(txt) };
  });

  const shot = `${OUT}/scanner-${label}.png`;
  await page.screenshot({ path: shot, fullPage: false });
  console.log(`  screenshot: ${shot}`);
  console.log(`  on screen : ${state.txt.slice(0, 220)}`);
  console.log(`  field values: ${JSON.stringify(state.vals)}`);

  check("reader-down banner shown", state.readerDown);
  check("card number came from the barcode", state.vals.includes(TRUTH), `values ${JSON.stringify(state.vals)}`);
  check("amber flag styling applied", state.amber > 0 || state.flags > 0, `boxes ${state.amber}, labels ${state.flags}`);
  await page.close();
}

await run("mobile", 390, 844, true);
await run("desktop", 1440, 900, false);
await browser.close();
console.log(failures === 0 ? `\nALL UI CHECKS PASSED\n` : `\n${failures} UI CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
