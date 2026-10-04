// Why this exists (2026-08-23): the coverage sweep returned 8 stores as "not-drivable" with NO
// card field found, no login wall and no captcha. That verdict lumps together three completely
// different answers, and only one of them is a real closed door:
//
//   1. the store offers NO online balance check at all (Chipotle: "check in restaurant, or call")
//   2. the balance form exists but is one click away from the page we landed on
//   3. a cookie/consent banner was covering the page when we looked
//
// Reporting all three as "closed" would undercount the openings and kill the feature on bad data.
// This probe reads each page and says WHICH of the three it is. Read-only: it never submits.

import puppeteer from "puppeteer";

const PAGES = {
  starbucks: "https://www.starbucks.com/gift",
  walmart: "https://www.walmart.com/cp/gift-cards/1094765",
  ulta: "https://www.ulta.com/guest/giftcard-balance",
  nordstrom: "https://www.nordstrom.com/c/gift-card-balance",
  chipotle: "https://www.chipotle.com/gift-cards",
  gap: "https://www.gap.com/customerService/info.do?cid=81364",
  homedepot: "https://www.homedepot.com/mycheckout/giftcard",
  panera: "https://www.panerabread.com/en-us/gift-cards.html",
};

const LAUNCH_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled", "--window-size=1280,900", "--lang=en-US"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Consent banners sit on top of the page and can hide the very form we came for. Click the
// obvious accept control if one is present. Never anything that is not a cookie notice.
function dismissConsentInPage() {
  const words = /^(accept all|accept|allow all|agree|i agree|got it|ok|close|continue)$/i;
  const clicked = [];
  for (const el of document.querySelectorAll('button,[role=button],a')) {
    const t = (el.innerText || el.getAttribute("aria-label") || "").trim();
    if (!words.test(t)) continue;
    const box = el.closest('[class*="cookie" i],[class*="consent" i],[class*="privacy" i],[id*="cookie" i],[id*="consent" i],[id*="onetrust" i]');
    if (!box) continue;
    try { el.click(); clicked.push(t); } catch {}
  }
  return clicked;
}

function readPageInPage() {
  const body = document.body ? document.body.innerText.replace(/\s+/g, " ") : "";

  // Does the page itself SAY there is no online check? Stores are usually explicit about this.
  const offline = [
    /check (?:your )?balance at any/i,
    /balance (?:can only be|is only) (?:checked|available)/i,
    /call \s*1[-\s]?8\d{2}[-\s]?\d{3}[-\s]?\d{4}/i,
    /visit (?:any|a) (?:store|restaurant|location)/i,
    /in[- ]store only/i,
  ].filter((re) => re.test(body)).map(String);

  // Any control that leads to a balance check.
  const links = [];
  for (const el of document.querySelectorAll("a,button,[role=button]")) {
    const t = (el.innerText || el.getAttribute("aria-label") || "").trim();
    if (!/balance/i.test(t)) continue;
    if (t.length > 60) continue;
    links.push({ text: t, href: el.getAttribute("href") || null, tag: el.tagName.toLowerCase() });
  }

  const inputs = [...document.querySelectorAll("input")].filter((el) => {
    const st = getComputedStyle(el);
    return el.type !== "hidden" && st.display !== "none" && st.visibility !== "hidden" && el.offsetParent !== null;
  }).map((el) => [el.name, el.id, el.placeholder, el.getAttribute("aria-label")].filter(Boolean).join(" ").slice(0, 60));

  return {
    title: document.title,
    offlineSignals: offline,
    balanceControls: links.slice(0, 8),
    visibleInputs: inputs,
    mentionsBalance: /balance/i.test(body),
  };
}

const browser = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
const out = {};
for (const [key, url] of Object.entries(PAGES)) {
  const page = await browser.newPage();
  const row = { url, reached: false };
  try {
    const ua = (await browser.userAgent()).replace("HeadlessChrome", "Chrome");
    await page.setUserAgent(ua);
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
    await sleep(4000);
    row.consentClicked = await page.evaluate(dismissConsentInPage).catch(() => []);
    if (row.consentClicked?.length) await sleep(1500);
    Object.assign(row, await page.evaluate(readPageInPage));
    row.reached = true;
  } catch (e) {
    row.error = String(e).slice(0, 140);
  }
  await page.close().catch(() => {});

  // Classify: the whole point is to replace one useless bucket with three real answers.
  row.verdict = !row.reached
    ? "unreached (our blank)"
    : row.offlineSignals?.length
      ? "NO ONLINE CHECK (store says phone/in-store)"
      : row.visibleInputs?.length >= 2
        ? "form is probably ON this page (re-run the driver)"
        : row.balanceControls?.length
          ? "balance form is ONE CLICK AWAY"
          : "no balance path found on this page";
  out[key] = row;
  console.log(`\n=== ${key} ===`);
  console.log(`  verdict: ${row.verdict}`);
  console.log(`  title: ${row.title ?? "(none)"}`);
  if (row.consentClicked?.length) console.log(`  consent dismissed: ${row.consentClicked.join(", ")}`);
  if (row.offlineSignals?.length) console.log(`  offline signals: ${row.offlineSignals.join(" | ")}`);
  if (row.balanceControls?.length) console.log(`  balance controls: ${row.balanceControls.map((l) => `"${l.text}" -> ${l.href ?? l.tag}`).join(" | ")}`);
  if (row.visibleInputs?.length) console.log(`  visible inputs: ${row.visibleInputs.join(" | ")}`);
  if (row.error) console.log(`  error: ${row.error}`);
}
await browser.close().catch(() => {});
console.log("\n" + JSON.stringify(out, null, 2));
