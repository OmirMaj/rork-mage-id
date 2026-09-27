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

// ── 4b. The same rule for Colors.primary ────────────────────────────────────
//
// The rebrand made `Colors.primary` THEME-AWARE: with no picked hue it returns
// #5DB36E in the dark theme, because the light brand #2F6B3A is 2.80:1 on the
// dark page. That fixed every primary-coloured icon and link — and silently
// broke every primary-coloured FILL under white: white on #5DB36E is 2.58:1.
// (The old orange gave 2.87:1, so these buttons were never AA; the rebrand
// critic caught them because the guard above only reads `.accent`.) A button
// that carries a white label paints `accentFill` — 6.39:1 light, 4.83:1 dark,
// and solved to the same budget for a picked preset hue.
//
// Detection is the accent guard's, widened in three ways the `Colors.primary`
// call sites need:
//   - the value may be a conditional (`active ? Colors.primary : t.surface`);
//     a tint (`Colors.primary + '15'`, `${Colors.primary}15`) or a helper call
//     (`withAlpha(Colors.primary, …)`) is NOT a solid fill;
//   - an ANONYMOUS inline style (`style={[s.btn, { backgroundColor: … }]}`)
//     counts, judged by its own `color:` and by the <Text> inside the element;
//   - a style object may be referenced through any sheet name (`s.`, `st.`,
//     `styles.`), not only `styles.`.
// Light text = isWhiteText above. Icon-only fills are not text (WCAG 1.4.11
// asks 3:1 of a glyph), so they are not gated here — but white on dark
// Colors.primary misses 3:1 too, so fix them by hand when you see one.
//
// PRIMARY_FILL_ALLOW: { file, style, reason } for a genuine exception (a fill
// that can only render on a hard-coded light ground, say). Every entry must
// still match an offender or it FAILS as stale.
// PRIMARY_FILL_DEFERRED: files other runs own right now (loader / desktop
// phase-B / UX lanes; see scratchpad rebrand-handoff/deferred.md). CEILING =
// the offender count on 2026-09-27. It may only fall; at 0 the row is stale.
console.log('brand-colour USAGE guard (white text on a solid Colors.primary fill):');

type PrimaryAllow = { file: string; style: string; reason: string };
const PRIMARY_FILL_ALLOW: PrimaryAllow[] = [];
const PRIMARY_FILL_DEFERRED: Record<string, number> = {
  'app/(tabs)/construction-ai/index.tsx': 5,
  'app/(tabs)/estimate/full.tsx': 14,
  'components/AIQuickEstimate.tsx': 3,
  'components/EstimateComparison.tsx': 1,
  'components/MaterialAIEstimateModal.tsx': 1,
  'components/ProductivityCalculator.tsx': 2,
  'components/SquareFootEstimator.tsx': 1,
  'components/VoiceCommandModal.tsx': 1,
};

/** Is `value` (a backgroundColor's value text) a SOLID primary fill somewhere
 *  in it — i.e. an `<ident>.primary` that is not a tint and not an argument? */
function isRawPrimaryValue(value: string): boolean {
  const v = value.trim();
  if (v.startsWith('`')) return false; // `${Colors.primary}15` — a template tint
  const re = /(?<![\w$.])[A-Za-z_$][\w$]*\.primary(?![\w$])(\s*\+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v)) !== null) {
    if (m[1]) continue; // `Colors.primary + '15'` — an alpha tint
    const before = v.slice(0, m.index);
    const opens = (before.match(/\(/g) ?? []).length - (before.match(/\)/g) ?? []).length;
    if (opens > 0 && /[\w$]\s*\([^()]*$/.test(before)) continue; // helper-call argument
    return true;
  }
  return false;
}

/** Every `backgroundColor:` value in `src` that is a raw primary fill, with its
 *  offset (of the property name). Strings are not special-cased: a
 *  `backgroundColor:` inside a string literal is vanishingly rare in .tsx. */
function rawPrimaryBgOffsets(src: string): number[] {
  const out: number[] = [];
  const re = /backgroundColor:\s*([^,}\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) if (isRawPrimaryValue(m[1])) out.push(m.index);
  return out;
}

/** The `{…}` object literal enclosing `off`, and the key it is assigned to
 *  (`name: {` → 'name'; anything else → null, i.e. an anonymous inline style). */
function enclosingObject(src: string, off: number): { start: number; end: number; name: string | null } | null {
  let depth = 0, i = off;
  for (; i >= 0; i--) {
    const ch = src[i];
    if (ch === '}') depth++;
    else if (ch === '{') { if (depth === 0) break; depth--; }
  }
  if (i < 0) return null;
  const start = i;
  let d = 0, instr: string | null = null, end = -1;
  for (let j = start; j < src.length; j++) {
    const ch = src[j];
    if (instr) { if (ch === '\\') { j++; continue; } if (ch === instr) instr = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') instr = ch;
    else if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) { end = j + 1; break; } }
  }
  if (end < 0) return null;
  const keyM = /([A-Za-z0-9_$]+)\s*:\s*$/.exec(src.slice(Math.max(0, start - 80), start));
  return { start, end, name: keyM ? keyM[1] : null };
}

/** subtreeHasWhiteText, with a <Text>'s style refs read through ANY sheet name. */
function subtreeHasWhiteTextAnySheet(src: string, off: number, styleWhite: Record<string, boolean>): string | null {
  const sub = elementSubtree(src, off);
  if (!sub) return null;
  const tRe = /<Text\b([^>]*)>/g;
  let tm: RegExpExecArray | null;
  while ((tm = tRe.exec(sub)) !== null) {
    const attrs = tm[1];
    const cRe = /color:\s*([^,}\]]+)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cRe.exec(attrs)) !== null) if (isWhiteText(cm[1])) return 'jsx-inline';
    const sRe = /(?<![\w$])[A-Za-z_$][\w$]*\.([A-Za-z0-9_]+)/g;
    let sm: RegExpExecArray | null;
    while ((sm = sRe.exec(attrs)) !== null) if (styleWhite[sm[1]]) return 'jsx-styleref';
  }
  return null;
}

const primaryOffenders: { file: string; style: string; line: number; why: string }[] = [];
for (const root of SRC_ROOTS) {
  for (const file of walk(join(ROOT, root), [])) {
    const rel = file.slice(ROOT.length + 1);
    const src = readFileSync(file, 'utf8');
    if (!src.includes('.primary')) continue;
    const offs = rawPrimaryBgOffsets(src);
    if (offs.length === 0) continue;
    const entries = allObjectEntries(src);
    const styleWhite: Record<string, boolean> = {};
    for (const [nm, obj] of Object.entries(entries)) styleWhite[nm] = colorValuesIn(obj).some(isWhiteText);
    const seen = new Set<string>();
    for (const off of offs) {
      const enc = enclosingObject(src, off);
      if (!enc) continue;
      const obj = src.slice(enc.start, enc.end);
      const line = src.slice(0, off).split('\n').length;
      let why: string | null = null;
      if (colorValuesIn(obj).some(isWhiteText)) why = 'inline';
      if (!why && enc.name && entries[enc.name] !== undefined) {
        for (const c of textSiblingCandidates(enc.name)) {
          if (entries[c] !== undefined && styleWhite[c]) { why = 'sibling:' + c; break; }
        }
        if (!why) {
          const useRe = new RegExp(`(?<![\\w$])[A-Za-z_$][\\w$]*\\.${enc.name}(?![\\w$])`, 'g');
          let um: RegExpExecArray | null;
          while (!why && (um = useRe.exec(src)) !== null) why = subtreeHasWhiteTextAnySheet(src, um.index, styleWhite);
        }
      }
      if (!why && !enc.name) why = subtreeHasWhiteTextAnySheet(src, off, styleWhite);
      if (!why) continue;
      const style = enc.name ?? `(inline @${line})`;
      if (seen.has(style)) continue;
      seen.add(style);
      primaryOffenders.push({ file: rel, style, line, why });
    }
  }
}

const primaryAllowUsed = new Array(PRIMARY_FILL_ALLOW.length).fill(0);
const primaryLive = primaryOffenders.filter((o) => {
  const i = PRIMARY_FILL_ALLOW.findIndex((a) => a.file === o.file && a.style === o.style);
  if (i >= 0) { primaryAllowUsed[i]++; return false; }
  return true;
});
const primaryDeferredCount: Record<string, number> = {};
const primaryLines: string[] = [];
for (const o of primaryLive.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  if (PRIMARY_FILL_DEFERRED[o.file] !== undefined) { primaryDeferredCount[o.file] = (primaryDeferredCount[o.file] ?? 0) + 1; continue; }
  primaryLines.push(`${o.file}:${o.line}  ::  ${o.style}   [${o.why}] — move the fill to accentFill`);
}
PRIMARY_FILL_ALLOW.forEach((a, i) => {
  if (primaryAllowUsed[i] === 0) primaryLines.push(`${a.file}  ::  ${a.style}   [allowlist entry is STALE — nothing matches it; delete the entry]`);
});
let primaryDeferredHits = 0;
for (const [file, ceiling] of Object.entries(PRIMARY_FILL_DEFERRED)) {
  const c = primaryDeferredCount[file] ?? 0;
  primaryDeferredHits += c;
  if (c === 0) primaryLines.push(`${file}  (0 offenders)  [deferred entry is STALE — the fix landed; delete the row]`);
  else if (c > ceiling) {
    primaryLines.push(`${file}  ${c} offenders > ceiling ${ceiling}  [a NEW white-on-Colors.primary fill in a deferred file]`);
    for (const o of primaryLive.filter((x) => x.file === file)) primaryLines.push(`    ${o.file}:${o.line}  ::  ${o.style}   [${o.why}]`);
  } else if (c < ceiling) console.log(`  NOTE  ${file}: ${c} offender(s), ceiling ${ceiling} — lower the ceiling to ${c}`);
}
console.log(`  ${primaryOffenders.length} offender(s) found; ${PRIMARY_FILL_ALLOW.length} allowlisted, ${primaryDeferredHits} deferred in ${Object.keys(PRIMARY_FILL_DEFERRED).length} files owned by other runs`);
// BRAND_VERBOSE=1 lists every offender, deferred ones included — the to-do list
// for whoever picks up a deferred file.
if (process.env.BRAND_VERBOSE) for (const o of primaryOffenders) console.log(`    · ${o.file}:${o.line}  ::  ${o.style}   [${o.why}]`);
if (primaryLines.length === 0) {
  console.log('  PASS  no white text on a solid Colors.primary fill outside the deferred files (those fills use accentFill)\n');
} else {
  failures += primaryLines.length;
  console.log(`  FAIL  ${primaryLines.length} finding(s):`);
  for (const l of primaryLines) console.log(`    ${l}`);
  console.log('');
}

// ── 5. The retired palette in places the token file cannot reach ────────────
// Emails are rendered by the recipient's mail client, so every edge function
// that builds one carries LITERAL hexes — eight files, none of which import
// constants/colors.ts. The rebrand first missed all eight. And the header pill
// is MAGE's mark on the ink bar: a caller's milestone accent (success teal,
// danger) under ink text fails contrast, so it must always be the on-ink green.
console.log('brand-colour RETIRED-PALETTE guard (edge emails, marketing cache):');
// walk() above collects .tsx only; these scans need every file type.
function walkAll(dir: string, acc: string[] = []): string[] {
  let ents: string[];
  try { ents = readdirSync(dir); } catch { return acc; }
  for (const name of ents) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walkAll(full, acc); else acc.push(full);
  }
  return acc;
}
const RETIRED = [/#FF6A1A/i, /#F4EFE6/i, /#E8DFCD/i, /Fraunces/, /Georgia,\s*'Times New Roman',\s*serif/];
const edgeHits: string[] = [];
const edgeFiles = walkAll(join(ROOT, 'supabase/functions')).filter((f) => /\.(ts|tsx|html)$/.test(f));
for (const f of edgeFiles) {
  const src = readFileSync(f, 'utf8');
  src.split('\n').forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return;
    for (const re of RETIRED) if (re.test(line)) edgeHits.push(`${f.slice(ROOT.length + 1)}:${i + 1}  ${re.source}`);
  });
}
if (edgeFiles.length < 20) { failures++; console.log(`  FAIL  scanned only ${edgeFiles.length} edge files — the walk is broken, not the palette clean`); }
else if (edgeHits.length === 0) console.log(`  PASS  no retired orange / cream / serif in ${edgeFiles.length} supabase/functions files`);
else { failures += edgeHits.length; console.log(`  FAIL  ${edgeHits.length} retired-palette literal(s) in emails:\n          ` + edgeHits.join('\n          ')); }

for (const rel of ['supabase/functions/_shared/email.ts', 'utils/emailLayout.ts']) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const pill = src.match(/background:\$\{([^}]*)\};color:#0B0D10;[^<]*MAGE&nbsp;ID/);
  if (pill && pill[1].trim() === 'BRAND_ON_INK') console.log(`  PASS  ${rel}: the MAGE ID pill is always BRAND_ON_INK`);
  else { failures++; console.log(`  FAIL  ${rel}: the MAGE ID pill paints ${pill ? pill[1] : '(not found)'} under ink text — pin it to BRAND_ON_INK`); }
}

// netlify.toml serves /*.css, /*.js and /assets/* with a ONE-YEAR immutable
// cache. A changed file at an unchanged URL never reaches a returning visitor,
// and the rebrand shipped with 18 pages still on styles.css?v=2026-07-14. So:
// every page that references one of these assets uses a ?v=, and every page uses
// the SAME ?v= for the same asset — one page left behind is one page in orange.
const CACHED = ['styles.css', 'landing.css', 'motion.js', 'assets/logo-mark-light.png', 'assets/logo-mark.png', 'assets/og-image.png', 'assets/favicon-16.png', 'assets/favicon-32.png', 'assets/favicon-180.png', 'assets/favicon-512.png'];
const versions: Record<string, Map<string, string[]>> = {};
const marketingPages = walkAll(join(ROOT, 'marketing')).filter((f) => f.endsWith('.html'));
for (const f of marketingPages) {
  const src = readFileSync(f, 'utf8');
  const rel = f.slice(ROOT.length + 1);
  for (const a of CACHED) {
    const re = new RegExp(`(?:https://mageid\\.app)?/${a.replace(/\./g, '\\.')}(\\?v=[^"'\\s)]*)?(?=["'\\s)])`, 'g');
    for (const m of src.matchAll(re)) {
      const v = m[1] ?? '(unversioned)';
      (versions[a] ??= new Map()).set(v, [...((versions[a].get(v)) ?? []), rel]);
    }
  }
}
if (marketingPages.length < 20) { failures++; console.log(`  FAIL  scanned only ${marketingPages.length} marketing pages — the walk is broken`); }
for (const a of CACHED) {
  const vs = versions[a];
  if (!vs) continue;
  const n = [...vs.values()].reduce((t, l) => t + l.length, 0);
  if (vs.size === 1 && !vs.has('(unversioned)')) { console.log(`  PASS  /${a}: ${n} reference(s), one version ${[...vs.keys()][0]}`); continue; }
  failures++;
  console.log(`  FAIL  /${a} is referenced at ${vs.size} version(s) — returning visitors keep the stale one:`);
  for (const [v, files] of vs) console.log(`          ${v}  ×${files.length}  e.g. ${[...new Set(files)].slice(0, 3).join(', ')}`);
}
console.log('');

// ═════════════════════════════════════════════════════════════════════════════
// 6. RETIRED-PALETTE GATE (repo-wide)
//
// Section 5 only reads supabase/functions, and only for three exact hexes. The
// 2026-09-26 sweep found what that left open: two marketing pages still shipped
// an ORANGE data-URI favicon (the PNG swap never touched it), a pill painted an
// undefined CSS var, and nothing at all stopped a new '#FF6A1A' landing in
// app/, components/, utils/ or marketing/. This section closes that:
//
//   a. SCAN every source file under the shipped roots (below). A walk that
//      reads fewer than GATE_MIN_FILES files FAILS — a broken walk must not
//      read as a clean palette.
//   b. NORMALISE: %23 → '#' (data-URI SVGs); comments are BLANKED (not
//      deleted, so line numbers hold) — //, /* */ and <!-- -->. A historical
//      "was #FF6A1A" comment is fine. String contents are never stripped:
//      email and PDF templates live in strings.
//   c. RETIRED literals fail on an exact (case-insensitive) match. A hex
//      followed by two more hex digits (#RRGGBBAA) still matches, and so does
//      the '#FF6A1A' + '22' concatenation, which reads as '#FF6A1A' in source.
//   d. NEAR VARIANTS: any other 6-digit hex within CIE76 ΔE 8 of #FF6A1A, or
//      ΔE 4 of #BC440C, fails too — '#F97316' is the same orange to a user.
//   e. ALLOWLIST: { path, literal | regex, reason }. Every entry must still
//      match a real (uncommented) hit, or it FAILS as stale, so it cannot rot.
//   f. DEFERRED: files owned right now by the loader (level) and desktop
//      phase-B (d6r) runs. Each has a CEILING = its hit count on 2026-09-26.
//      The count may only fall; at 0 the entry is stale and FAILS until
//      removed.
//   g. DARK INK ON THE GREEN FILL: the old orange took dark text; the green
//      does not (#0B0D10 on #357A42 is 3.72:1). A style object that paints a
//      brand-green background under a near-black `color` FAILS, and five
//      sibling bg→text pairs are pinned by file and style name.
//   i. Every var(--x) with no fallback on a marketing page is defined on that
//      page or in a stylesheet it links (the bid-invite pill painted
//      var(--amber) on a page that never defined it: white text on nothing).
// ═════════════════════════════════════════════════════════════════════════════
console.log('brand-colour RETIRED-PALETTE GATE (repo-wide):');

const GATE_ROOTS = ['app', 'components', 'utils', 'hooks', 'contexts', 'constants', 'lib', 'types', 'supabase/functions', 'marketing', 'public'];
const GATE_EXT = /\.(tsx?|jsx?|mjs|html|css|webmanifest|svg)$/;
// assets/ is out of scope entirely: assets/brand/splash.svg is the installed
// native splash's source and stays orange until the native build. mocks/ holds
// fixture data with third-party brand colours.
const GATE_SKIP_DIRS = new Set(['node_modules', '.git', '__tests__', 'docs', 'scripts', 'mocks', '__mocks__', 'assets']);
const GATE_SKIP_PREFIXES = ['utils/generated/'];
// ~90% of the real count (1454 files on 2026-09-26; see the printed count).
const GATE_MIN_FILES = 1300;

function gateWalk(dir: string, acc: string[]): string[] {
  let ents: string[];
  try { ents = readdirSync(dir); } catch { return acc; }
  for (const name of ents) {
    if (GATE_SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) gateWalk(full, acc);
    else if (GATE_EXT.test(name) && !name.endsWith('.snap') && !name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

/** Replace every non-newline char with a space: blanks a comment while keeping
 *  every line number (and column) of the text after it. */
const blankOut = (s: string) => s.replace(/[^\n]/g, ' ');

function stripHtmlComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, blankOut);
}

/** CSS: blank /* *\/ comments, honouring quoted strings (a url('…') or a
 *  content: '…' is never a comment). */
function stripCssComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      out += blankOut(src.slice(i, end)); i = end; continue;
    }
    out += ch; i++;
  }
  return out;
}

/** JS/TS: blank // and /* *\/ comments. String, template and regex literals are
 *  skipped whole (a 'https://…' string is not a comment), and template `${…}`
 *  holes are code again. */
function stripJsComments(src: string): string {
  const out = src.split('');
  const n = src.length;
  type Frame = { t: 'code'; depth: number } | { t: 'tpl' };
  const stack: Frame[] = [{ t: 'code', depth: 0 }];
  const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);
  const regexAllowedAt = (i: number): boolean => {
    let k = i - 1;
    while (k >= 0 && /\s/.test(out[k])) k--;
    if (k < 0) return true;
    const c = out[k];
    if (/[\w$]/.test(c)) {
      let s = k;
      while (s > 0 && /[\w$]/.test(out[s - 1])) s--;
      return REGEX_AFTER_WORD.has(out.slice(s, k + 1).join(''));
    }
    return '(,=:[!&|?{};+-*%<>~^'.includes(c);
  };
  let i = 0;
  while (i < n) {
    const top = stack[stack.length - 1];
    const ch = src[i];
    if (top.t === 'tpl') {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { stack.pop(); i++; continue; }
      if (ch === '$' && src[i + 1] === '{') { stack.push({ t: 'code', depth: 0 }); i += 2; continue; }
      i++; continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? n : e;
      for (let k = i; k < end; k++) out[k] = ' ';
      i = end; continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      for (let k = i; k < end; k++) if (out[k] !== '\n') out[k] = ' ';
      i = end; continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      i = j + 1; continue;
    }
    if (ch === '`') { stack.push({ t: 'tpl' }); i++; continue; }
    if (ch === '/' && regexAllowedAt(i)) {
      let j = i + 1, inClass = false;
      while (j < n && src[j] !== '\n') {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        j++;
      }
      i = j + 1; continue;
    }
    if (ch === '{') top.depth++;
    else if (ch === '}') {
      if (top.depth === 0 && stack.length > 1) { stack.pop(); i++; continue; }
      top.depth--;
    }
    i++;
  }
  return out.join('');
}

/** Decode %23, then blank every comment the file's language has. */
function normaliseForGate(rel: string, raw: string): string {
  const src = raw.replace(/%23/gi, '#');
  if (/\.html$/.test(rel)) {
    let s = stripHtmlComments(src);
    s = s.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, a: string, body: string, b: string) => a + stripCssComments(body) + b);
    s = s.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_m, a: string, body: string, b: string) => a + stripJsComments(body) + b);
    return s;
  }
  if (/\.css$/.test(rel)) return stripCssComments(src);
  if (/\.svg$/.test(rel)) return stripHtmlComments(src);
  if (/\.webmanifest$/.test(rel)) return src;
  return stripHtmlComments(stripJsComments(src));
}

// c. The retired palette.
const GATE_RETIRED_HEX = new Set([
  // orange family
  'FF6A1A', 'FD6A1A', 'FF8533', 'BC440C', 'C44A0F', 'B23E08', 'FFF1E6',
  // cream grounds
  'FBF8F2', 'FAF7F0', 'E8DFCD', 'E6DED0', 'EFE8DA', 'F4EFE6',
  // old success greens (ΔE 9.2 from the new brand — see check 3)
  '2E7D44', '256B39', '4ED37A', '1E8E4A', 'E8FAF0', '34C759', '2E7D32', '16A34A', '1B5E20', 'E8F5E9',
  // retired forest brand
  '1A6B3C',
]);
const GATE_RGB: RegExp[] = [
  /rgba?\(\s*255[\s,]+106[\s,]+26\s*[,/)]/gi,
  /rgba?\(\s*188[\s,]+68[\s,]+12\s*[,/)]/gi,
  /rgba?\(\s*46[\s,]+125[\s,]+68\s*[,/)]/gi,
  /rgba?\(\s*78[\s,]+211[\s,]+122\s*[,/)]/gi,
  /rgba?\(\s*52[\s,]+199[\s,]+89\s*[,/)]/gi,
];
const GATE_FONTS: RegExp[] = [/Fraunces/gi, /Georgia[^;"'`]*serif/gi];
// `(?<!&)` so an HTML numeric entity (&#128512;) is not read as a colour.
const GATE_HEX = /(?<!&)#([0-9a-f]{6})(?:[0-9a-f]{2})?(?![0-9a-f])/gi;
const NEAR_ORANGE = { hex: '#FF6A1A', max: 8 };
const NEAR_ORANGE_DARK = { hex: '#BC440C', max: 4 };

/** lit = the matched text; key = its normalised form (what a string allowlist
 *  entry compares); ctx = the whole normalised line (what a regex entry tests). */
type GateHit = { file: string; line: number; lit: string; key: string; rule: string; ctx: string };

/** Every retired / near / font hit in one file's (normalised) source. */
function scanRetired(rel: string, norm: string): GateHit[] {
  const hits: GateHit[] = [];
  norm.split('\n').forEach((text, idx) => {
    const line = idx + 1;
    if (text.includes('#')) {
      for (const m of text.matchAll(GATE_HEX)) {
        const core = m[1].toUpperCase();
        if (GATE_RETIRED_HEX.has(core)) { hits.push({ file: rel, line, lit: m[0], key: '#' + core, rule: 'retired', ctx: text }); continue; }
        const d1 = deltaE('#' + core, NEAR_ORANGE.hex);
        const d2 = deltaE('#' + core, NEAR_ORANGE_DARK.hex);
        if (d1 <= NEAR_ORANGE.max) hits.push({ file: rel, line, lit: m[0], key: '#' + core, rule: `near ΔE=${d1.toFixed(1)} from ${NEAR_ORANGE.hex}`, ctx: text });
        else if (d2 <= NEAR_ORANGE_DARK.max) hits.push({ file: rel, line, lit: m[0], key: '#' + core, rule: `near ΔE=${d2.toFixed(1)} from ${NEAR_ORANGE_DARK.hex}`, ctx: text });
      }
    }
    if (/rgb/i.test(text)) {
      for (const re of GATE_RGB) for (const m of text.matchAll(re)) hits.push({ file: rel, line, lit: m[0], key: m[0].replace(/\s+/g, '').toLowerCase(), rule: 'retired', ctx: text });
    }
    for (const re of GATE_FONTS) for (const m of text.matchAll(re)) hits.push({ file: rel, line, lit: m[0], key: m[0], rule: 'font', ctx: text });
  });
  return hits;
}

// g. Dark ink on the green fill.
const GREEN_BG = new Set([
  'Colors.tradeColors.general', 'Colors.primary', 'Colors.accentFill', 't.accent', 't.accentFill',
  'themeColors.accent', 'themeColors.accentFill', 'colors.accent', 'colors.accentFill', 'BRAND_ACCENT',
  "'#2F6B3A'", "'#357A42'", "'#388046'",
]);
const DARK_INK = new Set(['#0B0D10', '#000', '#000000', '#111']);
/** A property's value up to the next top-level `,` `}` or newline. */
function propValue(objOwn: string, prop: string): string | null {
  const m = new RegExp(`(?<![\\w$])${prop}\\s*:\\s*([^,}\\n]+)`).exec(objOwn);
  return m ? m[1].trim() : null;
}
const normBg = (v: string) => v.replace(/"/g, "'").replace(/'#([0-9a-f]+)'/i, (_m, h: string) => `'#${h.toUpperCase()}'`);
function isDarkInk(v: string | null): boolean {
  if (!v) return false;
  const m = /^['"](#[0-9a-f]{3,6})['"]$/i.exec(v.trim());
  return !!m && DARK_INK.has(m[1].toUpperCase());
}

/** Every `{…}` object in the file whose OWN level (nested objects removed)
 *  paints a green background under a dark-ink colour. */
function scanDarkInk(rel: string, norm: string): GateHit[] {
  if (!/backgroundColor/.test(norm) || !/(?<![\w$])color\s*:\s*['"]#(0B0D10|000|000000|111)['"]/i.test(norm)) return [];
  const hits: GateHit[] = [];
  const opens: number[] = [];
  // For each object: the source with nested {…} contents blanked.
  const n = norm.length;
  let instr: string | null = null;
  for (let i = 0; i < n; i++) {
    const ch = norm[i];
    if (instr) { if (ch === '\\') { i++; continue; } if (ch === instr || (ch === '\n' && instr !== '`')) instr = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { instr = ch; continue; }
    if (ch === '{') opens.push(i);
    else if (ch === '}' && opens.length) {
      const start = opens.pop()!;
      const body = norm.slice(start + 1, i);
      if (!body.includes('backgroundColor')) continue;
      // blank nested objects so only this object's own properties are read
      let own = '', depth = 0;
      for (const c of body) {
        if (c === '{') depth++;
        if (depth === 0) own += c; else own += c === '\n' ? '\n' : ' ';
        if (c === '}') depth--;
      }
      const bg = propValue(own, 'backgroundColor');
      if (!bg || !GREEN_BG.has(normBg(bg))) continue;
      const col = propValue(own, 'color');
      if (!isDarkInk(col)) continue;
      const colOff = start + 1 + own.search(/(?<![\w$])color\s*:/);
      const line = norm.slice(0, colOff).split('\n').length;
      hits.push({ file: rel, line, lit: `{ backgroundColor: ${bg}, color: ${col} }`, key: 'dark-ink', rule: 'dark-ink', ctx: '' });
    }
  }
  return hits;
}

/** The sibling bg-style → text-style pairs (bg on one entry, ink on another):
 *  the text style must never be dark ink. Pinned by file + style name. */
const DARK_INK_PINS: { file: string; bg: string; text: string }[] = [
  { file: 'components/SendPortalLinkModal.tsx', bg: 'modeBtnActive', text: 'modeBtnTextActive' },
  { file: 'components/SendPortalLinkModal.tsx', bg: 'sendBtn', text: 'sendText' },
  { file: 'components/schedule/AddTaskModal.tsx', bg: 'submitBtn', text: 'submitText' },
  { file: 'components/schedule/SchedulerHeader.tsx', bg: 'phoneExportBtn', text: 'phoneExportBtnText' },
  { file: 'components/schedule/tabs/BoardTab.tsx', bg: 'phoneSwitcherTabActive', text: 'phoneSwitcherLabelActive' },
  { file: 'components/schedule/tabs/BoardTab.tsx', bg: 'phoneSwitcherTabActive', text: 'phoneSwitcherCountActive' },
  // DEFERRED (d6r Z1 owns the file): the FAB paints Colors.tradeColors.general
  // under a '#0B0D10' "+" glyph. Counted against its DEFERRED ceiling below.
  { file: 'components/schedule/tabs/GanttTab.tsx', bg: 'fab', text: 'fabIcon' },
];

// e. ALLOWLIST. Every entry must still match a real hit (stale → FAIL).
type AllowEntry = { path: string; match: string | RegExp; reason: string };
const PHOTO_INK = 'photo-markup ink: the user-drawn annotation colour, identical across screen, PDF and portal';
const WARN_INK = 'semantic warning / over-budget / urgent ink (#C2410C), on main before the rebrand; warning and danger are unchanged';
const GATE_ALLOWLIST: AllowEntry[] = [
  { path: 'constants/colors.ts', match: '#F4EFE6', reason: 'Theme.dark.text, legacyChrome dark ink, the Colors.text getter, tradeColors.finish: light ink on dark grounds, not a cream ground' },
  { path: 'constants/colors.ts', match: '#F97316', reason: 'PHASE_PALETTE Insulation and TAKEOFF_CONDITION_PALETTE: categorical, not the brand' },
  { path: 'components/BrandBackdrop.tsx', match: '#F4EFE6', reason: 'OnInk.title: light ink on the ink field' },
  { path: 'app/login.tsx', match: '#F4EFE6', reason: 'hero type on the dark field' },
  { path: 'app/onboarding.tsx', match: '#F4EFE6', reason: 'BRAND.cream: light ink and CTA text on the ink hero' },
  { path: 'app/persona-select.tsx', match: '#F4EFE6', reason: 'BRAND.cream: light ink and CTA text on the ink hero' },
  { path: 'app/photo-annotator.tsx', match: '#1E8E4A', reason: PHOTO_INK },
  { path: 'app/project-detail.tsx', match: '#1E8E4A', reason: PHOTO_INK },
  { path: 'components/PhotoMarkupOverlay.tsx', match: '#1E8E4A', reason: PHOTO_INK },
  { path: 'utils/punchExportHtml.ts', match: '#1E8E4A', reason: PHOTO_INK },
  { path: 'utils/pdfGenerator.ts', match: '#1E8E4A', reason: PHOTO_INK },
  { path: 'marketing/portal/index.html', match: '#1E8E4A', reason: PHOTO_INK },
  { path: 'utils/emailService.ts', match: '#C2410C', reason: WARN_INK },
  { path: 'utils/emailLayout.ts', match: '#C2410C', reason: WARN_INK },
  { path: 'supabase/functions/_shared/email.ts', match: '#C2410C', reason: WARN_INK },
  { path: 'supabase/functions/notify/index.ts', match: '#C2410C', reason: WARN_INK },
  { path: 'marketing/portal/index.html', match: '#C2410C', reason: WARN_INK },
  { path: 'marketing/preferences/index.html', match: '#C2410C', reason: WARN_INK },
  { path: 'marketing/unsubscribe/index.html', match: '#C2410C', reason: WARN_INK },
  { path: 'app/(tabs)/discover/index.tsx', match: '#FF6F00', reason: 'NYC SBS resource link colour: categorical, a third-party mark' },
  { path: 'app/dev-seeder.tsx', match: '#F97316', reason: 'dev-only seed data' },
  { path: 'constants/certifications.ts', match: '#1A6B3C', reason: 'certification badge palette: categorical' },
  { path: 'constants/certifications.ts', match: '#2E7D32', reason: 'certification badge palette: categorical' },
  { path: 'constants/certifications.ts', match: '#1B5E20', reason: 'certification badge palette: categorical' },
  { path: 'constants/materials.ts', match: '#1A6B3C', reason: 'materials category palette: categorical' },
  { path: 'components/schedule/ResourceSwimlanes.tsx', match: '#34C759', reason: 'per-resource palette: categorical' },
  { path: 'app/punch-walk.tsx', match: '#16A34A', reason: 'trade colour: categorical' },
  { path: 'app/closeout-binder.tsx', match: '#16A34A', reason: 'per-document colour (G704): categorical' },
  { path: 'utils/pdfGenerator.ts', match: /'Caveat',\s*cursive,\s*Georgia,\s*serif/i, reason: 'typed-signature handwriting fallback, not a display face' },
  { path: 'app/_layout.tsx', match: /fraunces/i, reason: 'Fraunces_700Bold import + useFonts, kept loaded ONLY for main\'s components/BrandSplash.tsx. Once the loader\'s rewritten BrandSplash lands it names no Fraunces face: delete the import, this entry and BrandSplash\'s GATE_DEFERRED row together (deferred.md)' },
  // NOT YET (an entry that matches nothing fails as stale): in the loader
  // (level) merge commit, add utils/levelTimeline.ts '#FF6A1A' and '#F4EFE6' —
  // NATIVE_SPLASH_*, the replica of the INSTALLED orange native splash, kept
  // until the native build ships assets/brand-next. Exact entries in
  // deferred.md, "utils/levelTimeline.ts".
];

// f. DEFERRED: owned right now by the level / d6r phase-B runs. CEILING = the
//    hit count on 2026-09-26 under these exact rules (dark-ink pins included).
//    Only ever lower a number; delete the row when its file reaches 0.
const GATE_DEFERRED: Record<string, number> = {
  'app/(tabs)/discover/hire.tsx': 6,
  'app/(tabs)/schedule/index.tsx': 1,
  'app/client-view.tsx': 8,
  'app/company-profile.tsx': 1,
  'app/compare-drawings.tsx': 4,
  'app/equipment-detail.tsx': 5,
  'app/extract-submittals.tsx': 3,
  'app/oac-meeting.tsx': 1,
  'components/AIBidScorecard.tsx': 13,
  'components/AIEquipmentAdvice.tsx': 4,
  'components/AIEstimateValidator.tsx': 7,
  'components/AISubEvaluator.tsx': 3,
  'components/AIWeeklySummary.tsx': 8,
  // Not a colour pass: the loader's rewrite reads NATIVE_SPLASH_* (must match
  // the installed orange splash) then the live hue. Delete this row with the
  // _layout.tsx Fraunces import + ALLOWLIST entry when that rewrite lands.
  'components/BrandSplash.tsx': 4,
  'components/ConfirmEmailModal.tsx': 2,
  'components/DemoSeedPickerModal.tsx': 2,
  'components/QuickUpdateClarifier.tsx': 3,
  'components/schedule/InteractiveGantt.tsx': 1,
  'components/schedule/tabs/GanttTab.tsx': 1, // the fab→fabIcon dark-ink pin
  'public/index.html': 4,
};

const gateFileList = GATE_ROOTS.flatMap((r) => gateWalk(join(ROOT, r), []))
  .map((f) => f.slice(ROOT.length + 1))
  .filter((rel) => !GATE_SKIP_PREFIXES.some((p) => rel.startsWith(p)));
const gateSrc = new Map<string, string>();
const gateHits: GateHit[] = [];
for (const rel of gateFileList) {
  const norm = normaliseForGate(rel, readFileSync(join(ROOT, rel), 'utf8'));
  gateSrc.set(rel, norm);
  gateHits.push(...scanRetired(rel, norm));
  if (/\.(tsx?|jsx?)$/.test(rel)) gateHits.push(...scanDarkInk(rel, norm));
}

// Sibling pins.
const pinFailures: string[] = [];
for (const p of DARK_INK_PINS) {
  const norm = gateSrc.get(p.file);
  if (norm === undefined) { pinFailures.push(`${p.file}  (file not found)  [rule: dark-ink pin stale — update DARK_INK_PINS]`); continue; }
  const entries: Record<string, string> = {};
  for (const [s, e] of findStyleSheets(norm)) Object.assign(entries, splitEntries(norm.slice(s, e)));
  if (entries[p.bg] === undefined || entries[p.text] === undefined) {
    pinFailures.push(`${p.file}  ${p.bg}→${p.text}  [rule: dark-ink pin stale — a style was renamed; update DARK_INK_PINS]`);
    continue;
  }
  const dark = colorValuesIn(entries[p.text]).map((v) => v.trim().replace(/,+$/, '').trim()).find((v) => isDarkInk(v));
  if (dark) {
    const off = norm.indexOf(entries[p.text]);
    gateHits.push({ file: p.file, line: norm.slice(0, off).split('\n').length, lit: `${p.bg}→${p.text} color ${dark}`, key: 'dark-ink', rule: 'dark-ink', ctx: '' });
  }
}

const allowUsed = new Array(GATE_ALLOWLIST.length).fill(0);
const isAllowed = (h: GateHit): boolean => {
  let ok = false;
  GATE_ALLOWLIST.forEach((a, i) => {
    if (a.path !== h.file) return;
    const hit = typeof a.match === 'string' ? h.key.toUpperCase() === a.match.toUpperCase() : a.match.test(h.ctx);
    if (hit) { allowUsed[i]++; ok = true; }
  });
  return ok;
};
const liveHits = gateHits.filter((h) => !isAllowed(h));
const deferredCount: Record<string, number> = {};
const gateFails: GateHit[] = [];
for (const h of liveHits) {
  if (GATE_DEFERRED[h.file] !== undefined) deferredCount[h.file] = (deferredCount[h.file] ?? 0) + 1;
  else gateFails.push(h);
}
const gateLines: string[] = [];
for (const h of gateFails.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  gateLines.push(`${h.file}:${h.line}  ${h.lit}  [rule: ${h.rule}]`);
}
gateLines.push(...pinFailures);
GATE_ALLOWLIST.forEach((a, i) => {
  if (allowUsed[i] === 0) gateLines.push(`${a.path}  ${String(a.match)}  [rule: allowlist entry is STALE — nothing uncommented matches it; delete the entry]`);
});
let deferredFiles = 0, deferredHits = 0;
for (const [file, ceiling] of Object.entries(GATE_DEFERRED)) {
  const c = deferredCount[file] ?? 0;
  if (c === 0) { gateLines.push(`${file}  (0 hits)  [rule: deferred entry is STALE — the colour pass landed; delete the row]`); continue; }
  deferredFiles++; deferredHits += c;
  if (c > ceiling) {
    gateLines.push(`${file}  ${c} hits > ceiling ${ceiling}  [rule: deferred ceiling exceeded — a NEW retired literal in a deferred file]`);
    for (const h of liveHits.filter((x) => x.file === file)) gateLines.push(`    ${h.file}:${h.line}  ${h.lit}  [rule: ${h.rule}]`);
  } else if (c < ceiling) {
    console.log(`  NOTE  ${file}: ${c} hit(s), ceiling ${ceiling} — lower the ceiling to ${c}`);
  }
}

// i. Undefined CSS custom properties on marketing pages.
const cssVarLines: string[] = [];
let cssPages = 0;
for (const rel of gateFileList.filter((f) => f.startsWith('marketing/') && f.endsWith('.html'))) {
  cssPages++;
  const raw = readFileSync(join(ROOT, rel), 'utf8');
  const defined = new Set([...raw.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  for (const m of raw.matchAll(/href="([^"]+?\.css)[^"]*"/g)) {
    const href = m[1];
    if (/^https?:/.test(href)) continue;
    const p = href.startsWith('/') ? join(ROOT, 'marketing', href) : join(ROOT, dirname(rel), href);
    let css = '';
    try { css = readFileSync(p, 'utf8'); } catch { cssVarLines.push(`${rel}  links ${href}, which does not exist  [rule: css-var]`); continue; }
    for (const d of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(d[1]);
  }
  const used = new Set([...stripHtmlComments(raw).matchAll(/var\((--[a-z0-9-]+)\s*\)/gi)].map((m) => m[1]));
  const undef = [...used].filter((v) => !defined.has(v)).sort();
  if (undef.length) cssVarLines.push(`${rel}  var(${undef.join('), var(')}) with no fallback and no definition  [rule: css-var]`);
}
gateLines.push(...cssVarLines);

console.log(`  scanned ${gateFileList.length} files (floor ${GATE_MIN_FILES}); ${gateHits.length} raw hit(s), ${gateHits.length - liveHits.length} allowlisted`);
if (gateFileList.length < GATE_MIN_FILES) {
  failures++;
  console.log(`  FAIL  scanned only ${gateFileList.length} files — the walk is broken, not the palette clean`);
}
console.log(`  ALLOWLIST ${GATE_ALLOWLIST.length} entries (${allowUsed.filter((u) => u > 0).length} live)`);
console.log(`  DEFERRED ${deferredFiles} files / ${deferredHits} hits (colour round pending)`);
console.log(`  css vars: ${cssPages} marketing pages checked`);
if (gateLines.length === 0) {
  console.log('  PASS  no retired orange / cream / old-success / serif literal, no dark ink on the green fill, no undefined CSS var');
} else {
  failures += gateLines.length;
  console.log(`  FAIL  ${gateLines.length} finding(s):`);
  for (const l of gateLines) console.log(`    ${l}`);
}
console.log('');

process.exit(failures === 0 ? 0 : 1);
