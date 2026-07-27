// gen-splash.mjs — generate the flat native splash / adaptive-icon assets.
//
// WHY THIS EXISTS
// The old native splash (assets/images/splash-icon.png) was an AI-slop
// "crest": the letters M-A-G-E-I-D fused into a diamond/shield with a
// stylised orange "1D". Off-brand, busy, and the FIRST thing every user
// sees. The approved brand direction is a flat "spirit level" mark — the
// exact motif from components/PersonaSwitchOverlay.tsx and the marketing
// site: an ink field, a thin amber level track, and a bubble settled dead
// centre. Ink + amber only. No illustration, no crest, no gradient/glow.
//
// This is the PRE-JS static layer. The crisp Fraunces "MAGE ID" wordmark
// is drawn by the animated components/BrandSplash.tsx the instant JS boots;
// the native layer only needs the unmistakable level line so the two
// layers read as one continuous brand moment across the hand-off.
//
// WHY jimp-compact (not an SVG rasteriser)
// This repo has no rsvg-convert / magick / inkscape / sharp / resvg, so
// there is no SVG->PNG path. jimp-compact (bundled via @expo/image-utils)
// CAN draw solid geometry pixel-perfectly, and the level mark is pure
// geometry — no font rasterisation, so nothing can render blurry or wrong.
// If a proper SVG rasteriser is ever installed, assets/brand/splash.svg is
// the vector source of truth; re-generate from it instead.
//
// USAGE
//   node scripts/gen-splash.mjs
// Regenerates:
//   assets/images/splash-icon.png     1024x1024  (native splash, resizeMode:contain)
//   assets/images/adaptive-icon.png   1024x1024  (Android adaptive foreground)
// The ink background is baked into the PNG AND declared in app.json
// (splash.backgroundColor / android.adaptiveIcon.backgroundColor) so the
// contain-letterboxing on tall devices stays ink, never white.

import Jimp from 'jimp-compact';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'assets', 'images');

// ── Brand tokens (must match constants/colors.ts Theme.dark + marketing) ──
const INK = 0x0b0d10ff; // Theme.dark.bg — the scrim / marketing --ink
const AMBER = 0xff6a1aff; // Theme.dark.accent — the brand orange
// A muted cream at low alpha for the level end-notches — same identity as
// PersonaSwitchOverlay's `t.textMuted` hairline notch, never a second accent.
const NOTCH = 0xf4efe640; // cream @ ~25%

const SIZE = 1024;

// Level geometry, scaled up from PersonaSwitchOverlay (track 172 / bubble 30
// / height 16 at ~375pt screen). Kept proportional so the static mark and the
// animated component read as the same object.
const TRACK_W = Math.round(SIZE * 0.42); // ~430px — a confident but not full-bleed line
const TRACK_H = 8; // thin hairline track
const BUBBLE_W = Math.round(TRACK_W * 0.16); // proportional to PersonaSwitchOverlay's 30/172
const BUBBLE_H = 26;
const NOTCH_W = 8;
const NOTCH_H = 30;

// Draw a centred rounded rectangle. `r` is the corner radius (0 = square).
// Corners outside the rounded region are skipped so the shape reads as a
// pill / rounded bar — matching the SVG source's rx values and the
// component's Radius.full bubble.
function fillRect(img, cx, cy, w, h, color, r = 0) {
  const x0 = Math.round(cx - w / 2);
  const y0 = Math.round(cy - h / 2);
  const rad = Math.min(r, w / 2, h / 2);
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || y < 0 || x >= img.bitmap.width || y >= img.bitmap.height) continue;
      if (rad > 0) {
        // Distance from the nearest rounded corner centre.
        const dx = Math.max(x0 + rad - x, x - (x0 + w - 1 - rad), 0);
        const dy = Math.max(y0 + rad - y, y - (y0 + h - 1 - rad), 0);
        if (dx > 0 && dy > 0 && dx * dx + dy * dy > rad * rad) continue;
      }
      img.setPixelColor(color, x, y);
    }
  }
}

// `scale` lets the launcher icon draw a bolder, tighter mark than the
// full-screen splash (a thin line masked into Android's circle would read as
// a barely-visible sliver). 1 = splash proportions; >1 = fatter track/bubble
// for the icon's tight safe zone.
async function buildLevelMark(size, scale = 1) {
  const img = new Jimp(size, size, INK);
  const cx = size / 2;
  const cy = size / 2;

  const trackW = Math.round(TRACK_W * (scale > 1 ? 1.35 : 1));
  const trackH = Math.round(TRACK_H * scale);
  const bubbleW = Math.round(BUBBLE_W * (scale > 1 ? 1.6 : 1));
  const bubbleH = Math.round(BUBBLE_H * scale);
  const notchW = Math.round(NOTCH_W * scale);
  const notchH = Math.round(NOTCH_H * (scale > 1 ? 1.6 : 1));

  // Track — thin amber-soft line the bubble rides. Use a low-alpha amber so
  // the settled bubble (full amber) reads as the hero, exactly like the
  // component (track = t.line hairline, bubble = t.accent).
  fillRect(img, cx, cy, trackW, trackH, 0xff6a1a40, trackH / 2);

  // End notches — the level's centre reference marks, muted cream hairlines.
  fillRect(img, cx - trackW / 2, cy, notchW, notchH, NOTCH, 2);
  fillRect(img, cx + trackW / 2, cy, notchW, notchH, NOTCH, 2);

  // Centre reference notch (the "dead centre" the bubble settles into).
  fillRect(img, cx, cy, Math.round(4 * scale), notchH - Math.round(8 * scale), NOTCH, 2);

  // The bubble — settled DEAD CENTRE. Full amber, pill-rounded. This is the
  // whole idea.
  fillRect(img, cx, cy, bubbleW, bubbleH, AMBER, bubbleH / 2);

  return img;
}

async function main() {
  const splash = await buildLevelMark(SIZE);
  await splash.writeAsync(join(OUT, 'splash-icon.png'));
  console.log('wrote assets/images/splash-icon.png');

  // Adaptive icon foreground reuses the level mark (the old crest lived here
  // too). Android masks the foreground to a circle/rounded-square and pads it
  // ~33%, so a thin splash-weight line would read as a barely-visible sliver.
  // Draw the mark at 3x weight so track + bubble stay legible at launcher
  // sizes while sitting comfortably inside the 66% keep-clear safe zone.
  const adaptive = await buildLevelMark(SIZE, 3);
  await adaptive.writeAsync(join(OUT, 'adaptive-icon.png'));
  console.log('wrote assets/images/adaptive-icon.png');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
