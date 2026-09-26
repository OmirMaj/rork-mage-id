// validate-motion-numbers.ts — the slicker pass, lane B: numbers that count,
// fills that glide, chevrons that rotate.
//
//   bun run scripts/validate-motion-numbers.ts
//
// Text-only (comments stripped). It pins:
//   - TapeRollNumber never counts from 0 on mount (no Animated.Value(0), no
//     useState(0)/useRef(0) seed), honours Reduce Motion, and COUNT_MS ≤ 480;
//   - AnimatedFill clamps to [0, 100], FILL_MS ≤ 360, native-driver scaleX;
//   - no bounciness / friction / bounce / elastic in the three motion files;
//   - every adoption site uses AnimatedFill / CollapseChevron, and no chevron
//     icon-swap ternary survives in the phone schedule list or Gantt.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Strip // and /* *\/ comments (strings with `//` in URLs are not in these files' rules). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passes += 1; return; }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

const TAPE = 'components/animations/TapeRollNumber.tsx';
const FILL = 'components/animations/AnimatedFill.tsx';
const CHEV = 'components/animations/CollapseChevron.tsx';

const tape = stripComments(read(TAPE));
const fill = stripComments(read(FILL));
const chev = stripComments(read(CHEV));

// ── TapeRollNumber ──────────────────────────────────────────────────────────
check('TapeRollNumber: no Animated.Value(0) mount seed', !/new\s+Animated\.Value\(\s*0\s*\)/.test(tape));
check('TapeRollNumber: no useState<number>(0) / useState(0) display seed', !/useState(?:<number>)?\(\s*0\s*\)/.test(tape));
check('TapeRollNumber: no useRef(0) last-value seed', !/useRef(?:<number>)?\(\s*0\s*\)/.test(tape));
check('TapeRollNumber: calls reducedMotion()', /reducedMotion\(\)/.test(tape));
check('TapeRollNumber: exports useCountTo(value, format, maxMs = COUNT_MS)',
  /export function useCountTo\(\s*value: number,\s*format: \(n: number\) => string,\s*maxMs: number = COUNT_MS\s*\)/.test(tape));
const countMs = tape.match(/const COUNT_MS\s*=\s*(\d+)/);
check('TapeRollNumber: COUNT_MS ≤ 480', !!countMs && Number(countMs[1]) <= 480, countMs ? countMs[1] : 'missing');
check('TapeRollNumber: count capped at 480', /Math\.min\(\s*maxMs,\s*COUNT_CAP_MS\s*\)/.test(tape) && /const COUNT_CAP_MS\s*=\s*480\b/.test(tape));
check('TapeRollNumber: ease-out cubic', /1 - Math\.pow\(1 - t, 3\)/.test(tape));
check('TapeRollNumber: jumps without requestAnimationFrame', /typeof requestAnimationFrame !== 'function'/.test(tape));
check('TapeRollNumber: cancels its frame loop', /cancelAnimationFrame\(/.test(tape) && /useEffect\(\(\) => cancel, \[\]\)/.test(tape));
check('TapeRollNumber: a11y label only while counting', /\.\.\.\(counting \? \{ accessibilityLabel: fmt\(value\) \} : \{\}\)/.test(tape));
check('TapeRollNumber: rest style is exactly [styles.text, style]', /: \[styles\.text, style\]\}/.test(tape));
check('TapeRollNumber: default duration is COUNT_MS', /duration = COUNT_MS/.test(tape));

// ── AnimatedFill ────────────────────────────────────────────────────────────
check('AnimatedFill: clamps to [0, 100] (non-finite → 0)',
  /Math\.max\(0, Math\.min\(100, Number\.isFinite\(value\) \? value : 0\)\)/.test(fill));
check('AnimatedFill: the component uses the clamped value', /const v = clampPct\(value\)/.test(fill));
const fillMs = fill.match(/const FILL_MS\s*=\s*(\d+)/);
check('AnimatedFill: FILL_MS ≤ 360', !!fillMs && Number(fillMs[1]) <= 360, fillMs ? fillMs[1] : 'missing');
check('AnimatedFill: arms only on a positive target outside Reduce Motion', /if \(v > 0 && !reducedMotion\(\)\)/.test(fill));
check('AnimatedFill: rest leaf is the plain View', /if \(run === 0\) return <View style=\{style\}/.test(fill));
check('AnimatedFill: scaleX about the left edge', /transformOrigin: 'left', transform: \[\{ scaleX: s \}\]/.test(fill));
check('AnimatedFill: native driver', /useNativeDriver: nativeDriver/.test(fill));

// ── CollapseChevron ─────────────────────────────────────────────────────────
const chevMs = chev.match(/const CHEVRON_MS\s*=\s*(\d+)/);
check('CollapseChevron: CHEVRON_MS ≤ 240', !!chevMs && Number(chevMs[1]) <= 240, chevMs ? chevMs[1] : 'missing');
check('CollapseChevron: icon swap at rest and under Reduce Motion', /if \(!armed \|\| reduced\)/.test(chev));
check('CollapseChevron: rotation layer is non-interactive', /<Animated\.View pointerEvents="none"/.test(chev));
check('CollapseChevron: native driver', /useNativeDriver: nativeDriver/.test(chev));

// ── No bounce anywhere in the new motion ────────────────────────────────────
for (const [name, src] of [[TAPE, tape], [FILL, fill], [CHEV, chev]] as const) {
  check(`${name}: no bounciness/friction/bounce/elastic`, !/bounciness|friction|Easing\.bounce|Easing\.elastic|\bbounce\b|\belastic\b/.test(src));
}

// ── Adoption ────────────────────────────────────────────────────────────────
const SITES: [string, RegExp[]][] = [
  ['app/punch-list.tsx', [
    /<AnimatedFill value=\{progressPercent\} style=\{\[styles\.progressFill, \{ width: `\$\{progressPercent\}%` \}\]\} \/>/,
    /const shownPct = useCountTo\(progressPercent,/,
    /\{shownPct\}%/,
  ]],
  ['components/schedule/mobile/MobileScheduleList.tsx', [
    /<AnimatedFill value=\{pct\} style=\{\[styles\.fill, \{ width: `\$\{pct\}%`/,
    /<CollapseChevron open=\{!item\.collapsed\}/,
  ]],
  ['components/schedule/mobile/MobileGantt.tsx', [/<CollapseChevron open=\{!collapsedPhases\[r\.phase\]\}/]],
  ['components/schedule/mobile/ProgressTab.tsx', [
    /<AnimatedFill value=\{Math\.min\(100, overall\)\} style=\{\[styles\.heroFill, \{ width: `\$\{Math\.min\(100, overall\)\}%` \}\]\}/,
    /<AnimatedFill value=\{Math\.min\(100, p\.pct\)\} style=\{\[styles\.miniFill, \{ width: `\$\{Math\.min\(100, p\.pct\)\}%`/,
    /const shownOverall = useCountTo\(overall,/,
    /\{shownOverall\}%/,
  ]],
  ['app/(tabs)/schedule/index.tsx', [
    /<AnimatedFill value=\{totalProgress\} style=\{\[styles\.overallProgressFill, \{ width: `\$\{totalProgress\}%`/,
    /<AnimatedFill value=\{task\.progress\} style=\{\[styles\.progressFill, \{ width: `\$\{task\.progress\}%`/,
    /<AnimatedFill value=\{task\.progress\} style=\{\[styles\.fieldProgressFill, \{ width: `\$\{task\.progress\}%`/,
  ]],
  ['app/project-detail.tsx', [
    /<AnimatedFill value=\{heroProgress\.pct\} style=\{\{ width: `\$\{heroProgress\.pct\}%`/,
    /<AnimatedFill value=\{punchItems\.length > 0 \?[^}]*\} style=\{\[styles\.punchProgressFill/,
    /<CollapseChevron pair="downUp" open=\{!collapsed\}/,
  ]],
  ['components/portfolio/PortfolioTable.tsx', [
    /const pct = Math\.max\(0, Math\.min\(100, r\.pct\)\);/,
    /<AnimatedFill value=\{pct\} style=\{\[styles\.pctFill, \{ width: `\$\{pct\}%` \}\]\} \/>/,
  ]],
  // ProjectRow keeps the width expression inline: validate-portfolio-row pins
  // `width: \`${Math.min(100, burnPct)}%\`` literally, so the value repeats it.
  ['components/ProjectRow.tsx', [
    /<AnimatedFill\s+value=\{Math\.min\(100, burnPct\)\}\s+style=\{\[\s+styles\.burnFill,\s+\{\s+width: `\$\{Math\.min\(100, burnPct\)\}%`/,
  ]],
];
for (const [rel, pats] of SITES) {
  const src = stripComments(read(rel));
  pats.forEach((p, i) => check(`${rel}: adoption #${i + 1}`, p.test(src), String(p).slice(0, 90)));
}

// The icon-swap ternaries are gone from the phone schedule list and Gantt.
for (const rel of ['components/schedule/mobile/MobileScheduleList.tsx', 'components/schedule/mobile/MobileGantt.tsx']) {
  const src = stripComments(read(rel));
  check(`${rel}: no chevron icon-swap ternary`, !/\?\s*<ChevronRight/.test(src) && !/:\s*<ChevronDown/.test(src));
}

console.info(`\nvalidate-motion-numbers: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
