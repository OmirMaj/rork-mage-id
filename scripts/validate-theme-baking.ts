// Theme-baking guard — the defect class the 2026-09-07 app-experience audit
// found in 24 files ("Do next" #5).
//
// The bug, precisely
// ------------------
// constants/colors.ts turned its theme-sensitive properties into GETTERS that
// read a module-level `_currentTheme`, so an INLINE read (`color={Colors.text}`
// in JSX) re-resolves on every render and follows the theme. A
// `StyleSheet.create({ color: Colors.text })` written at MODULE SCOPE does not:
// the getter is invoked exactly once, when the module is first imported, and
// the resulting number is frozen into the RN style registry for the life of the
// process. constants/colors.ts:64-70 admits this in its own header — "It does
// NOT fully fix the StyleSheet.create case".
//
// Frozen light values inside an otherwise-dark app are not a cosmetic drift.
// The Pro Scheduler was a white island at full brightness for a foreman running
// dark mode at 6am, and in components/schedule/GridPane.tsx the anchor modal
// mixed BOTH modes in one tree: a Theme.light card under a `themeColors.text`
// web date input, i.e. cream type on white — an invisible field.
//
// The fix, which this guard pins
// ------------------------------
// The repo's own pattern (components/ToolScreenChrome.tsx):
//
//     const makeStyles = (t: ThemeColors) => StyleSheet.create({ ... });
//     const styles = useThemedStyles(makeStyles);   // memoized per theme
//
// A FACTORY is exempt from checks 1 and 2 by construction — it re-runs when the
// resolved theme changes, and it has `t` in hand. A bare module-scope sheet is
// not, and cannot be made so.
//
// Three checks, because the class has three shapes and each one shipped:
//
//   1. module-scope sheet reading a theme-aware `Colors.*` getter  (23 sheets)
//   2. module-scope sheet with a Theme-palette LITERAL, in a file that also
//      reads the live theme  (1 sheet — GridPane's anchor modal; the codemods
//      in scripts/codemod-colors*.js inlined Theme.light hexes over the getters
//      in several files, which check 1 cannot see)
//   3. a bare `useTheme();` called for a side effect it does not have  (6 files
//      — components/schedule/StatusPill.tsx:21 even commented "subscribe so the
//      pill recolors on theme change", which a frozen sheet makes impossible)
//   4. an achromatic rgba RULE (alpha >= 0.4) used as a border INSIDE a themed
//      factory  (2 sheets — see below)
//
// What check 2 deliberately CANNOT see, and why check 4 exists
// -----------------------------------------------------------
// Check 2 skips factories. It has to: a factory has `t` in hand, so a literal
// there is a considered choice often enough (`color: '#0B0D10'` is the near-
// black ink on a bright trade chip, right on either ground) that flagging every
// one would make this guard noise. The cost is that check 2 goes blind on
// exactly the 24 files this pass converted — it cannot regress-protect its own
// work, and the 2026-09-07 review found it had already let two through:
// ExportSheet.tsx and SchedulerTabShell.tsx each kept a `rgba(31,37,45,0.6)`
// row rule after their sheets started following the theme (tabs/DashboardTab
// .tsx had the identical literal and it WAS fixed). So check 4 takes the one
// slice of that space where there is no judgement call left to make: a NEUTRAL
// BORDER at 40% alpha or more is not a hairline, it is a bar, and it cannot be
// right on both grounds. `rgba(31,37,45,0.6)` composited to rgb(121,124,129) on
// the light sheet and to rgb(27,29,32) — invisible — on the dark one. Every
// real separator in this codebase is a 4-25% tint of its own ground's ink,
// which is why the threshold sits at 0.4 and not lower: below it live the
// legitimate white-on-dark-hero rules (app/signup.tsx 0.25,
// components/ClientHome.tsx 0.3) that this guard must not touch.
//
// Three deliberate narrowings, each of which cost a real false positive when
// tried the other way (measured 2026-09-07):
//   • BORDERS only, not backgrounds. 84 screens paint a `rgba(0,0,0,0.45)`
//     modal scrim, which is a neutral slab at >=0.4 and is CORRECT on both
//     themes — a scrim darkens whatever is behind it. A scrim is never a
//     border, so restricting the property closes that whole family.
//   • rgba only, not hex. A hex has no alpha channel to judge, and the opaque
//     ones in play (`#000000` on the login CTA) are ink on a bright fill.
//   • achromatic only. A `#FF3B3020` danger tint reads as itself on either
//     ground; only a grey has to pick a side.
//
// Both token lists are PARSED out of constants/colors.ts rather than typed in
// here, so adding a theme-aware getter or retinting a palette entry extends the
// guard automatically instead of silently narrowing it.
//
// Pure node:fs — no bundler, no react-native import (those crash bun).
// fileURLToPath + join because the repo path contains a space.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ROOTS = ['app', 'components'];

let failures = 0;

// ── The token lists, read out of the source of truth ────────────────────────

const colorsSrc = readFileSync(join(ROOT, 'constants/colors.ts'), 'utf8');

/** Getters whose body branches on `_currentTheme` — the ones that bake. */
const THEME_AWARE = new Set<string>();
for (const m of colorsSrc.matchAll(/get\s+([A-Za-z0-9_]+)\s*\(\)\s*\{[^}]*_currentTheme[^}]*\}/g)) {
  THEME_AWARE.add(m[1]);
}
// If a refactor of constants/colors.ts breaks that parse, this guard would
// quietly pass on everything. Fail loudly instead. `text` and `surface` are the
// two the whole class hangs on; they have been theme-aware since Phase 26.
if (THEME_AWARE.size < 10 || !THEME_AWARE.has('text') || !THEME_AWARE.has('surface')) {
  console.log(`  FAIL  could not parse the theme-aware getters out of constants/colors.ts`);
  console.log(`        (found ${THEME_AWARE.size}: ${[...THEME_AWARE].join(', ') || 'none'})`);
  console.log(`        Check 1 is inert until this parses — fix the regex, do not delete the check.\n`);
  process.exit(1);
}

/**
 * Ground/ink hexes from Theme.light + Theme.dark. A module-scope sheet holding
 * one of these is a sheet someone froze to a single theme by hand.
 *
 * Two families are deliberately NOT in the set, both for the same reason —
 * their value collides with a use that is correct on ANY ground, so flagging
 * them would be noise on innocent sheets while catching nothing check 1 misses:
 *
 *   '#FFFFFF'  (= Theme.light.surface) is also the LABEL on every coloured
 *              button fill in the app.
 *   'rgba(255,255,255,NN)'  (= Theme.dark.line) is also the hairline every
 *              piece of self-darkening chrome draws on its OWN ink ground —
 *              components/DesktopSidebar.tsx paints #1C1C1E and rules it in
 *              white 6% in both themes, which is right, not baked.
 *
 * What is left is the set the codemods actually inlined: the light inks
 * (#2B3038, #9AA3AD), the light rules (rgba(43,48,56,NN)), the creams
 * (#F4EFE6, #FBF8F2) and the dark grounds (#0B0D10, #14181D, #1A1F26).
 */
const PALETTE_ROLES = ['bg', 'surface', 'surfaceAlt', 'text', 'textSecondary', 'textMuted', 'line', 'neutralSoft'];
const PALETTE_LITERALS = new Set<string>();
{
  const start = colorsSrc.indexOf('export const Theme');
  const themeObj = colorsSrc.slice(start, colorsSrc.indexOf('\n};', start));
  for (const role of PALETTE_ROLES) {
    for (const m of themeObj.matchAll(new RegExp(`\\b${role}:\\s*'([^']+)'`, 'g'))) {
      const v = m[1];
      if (v === '#FFFFFF' || v === '#fff') continue;
      if (/^rgba\(255,\s*255,\s*255,/.test(v)) continue;
      // Matched WHOLE, including the alpha. The values that got inlined were
      // inlined by scripts/codemod-colors*.js straight off these tokens, so
      // they are byte-identical; matching an rgba PREFIX instead flagged every
      // legitimate `rgba(255,255,255,0.10)` hairline in the app.
      PALETTE_LITERALS.add(v);
    }
  }
}
if (PALETTE_LITERALS.size < 8) {
  console.log(`  FAIL  could not parse Theme.light/Theme.dark literals out of constants/colors.ts`);
  console.log(`        (found ${PALETTE_LITERALS.size}) — check 2 is inert until this parses.\n`);
  process.exit(1);
}

// ── File walk + a crude but sufficient source masker ────────────────────────

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Blank out comments and string bodies (preserving newlines and offsets) so the
 * bracket-depth walk below can't be thrown off by a `{` inside a comment or a
 * quoted string. Offsets stay 1:1 with the original, so every index found in
 * the masked text indexes the real source.
 */
function mask(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank)
    .replace(/`(?:\\.|[^`\\])*`/g, blank)
    .replace(/'(?:\\.|[^'\\\n])*'/g, blank)
    .replace(/"(?:\\.|[^"\\\n])*"/g, blank);
}

interface Sheet { file: string; line: number; body: string; factory: boolean }

/** Every StyleSheet.create(...) call that sits at bracket depth 0. */
function moduleScopeSheets(file: string, src: string): Sheet[] {
  const out: Sheet[] = [];
  const masked = mask(src);
  const NEEDLE = 'StyleSheet.create(';
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '{' || ch === '(' || ch === '[') { depth++; continue; }
    if (ch === '}' || ch === ')' || ch === ']') { depth--; continue; }
    if (depth !== 0 || !masked.startsWith(NEEDLE, i)) continue;
    let d = 0, j = i + NEEDLE.length - 1;
    for (; j < masked.length; j++) {
      const c = masked[j];
      if (c === '(' || c === '{' || c === '[') d++;
      else if (c === ')' || c === '}' || c === ']') { d--; if (d === 0) break; }
    }
    const line = src.slice(0, i).split('\n').length;
    // A factory declares the theme ON the same line it opens the sheet:
    //   const makeStyles = (t: ThemeColors) => StyleSheet.create({
    // The ThemeColors PARAMETER is the whole test, not the arrow. A
    // parameterless `() => StyleSheet.create({ color: Colors.text })` re-runs
    // per theme but still reads the static module, and contexts/ThemeContext
    // .tsx pushes `setColorTheme(resolved)` from a useEffect — i.e. AFTER the
    // render whose memo built the sheet — so such a factory latches the
    // PREVIOUS theme and useThemedStyles never recomputes it. That is a bake
    // with extra steps; it is not exempt.
    const declLine = src.split('\n')[line - 1];
    out.push({
      file,
      line,
      body: src.slice(i, j + 1),
      factory: /\(\s*\w+\s*:\s*ThemeColors\s*\)\s*=>\s*StyleSheet\.create/.test(declLine),
    });
    i = j;
  }
  return out;
}

const files = ROOTS.flatMap((d) => walk(join(ROOT, d)));

// ── Check 1: no baked theme-aware getter ────────────────────────────────────

console.log('theme-baking guard\n');

const bakedGetters: { file: string; line: number; tokens: string[] }[] = [];
const bakedLiterals: { file: string; line: number; values: string[] }[] = [];
const bareSubscriptions: { file: string; line: number }[] = [];
const neutralSlabs: { file: string; line: number; prop: string; value: string }[] = [];

/** `rgba(r,g,b,a)` -> its parts, or null for anything else (hex, named, hsl). */
function parseRgba(v: string): { r: number; g: number; b: number; a: number } | null {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}

/**
 * Neutral = HSV saturation at or below 0.35. A grey / near-black / near-white
 * rule has no identity of its own, so it reads as "whatever the ground is not"
 * — a different colour on each theme. A saturated one (a red danger tint, the
 * brand orange) reads as itself on both and is fine.
 *
 * Saturation, not a per-channel spread: the first cut of this check tested
 * `max channel delta <= 12` and PASSED on the very literal it was written for
 * — `rgba(31,37,45,0.6)` is a blue-grey whose R/B delta is 14 (review
 * 2026-09-07, caught by mutating the fix back in). The measured spread over
 * every rgba border in app/ + components/:
 *     rgba(31,37,45)   0.31   the two 60% row rules this pass missed
 *     rgba(60,60,67)   0.10   real hairlines, already under the alpha floor
 *     rgba(30,142,74)  0.79   green success tint
 *     rgba(255,106,26) 0.90   brand orange
 *     rgba(255,59,48)  0.81   danger tint
 * so 0.35 separates the slates from every signal colour with room on both
 * sides. Pure black scores 0 and is treated as neutral; there is no
 * `rgba(0,0,0,>=0.4)` BORDER in the tree today, and if one appears it should
 * be justified rather than assumed.
 */
function isNeutralSlab(v: string): boolean {
  const c = parseRgba(v);
  if (!c) return false;
  if (c.a < 0.4) return false;
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  return saturation <= 0.35;
}

for (const full of files) {
  const src = readFileSync(full, 'utf8');
  const rel = relative(ROOT, full);

  // A bare `useTheme();` — the return value dropped on the floor. The only
  // reason to write it is to "subscribe", and subscribing buys nothing unless
  // something downstream consumes the value; useThemedStyles(makeStyles) is
  // that consumer.
  for (const m of src.matchAll(/^[ \t]*useTheme\(\);/gm)) {
    bareSubscriptions.push({ file: rel, line: src.slice(0, m.index!).split('\n').length });
  }

  if (!src.includes('StyleSheet.create')) continue;
  const themeAwareFile = /useTheme\(|useThemedStyles|ThemeColors/.test(src);

  for (const sheet of moduleScopeSheets(rel, src)) {
    // Check 4 runs on factories as well — a literal does not un-bake itself
    // just because the sheet around it re-runs.
    if (themeAwareFile) {
      for (const m of sheet.body.matchAll(/(border[A-Za-z]*Color)\s*:\s*'([^']+)'/g)) {
        if (!isNeutralSlab(m[2])) continue;
        neutralSlabs.push({
          file: rel,
          line: sheet.line + sheet.body.slice(0, m.index!).split('\n').length - 1,
          prop: m[1],
          value: m[2],
        });
      }
    }

    if (sheet.factory) continue;

    const tokens = new Set<string>();
    for (const m of sheet.body.matchAll(/\bColors\.([A-Za-z0-9_]+)/g)) {
      if (THEME_AWARE.has(m[1])) tokens.add(m[1]);
    }
    if (tokens.size) bakedGetters.push({ file: rel, line: sheet.line, tokens: [...tokens].sort() });

    // Check 2 only fires in a file that ALSO reads the live theme. A wholly
    // un-themed screen painting fixed hexes is a different (and lesser)
    // problem; the dangerous shape is baked ink sharing a tree with live
    // ground, which is what made GridPane's date field invisible.
    if (themeAwareFile) {
      const hits = [...PALETTE_LITERALS].filter((v) => sheet.body.includes(v));
      if (hits.length) bakedLiterals.push({ file: rel, line: sheet.line, values: hits.sort() });
    }
  }
}

if (bakedGetters.length === 0) {
  console.log('  PASS  0 module-scope StyleSheets read a theme-aware Colors getter.');
} else {
  failures += bakedGetters.length;
  console.log(`  FAIL  ${bakedGetters.length} module-scope StyleSheet(s) freeze a theme-aware getter at import.`);
  console.log('        Convert to `const makeStyles = (t: ThemeColors) => StyleSheet.create({...})`');
  console.log('        + `useThemedStyles(makeStyles)` (see components/ToolScreenChrome.tsx):');
  for (const o of bakedGetters.sort((a, b) => a.file.localeCompare(b.file))) {
    console.log(`          ${o.file}:${o.line}   ${o.tokens.map((t) => 'Colors.' + t).join(', ')}`);
  }
}
console.log('');

if (bakedLiterals.length === 0) {
  console.log('  PASS  0 module-scope StyleSheets hardcode a Theme palette value in a themed file.');
} else {
  failures += bakedLiterals.length;
  console.log(`  FAIL  ${bakedLiterals.length} module-scope StyleSheet(s) hardcode one theme's palette`);
  console.log('        while the same file reads the live theme — baked ink under a live ground:');
  for (const o of bakedLiterals.sort((a, b) => a.file.localeCompare(b.file))) {
    console.log(`          ${o.file}:${o.line}   ${o.values.join(' ')}`);
  }
}
console.log('');

if (bareSubscriptions.length === 0) {
  console.log('  PASS  0 bare `useTheme();` calls (every subscription feeds something).');
} else {
  failures += bareSubscriptions.length;
  console.log(`  FAIL  ${bareSubscriptions.length} bare \`useTheme();\` call(s) — the value is discarded, so`);
  console.log('        nothing recolors. Consume it: `const styles = useThemedStyles(makeStyles);`');
  console.log('        or `const { colors: t } = useTheme();`:');
  for (const o of bareSubscriptions.sort((a, b) => a.file.localeCompare(b.file))) {
    console.log(`          ${o.file}:${o.line}`);
  }
}
console.log('');

if (neutralSlabs.length === 0) {
  console.log('  PASS  0 sheets rule a border with a >=40% neutral rgba literal.');
} else {
  failures += neutralSlabs.length;
  console.log(`  FAIL  ${neutralSlabs.length} sheet(s) draw a border from a >=40% NEUTRAL rgba literal in`);
  console.log('        a themed file. At that alpha it is a bar, not a hairline, and it cannot');
  console.log('        be right on both grounds — use `t.line`:');
  for (const o of neutralSlabs.sort((a, b) => a.file.localeCompare(b.file))) {
    console.log(`          ${o.file}:${o.line}   ${o.prop}: '${o.value}'`);
  }
}
console.log('');

console.log(failures === 0
  ? `theme-baking: PASS (${files.length} files scanned)`
  : `theme-baking: FAIL (${failures} problem(s))`);
process.exit(failures === 0 ? 0 : 1);
