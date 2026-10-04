// Client-side barcode/QR decode for card photos — a bonus layer on top of vision OCR.
// Exact when it hits, silent when it misses; never delays or replaces the vision read.
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from "@zxing/library";

// The formats gift cards actually use: QR/PDF417 squares + the 1D strips.
const FORMATS = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.PDF_417,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
];

function newReader(): MultiFormatReader {
  const reader = new MultiFormatReader();
  reader.setHints(
    new Map<DecodeHintType, unknown>([
      [DecodeHintType.POSSIBLE_FORMATS, FORMATS],
      [DecodeHintType.TRY_HARDER, true],
    ]),
  );
  return reader;
}

function tryDecode(reader: MultiFormatReader, gray: Uint8ClampedArray, width: number, height: number): string | null {
  try {
    const source = new RGBLuminanceSource(gray, width, height);
    return reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(source))).getText() ?? null;
  } catch {
    return null; // NotFoundException — no code in this view
  }
}

// 1D strips live low on gift cards — pass 2 re-reads just the bottom region.
export function cropBottomGray(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  ratio = 0.55,
): { gray: Uint8ClampedArray; height: number } {
  const h = Math.max(1, Math.floor(height * ratio));
  return { gray: gray.subarray((height - h) * width), height: h };
}

// A rectangular sub-region of a grayscale buffer, copied into a tight buffer ZXing can read.
// Used to retry the decode focused on where card barcodes commonly sit (bottom / right).
export function cropRegionGray(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  cw: number,
  ch: number,
): { gray: Uint8ClampedArray; width: number; height: number } {
  const x = Math.max(0, Math.min(width - 1, Math.floor(x0)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(y0)));
  const w = Math.max(1, Math.min(width - x, Math.floor(cw)));
  const h = Math.max(1, Math.min(height - y, Math.floor(ch)));
  const out = new Uint8ClampedArray(w * h);
  for (let r = 0; r < h; r++) {
    const src = (y + r) * width + x;
    out.set(gray.subarray(src, src + w), r * w);
  }
  return { gray: out, width: w, height: h };
}

// Rotate a grayscale buffer by 90/180/270° — barcodes scanned sideways/upside-down on a card
// won't decode in their native orientation, so we retry rotated copies. Pure, no DOM.
export function rotateGray(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  deg: 90 | 180 | 270,
): { gray: Uint8ClampedArray; width: number; height: number } {
  const out = new Uint8ClampedArray(width * height);
  if (deg === 180) {
    const n = width * height;
    for (let i = 0; i < n; i++) out[i] = gray[n - 1 - i];
    return { gray: out, width, height };
  }
  const ow = height;
  const oh = width;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      // 90° CW: (x,y) -> (height-1-y, x); 270° CW: (x,y) -> (y, width-1-x)
      const oi = deg === 90 ? x * ow + (height - 1 - y) : (width - 1 - x) * ow + y;
      out[oi] = gray[row + x];
    }
  }
  return { gray: out, width: ow, height: oh };
}

// Pure decode over a grayscale buffer: full frame, then bottom crop.
// Runs anywhere (no DOM) — the dev self-test exercises exactly this path.
export function decodeGrayscale(gray: Uint8ClampedArray, width: number, height: number): string | null {
  const reader = newReader();
  const full = tryDecode(reader, gray, width, height);
  if (full) return full;
  const bottom = cropBottomGray(gray, width, height);
  return tryDecode(reader, bottom.gray, width, bottom.height);
}

// The barcode is the most reliable read on a card, so try HARD before giving up: across rotations
// (0/90/180/270) and a few region crops (full, bottom third, right third — where card barcodes sit).
// Reasonably bounded (≤4 rotations × ≤3 crops) and pure (no DOM). First decode that passes the
// caller's validator wins; null on total miss. Bigger fan-out than decodeGrayscale — for the
// real full-res decode pass, not the cheap live auto-capture tick.
export function decodeGrayscaleHard(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  accept: (s: string) => boolean,
): string | null {
  const reader = newReader();
  const variants: { gray: Uint8ClampedArray; width: number; height: number }[] = [
    { gray, width, height },
    rotateGray(gray, width, height, 90),
    rotateGray(gray, width, height, 180),
    rotateGray(gray, width, height, 270),
  ];
  for (const v of variants) {
    const crops: { gray: Uint8ClampedArray; width: number; height: number }[] = [
      v,
      cropRegionGray(v.gray, v.width, v.height, 0, Math.floor(v.height * 0.66), v.width, Math.ceil(v.height * 0.34)),
      cropRegionGray(v.gray, v.width, v.height, Math.floor(v.width * 0.66), 0, Math.ceil(v.width * 0.34), v.height),
    ];
    for (const c of crops) {
      const text = tryDecode(reader, c.gray, c.width, c.height)?.trim();
      if (text && accept(text)) return text;
    }
  }
  return null;
}

// Frame-quality signal for live auto-capture: mean luma + a focus score (gradient energy,
// a cheap variance-of-Laplacian proxy). Pure over a grayscale buffer — no DOM, so the dev
// self-test exercises the exact path. A flat/blurry frame scores low; a sharp, high-contrast
// one scores high. Subsamples (step 2) so it stays cheap on a ~480px tick frame.
export function frameQuality(gray: Uint8ClampedArray, width: number, height: number): { brightness: number; sharpness: number } {
  if (width < 3 || height < 3) return { brightness: 0, sharpness: 0 };
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const brightness = sum / gray.length;
  // 4-neighbour Laplacian magnitude, averaged over interior pixels (stride 2).
  let acc = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y += 2) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 2) {
      const c = gray[row + x];
      const lap = gray[row + x - 1] + gray[row + x + 1] + gray[row - width + x] + gray[row + width + x] - 4 * c;
      acc += lap * lap;
      n++;
    }
  }
  return { brightness, sharpness: n ? acc / n : 0 };
}

// A plausible card number: alphanumeric (spaces/dashes ok), not a URL/structured payload (so a
// promo QR on the back can never pollute the code field), and carrying ≥8 digits — real card
// numbers do; short non-card codes and most promo strings don't. Misses stay silent.
export const looksLikeCardCode = (s: string) =>
  /^[A-Za-z0-9 -]{6,40}$/.test(s) && !/^https?:/i.test(s) && (s.match(/\d/g)?.length ?? 0) >= 8;

export async function decodeCardBarcode(dataUrl: string): Promise<string | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode_failed"));
      el.src = dataUrl;
    });
    // Decode at FULL resolution — barcodes need every pixel; never shrink for the decode pass.
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = (data[p] * 306 + data[p + 1] * 601 + data[p + 2] * 117) >> 10;
    }
    // Try hard: rotations × region crops, accept only a validated card number.
    return decodeGrayscaleHard(gray, w, h, looksLikeCardCode);
  } catch {
    return null; // barcode is a bonus layer — failures never surface
  }
}
