/**
 * validate-level-splash.ts — the baked native splash, decoded by hand, must
 * equal the numbers every Level replica draws from.
 *
 * Run: bun run scripts/validate-level-splash.ts [--html <path>] [--png <path>]
 *
 * WHY. The native splash (assets/images/splash-icon.png) is baked into the
 * binary; the first JS frame (BrandSplash) and the web's pre-JS level redraw
 * it from the NATIVE_SPLASH_* constants in utils/levelTimeline.ts. The hand-off
 * from the baked PNG to the live mark is only invisible if those constants are
 * the PNG, to the pixel. So this script decodes the PNG itself (node:zlib
 * inflate + the five scanline filters; no package) and asserts:
 *
 *  A. 1024 × 1024 RGBA, exactly FOUR distinct RGBA values.
 *  B. Each part's bounding box, and NATIVE_SPLASH_PX equals it.
 *  C. The NATIVE_SPLASH_* colours and alphas equal the measured RGBA.
 *  D. The corner radii: a SQUARE track (2840 track pixels), 8 × 30 caps of
 *     radius 4, a 67 × 26 bubble of radius 13 — and NATIVE_SPLASH_RADII_PX.
 *  E. The bubble's travel (± NATIVE_SPLASH_AMP_PX) stays inside the track.
 *  F. The mark is centred on the canvas, so splashRect centres it on any
 *     screen, and the web mark is capped at 240 px.
 *  G. The pre-JS web level in public/index.html (the SPLASHPX P2 hand-off
 *     patch) draws the same parts. Skipped with a NOTE until P2 is applied;
 *     `--html <path>` points it at a patched copy. MEDIA-AWARE since lane
 *     LOADERDESK: the base rule is the phone cap, and three @media blocks size
 *     the mark for tablet / laptop / monitor windows; the effective width at
 *     (W, H) is the last block whose min-width ≤ W, compared against
 *     launchRect (utils/levelDesk.ts) at 11 screens. Its colours are the WEB
 *     launch palette (WEB_LAUNCH: concrete, brand green, light ink — the
 *     orchestrator's 2026-10-01 decision; the web has no native splash to
 *     match), at the PNG's alphas. The DARK-page rules (one
 *     @media (prefers-color-scheme: dark) block and the html[data-theme='dark']
 *     rules) recolour the same parts and are pinned by
 *     scripts/validate-level-desk.ts rule H; this rule sets them aside and
 *     checks the light still they recolour.
 *  H. The native images agree with app.json and with each other (BUILD 18,
 *     lane APPNATIVE, 2026-10-03): app.json points at these files; the
 *     splash.backgroundColor and android.adaptiveIcon.backgroundColor are the
 *     PNGs' own ground, so `resizeMode: contain` letterboxes with no visible
 *     box; the App Store icon is 1024 × 1024 with NO alpha channel (App Store
 *     Connect rejects an icon with one) on the same ink ground; the green
 *     rebrand is in every native image (green present, no old-orange pixel);
 *     and the assets/brand-next staging folder is gone.
 *
 * GREEN SINCE BUILD 18. The baked splash moved from the old orange to the
 * brand green as it reads on ink (BRAND_ACCENT_ON_DARK, decimal 93,179,110);
 * the ink ground and the cream caps are unchanged, and so is every pixel of
 * geometry (scripts/gen-splash.mjs reproduces the PNG pixel for pixel). Rule C
 * therefore needs utils/levelTimeline.ts NATIVE_SPLASH_ACCENT to be the same
 * green, or BrandSplash's frame 0 is a different colour from the launch screen
 * it replaces.
 *
 * No colour literal lives in this file: expected colours come from the
 * NATIVE_SPLASH_* constants or are written as the PNG's decimal RGBA.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  NATIVE_SPLASH_ACCENT,
  NATIVE_SPLASH_AMP_PX,
  NATIVE_SPLASH_BG,
  NATIVE_SPLASH_CAP,
  NATIVE_SPLASH_CAP_ALPHA,
  NATIVE_SPLASH_PX,
  NATIVE_SPLASH_RADII_PX,
  NATIVE_SPLASH_TRACK_ALPHA,
  SPLASH_MARK_H,
  SPLASH_MARK_W,
  SPLASH_MARK_X0,
  SPLASH_MARK_Y0,
  SPLASH_WEB_MAX_W,
  splashPartRects,
  splashRect,
} from '../utils/levelTimeline';
import { WEB_LAUNCH, launchRect } from '../utils/levelDesk';

const ROOT = join(__dirname, '..');

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passes++; return; }
  failures++;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

// ── The PNG decoder ──────────────────────────────────────────────────────────

/** px is always RGBA; an RGB (colour type 2) file is expanded with alpha 255. */
interface Decoded { width: number; height: number; px: Uint8Array; colorType: number }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(file: Buffer): Decoded {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (file[i] !== SIG[i]) throw new Error('not a PNG (bad signature)');
  let off = 8;
  let ihdr: Buffer | null = null;
  const idat: Buffer[] = [];
  let sawEnd = false;
  while (off + 8 <= file.length) {
    const len = file.readUInt32BE(off);
    const type = file.toString('latin1', off + 4, off + 8);
    const body = file.subarray(off + 4, off + 8 + len); // type + data, for the CRC
    const data = file.subarray(off + 8, off + 8 + len);
    const crc = file.readUInt32BE(off + 8 + len);
    if (crc32(body) !== crc) throw new Error(`bad CRC in ${type} chunk`);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') { sawEnd = true; break; }
    off += 12 + len;
  }
  if (!ihdr) throw new Error('no IHDR chunk');
  if (!sawEnd) throw new Error('no IEND chunk');
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (colorType !== 6 && colorType !== 2) throw new Error(`colour type ${colorType}, need 6 (RGBA) or 2 (RGB)`);
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth}, need 8`);
  if (interlace !== 0) throw new Error(`interlace ${interlace}, need 0`);

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  if (raw.length !== height * (stride + 1)) throw new Error(`inflated ${raw.length} bytes, need ${height * (stride + 1)}`);
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? px[dst + i - bpp] : 0;
      const b = y > 0 ? px[up + i] : 0;
      const c = y > 0 && i >= bpp ? px[up + i - bpp] : 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error(`row ${y}: unknown filter ${filter}`);
      }
      px[dst + i] = v & 0xff;
    }
  }
  if (bpp === 4) return { width, height, px, colorType };
  const rgba = new Uint8Array(width * height * 4);
  for (let j = 0, k = 0; j < px.length; j += 3, k += 4) {
    rgba[k] = px[j]; rgba[k + 1] = px[j + 1]; rgba[k + 2] = px[j + 2]; rgba[k + 3] = 255;
  }
  return { width, height, px: rgba, colorType };
}

// ── Measure ──────────────────────────────────────────────────────────────────

type RGBA = readonly [number, number, number, number];
const key = (c: RGBA) => c.join(',');
const hexRgb = (hex: string): [number, number, number] => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
};

// The PNG's four values, as decimal RGBA (the ground truth rule C compares the
// constants against).
const BG: RGBA = [11, 13, 16, 255];
// Green since build 18: BRAND_ACCENT_ON_DARK at the track alpha, and opaque.
const TRACK: RGBA = [93, 179, 110, 64];
const BUBBLE: RGBA = [93, 179, 110, 255];
const CAP: RGBA = [244, 239, 230, 64];

const argv = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
// `--png <path>` exists for mutation-testing this script against an edited copy.
// The splash's own Paeth rows never hit a b-vs-c tie, so pin the predictor's
// order (a, then b, then c — PNG spec §9.4) on hand-worked values.
check('decoder: Paeth predictor (0,30,10)→30 (b beats c on a tie)', paeth(0, 30, 10) === 30);
check('decoder: Paeth predictor (10,20,15)→15, (100,50,60)→100, (5,5,5)→5',
  paeth(10, 20, 15) === 15 && paeth(100, 50, 60) === 100 && paeth(5, 5, 5) === 5);

const pngPath = argv('--png') ?? join(ROOT, 'assets', 'images', 'splash-icon.png');
let img: Decoded;
try {
  img = decodePng(readFileSync(pngPath));
  passes++;
} catch (e) {
  console.error(`FAIL  decode assets/images/splash-icon.png — ${(e as Error).message}`);
  process.exit(1);
}
const { width: W, height: H, px } = img;
check('A. the splash is colour type 6 (RGBA)', img.colorType === 6, String(img.colorType));
const at = (x: number, y: number): string => {
  const i = (y * W + x) * 4;
  return `${px[i]},${px[i + 1]},${px[i + 2]},${px[i + 3]}`;
};

interface Box { x0: number; x1: number; y0: number; y1: number; n: number } // inclusive
const counts = new Map<string, Box>();
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const k = at(x, y);
    const b = counts.get(k);
    if (!b) counts.set(k, { x0: x, x1: x, y0: y, y1: y, n: 1 });
    else {
      b.n++;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }
  }
}
const box = (c: RGBA): Box => counts.get(key(c)) ?? { x0: -1, x1: -1, y0: -1, y1: -1, n: 0 };
const boxStr = (b: { x0: number; x1: number; y0: number; y1: number }) => `x ${b.x0}–${b.x1} / y ${b.y0}–${b.y1}`;

// ── A. Canvas and palette ────────────────────────────────────────────────────
check('A. the splash is 1024 × 1024', W === 1024 && H === 1024, `${W} × ${H}`);
check('A. exactly four distinct RGBA values (no anti-aliasing)', counts.size === 4,
  `${counts.size}: ${[...counts.keys()].slice(0, 8).join(' | ')}`);
for (const [name, c] of [['background', BG], ['track', TRACK], ['bubble', BUBBLE], ['caps', CAP]] as const) {
  check(`A. the ${name} colour (${key(c)}) is present`, counts.has(key(c)));
}

// ── B. Bounding boxes ────────────────────────────────────────────────────────
const tb = box(TRACK);
const bb = box(BUBBLE);
const cb = box(CAP);
const eqBox = (b: Box, x0: number, x1: number, y0: number, y1: number) =>
  b.x0 === x0 && b.x1 === x1 && b.y0 === y0 && b.y1 === y1;
check('B. track bbox x 301–722 / y 508–515', eqBox(tb, 301, 722, 508, 515), boxStr(tb));
check('B. bubble bbox x 479–545 / y 499–524', eqBox(bb, 479, 545, 499, 524), boxStr(bb));
check('B. caps bbox x 293–730 / y 497–526', eqBox(cb, 293, 730, 497, 526), boxStr(cb));

/** The cap-coloured pixels in columns [xa, xb], as an inclusive bbox. */
function capBoxIn(xa: number, xb: number): Box {
  const b: Box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, n: 0 };
  for (let y = 0; y < H; y++) for (let x = xa; x <= xb; x++) {
    if (at(x, y) !== key(CAP)) continue;
    b.n++;
    b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x);
    b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
  }
  return b;
}
const capL = capBoxIn(0, 511);
const capR = capBoxIn(512, W - 1);
check('B. left cap x 293–300 / y 497–526', eqBox(capL, 293, 300, 497, 526), boxStr(capL));
check('B. right cap x 723–730 / y 497–526', eqBox(capR, 723, 730, 497, 526), boxStr(capR));
check('B. the two caps are every cap pixel', capL.n + capR.n === cb.n, `${capL.n} + ${capR.n} ≠ ${cb.n}`);

const excl = (b: Box) => ({ x0: b.x0, x1: b.x1 + 1, y0: b.y0, y1: b.y1 + 1 });
const P = NATIVE_SPLASH_PX;
const sameExcl = (p: { x0: number; x1: number; y0: number; y1: number }, b: Box) => {
  const e = excl(b);
  return p.x0 === e.x0 && p.x1 === e.x1 && p.y0 === e.y0 && p.y1 === e.y1;
};
check('B. NATIVE_SPLASH_PX.capL = {293,301,497,527} = measured', sameExcl(P.capL, capL), JSON.stringify(P.capL));
check('B. NATIVE_SPLASH_PX.capR = {723,731,497,527} = measured', sameExcl(P.capR, capR), JSON.stringify(P.capR));
check('B. NATIVE_SPLASH_PX.track = {301,723,508,516} = measured', sameExcl(P.track, tb), JSON.stringify(P.track));
check('B. NATIVE_SPLASH_PX.bubble = {479,546,499,525} = measured', sameExcl(P.bubble, bb), JSON.stringify(P.bubble));

// ── C. Colours ───────────────────────────────────────────────────────────────
const rgbKey = (hex: string, a: number) => [...hexRgb(hex), a].join(',');
check('C. NATIVE_SPLASH_BG is the background', rgbKey(NATIVE_SPLASH_BG, 255) === key(BG), NATIVE_SPLASH_BG);
const ACCENT_FIX = 'utils/levelTimeline.ts NATIVE_SPLASH_ACCENT must be the baked bubble (decimal 93,179,110 since build 18)';
check('C. NATIVE_SPLASH_ACCENT is the bubble', rgbKey(NATIVE_SPLASH_ACCENT, 255) === key(BUBBLE), `${NATIVE_SPLASH_ACCENT} — ${ACCENT_FIX}`);
check('C. NATIVE_SPLASH_ACCENT @ TRACK_ALPHA is the track', rgbKey(NATIVE_SPLASH_ACCENT, NATIVE_SPLASH_TRACK_ALPHA) === key(TRACK),
  `${NATIVE_SPLASH_ACCENT} @ ${NATIVE_SPLASH_TRACK_ALPHA} — ${ACCENT_FIX}`);
check('C. NATIVE_SPLASH_CAP @ CAP_ALPHA is the caps', rgbKey(NATIVE_SPLASH_CAP, NATIVE_SPLASH_CAP_ALPHA) === key(CAP),
  `${NATIVE_SPLASH_CAP} @ ${NATIVE_SPLASH_CAP_ALPHA}`);
check('C. NATIVE_SPLASH_TRACK_ALPHA is 64', NATIVE_SPLASH_TRACK_ALPHA === 64);
check('C. NATIVE_SPLASH_CAP_ALPHA is 64', NATIVE_SPLASH_CAP_ALPHA === 64);

// ── D. Radii ─────────────────────────────────────────────────────────────────
const R = NATIVE_SPLASH_RADII_PX;
check('D. NATIVE_SPLASH_RADII_PX = { track: 0, cap: 4, bubble: 13 }', R.track === 0 && R.cap === 4 && R.bubble === 13,
  JSON.stringify(R));
const is = (x: number, y: number, c: RGBA) => at(x, y) === key(c);
// Track: square ends.
for (const [x, y] of [[301, 508], [722, 508], [301, 515], [722, 515]] as const) {
  check(`D. track corner (${x},${y}) is track colour (square ends)`, is(x, y, TRACK), at(x, y));
}
let bubbleInTrack = 0;
let otherInTrack = 0;
for (let y = tb.y0; y <= tb.y1; y++) for (let x = tb.x0; x <= tb.x1; x++) {
  if (is(x, y, BUBBLE)) bubbleInTrack++;
  else if (!is(x, y, TRACK)) otherInTrack++;
}
const trackArea = (P.track.x1 - P.track.x0) * (P.track.y1 - P.track.y0);
check('D. the track bbox is 422 × 8 = 3376', trackArea === 3376, String(trackArea));
check('D. bubble pixels inside the track bbox = 67 × 8 = 536', bubbleInTrack === 536, String(bubbleInTrack));
check('D. track pixels = 2840', tb.n === 2840, String(tb.n));
check('D. track pixels = 3376 − bubble-in-track (every track-bbox pixel is track or bubble)',
  tb.n === trackArea - bubbleInTrack && otherInTrack === 0, `track ${tb.n}, bubble ${bubbleInTrack}, other ${otherInTrack}`);
// Caps: 8 × 30 pills of radius 4.
check('D. cap (293,497) is background (rounded corner)', is(293, 497, BG), at(293, 497));
check('D. cap (300,497) is background (rounded corner)', is(300, 497, BG), at(300, 497));
check('D. cap (296,497) is cap colour (top of the pill)', is(296, 497, CAP), at(296, 497));
check('D. cap (293,512) is cap colour (straight side)', is(293, 512, CAP), at(293, 512));
check('D. cap is 8 × 30 = radius 4 at half its width', P.capL.x1 - P.capL.x0 === 8 && P.capL.y1 - P.capL.y0 === 30
  && R.cap === (P.capL.x1 - P.capL.x0) / 2);
// Bubble: 67 × 26, radius 13.
check('D. bubble (479,499) is background', is(479, 499, BG), at(479, 499));
check('D. bubble (480,500) is background', is(480, 500, BG), at(480, 500));
check('D. bubble (479,512) is accent', is(479, 512, BUBBLE), at(479, 512));
check('D. bubble (545,512) is accent', is(545, 512, BUBBLE), at(545, 512));
check('D. bubble (512,499) is accent', is(512, 499, BUBBLE), at(512, 499));
check('D. bubble (481,512) is opaque accent (craft anchor)', is(481, 512, BUBBLE), at(481, 512));
check('D. bubble (544,512) is opaque accent (craft anchor)', is(544, 512, BUBBLE), at(544, 512));
check('D. bubble is 67 × 26 = radius 13 at half its height', P.bubble.x1 - P.bubble.x0 === 67
  && P.bubble.y1 - P.bubble.y0 === 26 && R.bubble === (P.bubble.y1 - P.bubble.y0) / 2);

// ── E. Clearance ─────────────────────────────────────────────────────────────
const bubbleCx = (P.bubble.x0 + P.bubble.x1) / 2;
const bubbleHalf = (P.bubble.x1 - P.bubble.x0) / 2;
check('E. bubble centre is 512.5, half-width 33.5', bubbleCx === 512.5 && bubbleHalf === 33.5, `${bubbleCx} / ${bubbleHalf}`);
check('E. 512.5 − AMP − 33.5 stays inside the track (≥ 301)', bubbleCx - NATIVE_SPLASH_AMP_PX - bubbleHalf >= P.track.x0,
  String(bubbleCx - NATIVE_SPLASH_AMP_PX - bubbleHalf));
check('E. 512.5 + AMP + 33.5 stays inside the track (≤ 723)', bubbleCx + NATIVE_SPLASH_AMP_PX + bubbleHalf <= P.track.x1,
  String(bubbleCx + NATIVE_SPLASH_AMP_PX + bubbleHalf));

// ── F. Centring ──────────────────────────────────────────────────────────────
check('F. the mark box is the caps\' union (x 293–731, y 497–527, 438 × 30)',
  SPLASH_MARK_X0 === P.capL.x0 && SPLASH_MARK_X0 + SPLASH_MARK_W === P.capR.x1
  && SPLASH_MARK_Y0 === P.capL.y0 && SPLASH_MARK_Y0 + SPLASH_MARK_H === P.capL.y1
  && SPLASH_MARK_W === 438 && SPLASH_MARK_H === 30);
check('F. the mark box is centred on the canvas (512, 512)',
  SPLASH_MARK_X0 + SPLASH_MARK_W / 2 === W / 2 && SPLASH_MARK_Y0 + SPLASH_MARK_H / 2 === H / 2);
const SCREENS: { w: number; h: number; p: 'ios' | 'web' }[] = [
  { w: 393, h: 852, p: 'ios' }, { w: 1280, h: 800, p: 'web' }, { w: 390, h: 844, p: 'web' },
];
for (const { w, h, p } of SCREENS) {
  const r = splashRect(w, h, p);
  check(`F. splashRect(${w}×${h}, ${p}) centres the mark`,
    near(r.markLeft + r.markW / 2, w / 2, 0.01) && near(r.markTop + r.markH / 2, h / 2, 0.01),
    `centre ${r.markLeft + r.markW / 2}, ${r.markTop + r.markH / 2}`);
  const want = p === 'web'
    ? Math.min((SPLASH_MARK_W * Math.min(w, h)) / 1024, SPLASH_WEB_MAX_W)
    : (SPLASH_MARK_W * Math.min(w, h)) / 1024;
  check(`F. splashRect(${w}×${h}, ${p}) markW = ${p === 'web' ? 'min(438·min(W,H)/1024, 240)' : '438·min(W,H)/1024'}`,
    near(r.markW, want, 1e-9), `${r.markW} vs ${want}`);
}
check('F. SPLASH_WEB_MAX_W is 240', SPLASH_WEB_MAX_W === 240);

// ── G. The pre-JS web level (P2) ─────────────────────────────────────────────
const htmlPath = argv('--html') ?? join(ROOT, 'public', 'index.html');
const html = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : '';
if (!html.includes('id="mage-prejs-level"')) {
  console.info('NOTE: pre-JS level not applied yet (P2 is a handoff patch)');
} else {
  validatePreJs(html);
}

function validatePreJs(doc: string): void {
  const styleRe = /<style id="mage-prejs-level-css">([\s\S]*?)<\/style>/;
  const sm = styleRe.exec(doc);
  check('G. the <style id="mage-prejs-level-css"> block exists', !!sm);
  if (!sm) return;
  const headEnd = doc.indexOf('</head>');
  const docCssAt = doc.indexOf('<style id="mage-document">');
  const docCssEnd = docCssAt >= 0 ? doc.indexOf('</style>', docCssAt) : -1;
  check('G. the style block sits in <head>, after the mage-document region (never inside it)',
    sm.index < headEnd && (docCssAt < 0 || sm.index > docCssEnd));
  check('G. the first </head> is the real one (Expo injects before the first match)',
    doc.indexOf('</head>') === doc.lastIndexOf('</head>'));
  const allCss = sm[1].replace(/\/\*[\s\S]*?\*\//g, '');
  check('G. still frame: no animation, transition or @keyframes', !/animation|transition|@keyframes/i.test(allCss));
  // The dark-page recolour (validate-level-desk rule H) is set aside: the
  // @media (prefers-color-scheme: dark) block, and the html[data-theme] rules
  // the flat parser below keys under their own selectors anyway.
  const css = allCss.replace(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');

  // @media blocks are parsed on their own: the flat rule parser below would
  // read a block's inner `.mpl-mark` rule as the base rule.
  const MEDIA = /@media\s*\(min-width:\s*(\d+)px\)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
  const media = [...css.matchAll(MEDIA)].map((m) => {
    const inner = /^\s*#mage-prejs-level \.mpl-mark\s*\{\s*width:\s*clamp\((\d+)px,\s*([\d.]+)vw,\s*(\d+)px\);?\s*\}\s*$/.exec(m[2]);
    return { minW: Number(m[1]), body: m[2], clamp: inner ? { lo: Number(inner[1]), vw: Number(inner[2]), hi: Number(inner[3]) } : null };
  });
  check('G every @media block is (min-width: Npx) and holds only a .mpl-mark width clamp',
    media.length === (css.match(/@media/g) ?? []).length && media.every((b) => b.clamp != null), media.map((b) => b.body.trim()).join(' | '));
  check('G the @media blocks ascend by min-width', media.every((b, i) => i === 0 || b.minW > media[i - 1].minW), media.map((b) => b.minW).join(','));
  const baseCss = css.replace(MEDIA, '');
  const rules = new Map<string, Map<string, string>>();
  for (const m of baseCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    const decls = new Map<string, string>();
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      decls.set(d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim().replace(/\s+/g, ' '));
    }
    rules.set(sel, decls);
  }
  const rule = (sel: string) => rules.get(sel) ?? new Map<string, string>();
  const colourIs = (v: string | undefined, hex: string) => (v ?? '').toLowerCase() === hex.toLowerCase();

  // The element: a sibling right after an untouched #root, hidden by CSS once
  // React has rendered anything into #root.
  const root = '<div id="root"></div>';
  const rootAt = doc.indexOf(root);
  const elAt = doc.indexOf('<div id="mage-prejs-level"');
  check('G. #root stays exactly <div id="root"></div> (validate-desktop-page-map pins it)', rootAt > 0);
  check('G. #mage-prejs-level is the next element after #root',
    rootAt > 0 && elAt > rootAt && doc.slice(rootAt + root.length, elAt).trim() === '');
  check('G. #mage-prejs-level is aria-hidden', /<div id="mage-prejs-level" aria-hidden="true">/.test(doc));
  const elEnd = doc.indexOf('</body>');
  const el = elAt > 0 ? doc.slice(elAt, elEnd) : '';
  check('G. no script inside the pre-JS level', !/<script/i.test(el));
  const order = ['mpl-cap-l', 'mpl-cap-r', 'mpl-track', 'mpl-bubble'].map((c) => el.indexOf(`mpl-part ${c}`));
  check('G. parts stack caps, track, bubble (the bubble covers the track)',
    order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2] && order[2] < order[3], order.join(','));
  check('G. #root:not(:empty) + #mage-prejs-level { display: none }',
    rule('#root:not(:empty) + #mage-prejs-level').get('display') === 'none');

  const host = rule('#mage-prejs-level');
  check('G. the level is fixed full-screen', host.get('position') === 'fixed' && host.get('inset') === '0');
  check('G. the level ground is the web launch ground (WEB_LAUNCH.bg, the concrete token)', colourIs(host.get('background-color'), WEB_LAUNCH.bg), host.get('background-color'));
  check('G. the web launch is not the native splash ink', !colourIs(host.get('background-color'), NATIVE_SPLASH_BG));
  check('G. the level sits at z-index 1', host.get('z-index') === '1');

  const mark = rule('#mage-prejs-level .mpl-mark');
  check('G. the mark is centred (left 50%, top 50%, translate(-50%, -50%))',
    mark.get('position') === 'absolute' && mark.get('left') === '50%' && mark.get('top') === '50%'
    && mark.get('transform') === 'translate(-50%, -50%)');
  const wm = /^min\(([\d.]+)vmin, (\d+)px\)$/.exec(mark.get('width') ?? '');
  const vmin = wm ? Number(wm[1]) : NaN;
  const cap = wm ? Number(wm[2]) : NaN;
  check('G. mark width is min(42.77vmin, 240px) (438/1024 within 0.01 %)',
    near(vmin, (100 * SPLASH_MARK_W) / 1024, 0.01) && cap === SPLASH_WEB_MAX_W, mark.get('width'));
  check('G. mark aspect-ratio is 438 / 30', mark.get('aspect-ratio') === `${SPLASH_MARK_W} / ${SPLASH_MARK_H}`, mark.get('aspect-ratio'));

  const pct = (v: string | undefined) => {
    const m = /^(-?[\d.]+)%$/.exec(v ?? '');
    return m ? Number(m[1]) : NaN;
  };
  const opacity = (v: string | undefined) => Number(v ?? NaN);
  const parts = [
    { cls: 'mpl-cap-l', p: P.capL, colour: WEB_LAUNCH.cap, alpha: NATIVE_SPLASH_CAP_ALPHA, round: true },
    { cls: 'mpl-cap-r', p: P.capR, colour: WEB_LAUNCH.cap, alpha: NATIVE_SPLASH_CAP_ALPHA, round: true },
    { cls: 'mpl-track', p: P.track, colour: WEB_LAUNCH.accent, alpha: NATIVE_SPLASH_TRACK_ALPHA, round: false },
    { cls: 'mpl-bubble', p: P.bubble, colour: WEB_LAUNCH.accent, alpha: 255, round: true },
  ];
  const base = rule('#mage-prejs-level .mpl-part');
  check('G. every part is absolutely positioned', base.get('position') === 'absolute');
  const got: Record<string, { l: number; t: number; w: number; h: number }> = {};
  for (const { cls, p, colour, alpha, round } of parts) {
    const r = rule(`#mage-prejs-level .${cls}`);
    const want = {
      l: (100 * (p.x0 - SPLASH_MARK_X0)) / SPLASH_MARK_W,
      t: (100 * (p.y0 - SPLASH_MARK_Y0)) / SPLASH_MARK_H,
      w: (100 * (p.x1 - p.x0)) / SPLASH_MARK_W,
      h: (100 * (p.y1 - p.y0)) / SPLASH_MARK_H,
    };
    const have = { l: pct(r.get('left')), t: pct(r.get('top')), w: pct(r.get('width')), h: pct(r.get('height')) };
    got[cls] = have;
    for (const k of ['l', 't', 'w', 'h'] as const) {
      check(`G. ${cls} ${k} = ${want[k].toFixed(4)}% (NATIVE_SPLASH_PX within 0.01 %)`, near(have[k], want[k], 0.01), String(have[k]));
    }
    check(`G. ${cls} colour is the WEB_LAUNCH value`, colourIs(r.get('background-color'), colour), r.get('background-color'));
    check(`G. ${cls} is never the native splash accent / cream`, !colourIs(r.get('background-color'), NATIVE_SPLASH_ACCENT)
      && !colourIs(r.get('background-color'), NATIVE_SPLASH_CAP));
    if (alpha === 255) check(`G. ${cls} is opaque`, !r.has('opacity') || opacity(r.get('opacity')) === 1, r.get('opacity'));
    else check(`G. ${cls} opacity is 64/255 (0.251)`, near(opacity(r.get('opacity')), alpha / 255, 0.0005), r.get('opacity'));
    const rad = r.get('border-radius') ?? '';
    if (round) check(`G. ${cls} is fully rounded (border-radius 9999px)`, rad === '9999px', rad);
    else check(`G. ${cls} has square ends (border-radius 0)`, rad === '0' || rad === '0px', rad);
  }

  // The CSS formulas equal BrandSplash's web frame 0 (launchRect: splashRect's
  // web cap below 768, the desk tiers from 768). The effective width is the
  // last @media block whose min-width ≤ W, else the base rule.
  const cssMarkW = (w: number, h: number): number => {
    let mw = Math.min((vmin / 100) * Math.min(w, h), cap);
    for (const b of media) if (b.clamp && w >= b.minW) mw = Math.min(b.clamp.hi, Math.max(b.clamp.lo, (b.clamp.vw / 100) * w));
    return mw;
  };
  for (const [w, h] of [[390, 844], [320, 568], [767, 1024], [768, 1024], [1024, 768], [1280, 800], [1440, 900], [1512, 945], [1920, 1080], [2560, 1440], [3440, 1440]] as const) {
    const r = launchRect(w, h, 'web');
    const markW = cssMarkW(w, h);
    const markH = (markW * SPLASH_MARK_H) / SPLASH_MARK_W;
    check(`G. ${w}×${h}: CSS mark ${markW.toFixed(2)} × ${markH.toFixed(2)} = launchRect within 0.05 px`,
      near(markW, r.markW, 0.05) && near(markH, r.markH, 0.05), `${r.markW} × ${r.markH}`);
    check(`G. ${w}×${h}: CSS mark origin = launchRect within 0.05 px`,
      near(w / 2 - markW / 2, r.markLeft, 0.05) && near(h / 2 - markH / 2, r.markTop, 0.05),
      `${w / 2 - markW / 2},${h / 2 - markH / 2} vs ${r.markLeft},${r.markTop}`);
    const want = splashPartRects(r.s);
    for (const [cls, name] of [['mpl-cap-l', 'capL'], ['mpl-cap-r', 'capR'], ['mpl-track', 'track'], ['mpl-bubble', 'bubble']] as const) {
      const g = got[cls];
      const pr = want[name];
      check(`G. ${w}×${h}: ${cls} = splashPartRects(launchRect s) within 0.05 px`,
        near((g.l / 100) * markW, pr.left, 0.05) && near((g.t / 100) * markH, pr.top, 0.05)
        && near((g.w / 100) * markW, pr.width, 0.05) && near((g.h / 100) * markH, pr.height, 0.05));
    }
  }
}

// ── H. The native images agree with app.json and with each other ────────────
{
  const appPath = argv('--app') ?? join(ROOT, 'app.json');
  const iconPath = argv('--icon') ?? join(ROOT, 'assets', 'images', 'icon.png');
  const adaptivePath = argv('--adaptive') ?? join(ROOT, 'assets', 'images', 'adaptive-icon.png');
  const app = JSON.parse(readFileSync(appPath, 'utf8')) as {
    expo: {
      icon?: string;
      splash?: { image?: string; resizeMode?: string; backgroundColor?: string };
      android?: { adaptiveIcon?: { foregroundImage?: string; backgroundColor?: string } };
    };
  };
  const e = app.expo;
  const sameHex = (hex: string | undefined, c: RGBA) => {
    try { return !!hex && c[3] === 255 && key([...hexRgb(hex), 255]) === key(c); } catch { return false; }
  };
  // The rebrand test, in decimal: green is the brand green family (g well
  // above r and b); the old orange is r high, b low. Thresholds sit far from
  // the cream (207,203,196), the ink (11,13,16) and both brands' anti-aliasing.
  const isGreen = (r: number, g: number, b: number) => g - r >= 50 && g - b >= 40;
  const isOrange = (r: number, g: number, b: number) => r >= 180 && r - b >= 120 && r - g >= 60;
  const tally = (d: Decoded) => {
    let green = 0; let orange = 0;
    for (let i = 0; i < d.px.length; i += 4) {
      if (d.px[i + 3] === 0) continue;
      if (isGreen(d.px[i], d.px[i + 1], d.px[i + 2])) green++;
      if (isOrange(d.px[i], d.px[i + 1], d.px[i + 2])) orange++;
    }
    return { green, orange };
  };
  const pxAt = (d: Decoded, x: number, y: number): RGBA => {
    const i = (y * d.width + x) * 4;
    return [d.px[i], d.px[i + 1], d.px[i + 2], d.px[i + 3]];
  };
  const corners = (d: Decoded): RGBA[] =>
    [[0, 0], [d.width - 1, 0], [0, d.height - 1], [d.width - 1, d.height - 1]].map(([x, y]) => pxAt(d, x, y));

  // The splash.
  check('H. app.json splash.image is ./assets/images/splash-icon.png', e.splash?.image === './assets/images/splash-icon.png', String(e.splash?.image));
  check('H. app.json splash.resizeMode is contain', e.splash?.resizeMode === 'contain', String(e.splash?.resizeMode));
  check('H. app.json splash.backgroundColor is the splash PNG\'s own ground (no visible box)',
    sameHex(e.splash?.backgroundColor, BG) && corners(img).every((c) => key(c) === key(BG)), String(e.splash?.backgroundColor));
  check('H. the splash is the green rebrand (the bubble is green, nothing is the old orange)',
    isGreen(BUBBLE[0], BUBBLE[1], BUBBLE[2]) && tally(img).orange === 0 && tally(img).green === box(BUBBLE).n + box(TRACK).n,
    JSON.stringify(tally(img)));

  // The App Store / home-screen icon.
  check('H. app.json icon is ./assets/images/icon.png', e.icon === './assets/images/icon.png', String(e.icon));
  let icon: Decoded | null = null;
  try { icon = decodePng(readFileSync(iconPath)); } catch (err) { check('H. icon.png decodes', false, (err as Error).message); }
  if (icon) {
    check('H. icon.png is 1024 × 1024', icon.width === 1024 && icon.height === 1024, `${icon.width} × ${icon.height}`);
    check('H. icon.png has NO alpha channel (colour type 2; App Store Connect rejects an icon with alpha)', icon.colorType === 2, String(icon.colorType));
    check('H. icon.png sits on the splash ink ground (all four corners)', corners(icon).every((c) => key(c) === key(BG)),
      corners(icon).map(key).join(' | '));
    const t = tally(icon);
    check('H. icon.png carries the green rebrand (≥ 10,000 green pixels) and no old-orange pixel', t.green >= 10000 && t.orange === 0, JSON.stringify(t));
  }

  // The Android adaptive icon (foreground on its declared background).
  check('H. app.json android.adaptiveIcon.foregroundImage is ./assets/images/adaptive-icon.png',
    e.android?.adaptiveIcon?.foregroundImage === './assets/images/adaptive-icon.png', String(e.android?.adaptiveIcon?.foregroundImage));
  let adaptive: Decoded | null = null;
  try { adaptive = decodePng(readFileSync(adaptivePath)); } catch (err) { check('H. adaptive-icon.png decodes', false, (err as Error).message); }
  if (adaptive) {
    check('H. adaptive-icon.png is 1024 × 1024', adaptive.width === 1024 && adaptive.height === 1024, `${adaptive.width} × ${adaptive.height}`);
    check('H. app.json android.adaptiveIcon.backgroundColor is the adaptive icon\'s own ground',
      sameHex(e.android?.adaptiveIcon?.backgroundColor, corners(adaptive)[0]) && corners(adaptive).every((c) => key(c) === key(BG)),
      String(e.android?.adaptiveIcon?.backgroundColor));
    const t = tally(adaptive);
    check('H. adaptive-icon.png bubble is the splash bubble green, and no old-orange pixel',
      key(pxAt(adaptive, 512, 512)) === key(BUBBLE) && t.orange === 0, `${key(pxAt(adaptive, 512, 512))} ${JSON.stringify(t)}`);
  }

  check('H. assets/brand-next (the staging folder) is gone — the green images live in assets/images',
    !existsSync(argv('--brand-next') ?? join(ROOT, 'assets', 'brand-next')));
}

if (failures > 0) {
  console.error(`\nvalidate-level-splash: ${failures} failed, ${passes} passed`);
  process.exit(1);
}
console.info(`validate-level-splash: all ${passes} checks passed`);
