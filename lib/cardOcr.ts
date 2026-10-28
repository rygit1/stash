// On-device text reading for plastic gift cards (Tesseract.js, WebAssembly): the number and PIN when
// a card has no barcode, and the store's name either way.
// The photo never leaves the phone: the engine and English data are served from stashinc.pro
// (/tesseract, copied there by scripts/copy-ocr-assets.mjs) and run in a Web Worker. They are
// only downloaded the first time a barcode-less card is scanned, then cached by the browser.
//
// Text recognition can misread a digit under glare or at an angle, so callers must show anything
// it returns as "check this one", never as exact (unlike a barcode, which is exact).

import type { Worker } from "tesseract.js";
import { findStoreName } from "./giftStores";

export type CardText = { code: string | null; pin: string | null; store: string | null };

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker("eng", 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/core",
        langPath: "/tesseract/lang",
        // Load the worker from its own URL rather than a blob: so the CSP's worker-src 'self' holds.
        workerBlobURL: false,
      });
    })();
    // A failed load (offline, blocked) shouldn't poison every later scan.
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

// Letters OCR commonly confuses with digits, mapped back to digits inside number-like tokens only.
const LOOKALIKE = "OoDQIl|ZSsBG";
const DIGIT_LOOKALIKES: Record<string, string> = { O: "0", o: "0", D: "0", Q: "0", I: "1", l: "1", "|": "1", Z: "2", S: "5", s: "5", B: "8", G: "6" };
const toDigits = (s: string) => s.replace(new RegExp(`[${LOOKALIKE}]`, "g"), (c) => DIGIT_LOOKALIKES[c] ?? c);
const digitish = new RegExp(`^[0-9${LOOKALIKE}]+$`);

const mostCommon = (values: string[]): string | null => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best === null || n > counts.get(best)!) best = v;
  return best;
};

// A token that is a number, allowing OCR lookalike letters, but only if it has real digits in it
// (so words like "SOS" or "Bill" never turn into numbers).
const numberToken = (t: string): string | null => {
  const clean = t.replace(/[^0-9A-Za-z|]/g, "");
  if (!clean || !digitish.test(clean)) return null;
  const real = (clean.match(/\d/g) ?? []).length;
  return real * 2 >= clean.length ? toDigits(clean) : null;
};

// Card number from several readings of the same card, each with a weight (how much to trust that
// pass for digits). Gift card numbers are almost always printed as four groups of four, so every
// digit of every group is voted on separately: one pass may get the first group right, another the
// last. Falls back to the most common 12–19 digit run when no four-group line is found.
function voteCode(readings: { text: string; weight: number }[]): string | null {
  const groupsAt: { g: string; w: number }[][] = [[], [], [], []];
  const runs: string[] = [];
  for (const { text, weight } of readings) {
    for (const line of text.split("\n")) {
      const tokens = line.split(/[\s\-]+/).map(numberToken);
      // Consecutive number tokens form one printed number (groups split by spaces or dashes).
      let current: string[] = [];
      const flush = () => {
        const groups = current.filter((g) => g.length >= 3 && g.length <= 4);
        if (groups.length >= 3 && groups.length === current.length) {
          const last4 = groups.slice(-4);
          const offset = 4 - last4.length; // three groups: the missing one is most often the first
          last4.forEach((g, i) => {
            if (g.length === 4) groupsAt[i + offset].push({ g, w: weight });
          });
        }
        const run = current.join("");
        if (run.length >= 12 && run.length <= 19) runs.push(run);
        current = [];
      };
      for (const t of tokens) {
        if (t) current.push(t);
        else flush();
      }
      flush();
    }
  }
  if (groupsAt.every((g) => g.length > 0)) {
    return groupsAt
      .map((cands) =>
        [0, 1, 2, 3]
          .map((pos) => {
            const score = new Map<string, number>();
            for (const { g, w } of cands) score.set(g[pos], (score.get(g[pos]) ?? 0) + w);
            return [...score.entries()].sort((a, b) => b[1] - a[1])[0][0];
          })
          .join(""),
      )
      .join("");
  }
  const sixteen = runs.filter((r) => r.length === 16);
  return mostCommon(sixteen.length ? sixteen : runs) ?? null;
}

// PIN / security code: a short value after its label. OCR often garbles the label ("Rey Coder",
// "fay Code"), so any short word followed by "code" counts, as do the usual labels.
const PIN_LABEL =
  /\b(?:PIN|\w{2,4}\.?\s*Code[s:;r]?|Security\s*Code|Access\s*(?:Code|Number|No\.?)|CSC|EAN|Scratch[- ]?off)\b\s*[:#.;]?\s*([A-Za-z0-9]{3,12})\b/i;
function votePin(texts: string[], code: string | null): string | null {
  const found: string[] = [];
  for (const text of texts) {
    const m = PIN_LABEL.exec(text);
    if (!m) continue;
    let pin = m[1];
    if (/\d/.test(pin) && digitish.test(pin)) pin = toDigits(pin);
    if (code && pin.length > 6 && code.includes(pin)) continue; // grabbed part of the card number
    found.push(pin);
  }
  return mostCommon(found);
}

// Pure parser, exported for tests: combine one or more readings of the same card.
// A plain string or string[] counts every reading equally; readCardText passes weights.
export function parseCardText(texts: string | string[] | { text: string; weight: number }[]): CardText {
  const readings = (Array.isArray(texts) ? texts : [texts]).map((t) => (typeof t === "string" ? { text: t, weight: 1 } : t));
  const all = readings.map((r) => r.text);
  const code = voteCode(readings);
  return { code, pin: votePin(all, code), store: findStoreName(all.join("\n")) };
}

// Grayscale, enlarged, higher-contrast copy of the photo: printed digits read much more reliably.
async function enhance(dataUrl: string, contrast: number): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(2, 2400 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const ctx = c.getContext("2d")!;
  ctx.filter = `grayscale(1) contrast(${contrast})`;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

// Read a card photo (data URL) with four quick passes and vote. Resolves null if the engine can't
// load or it takes too long, so the scanner falls back to empty boxes to type into, as before.
// wordsOnly: skip the two digit passes, for when a barcode already gave the exact number and only the
// store name and PIN are wanted. Twice as fast.
export async function readCardText(
  dataUrl: string,
  { wordsOnly = false, timeoutMs = 45_000 }: { wordsOnly?: boolean; timeoutMs?: number } = {},
): Promise<CardText | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const read = (async () => {
    try {
      const worker = await getWorker();
      const strong = await enhance(dataUrl, 2.5);
      const texts: { text: string; weight: number }[] = [];
      const pass = async (image: string, params: Record<string, string>, weight: number) => {
        await worker.setParameters(params);
        texts.push({ text: (await worker.recognize(image)).data.text ?? "", weight });
      };
      const words = { tessedit_pageseg_mode: "3", tessedit_char_whitelist: "" }; // also finds labels, store name
      const digits = { tessedit_pageseg_mode: "6", tessedit_char_whitelist: "0123456789 " };
      await pass(dataUrl, words, 1);
      await pass(strong, words, 1);
      if (!wordsOnly) {
        await pass(strong, digits, 1.5);
        await pass(await enhance(dataUrl, 1.5), digits, 1.5);
      }
      return parseCardText(texts);
    } catch {
      return null;
    }
  })();
  return Promise.race([read, timeout]);
}
