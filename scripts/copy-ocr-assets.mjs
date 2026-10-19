// Copies the on-device OCR engine (Tesseract.js) into public/tesseract so the site serves it
// itself: no third-party CDN, and the card photo never leaves the phone. Runs before `next dev`
// and `next build` (see package.json). public/tesseract is generated, so it is git-ignored.
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const out = join(process.cwd(), "public", "tesseract");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "core"), { recursive: true });
mkdirSync(join(out, "lang"), { recursive: true });

cpSync(join(pkgDir("tesseract.js"), "dist", "worker.min.js"), join(out, "worker.min.js"));

// The LSTM-only builds (Stash uses the LSTM engine, oem 1). The worker picks one at runtime
// depending on whether the browser supports SIMD / relaxed SIMD.
const coreDir = pkgDir("tesseract.js-core");
for (const f of readdirSync(coreDir).filter((f) => f.endsWith("lstm.wasm.js"))) cpSync(join(coreDir, f), join(out, "core", f));

// English, LSTM "best_int" model: what tesseract.js uses by default for its LSTM engine.
cpSync(join(pkgDir("@tesseract.js-data/eng"), "4.0.0_best_int", "eng.traineddata.gz"), join(out, "lang", "eng.traineddata.gz"));

console.log("copied OCR assets to public/tesseract");
