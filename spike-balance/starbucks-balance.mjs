// PROVEN 2026-06-12: drives starbucks.com/gift's PUBLIC "Check your balance" form end-to-end,
// headless, no login, no CAPTCHA. A SCANNED physical card (we have its card number + security
// code printed on the back) gets its REAL balance fetched by driving the merchant form — same
// agent tech as nike-reveal.mjs, different form.
//
//   node starbucks-balance.mjs "<cardNumber>" "<securityCode>"
//
// KEY GOTCHA (same as Nike): the inputs are React controlled — puppeteer .type()/.fill() sets
// .value but React ignores it, so submit sends empty. Must set via the native value setter +
// dispatch input/change/blur (see fillReact below).

import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url)); // absolute, so cwd doesn't matter (route spawns from project root)
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const [cardNumber, securityCode] = process.argv.slice(2);
if (!cardNumber || !securityCode) {
  console.log(JSON.stringify({ ok: false, reason: "missing_args" }));
  process.exit(0); // never throw uncaught — the route parses a JSON line
}

// React-aware fill: native setter + synthetic events so onChange fires (puppeteer .type won't).
async function fillReact(page, selector, value) {
  await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    },
    selector,
    value,
  );
}

// Chrome's sandbox stays ON by default. Only Linux-in-Docker / root setups need it off: opt in with PUPPETEER_NO_SANDBOX=1.
const launchArgs = process.env.PUPPETEER_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-setuid-sandbox"] : [];
const browser = await puppeteer.launch({ headless: "new", args: launchArgs });
try {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto("https://www.starbucks.com/gift", { waitUntil: "networkidle2", timeout: 45000 });

  // Dismiss the cookie-consent banner first — it overlays the page and intercepts the reveal click.
  await page.evaluate(() => {
    const a = [...document.querySelectorAll("button, a")].find((n) => /^agree$|accept all|accept cookies/i.test((n.innerText || "").trim()));
    a?.click();
  });
  await new Promise((r) => setTimeout(r, 600));

  // "Check your balance." is a JS <a> (no href) — scroll into view + click it by text, then wait for the form.
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("a, button")].find((n) =>
      /check your balance/i.test((n.innerText || n.textContent || "").trim()),
    );
    el?.scrollIntoView();
    el?.click();
  });
  await page.waitForSelector('input[name="cardNumber"]', { timeout: 20000 });

  await fillReact(page, 'input[name="cardNumber"]', cardNumber);
  await fillReact(page, 'input[name="securityCode"]', securityCode);

  // Submit: the "Check balance" button (text match; skip the "Check your balance" reveal link we already clicked).
  // Click the VISIBLE "Check balance" submit (there are two on the page; pick the rendered one,
  // nearest the inputs). NOT the "Check your balance." reveal link we already clicked.
  await page.evaluate(() => {
    const top = document.querySelector('input[name="cardNumber"]')?.getBoundingClientRect().top ?? 0;
    const btns = [...document.querySelectorAll("button")].filter((n) => {
      const t = (n.innerText || n.textContent || "").trim();
      return /^check balance$/i.test(t) && n.offsetParent !== null;
    });
    btns.sort((a, b) => Math.abs(a.getBoundingClientRect().top - top) - Math.abs(b.getBoundingClientRect().top - top));
    btns[0]?.click();
  });

  // The form POSTs to starbucks.com/apiproxy/v1/gift/card/check-balance. On success the page renders
  // a $ amount; on a bad card it renders "Something went wrong — Check your card information".
  await page.waitForFunction(
    () => {
      const t = document.body.innerText || "";
      return /\$\s?\d/.test(t) || /(something went wrong|check your card information|invalid|not\s*found|unable|incorrect|try again|isn.?t valid)/i.test(t);
    },
    { timeout: 25000 },
  );
  await new Promise((r) => setTimeout(r, 1200)); // let the async result block settle before parse/shot
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));

  let screenshot = null;
  try {
    const dir = join(HERE, "evidence");
    mkdirSync(dir, { recursive: true });
    screenshot = join(dir, "starbucks-balance.png");
    await page.screenshot({ path: screenshot }); // best-effort: never let a shot failure sink the result
  } catch {}

  const invalid =
    /(something went wrong|check your card information|invalid|not\s*found|incorrect|unable|check the number|try again|isn.?t valid)/i.test(body);
  const amount = body.match(/\$\s?(\d+(?:\.\d{2})?)/)?.[1] ?? null;

  if (amount) {
    console.log(JSON.stringify({ ok: true, amount, store: "Starbucks", screenshot }));
  } else if (invalid) {
    console.log(JSON.stringify({ ok: false, reason: "invalid_card", screenshot }));
  } else {
    console.log(JSON.stringify({ ok: false, reason: "no_result", screenshot }));
  }
} catch (e) {
  // Distinguish the most common failure (the result never rendered) from anything else.
  const reason = /timeout|waiting/i.test(String(e?.message)) ? "timeout" : "no_result";
  console.log(JSON.stringify({ ok: false, reason }));
} finally {
  await browser.close();
}
