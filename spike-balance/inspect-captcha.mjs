// Read-only inspection: what captcha is actually on the page, and is the balance form
// behind it or beside it? No solving, no submitting. Just facts.
import puppeteer from "puppeteer";
const url = process.argv[2];
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox","--disable-setuid-sandbox","--disable-blink-features=AutomationControlled","--lang=en-US"] });
const page = await browser.newPage();
await page.setUserAgent((await browser.userAgent()).replace("HeadlessChrome","Chrome"));
await page.setViewport({ width: 1280, height: 900 });
await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
await new Promise(r => setTimeout(r, 5000));
const info = await page.evaluate(() => ({
  title: document.title,
  url: location.href,
  scripts: [...document.querySelectorAll("script[src]")].map(s=>s.src).filter(s=>/captcha|turnstile|recaptcha|hcaptcha|perimeterx|datadome|akamai/i.test(s)),
  iframes: [...document.querySelectorAll("iframe")].map(f=>f.src).filter(Boolean).slice(0,10),
  sitekeys: [...document.querySelectorAll("[data-sitekey]")].map(e=>({cls:e.className, key:e.getAttribute("data-sitekey")})),
  hasGrecaptcha: typeof window.grecaptcha !== "undefined",
  hasHcaptcha: typeof window.hcaptcha !== "undefined",
  hasTurnstile: typeof window.turnstile !== "undefined",
  inputs: [...document.querySelectorAll("input")].filter(el=>{const s=getComputedStyle(el);return el.type!=="hidden"&&s.display!=="none"&&s.visibility!=="hidden"&&el.offsetParent!==null;}).map(el=>({name:el.name,id:el.id,ph:el.placeholder,type:el.type})),
  bodyStart: (document.body?document.body.innerText:"").replace(/\s+/g," ").slice(0,400),
}));
console.log(JSON.stringify(info, null, 2));
await browser.close();
