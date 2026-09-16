// Brand-colour contrast + separation guard.
//
// Renamed from validate-brand-orange.ts in the 2026-09-16 rebrand (orange on
// cream → deep equipment green on concrete). A guard called "brand-orange"
// certifying a green brand would have been a lie in the file list, so the name
// moved with the hue; the engine did not change.
//
// THE SYSTEM this guard pins (founder decision, 2026-09-16):
//   brand          #2F6B3A  light UI — white on it 6.39:1, 5.44:1 on concrete
//   brand on dark  #5DB36E  dark UI  — 6.93:1 on #151816. The light brand on
//                           the dark ground is 2.80:1, so the dark theme does
//                           NOT reuse it.
//   grounds        light #ECEDE9 / #FFFFFF / #E2E4DF, dark #151816 / #1D211F / #252A27
//   success        TEAL (#12806E family), never green — see check 3.
//
// What it computes, from the token hexes in constants/colors.ts (real WCAG
// relative luminance + alpha compositing over the rendered ground — not a
// source-text heuristic):
//
//   1. accentLabel  — brand TEXT. AA 4.5:1 on every ground of its theme AND on
//                     the accentSoft wash of the brand over each (chip idiom).
//   2. accentFill   — the button FILL under WHITE text ("Next", "Mark paid").
//                     White on it ≥ 4.5:1, and the button itself ≥ 3:1 against
//                     every ground (WCAG 1.4.11 — a control you can see).
//      accent       — ≥ 4.5:1 on every ground of its theme: 373 of the 588
//                     `color: …accent` sites are text, whatever the chrome rule
//                     says.
//   3. SEPARATION   — brand vs success, CIE76 ΔE ≥ 18. The old success green
//                     #2E7D44 is ΔE 9.2 from the new brand: a primary action
//                     and a "Paid" badge would be the same swatch. This is the
//                     single most important assertion in the rebrand, and it is
//                     mutation-tested (set Theme.light.success back to #2E7D44
//                     and it goes red).
//
// Pure node:fs + a tiny colour engine — no react-native import (that crashes bun).

import { readFileSync, readdirSync, statSync } from 'node:fs';
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
/** sRGB → CIE L*a*b* (D65). Same maths as scripts/validate-contrast.ts labOf. */
function lab(hex: string): [number, number, number] {
  const lin = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const x = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047;
  const y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
  const z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
/** CIE76 ΔE — Euclidean distance in L*a*b*. ~2.3 is a just-noticeable
 *  difference side by side; under ~10 two swatches read as "the same colour"
 *  at a glance, which is the failure check 3 exists for. */
function deltaE(a: string, b: string): number {
  const A = lab(a), B = lab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
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

// The five accent tokens left the `Theme` object on 2026-09-07: they are
// DERIVED per user-chosen hue (deriveAccentPalette), and the brand's own
// family lives in the BRAND_ACCENT_FAMILY table below `Theme`. Without this
// second block the guard did not merely lose coverage, it threw at
// `token('light','accent')` and took itself off ship-check entirely
// (review 2026-09-07).
const familyObj = (() => {
  const start = colorsSrc.indexOf('const BRAND_ACCENT_FAMILY');
  if (start < 0) throw new Error('could not find `BRAND_ACCENT_FAMILY` in colors.ts — the brand accent family must stay a readable table');
  return colorsSrc.slice(start);
})();
const familyLight = (() => {
  const m = /light:\s*\{([\s\S]*?)\n {2}\},\n {2}dark:/.exec(familyObj);
  if (!m) throw new Error('could not find BRAND_ACCENT_FAMILY.light block');
  return m[1];
})();
const familyDark = (() => {
  const m = /dark:\s*\{([\s\S]*?)\n {2}\},\n\};/.exec(familyObj);
  if (!m) throw new Error('could not find BRAND_ACCENT_FAMILY.dark block');
  return m[1];
})();

/** Pull a hex token value from the light or dark Theme block, or — for the
 *  accent family, which no longer lives there — from BRAND_ACCENT_FAMILY. */
function token(theme: 'light' | 'dark', name: string): string {
  const re = new RegExp(`\\b${name}:\\s*'(#[0-9A-Fa-f]{6})'`);
  const m = re.exec(theme === 'light' ? lightBlock : darkBlock)
    ?? re.exec(theme === 'light' ? familyLight : familyDark);
  if (!m) throw new Error(`token ${theme}.${name} not found (or not a plain hex)`);
  return m[1].toUpperCase();
}

/** A top-level `export const NAME = '#…'` in colors.ts. */
function exportedHex(name: string): string {
  const m = new RegExp(`export const ${name}\\s*=\\s*'(#[0-9A-Fa-f]{6})'`).exec(colorsSrc);
  if (!m) throw new Error(`export const ${name} not found in colors.ts (or not a plain hex)`);
  return m[1].toUpperCase();
}

/** The static `Colors.success` signal fill — the first `success:` literal in
 *  the file, which lives in the Colors object above `Theme`. Screens that never
 *  migrated to useTheme() paint "Paid" badges with this one, so it has to be
 *  as far from the brand as the themed token is. */
const staticSuccess = (() => {
  const m = /\n\s+success:\s*'(#[0-9A-Fa-f]{6})'/.exec(colorsSrc.slice(0, colorsSrc.indexOf('export const Theme')));
  if (!m) throw new Error('Colors.success not found as a plain hex above `export const Theme`');
  return m[1].toUpperCase();
})();

const WHITE: RGB = [255, 255, 255];

let failures = 0;
const rows: string[] = [];
function assert(label: string, measured: number, min: number) {
  const pass = measured >= min;
  if (!pass) failures += 1;
  rows.push(`  ${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(60)} ${round2(measured).toFixed(2)}${min >= 10 ? ' ΔE' : ':1'}  (need ${min}${min >= 10 ? '' : ':1'})`);
}
function pin(label: string, got: string, want: string) {
  const pass = got.toUpperCase() === want.toUpperCase();
  if (!pass) failures += 1;
  rows.push(`  ${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(60)} ${got}${pass ? '' : `  (founder system says ${want})`}`);
}

console.log('\nbrand-colour validation (computed WCAG ratios + CIE76 ΔE):');

// ── 0. The system itself. Pinned, because every ratio below is only as honest
//      as the grounds it is measured on — retint the concrete and the ratios
//      would still "pass" against a page nobody ships.
const BRAND = exportedHex('BRAND_ACCENT');
const BRAND_DARK = exportedHex('BRAND_ACCENT_ON_DARK');
pin('BRAND_ACCENT', BRAND, '#2F6B3A');
pin('BRAND_ACCENT_ON_DARK', BRAND_DARK, '#5DB36E');
const GROUND_NAMES = ['bg', 'surface', 'surfaceAlt'] as const;
const FOUNDER_GROUNDS = {
  light: { bg: '#ECEDE9', surface: '#FFFFFF', surfaceAlt: '#E2E4DF' },
  dark: { bg: '#151816', surface: '#1D211F', surfaceAlt: '#252A27' },
} as const;
const G: Record<'light' | 'dark', Record<string, string>> = { light: {}, dark: {} };
for (const theme of ['light', 'dark'] as const) {
  for (const g of GROUND_NAMES) {
    G[theme][g] = token(theme, g);
    pin(`Theme.${theme}.${g}`, G[theme][g], FOUNDER_GROUNDS[theme][g]);
  }
}
// The default family must actually BE the brand: accent is the brand hue in
// light, the brand-on-dark hue in dark.
pin('BRAND_ACCENT_FAMILY.light.accent', token('light', 'accent'), BRAND);
pin('BRAND_ACCENT_FAMILY.dark.accent', token('dark', 'accent'), BRAND_DARK);

// ── 1 + 2. Contrast, both themes ────────────────────────────────────────────
const SOFT_ALPHA = { light: 0.12, dark: 0.16 } as const;
for (const theme of ['light', 'dark'] as const) {
  const accent = hexToRgb(token(theme, 'accent'));
  const label = hexToRgb(token(theme, 'accentLabel'));
  const fill = hexToRgb(token(theme, 'accentFill'));
  for (const g of GROUND_NAMES) {
    const bg = hexToRgb(G[theme][g]);
    assert(`${theme} accent on ${g}`, ratio(accent, bg), 4.5);
    assert(`${theme} accentLabel on ${g}`, ratio(label, bg), 4.5);
    assert(`${theme} accentLabel on accentSoft/${g}`, ratio(label, over(accent, bg, SOFT_ALPHA[theme])), 4.5);
    assert(`${theme} accentFill (button shape) on ${g}`, ratio(fill, bg), 3.0);
  }
  assert(`${theme} white on accentFill`, ratio(WHITE, fill), 4.5);
}

// Sanity anchors — the two facts this family is built around. If either stops
// being true the constants were edited without re-reading why they exist.
const lightOnDark = ratio(hexToRgb(BRAND), hexToRgb(G.dark.bg));
if (lightOnDark >= 3) { failures += 1; rows.push(`  FAIL  sanity: light brand ${BRAND} on dark bg should be <3:1 (why BRAND_ACCENT_ON_DARK exists), measured ${round2(lightOnDark)}`); }
const whiteOnDarkBrand = ratio(WHITE, hexToRgb(BRAND_DARK));
if (whiteOnDarkBrand >= 4.5) { failures += 1; rows.push(`  FAIL  sanity: white on ${BRAND_DARK} should be <4.5:1 (why dark accentFill differs), measured ${round2(whiteOnDarkBrand)}`); }

// ── 3. Brand vs success separation ──────────────────────────────────────────
//
// ΔE 18 is not fitted to pass. The regression it exists for scores 9.2 (brand
// #2F6B3A vs the old success #2E7D44); the founder's teal #12806E scores 21.6.
// 18 sits clear of the collision with room for a darker AA companion of the
// teal, and well under what any legitimate retint of either family would need.
//
// Every brand token a user can see as "the action" is held against every
// success token a user can see as "the state" — the fill is what a button
// paints, the label what a link or caption paints, and both themes' Theme
// tokens plus the static Colors.success fill are the badges.
const MIN_BRAND_SUCCESS_DELTA_E = 18;
const SUCCESS_LIGHT = [
  ['Theme.light.success', token('light', 'success')],
  ['Theme.light.successLabel', token('light', 'successLabel')],
  ['Colors.success', staticSuccess],
] as const;
for (const brandTok of ['accent', 'accentFill', 'accentLabel'] as const) {
  for (const [sName, sHex] of SUCCESS_LIGHT) {
    assert(`light ${brandTok} vs ${sName}`, deltaE(token('light', brandTok), sHex), MIN_BRAND_SUCCESS_DELTA_E);
  }
}
// Dark theme too: the same collision exists there (the old #4ED37A would sit
// a handful of ΔE from #5DB36E), and a check that only looks at one theme is a
// check the other theme can quietly fail.
for (const brandTok of ['accent', 'accentFill', 'accentLabel'] as const) {
  for (const sName of ['success', 'successLabel'] as const) {
    assert(`dark ${brandTok} vs Theme.dark.${sName}`, deltaE(token('dark', brandTok), token('dark', sName)), MIN_BRAND_SUCCESS_DELTA_E);
  }
}

console.log(rows.join('\n'));
console.log('');

// ═════════════════════════════════════════════════════════════════════════════
// USAGE GUARD — completeness authority for the accentFill rule.
//
// The token checks above prove the tokens are correct. They do NOT prove every
// button ACTUALLY USES accentFill. This section is the second half of the
// decision: it scans every StyleSheet in app/ + components/ and FAILS if any
// button style paints white/near-white/cream TEXT on the RAW brand `accent`
// fill. In the light theme the green brand happens to carry white (6.39:1), but
// the dark theme's accent #5DB36E gives white 2.58:1 — so a raw-accent button
// is still a dark-mode failure, and accentFill is still the only safe fill.
//
// What counts as an offender (must clear 4.5:1, so must move to accentFill):
//   a StyleSheet entry whose object literal has `backgroundColor: <tok>.accent`
//   — RAW accent, i.e. NOT accentSoft/Hot/Label/Fill/Muted/Light and NOT a
//   `<tok>.accent + 'NN'` alpha tint — AND that has white-ish TEXT via ONE of:
//     (a) an inline `color:` in the SAME literal, or
//     (b) a sibling `<name>Text`-style entry (broad naming variants) whose
//         color is white-ish, or
//     (c) a <Text> descendant, in the JSX element that uses styles.<name>,
//         whose color resolves white-ish.
//   White-ish = '#FFF' / '#FFFFFF' (and near-white/cream ≥ 245/238/230),
//   'white', Colors.textOnAccent / .textOnPrimary, or <tok>.surface / <tok>.bg
//   (both render white/cream in the light theme).
//
// What is NOT an offender (large non-text chrome — WCAG's 3:1 rule, brand hue
// is KEPT): icon-only buttons (a Lucide icon's `color` prop is not <Text>),
// progress/burn bars, unread dots, switch tracks/knobs, checkboxes, radios,
// bullets, section rules, and badges/circles with NO text label. These have no
// paired <Text>, so they are excluded — recoloring them would wrongly drift the
// brand hue on non-text chrome.
//
// This is the completeness authority: it lists EVERY offender by file + style
// name, and the ship is green only when the list is empty.
// ═════════════════════════════════════════════════════════════════════════════

// These directories were excluded while parallel tracks owned them; all of
// those tracks are now merged or discarded, so the guard covers the whole app.
const USAGE_EXCLUDE_PREFIXES: string[] = [];
function usageExcluded(rel: string): boolean {
  return USAGE_EXCLUDE_PREFIXES.some((p) => rel === p.replace(/\/$/, '') || rel.startsWith(p));
}

function walk(dir: string, acc: string[]): string[] {
  let ents: string[];
  try { ents = readdirSync(dir); } catch { return acc; }
  for (const name of ents) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc);
    else if (name.endsWith('.tsx')) acc.push(full);
  }
  return acc;
}

/** White / near-white / cream text signal. Mirrors the tokens above: raw white,
 *  the textOn* tokens, and surface/bg (white/cream in the light theme). */
function isWhiteText(rawVal: string): boolean {
  const val = rawVal.trim().replace(/,+$/, '').trim();
  const hexM = /^['"]#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})['"]$/.exec(val);
  if (hexM) {
    let h = hexM[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return r >= 245 && g >= 238 && b >= 230;
  }
  if (/\.(textOnAccent|textOnPrimary|surface|bg)$/.test(val)) return true;
  if (val === "'white'" || val === '"white"') return true;
  return false;
}

/** Does a style object literal paint its background on the RAW accent (not a
 *  tint, not accentSoft/Fill/…)? */
function hasRawAccentBg(objSrc: string): boolean {
  const re = /backgroundColor:\s*[A-Za-z_][A-Za-z0-9_]*\.accent(?![A-Za-z])(\s*\+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(objSrc)) !== null) {
    if (m[1]) continue; // `accent + 'NN'` → alpha tint, not a raw fill
    return true;
  }
  return false;
}

function colorValuesIn(objSrc: string): string[] {
  const out: string[] = [];
  const re = /\bcolor:\s*([^,}\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(objSrc)) !== null) out.push(m[1]);
  return out;
}

/** Find each `StyleSheet.create({ … })` body; return inner-brace [start,end). */
function findStyleSheets(src: string): [number, number][] {
  const res: [number, number][] = [];
  const re = /StyleSheet\.create\s*\(\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '{') continue;
    let depth = 0, instr: string | null = null;
    const start = i;
    for (let j = i; j < src.length; j++) {
      const ch = src[j];
      if (instr) { if (ch === '\\') { j++; continue; } if (ch === instr) instr = null; continue; }
      if (ch === "'" || ch === '"' || ch === '`') instr = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { res.push([start + 1, j]); break; } }
    }
  }
  return res;
}

/** Split a StyleSheet body into top-level `name -> objectLiteralSource`. */
function splitEntries(body: string): Record<string, string> {
  const entries: Record<string, string> = {};
  let i = 0; const n = body.length;
  while (i < n) {
    while (i < n && /[\s,]/.test(body[i])) i++;
    if (i >= n) break;
    if (body.startsWith('//', i)) { while (i < n && body[i] !== '\n') i++; continue; }
    if (body.startsWith('/*', i)) { const e = body.indexOf('*/', i); i = e >= 0 ? e + 2 : n; continue; }
    const keyM = /^([A-Za-z0-9_$]+|'[^']*'|"[^"]*")\s*:/.exec(body.slice(i));
    if (!keyM) { i++; continue; }
    const key = keyM[1].replace(/^['"]|['"]$/g, '');
    i += keyM[0].length;
    while (i < n && /\s/.test(body[i])) i++;
    if (body[i] === '{') {
      let depth = 0, instr: string | null = null; const vs = i;
      for (; i < n; i++) {
        const ch = body[i];
        if (instr) { if (ch === '\\') { i++; continue; } if (ch === instr) instr = null; continue; }
        if (ch === "'" || ch === '"' || ch === '`') instr = ch;
        else if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { entries[key] = body.slice(vs, i + 1); i++; break; } }
      }
    } else {
      // non-object value (array/expr) — skip to the next top-level comma
      let depth = 0, instr: string | null = null;
      for (; i < n; i++) {
        const ch = body[i];
        if (instr) { if (ch === '\\') { i++; continue; } if (ch === instr) instr = null; continue; }
        if (ch === "'" || ch === '"' || ch === '`') instr = ch;
        else if ('{[('.includes(ch)) depth++;
        else if ('}])'.includes(ch)) depth--;
        else if (ch === ',' && depth === 0) break;
      }
    }
  }
  return entries;
}

/** Every `name: { … }` object literal in the file, brace/string-aware. Unlike
 *  findStyleSheets this also covers `makeStyles = (t) => ({ … })` / themed-style
 *  factories that never call StyleSheet.create (e.g. app/project-detail.tsx),
 *  which the StyleSheet.create-only scan silently skipped. First occurrence of a
 *  name wins (the outer style, before any nested shadowOffset/{} it contains). */
function allObjectEntries(src: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const keyRe = /([A-Za-z0-9_$]+)\s*:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(src)) !== null) {
    const name = m[1];
    const open = m.index + m[0].length - 1;
    let depth = 0, instr: string | null = null;
    for (let j = open; j < src.length; j++) {
      const ch = src[j];
      if (instr) { if (ch === '\\') { j++; continue; } if (ch === instr) instr = null; continue; }
      if (ch === "'" || ch === '"' || ch === '`') instr = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { if (entries[name] === undefined) entries[name] = src.slice(open, j + 1); break; } }
    }
  }
  return entries;
}

/** From an index inside a JSX opening tag, find that tag's own '>' honoring
 *  strings and {…} nesting. Returns [gtIndex, selfClosing]. */
function findTagGt(src: string, from: number): [number, boolean] {
  let i = from, brace = 0; let instr: string | null = null; const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (instr) { if (ch === '\\') { i += 2; continue; } if (ch === instr) instr = null; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { instr = ch; i++; continue; }
    if (ch === '{') { brace++; i++; continue; }
    if (ch === '}') { brace--; i++; continue; }
    if (brace === 0 && ch === '>') return [i, src[i - 1] === '/'];
    i++;
  }
  return [-1, false];
}

/** Walk back to the '<' that opens the tag enclosing `off`, honoring {…}. */
function openingTagStart(src: string, off: number): number {
  let i = off, brace = 0;
  while (i > 0) {
    const ch = src[i];
    if (ch === '}') brace++;
    else if (ch === '{') { if (brace > 0) brace--; }
    else if (ch === '<' && brace <= 0 && /[A-Za-z]/.test(src[i + 1] || '')) return i;
    i--;
  }
  return -1;
}

/** Inner-JSX substring of the element whose opening tag contains `off`. */
function elementSubtree(src: string, off: number): string {
  const lt = openingTagStart(src, off);
  if (lt < 0) return '';
  const tm = /^<([A-Za-z][A-Za-z0-9_.]*)/.exec(src.slice(lt));
  if (!tm) return '';
  const tag = tm[1];
  const [gt, selfClose] = findTagGt(src, lt + 1);
  if (gt < 0 || selfClose) return '';
  const innerStart = gt + 1;
  let depth = 1, pos = innerStart;
  const tagTok = new RegExp('<(/?)(' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?=[\\s/>])', 'g');
  while (pos < src.length) {
    tagTok.lastIndex = pos;
    const mm = tagTok.exec(src);
    if (!mm) break;
    const [g, sc] = findTagGt(src, mm.index + mm[0].length);
    if (g < 0) break;
    if (mm[1] === '/') {
      depth--;
      if (depth === 0) return src.slice(innerStart, mm.index);
      pos = g + 1;
    } else {
      if (!sc) depth++;
      pos = g + 1;
    }
  }
  return src.slice(innerStart);
}

/** Does the JSX subtree of styles.<name> contain a <Text> with white color? */
function subtreeHasWhiteText(src: string, off: number, styleWhite: Record<string, boolean>): string | null {
  const sub = elementSubtree(src, off);
  if (!sub) return null;
  const tRe = /<Text\b([^>]*)>/g;
  let tm: RegExpExecArray | null;
  while ((tm = tRe.exec(sub)) !== null) {
    const attrs = tm[1];
    const cRe = /color:\s*([^,}\]]+)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cRe.exec(attrs)) !== null) if (isWhiteText(cm[1])) return 'jsx-inline';
    const sRe = /styles\.([A-Za-z0-9_]+)/g;
    let sm: RegExpExecArray | null;
    while ((sm = sRe.exec(attrs)) !== null) if (styleWhite[sm[1]]) return 'jsx-styleref';
  }
  return null;
}

/** Generate candidate sibling text-style names for a button style name. */
function textSiblingCandidates(name: string): string[] {
  const out = new Set<string>();
  const addVariants = (stem: string, suf = '') => {
    for (const tw of ['Text', 'Label', 'Title', 'Txt', 'Caption', 'Value']) {
      out.add(stem + tw + suf);
      out.add(stem + tw);
    }
  };
  addVariants(name);
  const mvar = /^(.*?)(Active|Selected|On|Enabled|Primary|Filled|Solid|Highlighted|Accept|Hot|Rec|Saved|Track|Current|Past|Mine)$/.exec(name);
  let base = name, varsuf = '';
  if (mvar) { base = mvar[1]; varsuf = mvar[2]; addVariants(base, varsuf); addVariants(base); }
  const suffixM = /(Btn|Button|Cta|CTA|Pill|Chip|Tab|Toggle|Segment|Option|Bubble|Card|Section|Header)$/.exec(base);
  if (suffixM) {
    const stem = base.slice(0, suffixM.index);
    if (stem) { addVariants(stem, varsuf); addVariants(stem); }
  }
  return [...out];
}

console.log('brand-colour USAGE guard (white text on raw accent fill):');

const SRC_ROOTS = ['app', 'components'];
const offenders: { file: string; style: string; why: string }[] = [];

for (const root of SRC_ROOTS) {
  for (const file of walk(join(ROOT, root), [])) {
    const rel = file.slice(ROOT.length + 1);
    if (usageExcluded(rel)) continue;
    const src = readFileSync(file, 'utf8');
    if (!src.includes('.accent')) continue;

    // Collect every style entry across all StyleSheets in the file, plus a
    // name -> hasWhiteColor map for sibling / JSX-styleref resolution.
    const entries: Record<string, string> = allObjectEntries(src);
    const styleWhite: Record<string, boolean> = {};
    for (const [nm, obj] of Object.entries(entries)) {
      styleWhite[nm] = colorValuesIn(obj).some(isWhiteText);
    }
    // Index every `styles.<name>` JSX use.
    const jsxIdx: Record<string, number[]> = {};
    const useRe = /styles\.([A-Za-z0-9_]+)/g;
    let um: RegExpExecArray | null;
    while ((um = useRe.exec(src)) !== null) (jsxIdx[um[1]] ||= []).push(um.index);

    for (const [name, obj] of Object.entries(entries)) {
      if (!hasRawAccentBg(obj)) continue;
      let why: string | null = null;
      // (a) inline color in the same literal
      if (colorValuesIn(obj).some(isWhiteText)) why = 'inline';
      // (b) sibling <name>Text-ish style with white color
      if (!why) {
        for (const c of textSiblingCandidates(name)) {
          if (entries[c] !== undefined && styleWhite[c]) { why = 'sibling:' + c; break; }
        }
      }
      // (c) JSX <Text> descendant with white color
      if (!why) {
        for (const off of jsxIdx[name] || []) {
          const r = subtreeHasWhiteText(src, off, styleWhite);
          if (r) { why = r; break; }
        }
      }
      if (why) offenders.push({ file: rel, style: name, why });
    }
  }
}

if (offenders.length === 0) {
  console.log(`  PASS  0 white-text-on-raw-accent button styles (all such fills use accentFill).\n`);
} else {
  failures += offenders.length;
  console.log(`  FAIL  ${offenders.length} button style(s) paint white text on the RAW accent fill —`);
  console.log(`        move each style's backgroundColor from \`.accent\` to \`.accentFill\`:`);
  for (const o of offenders.sort((a, b) => (a.file + a.style).localeCompare(b.file + b.style))) {
    console.log(`          ${o.file}  ::  ${o.style}   [${o.why}]`);
  }
  console.log('');
}

process.exit(failures === 0 ? 0 : 1);
