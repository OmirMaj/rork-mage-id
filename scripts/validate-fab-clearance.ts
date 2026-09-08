// validate-fab-clearance.ts — every scrollable screen must clear the Brain FAB.
//
// WHY. `BrainSurface` mounts ONE global FAB in app/_layout.tsx, so a 56pt
// opaque circle floats over the bottom-right of every screen with no idea what
// is underneath it. `BRAIN_FAB_CLEARANCE` (components/brain/brainFabState.ts)
// is the bottom padding that keeps a scroll container's last row out from under
// it, and it is opt-in per screen — there is no shared scroll frame to put it
// in (see that file's header for why). Opt-in means it gets forgotten: the
// hands-on UI pass on 2026-09-07 found 30 scrollable routes without it and
// photographed the FAB sitting on "Processor fee unknown" mid-list on Payments.
//
// This guard enumerates the same set mechanically so the number can only go
// down. It fails on a NEW screen that scrolls without clearance; a screen that
// has since been fixed prints a "delete it from KNOWN_GAPS" nudge rather than
// failing, matching the ceiling convention in validate-app-slop.ts — a guard
// that goes red when someone FIXES something teaches people to delete guards.
//
// Run: bun run scripts/validate-fab-clearance.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

console.log('\nbrain FAB clearance:');

// Paths are repo-root relative: every guard in scripts/ is run from the repo
// root by its `bun run test:*` entry.
const read = (rel: string): string => readFileSync(rel, 'utf8');

// ── 1. The clearance value is DERIVED from the FAB's geometry, so pin both ──
// BrainFab parks the circle at `bottom: insets.bottom + 70` and it is 56pt
// tall, so it occupies +70..+126 measured up from the window bottom; 126 plus
// 24pt of breathing room is the 150 in brainFabState. Move the FAB and this
// check tells you the padding every screen ships is now wrong.
const fabSrc = read('components/brain/BrainFab.tsx');
const stateSrc = read('components/brain/brainFabState.ts');

const clearance = Number(stateSrc.match(/BRAIN_FAB_CLEARANCE\s*=\s*(\d+)/)?.[1]);
const fabBottom = Number(fabSrc.match(/bottom:\s*insets\.bottom\s*\+\s*(\d+)/)?.[1]);
const fabHeight = Number(fabSrc.match(/fabWrap:\s*\{[\s\S]*?height:\s*(\d+)/)?.[1]);
ok('BrainFab geometry is readable', Number.isFinite(fabBottom) && Number.isFinite(fabHeight),
  `bottom=${fabBottom} height=${fabHeight}`);
ok(`clearance ${clearance} = FAB top edge ${fabBottom + fabHeight} + 24pt breathing room`,
  clearance === fabBottom + fabHeight + 24,
  `BrainFab now sits at insets.bottom + ${fabBottom} and is ${fabHeight}pt tall — ` +
  `BRAIN_FAB_CLEARANCE should be ${fabBottom + fabHeight + 24}, not ${clearance}`);

// ── 2. Which routes the FAB actually floats over ──
// Parsed out of BrainFab rather than duplicated, so adding a route to
// HIDDEN_ROOTS silently excuses it here too — which is the correct behaviour:
// no FAB, no clearance needed.
const hiddenLiteral = fabSrc.match(/HIDDEN_ROOTS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
const HIDDEN_ROOTS = new Set((hiddenLiteral.match(/'([^']+)'/g) ?? []).map(s => s.slice(1, -1)));
ok('HIDDEN_ROOTS parsed from BrainFab', HIDDEN_ROOTS.size >= 10 && HIDDEN_ROOTS.has('login'),
  `parsed ${HIDDEN_ROOTS.size} entries`);

// ── 3. The sweep ──
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

// Any container that scrolls its own content past the bottom of the window.
const SCROLLS = /<(ScrollView|FlatList|SectionList|VirtualizedList|Animated\.ScrollView|Animated\.FlatList|KeyboardAwareScrollView)[\s>]/;
// Two ways to be clear of it: pad the content, or suppress the FAB outright
// (useHideBrainFab — what the client-facing estimate does).
const CLEARS = /BRAIN_FAB_CLEARANCE|useHideBrainFab/;

/**
 * Routes that scroll under the FAB today. From the hands-on UI pass on
 * 2026-09-07 (30 found by hand, plus the two nested tab screens the by-hand
 * sweep of top-level routes missed). Ordered as the audit lists them.
 *
 * This list may only SHRINK. Fixing one is a two-line change: import
 * BRAIN_FAB_CLEARANCE and add `paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE`
 * to the scroll container's contentContainerStyle. The money screens —
 * invoice, aia-pay-app, change-order, cost-xray, estimate-wizard — are the ones
 * where a covered last row costs a contractor something.
 *
 * 30 → 6 on 2026-09-07. Two of the twenty-four needed something other than the
 * two-line change and are worth knowing about before you fix the rest:
 *   - Where the FAB is LIFTED over a measured sticky bar (useBrainFabLift), the
 *     clearance is measured from the top of that bar. Check 4 below enforces
 *     that case; do not hand-roll it.
 *   - plan-viewer calls useHideBrainFab() instead: its scroll container is a
 *     pinch-zoom draw canvas, where padding would push the sheet off-centre and
 *     the circle would still eat markup strokes.
 */
const KNOWN_GAPS: ReadonlySet<string> = new Set([
  'aia-pay-app', 'change-order', 'paywall', 'takeoff-estimate',
  '(tabs)/estimate/review', '(tabs)/settings/appearance',
]);

const offenders: string[] = [];
const fixed: string[] = [];
let scanned = 0;

for (const file of walk('app')) {
  const route = relative('app', file).replace(/\.tsx$/, '');
  // Layouts render no scroll container of their own, and `+not-found` / `+html`
  // are Expo Router's own specials.
  if (route.endsWith('_layout') || route.split('/').some(s => s.startsWith('+'))) continue;
  // segments[0] is what BrainFab tests, group parens included.
  if (HIDDEN_ROOTS.has(route.split('/')[0])) continue;

  const src = readFileSync(file, 'utf8');
  if (!SCROLLS.test(src)) continue;
  scanned++;
  if (CLEARS.test(src)) {
    if (KNOWN_GAPS.has(route)) fixed.push(route);
    continue;
  }
  if (!KNOWN_GAPS.has(route)) offenders.push(route);
}

ok(`${scanned} scrollable routes swept; no NEW screen scrolls under the FAB`,
  offenders.length === 0,
  offenders.length
    ? `${offenders.length} route(s) with a scroll container and no clearance:\n      ` +
      offenders.join('\n      ') +
      `\n      Add \`paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE\` to the` +
      `\n      contentContainerStyle, or call useHideBrainFab() if the FAB does not belong there.`
    : '');

if (fixed.length) {
  console.log(`\n  ${fixed.length} KNOWN_GAPS entr${fixed.length === 1 ? 'y is' : 'ies are'} now clear — delete from the list:`);
  for (const r of fixed) console.log(`        ↓ '${r}'`);
}

// ── 4. A LIFTED FAB needs the bar's height in the padding too ──
//
// The check above only asks whether BRAIN_FAB_CLEARANCE appears in the file.
// That is enough for a plain screen and useless for a screen with a sticky
// bar: every one of those bars is `position: 'absolute', bottom: 0`, so the
// scroll container still reaches the window bottom, and `useBrainFabLift(h)`
// pushes the FAB from its resting +70..+126 up to +70+h..+126+h. A screen that
// pads `insets.bottom + BRAIN_FAB_CLEARANCE` there is short by exactly `h` —
// roughly 100pt on an iPhone — and its last row sits under the raised circle
// AND under the bar.
//
// The 2026-09-07 sweep applied the flat padding to 24 screens and got this
// wrong on seven of them (data-export, generative-setup, invoice, lead-detail,
// plan-intelligence, qbo-review, schedule-review) while its own KNOWN_GAPS
// comment described the correct fix. Check 3 passed all seven. So the rule is
// mechanical now: whatever expression is handed to useBrainFabLift must appear
// VERBATIM in a paddingBottom next to BRAIN_FAB_CLEARANCE. Name it once —
//
//   const fabLift = showBar ? bottomBarH : 0;
//   useBrainFabLift(fabLift);
//   contentContainerStyle={{ paddingBottom: insets.bottom + fabLift + BRAIN_FAB_CLEARANCE }}
//
// — and the two can no longer drift apart.

/**
 * Screens whose lifted bar is a FLEX SIBLING below the scroll container, not an
 * absolute overlay. There the container already stops at the bar's top edge, so
 * the lift is exactly cancelled and adding it to the padding would double-count
 * it. Verified by reading the bar's style, not assumed.
 */
const LIFT_ABOVE_SCROLL: ReadonlySet<string> = new Set([
  'messages',   // styles.inputBar — plain flex row, no `position: absolute`.
]);

/**
 * Lifted screens that still pad for the FAB alone. Owned by other waves on
 * 2026-09-07; four of them are already in KNOWN_GAPS above for the simpler
 * reason. May only SHRINK — the fix is the three-line `fabLift` shape above.
 */
const LIFT_GAPS: ReadonlySet<string> = new Set([
  'aia-pay-app', 'bill-from-estimate', 'change-order', 'takeoff-estimate',
  '(tabs)/estimate/review', '(tabs)/estimate/full',
]);

const liftOffenders: string[] = [];
let lifted = 0;

for (const file of walk('app')) {
  const route = relative('app', file).replace(/\.tsx$/, '');
  if (route.endsWith('_layout')) continue;
  const src = readFileSync(file, 'utf8');
  // The argument, balanced to the closing paren of the call. Ternaries and
  // member access are all fine; nested parens are not, and no call site has any.
  const arg = src.match(/useBrainFabLift\(([^()\n]*(?:\([^()]*\)[^()\n]*)*)\)/)?.[1]?.trim();
  if (!arg || arg === '0') continue;
  lifted++;
  if (LIFT_ABOVE_SCROLL.has(route)) continue;
  // Same expression, in a paddingBottom that also clears the FAB.
  const padded = new RegExp(
    'paddingBottom:[^,}\\n]*\\b' + arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '\\b[^,}\\n]*BRAIN_FAB_CLEARANCE').test(src);
  if (!padded && !LIFT_GAPS.has(route)) liftOffenders.push(`${route}  (lift: ${arg})`);
}

ok(`${lifted} screens lift the FAB over a sticky bar; each pads for the bar too`,
  liftOffenders.length === 0,
  liftOffenders.length
    ? `${liftOffenders.length} screen(s) lift the FAB but pad only for its resting position:\n      ` +
      liftOffenders.join('\n      ') +
      `\n      Name the height once and use it in both:` +
      `\n        const fabLift = <the same expression>;` +
      `\n        useBrainFabLift(fabLift);` +
      `\n        paddingBottom: insets.bottom + fabLift + BRAIN_FAB_CLEARANCE`
    : '');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
