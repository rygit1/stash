// Focused diagnostic: WHY won't Nike's PIN field accept input, and can we complete one submit?
// Still DUMMY data, ONE submit, no hammering. Stays inside spike-balance/.
import puppeteer from "puppeteer";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVID = join(__dirname, "evidence");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CARD_19 = "6224990000000000000"; // 19-digit dummy (Nike GC length)
const PIN = "123456"; // 6-digit dummy

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled", "--window-size=1280,900", "--lang=en-US"],
});
const page = await browser.newPage();
const ua = (await browser.userAgent()).replace("HeadlessChrome", "Chrome");
await page.setUserAgent(ua);
await page.setViewport({ width: 1280, height: 900 });

const out = { steps: [] };
const log = (k, v) => { out.steps.push([k, v]); console.error(`${k}:`, JSON.stringify(v)); };

await page.goto("https://www.nike.com/orders/gift-card-lookup", { waitUntil: "domcontentloaded", timeout: 35000 });
await sleep(4000);

const tag = await page.evaluate(() => {
  const all = [...document.querySelectorAll("input")];
  const hint = (el) => [el.name, el.id, el.placeholder, el.getAttribute("aria-label")].filter(Boolean).join(" ");
  const card = all.find((el) => /gift.?card.?number|card.?number/i.test(hint(el)));
  const pin = all.find((el) => /pin/i.test(hint(el)) && el !== card);
  if (card) card.setAttribute("data-d", "card");
  if (pin) pin.setAttribute("data-d", "pin");
  const desc = (el) => (el ? { name: el.name, id: el.id, type: el.type, disabled: el.disabled, readOnly: el.readOnly, maxLength: el.maxLength, inputMode: el.inputMode, value: el.value } : null);
  return { card: desc(card), pin: desc(pin) };
});
log("fields", tag);

// Fill card (19 digits) via real keystrokes.
const ch = await page.$('[data-d="card"]');
await ch.click({ clickCount: 3 });
await ch.type(CARD_19, { delay: 45 });
await sleep(600);
log("after-card", await page.evaluate(() => {
  const c = document.querySelector('[data-d="card"]'), p = document.querySelector('[data-d="pin"]');
  return { cardValue: c?.value, pinDisabled: p?.disabled, pinReadOnly: p?.readOnly };
}));

// Attempt 1: real click + keyboard typing on PIN.
const ph = await page.$('[data-d="pin"]');
await ph.click({ clickCount: 3 });
await page.keyboard.type(PIN, { delay: 60 });
await sleep(400);
let pinVal = await page.$eval('[data-d="pin"]', (el) => el.value);
log("pin-after-keyboard", pinVal);

// Attempt 2 (only if still empty): native value setter + input/change events (React-friendly, still just filling).
if (!pinVal) {
  await page.evaluate((v) => {
    const el = document.querySelector('[data-d="pin"]');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }, PIN);
  await sleep(400);
  pinVal = await page.$eval('[data-d="pin"]', (el) => el.value);
  log("pin-after-nativeset", pinVal);
}

await page.screenshot({ path: join(EVID, "nike-diag-filled.png"), fullPage: true });

// Submit button state + ONE click if enabled.
const btn = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /check balance/i.test(x.innerText || ""));
  if (b) b.setAttribute("data-d", "submit");
  return b ? { disabled: b.disabled, ariaDisabled: b.getAttribute("aria-disabled"), text: (b.innerText || "").trim() } : null;
});
log("submit-state", btn);

if (btn && !btn.disabled) {
  await page.click('[data-d="submit"]', { delay: 30 }).catch(() => {});
  await Promise.race([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => {}),
    page.waitForResponse((r) => r.request().method() === "POST", { timeout: 12000 }).catch(() => {}),
    sleep(9000),
  ]);
  await sleep(2500);
  const res = await page.evaluate(() => {
    const body = document.body ? document.body.innerText : "";
    const re = /(invalid|incorrect|not valid|enter a valid|valid (card|number|pin)|doesn'?t match|try again|couldn'?t|unable)/i;
    const errs = [...new Set(body.split("\n").map((s) => s.trim()).filter((l) => l && re.test(l) && l.length < 180))].slice(0, 8);
    const alerts = [...document.querySelectorAll('[role=alert],[class*="error" i]')].map((e) => (e.innerText || "").trim()).filter(Boolean);
    return { errs, alerts: [...new Set(alerts)].slice(0, 8), url: location.href };
  });
  log("submit-result", res);
  await page.screenshot({ path: join(EVID, "nike-diag-result.png"), fullPage: true });
} else {
  log("submit-result", "button still disabled — did not submit");
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
