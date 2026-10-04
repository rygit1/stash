// Dependency-free Code 128 encoder → inline SVG. No npm deps; the bar patterns and
// checksum are the published Code 128 spec, implemented here so the card mockup can show a
// real, scannable barcode of the card number. Code Set B for general text; auto-switches to
// Code Set C across long even digit runs (halves the width — critical on a small card face).
//
// Each of the 107 symbols is 11 modules wide (3 bar/space pairs) EXCEPT Stop, which carries a
// 13-module pattern (its trailing 2-module bar). Checksum = (start + Σ i·value) mod 103.

// 0..106 → 6-digit module-width pattern (bar,space,bar,space,bar,space). Index 106 = Stop (incl. final bar).
// prettier-ignore
const PATTERNS: readonly string[] = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
];

const START_B = 104;
const START_C = 105;
const CODE_B = 100; // switch-to-B symbol (used from Code C)
const CODE_C = 99; // switch-to-C symbol (used from Code B)
const STOP = 106;

// A run of >=4 (interior) or >=2 (at the ends) even-length digits is cheaper in Code C.
// We keep it simple and correct: greedily prefer C for digit pairs, B otherwise.
function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

// Count the run of consecutive digits starting at i.
function digitRunLength(s: string, i: number): number {
  let n = 0;
  while (i + n < s.length && isDigit(s[i + n])) n++;
  return n;
}

// Build the list of symbol VALUES (0..106) for the data, with Start + interleaved set switches.
// Returns null if any char is outside Code 128 set B's printable range (32..126).
function encodeValues(input: string): number[] | null {
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 32 || c > 126) return null; // unencodable in set B; we don't use set A control chars
  }

  const values: number[] = [];
  let mode: "B" | "C" | null = null;
  let i = 0;

  // Decide whether to OPEN in C: a leading even digit run of length >=4, OR the whole string is
  // an even-length all-digit string of length >=2.
  const lead = digitRunLength(input, 0);
  const openInC = (lead >= 4 || (lead === input.length && lead >= 2)) && lead % 2 === 0 ? true : lead >= 6;

  if (openInC) {
    values.push(START_C);
    mode = "C";
  } else {
    values.push(START_B);
    mode = "B";
  }

  while (i < input.length) {
    if (mode === "C") {
      const run = digitRunLength(input, i);
      // Stay in C while we have a full digit pair. An odd trailing digit (or non-digit) ends C.
      if (run >= 2) {
        values.push((input.charCodeAt(i) - 48) * 10 + (input.charCodeAt(i + 1) - 48));
        i += 2;
        continue;
      }
      // Fewer than 2 digits left in this position → drop to B.
      values.push(CODE_B);
      mode = "B";
      continue;
    }
    // mode B
    const run = digitRunLength(input, i);
    const remaining = input.length - i;
    // Switch UP to C when it pays off: an interior even run >=6, or an ending even run >=4.
    const switchToC = run >= 6 || (run === remaining && run >= 4 && run % 2 === 0);
    if (switchToC) {
      values.push(CODE_C);
      mode = "C";
      continue;
    }
    values.push(input.charCodeAt(i) - 32); // set B: value = ascii - 32
    i++;
  }

  // Checksum: start value (already at index 0) weighted by position from 1.
  let sum = values[0];
  for (let p = 1; p < values.length; p++) sum += values[p] * p;
  values.push(sum % 103);
  values.push(STOP);
  return values;
}

export type Code128Opts = {
  /** module (narrowest bar) width in px. Default 2. */
  moduleWidth?: number;
  /** bar height in px. Default 56. */
  height?: number;
  /** quiet-zone width in modules each side (spec minimum 10). Default 10. */
  quietModules?: number;
  /** bar color. Default black. */
  color?: string;
  /** extra class on the <svg>. */
  className?: string;
};

type Code128Render = { svg: string; width: number; height: number; moduleCount: number };

// Core: input string → SVG markup + geometry. null when empty/unencodable.
export function code128(value: string, opts: Code128Opts = {}): Code128Render | null {
  if (!value) return null;
  const values = encodeValues(value);
  if (!values) return null;

  const moduleWidth = opts.moduleWidth ?? 2;
  const height = opts.height ?? 56;
  const quiet = opts.quietModules ?? 10;
  const color = opts.color ?? "#000";

  // Concatenate every symbol's module-width string into one run of bar/space widths.
  // Even index = bar, odd index = space (the pattern strings always start on a bar).
  const widths = values.map((v) => PATTERNS[v]).join("");
  let modules = 0;
  for (const ch of widths) modules += ch.charCodeAt(0) - 48;
  const totalModules = modules + quiet * 2;

  const rects: string[] = [];
  let x = quiet; // start after the leading quiet zone (in modules)
  let isBar = true;
  for (const ch of widths) {
    const w = ch.charCodeAt(0) - 48;
    if (isBar) rects.push(`<rect x="${x * moduleWidth}" y="0" width="${w * moduleWidth}" height="${height}"/>`);
    x += w;
    isBar = !isBar;
  }

  const pxW = totalModules * moduleWidth;
  const cls = opts.className ? ` class="${opts.className}"` : "";
  const svg =
    `<svg${cls} xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${height}" ` +
    `viewBox="0 0 ${pxW} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges" fill="${color}">` +
    `<rect x="0" y="0" width="${pxW}" height="${height}" fill="#fff"/>${rects.join("")}</svg>`;

  return { svg, width: pxW, height, moduleCount: totalModules };
}

// Convenience: just the SVG string (or null).
export function code128Svg(value: string, opts?: Code128Opts): string | null {
  return code128(value, opts)?.svg ?? null;
}

// Internal hooks for the verification script (round-trip / checksum proof). Not used by the UI.
export const __test = { encodeValues, PATTERNS };
