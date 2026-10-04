// Feasibility spike (ISOLATED from the main app):
// Can a browser-automation agent drive a merchant gift-card balance page well enough to demo?
//
// HARD RULES baked in:
//   - DUMMY card numbers only (never a real code). PIN 1234-style dummy.
//   - 1 submit per site, no retry hammering.
//   - NO captcha solving / evasion. Detecting + REPORTING a captcha/login wall IS the success result.
//
// Output: structured findings (JSON to stdout + evidence/findings.json) and screenshots per state.
// Parameterized so the app could later call checkBalance({ merchant, card, pin }).
//
// Note on headless: puppeteer v25's `headless: true` IS the modern ("new") headless mode.
// The old shell renderer is `headless: 'shell'`. We use the new mode per the spike spec.

import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(__dirname, "evidence");
mkdirSync(EVIDENCE_DIR, { recursive: true });

// URLs mirror the app's lib/merchants.ts registry.
const MERCHANTS = {
  target: {
    name: "Target",
    url: "https://www.target.com/guest/gift-card-balance",
    cardHints: ["card", "gift", "number", "access"],
    pinHints: ["pin", "access", "security"],
  },
  nike: {
    name: "Nike",
    url: "https://www.nike.com/orders/gift-card-lookup",
    cardHints: ["card", "gift", "number"],
    pinHints: ["pin"],
  },
  starbucks: {
    name: "Starbucks",
    // Old /card/balance 404s (re-confirmed 2026-08-23). The gift entry point lives on /gift.
    url: "https://www.starbucks.com/gift",
    cardHints: ["card", "number"],
    pinHints: ["pin", "csc", "security", "code"],
  },

  // === 2026-08-23 coverage scout. Which stores let ANYONE check with just card + PIN? ===
  // URLs pre-checked live; only pages that actually answered were added. A store missing from
  // here was never reached, which is OUR blank, not the store refusing.
  walmart: {
    name: "Walmart",
    url: "https://www.walmart.com/cp/gift-cards/1094765",
    cardHints: ["card", "gift", "number"],
    pinHints: ["pin", "security", "code"],
  },
  ulta: {
    name: "Ulta Beauty",
    url: "https://www.ulta.com/guest/giftcard-balance",
    cardHints: ["card", "gift", "number"],
    pinHints: ["pin", "cvv", "security", "code"],
  },
  nordstrom: {
    name: "Nordstrom",
    url: "https://www.nordstrom.com/c/gift-card-balance",
    cardHints: ["card", "gift", "number"],
    pinHints: ["pin", "security", "code"],
  },
  vanilla: {
    name: "Vanilla Visa (prepaid)",
    url: "https://www.vanillagift.com/check-balance",
    cardHints: ["card", "number"],
    pinHints: ["cvv", "cvc", "security", "code", "pin"],
  },
  chipotle: {
    name: "Chipotle",
    url: "https://www.chipotle.com/gift-cards",
    cardHints: ["card", "gift", "number"],
    pinHints: ["pin", "security", "code"],
  },
  gap: {
    name: "Gap / Old Navy",
    url: "https://www.gap.com/customerService/info.do?cid=81364",
    cardHints: ["card", "gift", "number"],
    pinHints: ["pin", "security", "code"],
  },
  amazon: {
    name: "Amazon",
    // Expected to be account-gated (Amazon killed the public check). Tested to PROVE it, not assume it.
    url: "https://www.amazon.com/gc/balance",
    cardHints: ["card", "gift", "claim", "number"],
    pinHints: ["pin", "security", "code"],
  },
  // These four refused a plain fetch (403 / connection reset). That is a fetch-level block, NOT a
  // verdict, only the real browser can say whether a public form is behind them.
  homedepot: {
    name: "Home Depot",
    url: "https://www.homedepot.com/mycheckout/giftcard",
    cardHints: ["card", "gift", "number"],
    pinHints: ["pin", "security", "code"],
  },
  lowes: {
    name: "Lowe's",
    url: "https://www.lowes.com/l/gift-card-balance.html",
    cardHints: ["card", "gift", "number"],
    pinHints: ["pin", "security", "code"],
  },
  doordash: {
    name: "DoorDash",
    url: "https://www.doordash.com/gift-cards/",
    cardHints: ["card", "gift", "number"],
    pinHints: ["pin", "security", "code"],
  },
  panera: {
    name: "Panera",
    url: "https://www.panerabread.com/en-us/gift-cards.html",
    cardHints: ["card", "gift", "number"],
    pinHints: ["pin", "security", "code"],
  },

  // === THE SHARED-PLATFORM LEAD (2026-08-23) ===
  // Chipotle's own page links its balance check out to chipotle.wgiftcard.com. wgiftcard.com is a
  // white-label gift card platform, and 11 brands answered on it (chipotle, olivegarden,
  // cheesecakefactory, buffalowildwings, dunkin, lowes, applebees, ihop, redlobster, texasroadhouse,
  // pfchangs). If ONE form drives there, it is ONE adapter for all of them, not 11 scripts.
  // Note lowes: lowes.com bot-blocked us, but its balance check lives here and did not.
  wgc_chipotle: {
    name: "Chipotle (wgiftcard)",
    url: "https://chipotle.wgiftcard.com/rbc/chipotle_responsive",
    cardHints: ["card", "gift", "number", "account"],
    pinHints: ["pin", "security", "code", "cvv"],
  },
  wgc_lowes: {
    name: "Lowe's (wgiftcard)",
    url: "https://lowes.wgiftcard.com/",
    cardHints: ["card", "gift", "number", "account"],
    pinHints: ["pin", "security", "code", "cvv"],
  },
  wgc_dunkin: {
    name: "Dunkin (wgiftcard)",
    url: "https://dunkin.wgiftcard.com/",
    cardHints: ["card", "gift", "number", "account"],
    pinHints: ["pin", "security", "code", "cvv"],
  },

  // Exact balance URLs the probe recovered from the stores' own pages.
  panera_balance: {
    name: "Panera (real balance page)",
    url: "https://www.panerabread.com/en-us/gift-cards/balance.html",
    cardHints: ["card", "gift", "number"],
    pinHints: ["pin", "security", "code"],
  },
};

// Clearly-dummy values. NEVER real codes.
const DUMMY = {
  target: { card: "6006491234567890123", pin: "1234" }, // Target GC ~ 19 digits + 4-digit access #
  nike: { card: "6224990000000000000", pin: "123456" }, // 19-digit dummy unlocks the readOnly PIN field
  starbucks: { card: "6011000000000000", pin: "1234" },
  // 2026-08-23 scout. All obviously fake (zero/sequential runs), sized to each store's real field
  // length so client-side validation lets the submit fire. A rejected dummy IS the success result:
  // it proves the form answered, which is the whole question.
  walmart: { card: "6006000000000000000", pin: "1234" },
  ulta: { card: "6006490000000000", pin: "1234" },
  nordstrom: { card: "6006000000000000", pin: "1234" },
  vanilla: { card: "4111111111111111", pin: "123" }, // prepaid Visa reads CVV, not a PIN
  chipotle: { card: "6006490000000000", pin: "12345678" },
  gap: { card: "6006490000000000", pin: "12345678" },
  amazon: { card: "AAAA-BBBBBB-CCCC", pin: "" }, // Amazon takes a claim code, no PIN
  homedepot: { card: "6006490000000000000", pin: "1234" },
  lowes: { card: "6006490000000000", pin: "1234" },
  doordash: { card: "6006490000000000", pin: "1234" },
  panera: { card: "6006490000000000", pin: "1234" },
};

// Never let a missing dummy row kill the batch: any merchant without one gets a generic fake.
const GENERIC_DUMMY = { card: "6006490000000000", pin: "1234" };
const dummyFor = (m) => DUMMY[m] ?? GENERIC_DUMMY;

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-blink-features=AutomationControlled", // benign realism flag; NOT captcha evasion
  "--window-size=1280,900",
  "--lang=en-US",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- in-page detectors (must be self-contained; passed to evaluate) ----------

function detectCaptchaInPage() {
  const scripts = [...document.querySelectorAll("script[src]")].map((s) => s.src);
  const iframes = [...document.querySelectorAll("iframe")].map((f) => f.src || "");
  const inAny = (arr, re) => arr.some((x) => re.test(x));
  const types = [];
  let blocking = false;

  if (window.grecaptcha || document.querySelector(".g-recaptcha,[data-sitekey]") || inAny(scripts, /recaptcha\/api/i) || inAny(iframes, /recaptcha/i)) {
    types.push("reCAPTCHA");
    if (inAny(iframes, /recaptcha.*(bframe|anchor)/i) || document.querySelector(".g-recaptcha")) blocking = true;
  }
  if (window.hcaptcha || document.querySelector(".h-captcha") || inAny(scripts, /hcaptcha\.com/i) || inAny(iframes, /hcaptcha/i)) {
    types.push("hCaptcha");
    if (inAny(iframes, /hcaptcha/i) || document.querySelector(".h-captcha")) blocking = true;
  }
  if (window.turnstile || document.querySelector(".cf-turnstile") || inAny(scripts, /turnstile/i) || inAny(iframes, /challenges\.cloudflare\.com/i)) {
    types.push("Cloudflare Turnstile");
    if (inAny(iframes, /challenges\.cloudflare\.com/i) || document.querySelector(".cf-turnstile")) blocking = true;
  }
  if (document.querySelector('#px-captcha,[id^="px-"]') || /px-captcha/i.test(document.documentElement.outerHTML)) {
    types.push("PerimeterX/HUMAN");
    blocking = true;
  }
  return { present: types.length > 0, types: [...new Set(types)], blocking };
}

function detectBlockInPage() {
  const t = (document.title || "").toLowerCase();
  const b = (document.body ? document.body.innerText : "").slice(0, 5000).toLowerCase();
  const hits = [];
  const pats = [
    ["Akamai", /access denied|reference #\s*\w|errors\.edgesuite|akamai/i],
    ["PerimeterX/HUMAN", /pardon our interruption|press & hold|press and hold|are you a human/i],
    ["Cloudflare", /checking your browser|cf-browser-verification|attention required|needs to review the security/i],
    ["Generic bot wall", /unusual traffic|verify you are (a )?human|enable javascript and cookies|automated access|to continue, please/i],
  ];
  for (const [name, re] of pats) if (re.test(t) || re.test(b)) hits.push(name);
  return { hits, title: document.title, bodyStart: b.slice(0, 240) };
}

function detectLoginWallInPage() {
  const t = (document.title || "").toLowerCase();
  const b = (document.body ? document.body.innerText : "").slice(0, 3000).toLowerCase();
  const re = /sign in or create account|sign ?in to (your )?account|create (an )?account|log ?in to continue|please sign in|sign in to (view|continue|check)|sign in with passkey/i;
  return { isLogin: re.test(t) || re.test(b), hasPassword: !!document.querySelector("input[type=password]") };
}

function findFormInPage(cardHints, pinHints) {
  const visible = (el) => {
    const st = getComputedStyle(el);
    return el.type !== "hidden" && st.display !== "none" && st.visibility !== "hidden" && el.offsetParent !== null;
  };
  const inputs = [...document.querySelectorAll("input")].filter(visible);
  const meta = (el) =>
    [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.getAttribute("autocomplete"), el.labels && el.labels[0] && el.labels[0].innerText]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  const neg = /search|email|store|zip|user|login|sign|pass|promo|coupon|quantity/;
  const score = (el, hints) => {
    const m = meta(el);
    if (neg.test(m)) return -1;
    let s = 0;
    for (const h of hints) if (m.includes(h)) s++;
    return s;
  };

  let card = null, cardBest = 0, pin = null, pinBest = 0;
  for (const el of inputs) {
    const s = score(el, cardHints);
    if (s > cardBest) { cardBest = s; card = el; }
  }
  for (const el of inputs) {
    if (el === card) continue;
    const s = score(el, pinHints);
    if (s > pinBest) { pinBest = s; pin = el; }
  }
  if (card) card.setAttribute("data-spike", "card");
  if (pin) pin.setAttribute("data-spike", "pin");

  // Submit: prefer a meaningfully-labeled control INSIDE the card's own <form>.
  const scope = (card && card.closest("form")) || document;
  const labelOf = (b) => (b.innerText || b.value || b.getAttribute("aria-label") || "").trim();
  let submit = [...scope.querySelectorAll('button,[role=button],input[type=submit]')].find((b) =>
    /check|balance|submit|view|look ?up|continue|redeem|^go$/i.test(labelOf(b))
  );
  if (!submit) submit = scope.querySelector("button[type=submit],input[type=submit]");
  if (!submit && scope !== document) submit = document.querySelector("button[type=submit],input[type=submit]");
  if (submit) submit.setAttribute("data-spike", "submit");

  return {
    cardFound: !!card, cardMeta: card ? meta(card) : null,
    pinFound: !!pin, pinMeta: pin ? meta(pin) : null,
    submitFound: !!submit, submitText: submit ? labelOf(submit).slice(0, 40) : null,
    submitDisabled: submit ? !!(submit.disabled || submit.getAttribute("aria-disabled") === "true") : null,
    scopedToForm: scope !== document,
    passwordField: !!document.querySelector("input[type=password]"),
    visibleInputs: inputs.length,
  };
}

function readResultInPage() {
  const body = document.body ? document.body.innerText : "";
  const errRe = /(invalid|incorrect|not valid|isn'?t valid|unable to|doesn'?t match|could ?n'?t|could not|check the|try again|enter a valid|no longer|not (found|recogniz)|valid (card|number|pin)|we (can'?t|couldn'?t))/i;
  const lines = body.split("\n").map((s) => s.trim()).filter(Boolean);
  const errs = [...new Set(lines.filter((l) => errRe.test(l) && l.length < 180))].slice(0, 6);
  const alerts = [...document.querySelectorAll('[role=alert],.error,.alert,[class*="error" i],[class*="Error"]')]
    .map((e) => (e.innerText || "").trim())
    .filter(Boolean);
  return { errs, alerts: [...new Set(alerts)].slice(0, 6), url: location.href, title: document.title };
}

// ---------- driver helpers ----------

async function shot(page, merchant, label, notes) {
  const file = `${merchant}-${label}.png`;
  try {
    await page.screenshot({ path: join(EVIDENCE_DIR, file), fullPage: true });
    notes.screenshots.push(file);
  } catch {
    try {
      await page.screenshot({ path: join(EVIDENCE_DIR, file), fullPage: false });
      notes.screenshots.push(file);
    } catch (e) {
      notes.notes.push(`screenshot ${label} failed: ${String(e).slice(0, 80)}`);
    }
  }
}

// Real keystrokes (so controlled/React inputs update), then ASSERT the value landed; one retry.
async function fillField(frame, selector, value, f, label) {
  const handle = await frame.$(selector).catch(() => null);
  if (!handle) { f.notes.push(`${label}: field handle missing`); return false; }
  // Some PIN fields (e.g. Nike's #giftCardPIN) stay readOnly until the card number is entered, wait until editable.
  await frame
    .waitForFunction((sel) => { const el = document.querySelector(sel); return el && !el.readOnly && !el.disabled; }, { timeout: 2500 }, selector)
    .catch(() => f.notes.push(`${label}: still readOnly/disabled after wait`));
  try {
    await handle.click({ clickCount: 3 }); // focus + select any existing text
    await handle.type(value, { delay: 50 });
  } catch (e) {
    f.notes.push(`${label}: type error ${String(e).slice(0, 60)}`);
  }
  let got = await frame.$eval(selector, (el) => el.value).catch(() => null);
  if (!got) {
    try {
      await handle.focus();
      await handle.type(value, { delay: 70 });
      got = await frame.$eval(selector, (el) => el.value).catch(() => null);
    } catch {}
  }
  f.notes.push(`${label}: value=${JSON.stringify(got)}`);
  return !!got;
}

async function locateForm(page, cfg) {
  for (const frame of page.frames()) {
    try {
      const found = await frame.evaluate(findFormInPage, cfg.cardHints, cfg.pinHints);
      if (found.cardFound || found.submitFound || found.passwordField) return { frame, found };
    } catch {}
  }
  const found = await page.mainFrame().evaluate(findFormInPage, cfg.cardHints, cfg.pinHints).catch(() => null);
  return { frame: page.mainFrame(), found: found || { cardFound: false, submitFound: false, visibleInputs: 0 } };
}

// ---------- main per-merchant routine ----------

export async function checkBalance({ merchant, card, pin, browser }) {
  const cfg = MERCHANTS[merchant];
  if (!cfg) throw new Error(`unknown merchant: ${merchant}`);
  const f = {
    merchant, name: cfg.name, url: cfg.url,
    httpStatus: null, loadsHeadless: false, loadError: null,
    blockSignals: [], captcha: { present: false, types: [], blocking: false },
    loginWall: false, form: null, submitted: false, result: null,
    formDrivable: false, verdict: "unknown", screenshots: [], notes: [],
  };

  const ownBrowser = !browser;
  browser = browser || (await puppeteer.launch({ headless: true, args: LAUNCH_ARGS }));
  const page = await browser.newPage();
  try {
    const ua = (await browser.userAgent()).replace("HeadlessChrome", "Chrome");
    await page.setUserAgent(ua);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    f.notes.push(`UA=${ua}`);

    let resp = null;
    try {
      resp = await page.goto(cfg.url, { waitUntil: "domcontentloaded", timeout: 35000 });
      f.httpStatus = resp ? resp.status() : null;
      f.loadsHeadless = true;
    } catch (e) {
      f.loadError = String(e).slice(0, 160);
      await shot(page, merchant, "loaderror", f);
      f.verdict = "bot-blocked";
      f.notes.push("navigation failed under headless");
      if (ownBrowser) await browser.close();
      return f;
    }

    await sleep(4000); // SPA hydration settle
    await shot(page, merchant, "1-loaded", f);

    f.blockSignals = (await page.evaluate(detectBlockInPage).catch(() => ({ hits: [] }))).hits;
    f.captcha = await page.evaluate(detectCaptchaInPage).catch(() => f.captcha);

    if ([403, 429, 503].includes(f.httpStatus) || f.blockSignals.length) {
      await shot(page, merchant, "blocked", f);
      f.verdict = "bot-blocked";
      f.notes.push(`block: status=${f.httpStatus} signals=${f.blockSignals.join(",") || "none"}`);
      if (ownBrowser) await browser.close();
      return f;
    }
    if (f.captcha.blocking) {
      await shot(page, merchant, "captcha", f);
      f.verdict = "captcha-walled";
      f.notes.push(`captcha wall: ${f.captcha.types.join(", ")}`);
      if (ownBrowser) await browser.close();
      return f;
    }

    const { frame, found } = await locateForm(page, cfg);
    f.form = found;

    if (!found.cardFound) {
      const login = await page.evaluate(detectLoginWallInPage).catch(() => ({ isLogin: false }));
      if (login.isLogin || found.passwordField) {
        f.loginWall = true;
        await shot(page, merchant, "loginwall", f);
        f.verdict = "login-gated";
        f.notes.push("page presents account sign-in / create-account, not a public card+PIN balance form");
        if (ownBrowser) await browser.close();
        return f;
      }
      f.verdict = "not-drivable";
      f.notes.push(`could not locate a card-number field (visibleInputs=${found.visibleInputs}, http=${f.httpStatus})`);
      await shot(page, merchant, "no-form", f);
      if (ownBrowser) await browser.close();
      return f;
    }

    // Fill DUMMY data. Assert each value landed.
    await fillField(frame, '[data-spike="card"]', card, f, "card");
    if (found.pinFound) {
      // Re-tag in case the card keystrokes re-rendered the form and dropped the pin tag.
      await frame.evaluate(findFormInPage, cfg.cardHints, cfg.pinHints).catch(() => {});
      await fillField(frame, '[data-spike="pin"]', pin, f, "pin");
    }
    await sleep(400); // let validation enable the submit button
    await shot(page, merchant, "2-filled", f);

    const submitState = await frame
      .evaluate(() => {
        const s = document.querySelector('[data-spike="submit"]');
        return s ? { disabled: !!(s.disabled || s.getAttribute("aria-disabled") === "true"), text: (s.innerText || s.value || "").trim().slice(0, 40) } : null;
      })
      .catch(() => null);
    if (submitState) f.notes.push(`submit after fill: disabled=${submitState.disabled} text=${JSON.stringify(submitState.text)}`);

    if (!found.submitFound) {
      f.verdict = "not-drivable";
      f.notes.push("found card field but no submit control");
      if (ownBrowser) await browser.close();
      return f;
    }

    // Snapshot the page BEFORE submitting so we can tell a real answer from a page that never moved.
    const beforeText = await page
      .evaluate(() => (document.body ? document.body.innerText.replace(/\s+/g, " ").slice(0, 4000) : ""))
      .catch(() => "");

    // ONE submit attempt. No retries / no hammering.
    if (submitState && submitState.disabled) {
      f.notes.push("submit disabled after fill, attempting native Enter submit once");
      await frame.focus(found.pinFound ? '[data-spike="pin"]' : '[data-spike="card"]').catch(() => {});
      await page.keyboard.press("Enter").catch(() => {});
    } else {
      try {
        await frame.click('[data-spike="submit"]', { delay: 30 });
      } catch {
        await frame.evaluate(() => document.querySelector('[data-spike="submit"]')?.click()).catch(() => {});
      }
    }
    f.submitted = true;

    // Wait for the page to ACTUALLY answer, never a fixed nap.
    // 2026-08-23: the old fixed 11.5s sleep screenshotted Nike while its Check Balance button was
    // STILL SPINNING, so a store that works scored as "no response". A slow store is not a closed
    // store. Poll until the text has changed AND nothing visible is still spinning.
    const settled = await page
      .waitForFunction(
        (before) => {
          const b = document.body ? document.body.innerText.replace(/\s+/g, " ").slice(0, 4000) : "";
          if (b === before) return false;
          const spinning = [...document.querySelectorAll('[aria-busy="true"],[class*="spinner" i],[class*="loading" i],[class*="Spinner"],[class*="Loading"]')]
            .some((el) => el.offsetParent !== null);
          return !spinning;
        },
        { timeout: 40000, polling: 500 },
        beforeText,
      )
      .then(() => true)
      .catch(() => false);
    f.answered = settled;
    f.notes.push(`post-submit settle: ${settled ? "page answered" : "no visible change within 40s"}`);
    await sleep(1500);

    // A captcha / bot wall may appear only on submit.
    const postCaptcha = await page.evaluate(detectCaptchaInPage).catch(() => ({ present: false, blocking: false, types: [] }));
    if (postCaptcha.blocking && !f.captcha.blocking) {
      f.captcha = postCaptcha;
      await shot(page, merchant, "captcha-onsubmit", f);
      f.verdict = "captcha-walled";
      f.notes.push(`captcha appeared on submit: ${postCaptcha.types.join(", ")}`);
      if (ownBrowser) await browser.close();
      return f;
    }
    const postBlock = (await page.evaluate(detectBlockInPage).catch(() => ({ hits: [] }))).hits;
    if (postBlock.length && !f.blockSignals.length) {
      f.blockSignals = postBlock;
      await shot(page, merchant, "blocked-onsubmit", f);
      f.verdict = "bot-blocked";
      f.notes.push(`bot wall on submit: ${postBlock.join(",")}`);
      if (ownBrowser) await browser.close();
      return f;
    }

    f.result = await page.evaluate(readResultInPage).catch(() => null);
    await shot(page, merchant, "3-result", f);

    // "It answered" counts three ways: it printed an error about our dummy card, it navigated, or
    // the page visibly changed and stopped spinning. Any one of those proves the form is drivable,
    // because a store that rejects a fake card would have shown a real balance for a real one.
    const reacted =
      !!(f.result && (f.result.errs.length || f.result.alerts.length)) ||
      (f.result && f.result.url !== cfg.url) ||
      f.answered === true;
    f.formDrivable = !!(found.cardFound && found.submitFound && f.submitted && reacted);
    f.verdict = f.formDrivable ? "drivable" : "submitted-no-clear-response";
    if (f.captcha.present && !f.captcha.blocking) f.notes.push(`invisible/background captcha present (${f.captcha.types.join(", ")}), not a hard wall`);
    if (!f.formDrivable) f.notes.push("submit fired but no obvious error/result captured, inspect 3-result screenshot");
  } catch (e) {
    f.notes.push(`unexpected: ${String(e).slice(0, 160)}`);
    await shot(page, merchant, "error", f);
    if (f.verdict === "unknown") f.verdict = "not-drivable";
  } finally {
    if (ownBrowser) await browser.close().catch(() => {});
  }
  return f;
}

// ---------- CLI ----------
async function main() {
  const [, , argMerchant, argCard, argPin] = process.argv;
  const list = argMerchant ? [argMerchant.toLowerCase()] : Object.keys(MERCHANTS);

  const browser = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
  const results = [];
  // A hung store must not eat the whole sweep. Each gets its own clock; blowing it is a recorded
  // verdict ("timeout"), never a lost row, so the batch always reports on every store.
  const PER_MERCHANT_MS = 180_000;
  const stub = (m, verdict, note) => ({
    merchant: m, name: MERCHANTS[m].name, url: MERCHANTS[m].url, verdict, measured: false,
    httpStatus: null, captcha: { types: [] }, form: null, formDrivable: false, screenshots: [], notes: [note],
  });

  for (const m of list) {
    if (!MERCHANTS[m]) { console.error(`skip unknown merchant: ${m}`); continue; }
    const d = dummyFor(m);
    const cardVal = argMerchant ? (argCard ?? d.card) : d.card;
    const pinVal = argMerchant ? (argPin ?? d.pin) : d.pin;
    process.stderr.write(`\n=== ${MERCHANTS[m].name} (${m}), dummy card ${cardVal} / pin ${pinVal || "(none)"} ===\n`);
    let f;
    try {
      f = await Promise.race([
        checkBalance({ merchant: m, card: cardVal, pin: pinVal, browser }),
        new Promise((res) => setTimeout(() => res(stub(m, "timeout", `exceeded ${PER_MERCHANT_MS}ms`)), PER_MERCHANT_MS)),
      ]);
    } catch (e) {
      f = stub(m, "harness-error", String(e).slice(0, 200));
    }
    // measured=true means WE actually reached and judged the page. False is OUR blank
    // (crash/timeout), which must never be read as the store refusing.
    f.measured = f.measured ?? true;
    results.push(f);
    process.stderr.write(`  verdict: ${f.verdict} | measured=${f.measured} | http=${f.httpStatus} | captcha=${f.captcha?.types?.join("/") || "none"} | cardField=${f.form?.cardFound} | drivable=${f.formDrivable}\n`);
  }

  await browser.close().catch(() => {});
  writeFileSync(join(EVIDENCE_DIR, process.env.FINDINGS_OUT || "findings.json"), JSON.stringify(results, null, 2));

  // The point of the sweep is the COUNT of open doors, plus where every other store died.
  const tally = {};
  for (const r of results) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
  const open = results.filter((r) => r.formDrivable).map((r) => r.name);
  const blank = results.filter((r) => !r.measured).map((r) => r.name);
  process.stderr.write(`\n===== SCOREBOARD (${results.length} stores) =====\n`);
  for (const [v, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) process.stderr.write(`  ${String(n).padStart(2)}  ${v}\n`);
  process.stderr.write(`\n  OPEN DOORS (public card+PIN check answered): ${open.length ? open.join(", ") : "none"}\n`);
  process.stderr.write(`  unmeasured (our blank, NOT their wall): ${blank.join(", ") || "none"}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
