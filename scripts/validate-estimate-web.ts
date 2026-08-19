// Estimate-surface web guard — pins the four defect CLASSES the 2026-08-18 web
// audit found on /estimate, /estimate/review and /estimate/full.
//
// This is a SOURCE-TEXT check, like scripts/validate-contrast.ts. It cannot
// render, so it cannot measure a contrast ratio or press Tab. What it CAN do is
// pin the exact textual shapes that produced the bugs:
//
//   A. CLIENT-VIEW LEAK IN THE HERO.
//      review.tsx renders its hero band ABOVE the ScrollView, outside both the
//      `cart.length === 0` branch (which carries the Contractor/Client toggle)
//      and the `mode === 'contractor'` branch (which carries every internal
//      number). So the hero is the ONE node on that screen that renders in both
//      modes — and its eyebrow inlined `{globalMarkup}% MARKUP`, publishing the
//      contractor's markup at the top of a client-facing page while the totals
//      bar, the rate-provenance chips and the shared-proposal token were all
//      correctly gated. The standing product rule is that estimate screens must
//      keep a client-facing mode that hides costs, markups and margin, so this
//      check reads the hero JSX and fails if a contractor-only identifier
//      appears inside it.
//
//   B. UNREACHABLE BY KEYBOARD.
//      react-native-web renders a <TouchableOpacity> with no accessibilityRole
//      as a plain <div> — no tabindex, no Enter/Space handling, invisible to a
//      screen reader. Production measured 992 elements on /estimate/full with
//      2 carrying role=button: the entire Full Estimator, including all 20k
//      catalog rows, could not be operated without a mouse. This check parses
//      every pressable in the estimate screens and requires a role.
//
//      Two shapes are legitimately excluded and are excluded BY SHAPE, not by a
//      hand-maintained allowlist: a full-bleed modal scrim (`styles.popupOverlay`),
//      which must not become a page-sized focus stop, and the
//      `onPress={() => undefined}` propagation blocker inside a modal card,
//      which is not a control at all.
//
//   C. MONEY IN A THEME-AGNOSTIC TOKEN.
//      `Colors.success` is '#34C759' in BOTH themes (constants/colors.ts) and
//      measures 2.22:1 on white, so the catalog's bulk prices were the least
//      readable text on the estimator. The theme token `themeColors.success` is
//      '#2E7D44' in light (5.06:1) and '#4ED37A' in dark. Same for error and
//      warning. This check flags `color:` — never `backgroundColor:`, where a
//      solid brand fill with a literal white label is legitimate — set from the
//      theme-agnostic constants.
//
//   D. TWO FORMATS FOR ONE COUNT.
//      The same catalog was rendered as '20,002 materials' (.toLocaleString())
//      and '20002 results' (raw .length) on one screen. Bare `.toLocaleString()`
//      is ALSO locale-dependent — it renders '20 002' in fr-FR — so the fix is
//      not "call toLocaleString everywhere" but "route counts through
//      utils/formatters.formatNumber", which pins 'en-US' the way formatMoney
//      already does. This check bans the bare call in the estimate screens.
//
// Pure node:fs — no bundler, no react-native import (those crash bun).
// fileURLToPath + join because the repo path contains a space.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SCREENS = [
  'app/(tabs)/estimate/index.tsx',
  'app/(tabs)/estimate/review.tsx',
  'app/(tabs)/estimate/full.tsx',
];

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const lineAt = (src: string, idx: number) => src.slice(0, idx).split('\n').length;

let failures = 0;
function ok(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log('  PASS  ' + name);
    return;
  }
  failures += 1;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}

console.log('\nestimate-web validation:');

// ── Check A: the review hero cannot name a contractor-only number ────────────
//
// The hero is the only always-rendered block on review.tsx, so anything it
// interpolates is published in client mode too.

const CONTRACTOR_ONLY = /\b(globalMarkup|markups|directCost|markupTotal|cartBaseTotal|grandTotal|clientView\.projectTotal)\b/;

function heroJsx(src: string): string | null {
  const start = src.indexOf('<View style={[styles.hero');
  if (start < 0) return null;
  // Walk to the matching </View> for THIS element (siblings/children counted).
  let depth = 0;
  let i = start;
  while (i < src.length) {
    if (src.startsWith('<View', i)) { depth++; i += 5; continue; }
    if (src.startsWith('</View>', i)) { depth--; i += 7; if (depth === 0) return src.slice(start, i); continue; }
    i++;
  }
  return null;
}

const reviewSrc = read('app/(tabs)/estimate/review.tsx');
const hero = heroJsx(reviewSrc);
ok(
  'review.tsx hero block is locatable (the check has something to read)',
  hero !== null,
  'expected `<View style={[styles.hero` in app/(tabs)/estimate/review.tsx',
);

if (hero) {
  const leaks = hero
    .split('\n')
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => CONTRACTOR_ONLY.test(l));
  ok(
    'review.tsx hero names no contractor-only figure (it renders in client mode too)',
    leaks.length === 0,
    leaks
      .map(({ l }) => `${l.trim().slice(0, 100)}  — hero renders above the mode branch; resolve the string from \`mode\` first`)
      .join('\n        '),
  );
}

// The positive half: the eyebrow must actually branch on the mode, so deleting
// the gate (rather than the interpolation) also fails.
ok(
  'review.tsx derives its hero eyebrow from `mode`',
  /const heroEyebrow\s*=\s*mode === 'contractor'/.test(reviewSrc),
  "expected `const heroEyebrow = mode === 'contractor' ? … : …` in app/(tabs)/estimate/review.tsx",
);

// ── Check B: every estimate pressable is keyboard-reachable ─────────────────

type Pressable = { file: string; line: number; props: string };

function pressablesMissingRole(rel: string): Pressable[] {
  const src = read(rel);
  const out: Pressable[] = [];
  const re = /<(TouchableOpacity|Pressable)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // Read the opening tag's props, stopping at the first '>' outside braces.
    let i = m.index + m[0].length;
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
      i++;
    }
    const props = src.slice(m.index + m[0].length, i);
    if (props.includes('accessibilityRole')) continue;
    // Legitimate non-controls, excluded by shape:
    //   the full-bleed dismiss scrim, and the no-op propagation blocker.
    if (props.includes('styles.popupOverlay')) continue;
    if (/onPress=\{\(\)\s*=>\s*undefined\}/.test(props)) continue;
    out.push({ file: rel, line: lineAt(src, m.index), props: props.replace(/\s+/g, ' ').trim().slice(0, 90) });
  }
  return out;
}

const roleless = SCREENS.flatMap(pressablesMissingRole);
ok(
  'every estimate pressable declares accessibilityRole (react-native-web needs it for a tabindex)',
  roleless.length === 0,
  roleless
    .map((p) => `${p.file}:${p.line}  <${p.props}>  — renders as a focusless <div> on web`)
    .join('\n        '),
);

// ── Check C: no theme-agnostic semantic colour used as text ─────────────────

const AGNOSTIC_FG = /(?<!background)(?<![A-Za-z])color[:=]\s*\{?\s*Colors\.(success|error|warning)\b/g;
const agnostic: string[] = [];
for (const rel of SCREENS) {
  const src = read(rel);
  let m: RegExpExecArray | null;
  AGNOSTIC_FG.lastIndex = 0;
  while ((m = AGNOSTIC_FG.exec(src))) {
    agnostic.push(`${rel}:${lineAt(src, m.index)}  Colors.${m[1]} as a foreground`);
  }
}
ok(
  'no estimate screen paints text in a theme-agnostic Colors.success/error/warning',
  agnostic.length === 0,
  agnostic
    .map((h) => `${h}  — #34C759 / #FF3B30 / #FF9500 are identical in both themes; use themeColors.success / dangerLabel / warningLabel`)
    .join('\n        '),
);

// ── Check D: counts of the same catalog use one formatter ──────────────────

const bareLocale: string[] = [];
for (const rel of SCREENS) {
  const src = read(rel);
  const re = /\.toLocaleString\(\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) bareLocale.push(`${rel}:${lineAt(src, m.index)}`);
}
ok(
  'estimate counts go through formatNumber, not a bare .toLocaleString()',
  bareLocale.length === 0,
  bareLocale
    .map((h) => `${h}  — bare .toLocaleString() is locale-dependent and drifts from the raw \`.length\` counts beside it; use formatNumber()`)
    .join('\n        '),
);

console.log('');
process.exit(failures === 0 ? 0 : 1);
