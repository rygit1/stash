// PROVEN 2026-06-11: drives a real Nike eGift "view gift card" link end-to-end, headless,
// no CAPTCHA. Reveals the hidden card number + PIN + balance — the code that the delivery
// email keeps behind a button. Auth = the email associated with the order (in production:
// the connected inbox's own address — the scanner already knows it).
//
//   node nike-reveal.mjs "<redeem-url>" "<order-email>"
//
// KEY GOTCHA: Nike's email field is a React controlled input — puppeteer .type()/.fill()
// sets .value but React ignores it, so submit sends empty. Must set via the native value
// setter + dispatch input/change events (see fillReact below).

import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url)); // absolute, so cwd doesn't matter (route spawns from project root)
const [url, email] = process.argv.slice(2);
if (!url || !email) {
  console.error('usage: node nike-reveal.mjs "<redeem-url>" "<order-email>"');
  process.exit(1);
}

// Chrome's sandbox stays ON by default. Only Linux-in-Docker / root setups need it off: opt in with PUPPETEER_NO_SANDBOX=1.
const launchArgs = process.env.PUPPETEER_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-setuid-sandbox"] : [];
const browser = await puppeteer.launch({ headless: "new", args: launchArgs });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 850 });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

  // Never type the user's email into a page that isn't Nike's. The link came out of an email body,
  // so re-check where we actually ended up (redirects included) before touching any field.
  const finalHost = new URL(page.url()).hostname.toLowerCase();
  if (!(finalHost === "nike.com" || finalHost.endsWith(".nike.com"))) {
    console.log(JSON.stringify({ ok: false, reason: "unexpected_host" }));
    await browser.close(); // process.exit() skips the finally block, so close explicitly
    process.exit(0);
  }
  await page.waitForSelector("#email", { timeout: 20000 });

  // React-aware fill: native setter + synthetic events so onChange fires.
  await page.evaluate((value) => {
    const el = document.querySelector("#email");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }, email);

  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => (b.innerText || "").trim().toLowerCase().includes("verify email"))?.click();
  });

  // Wait for either the reveal (card number rendered) or the error.
  await page.waitForFunction(() => /card #\s*\d|unable to verify/i.test(document.body.innerText), { timeout: 25000 });
  await new Promise((r) => setTimeout(r, 1500)); // let the async card block settle before parse/shot
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));

  if (/unable to verify/i.test(body)) {
    console.log(JSON.stringify({ ok: false, reason: "email_not_on_order" }));
  } else {
    const num = body.match(/Card #\s*([\d ]{12,})/i)?.[1]?.replace(/\s/g, "") ?? null;
    const pin = body.match(/Pin #\s*(\d{4,})/i)?.[1] ?? null;
    const amount = body.match(/\$\s?(\d+(?:\.\d{2})?)/)?.[1] ?? null;
    let screenshot = null;
    try {
      const dir = join(HERE, "evidence");
      mkdirSync(dir, { recursive: true });
      screenshot = join(dir, "nike-reveal-success.png");
      await page.screenshot({ path: screenshot }); // best-effort: never let a shot failure sink the result
    } catch {}
    console.log(JSON.stringify({ ok: true, amount, cardNumber: num, pin, screenshot }));
  }
} finally {
  await browser.close();
}
