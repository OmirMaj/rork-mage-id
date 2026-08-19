// Brand-orange contrast guard — founder decision #1.
//
// The brand hue #FF6A1A is KEPT for large non-text chrome (icons, burn bars,
// progress fills) where WCAG's 3:1 large/non-text rule applies. But as TEXT it
// measures only 2.87:1 on white, and white ON it measures the same 2.87:1 — so
// two derived companions carry the accessible cases:
//
//   accentLabel  — orange TEXT on a light background (captions included).
//                  Must clear AA 4.5:1 on EVERY light backdrop it can land on:
//                  surface #FFFFFF, bg #FBF8F2, surfaceAlt #F4EFE6, and the
//                  accentSoft tint (rgba(255,106,26,0.12)) composited over each.
//   accentFill   — the button FILL under WHITE text ("Next", "Mark paid",
//                  "Create your first project"). White on it must clear 4.5:1.
//
// This guard COMPUTES real WCAG ratios (relative luminance + alpha compositing
// over the actual rendered background) from the token hexes in constants/
// colors.ts. It is not a source-text heuristic — it fails if anyone retints a
// token below threshold, or reverts accentLabel/accentFill back to the raw hue.
//
// Pure node:fs + a tiny colour engine — no react-native import (that crashes bun).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Colour engine ───────────────────────────────────────────────────────────
type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** Composite an alpha fill (0..1) over an opaque backdrop → the rendered RGB. */
function over(fill: RGB, bg: RGB, a: number): RGB {
  return fill.map((c, i) => Math.round(c * a + bg[i] * (1 - a))) as RGB;
}
function relLum([r, g, b]: RGB): number {
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(fg: RGB, bg: RGB): number {
  const l1 = relLum(fg), l2 = relLum(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Read the tokens straight out of the source of truth ─────────────────────
const colorsSrc = readFileSync(join(ROOT, 'constants/colors.ts'), 'utf8');

// Scope to the `export const Theme = { light: {...}, dark: {...} }` object so
// the `light:` key in the default Colors export can't be mistaken for it.
const themeObj = (() => {
  const start = colorsSrc.indexOf('export const Theme');
  if (start < 0) throw new Error('could not find `export const Theme` in colors.ts');
  return colorsSrc.slice(start);
})();
const lightBlock = (() => {
  const m = /light:\s*\{([\s\S]*?)\n {2}\},\n {2}dark:/.exec(themeObj);
  if (!m) throw new Error('could not find Theme.light block');
  return m[1];
})();
const darkBlock = (() => {
  const m = /dark:\s*\{([\s\S]*?)\n {2}\},\n\};/.exec(themeObj);
  if (!m) throw new Error('could not find Theme.dark block');
  return m[1];
})();

/** Pull a hex token value from the light or dark Theme block. */
function token(theme: 'light' | 'dark', name: string): string {
  const block = theme === 'light' ? lightBlock : darkBlock;
  const m = new RegExp(`\\b${name}:\\s*'(#[0-9A-Fa-f]{6})'`).exec(block);
  if (!m) throw new Error(`token ${theme}.${name} not found (or not a plain hex)`);
  return m[1];
}

const WHITE: RGB = [255, 255, 255];

// Light-theme surfaces (the actual rendered backgrounds, per HOUSE RULES).
const L = { surface: '#FFFFFF', bg: '#FBF8F2', surfaceAlt: '#F4EFE6' } as const;
// Dark-theme surfaces.
const D = { surface: '#14181D', bg: '#0B0D10', surfaceAlt: '#1A1F26' } as const;

let failures = 0;
const rows: string[] = [];
function assert(label: string, measured: number, min: number) {
  const pass = measured >= min;
  if (!pass) failures += 1;
  rows.push(`  ${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(56)} ${round2(measured).toFixed(2)}:1  (need ${min}:1)`);
}

console.log('\nbrand-orange contrast validation (computed WCAG ratios):');

// ── accent stays the raw brand hue (used as large non-text chrome) ──────────
const accentL = token('light', 'accent');
if (accentL !== '#FF6A1A') { failures += 1; rows.push(`  FAIL  light accent must stay brand #FF6A1A, is ${accentL}`); }

// ── LIGHT: accentLabel (orange text) must clear 4.5:1 on every light backdrop ─
const labelL = hexToRgb(token('light', 'accentLabel'));
const softFill = hexToRgb('#FF6A1A'); // accentSoft is the brand hue at 0.12
for (const [name, bg] of Object.entries(L)) {
  const bgRgb = hexToRgb(bg);
  assert(`light accentLabel on ${name}`, ratio(labelL, bgRgb), 4.5);
  assert(`light accentLabel on accentSoft/${name}`, ratio(labelL, over(softFill, bgRgb, 0.12)), 4.5);
}

// ── LIGHT: white on accentFill must clear 4.5:1 ─────────────────────────────
assert('light white on accentFill', ratio(WHITE, hexToRgb(token('light', 'accentFill'))), 4.5);

// ── DARK: accentLabel must clear 4.5:1 on every dark backdrop ───────────────
const labelD = hexToRgb(token('dark', 'accentLabel'));
for (const [name, bg] of Object.entries(D)) {
  const bgRgb = hexToRgb(bg);
  assert(`dark accentLabel on ${name}`, ratio(labelD, bgRgb), 4.5);
  assert(`dark accentLabel on accentSoft/${name}`, ratio(labelD, over(softFill, bgRgb, 0.16)), 4.5);
}

// ── DARK: white on accentFill must clear 4.5:1 ──────────────────────────────
assert('dark white on accentFill', ratio(WHITE, hexToRgb(token('dark', 'accentFill'))), 4.5);

// ── The raw brand hue as TEXT/FILL-under-white must NOT be treated as passing.
// (Documents the 2.87:1 failure this decision fixes; a sanity anchor.)
const rawAsText = ratio(hexToRgb('#FF6A1A'), hexToRgb(L.surface));
if (rawAsText >= 4.5) { failures += 1; rows.push(`  FAIL  sanity: raw #FF6A1A on white should be <4.5, measured ${round2(rawAsText)}`); }

console.log(rows.join('\n'));
console.log('');
process.exit(failures === 0 ? 0 : 1);
