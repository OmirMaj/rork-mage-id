// smooth-l3-field-guard.ts — the smoothness pass, lane 3 (the field screens).
//
//   bun run scripts/validate-smooth-field.ts
//
// Text-level (these screens import react-native, which bun cannot load). It
// pins what lane 3 wired so a later edit cannot quietly undo it:
//   A. punch list — the adopted sheets rise, the hand-off sheets keep 'slide',
//      the phone item form fades and rises, and rows glide on the line right
//      before each write that removes or re-sections a row.
//   B. time clock — all six sheets rise.
//   C. phone schedule — the phase collapse eases; the project picker rises;
//      the finish sheet (a hand-off) keeps 'slide'.
//   D. Today / Lookahead progress cards — the PanResponder reads the LATEST
//      task and callback (the data-loss fix), feedback before the write, one
//      haptic, a Motion spring, no glow loop.
//   E. the schedule tab's live path is silent only when a card says so.
// The jest half (__tests__/smooth-l3-progress-card.test.tsx) drives the cards.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Strip // and /* *\/ comments and JSX {/* *\/} comments (strings kept). */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}
function between(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? src.slice(i) : src.slice(i, j + end.length);
}
/** The first non-blank code line before the first occurrence of `anchor`. */
function lineBefore(src: string, anchor: string): string {
  const i = src.indexOf(anchor);
  if (i < 0) return '<anchor missing>';
  const lines = src.slice(0, i).split('\n');
  lines.pop(); // the anchor's own line prefix
  for (let k = lines.length - 1; k >= 0; k--) if (lines[k].trim()) return lines[k].trim();
  return '';
}

let failures = 0;
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures += 1; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

// ── A. punch list ──────────────────────────────────────────────────────────
console.log('A. punch list');
{
  const P = code(read('app/punch-list.tsx'));
  for (const f of ['fWalk', 'fFilter', 'fBulkSub']) {
    ok(`${f} opts in to the rise`, new RegExp(`const ${f} = useSheetFrame\\('(form|dialog)', \\{[^}]*animationType: 'slide', rise: true \\}\\)`).test(P));
    ok(`${f}'s card is an Animated.View carrying ${f}.cardMotion`, new RegExp(`<Animated\\.View style=\\{\\[[^\\n]*${f}\\.card, ${f}\\.cardMotion\\]\\}>`).test(P));
  }
  for (const f of ['fTemplates', 'fBulkStatus']) {
    ok(`${f} keeps 'slide' (it closes and presents an Alert in the same tick)`,
      new RegExp(`const ${f} = useSheetFrame\\('(form|dialog)', \\{[^}]*animationType: 'slide' \\}\\)`).test(P) && !new RegExp(`${f}\\.cardMotion`).test(P));
  }
  ok('the item form Modal fades on every layout', /<Modal visible=\{showForm\} transparent animationType="fade"/.test(P));
  ok('the phone item form rises; the split panel does not', /const rForm = useRiseOnOpen\(showForm && editLayout !== 'split'\);/.test(P)
    && /const RisingScrollView = Animated\.createAnimatedComponent\(ScrollView\);/.test(P)
    && /<RisingScrollView style=\{\[\{ flex: 1 \}, rForm\]\}/.test(P));
  ok('glideRows is opacity-only layoutNext, skipped on a long list', /const GLIDE_ROW_LIMIT = 60;/.test(P)
    && /function glideRows\(rowCount: number\): void \{\s*if \(rowCount < GLIDE_ROW_LIMIT\) layoutNext\(\);\s*\}/.test(P));
  ok('rowCountRef follows the rendered rows', /rowCountRef\.current = rows\.length;/.test(P));
  const status = between(P, 'const handleStatusChange = useCallback(', '}, [');
  ok('status change: glideRows on the line before the write',
    lineBefore(status, 'updatePunchItem(item.id, punchStatusPatch(') === 'glideRows(rowCountRef.current);');
  const reject = between(P, 'const handleReject = useCallback(', '}, [');
  ok('reject / reopen: glideRows on the line before the write',
    lineBefore(reject, 'updatePunchItem(itemId, punchStatusPatch(') === 'glideRows(rowCountRef.current);');
  const move = between(P, 'const moveItem = useCallback(', '}, [');
  ok('move to the other list: glideRows on the line before the write',
    lineBefore(move, 'updatePunchItem(item.id, { listType: target });') === 'glideRows(rowCountRef.current);');
  ok('delete: glideRows right before deletePunchItem inside the destructive confirm',
    /\{ text: 'Delete', style: 'destructive', onPress: \(\) => \{ glideRows\(rowCountRef\.current\); latestActions\.current\.deletePunchItem\(item\.id\); \} \}/.test(P));
  const effects = P.split('useEffect(').slice(1).map((s) => s.slice(0, s.indexOf('}, [') + 1));
  ok('glideRows / layoutNext never run from an effect', effects.every((e) => !/glideRows\(|layoutNext\(/.test(e)));
}

// ── B. time clock ───────────────────────────────────────────────────────────
console.log('\nB. time clock');
{
  const T = code(read('app/time-tracking.tsx'));
  for (const f of ['fClockIn', 'fAlert', 'fRates', 'fCorrect', 'fOut', 'fExport']) {
    ok(`${f} rises on an Animated.View card`,
      new RegExp(`const ${f} = useSheetFrame\\('(form|dialog)', \\{[^}]*animationType: 'slide', rise: true \\}\\)`).test(T)
      && new RegExp(`<Animated\\.View style=\\{\\[styles\\.modalCard,[^\\n]*${f}\\.card, ${f}\\.cardMotion\\]\\}>`).test(T)
      && new RegExp(`animationType=\\{${f}\\.animationType\\}`).test(T));
  }
}

// ── C. phone schedule ─────────────────────────────────────────────────────────
console.log('\nC. phone schedule');
{
  const M = code(read('components/schedule/mobile/MobileScheduleScreen.tsx'));
  const toggles = M.match(/onTogglePhase=\{\(p\) => \{[^\n]*\}\}/g) ?? [];
  ok('both phase toggles ease: layoutNext() right before setCollapsed(', toggles.length === 2
    && toggles.every((t) => /\{ layoutNext\(\); setCollapsed\(/.test(t)) && !/onTogglePhase=\{\(p\) => setCollapsed/.test(M));
  const picker = between(M, 'function ProjectPickerSheet(', '\n}\n');
  ok('the project picker fades its scrim and rises its card', /const rise = useRiseOnOpen\(visible\);/.test(picker)
    && /<Modal visible=\{visible\} transparent animationType="fade"/.test(picker)
    && /<Animated\.View style=\{\[styles\.pickerSheet, \{ paddingBottom: insets\.bottom \+ 16 \}, rise\]\} testID="schedule-project-picker">/.test(picker));
  const finish = between(M, 'function FinishDateSheet(', '\n}\n');
  ok('the finish sheet keeps slide (four buttons hand off to another Modal)', /<Modal visible=\{visible\} transparent animationType="slide"/.test(finish)
    && !/useRiseOnOpen/.test(finish));
}

// ── D. the progress cards ────────────────────────────────────────────────────
for (const [file, card] of [['components/schedule/TodayView.tsx', 'SwipeableActiveCard'], ['components/schedule/LookaheadView.tsx', 'SwipeableLookaheadCard']] as const) {
  console.log(`\nD. ${card}`);
  const S = code(read(file));
  const body = between(S, `const ${card} = React.memo(function ${card}(`, '\n  return (');
  ok('a latest ref, refreshed every render', /const latest = useRef\(\{ task, onProgressUpdate, flashGreen \}\);\s*latest\.current = \{ task, onProgressUpdate, flashGreen \};/.test(body));
  const pan = between(body, 'PanResponder.create({', '\n  ).current;');
  ok('the PanResponder reads task / onProgressUpdate / flashGreen only through latest.current',
    pan.length > 0 && !/(^|[^.\w])(task\.|onProgressUpdate\(|flashGreen\()/m.test(pan.replace(/latest\.current\.(task|onProgressUpdate|flashGreen)/g, '').replace(/cur\.(task|flashGreen)/g, '')),
    pan.slice(0, 160));
  ok('the grant takes the start progress from latest.current', /onPanResponderGrant: \(\) => \{\s*startProg\.current = latest\.current\.task\.progress;/.test(pan));
  const rel = between(pan, 'onPanResponderRelease:', 'onPanResponderTerminate:');
  const iHap = rel.search(/Haptics\.(notificationAsync|impactAsync)/);
  const iFlash = rel.indexOf('cur.flashGreen()');
  const iSpring = rel.indexOf('Animated.spring(translateX');
  const iRaf = rel.indexOf('requestAnimationFrame(');
  ok('release: haptic, then flash + spring-back, then the write a frame later',
    iHap >= 0 && iFlash > iHap && iSpring > iHap && iRaf > iFlash && iRaf > iSpring
      && /requestAnimationFrame\(\(\) => latest\.current\.onProgressUpdate\(cur\.task, value, CARD_WRITE\)\)/.test(rel));
  ok('the spring-back is Motion.spring.snap on the native driver — no tension / friction',
    (pan.match(/Animated\.spring\(translateX, \{ toValue: 0, \.\.\.Motion\.spring\.snap, useNativeDriver: nativeDriver \}\)/g) ?? []).length === 2
      && !/tension:|friction:|bounciness:/.test(body));
  const inc = between(body, 'const handleIncrement = useCallback(', '}, [');
  ok('+ tap: haptic, flash, then the write on the next frame',
    /Haptics\.impactAsync[\s\S]*flashGreen\(\);[\s\S]*requestAnimationFrame\(\(\) => latest\.current\.onProgressUpdate\(task, next, CARD_WRITE\)\)/.test(inc)
      && !/[^.]onProgressUpdate\(task/.test(inc.replace(/latest\.current\.onProgressUpdate/g, '')));
  ok('no glow loop', !/Animated\.loop\(/.test(S) && !/readyGlow/.test(S));
  ok('CARD_WRITE is { silent: true }', /const CARD_WRITE: ProgressUpdateOpts = \{ silent: true \};/.test(S));
  ok('the flash runs on the native driver constant, not a literal', !/useNativeDriver: true/.test(body));
}
{
  const S = code(read('components/schedule/TodayView.tsx'));
  const done = between(S, 'const handleComplete = useCallback(', '}, [');
  ok('Today: Done taps haptic first, the write a frame later', /Haptics\.notificationAsync[\s\S]*flashGreen\(\);[\s\S]*requestAnimationFrame\(\(\) => latest\.current\.onProgressUpdate\(task, 100, CARD_WRITE\)\)/.test(done));
}

// ── E. the live path's haptic ────────────────────────────────────────────────
console.log('\nE. schedule tab');
{
  const X = code(read('app/(tabs)/schedule/index.tsx'));
  ok('applyProgressUpdate takes silent and fires its haptic only without it',
    /const applyProgressUpdate = useCallback\(\(task: ScheduleTask, nextProgress: number, live: boolean, silent = false\) =>/.test(X)
      && /if \(!silent && Platform\.OS !== 'web'\) void Haptics\.selectionAsync\(\);\s*\}, \[activeSchedule, saveSchedule/.test(X));
  ok('the live path is silent ONLY when the caller says so',
    /const handleLiveProgressUpdate = useCallback\(\s*\(task: ScheduleTask, nextProgress: number, opts\?: \{ silent\?: boolean \}\) => applyProgressUpdate\(task, nextProgress, true, opts\?\.silent === true\)/.test(X));
  ok('the Gantt path keeps its haptic', /const handleProgressUpdate = useCallback\(\s*\(task: ScheduleTask, nextProgress: number\) => applyProgressUpdate\(task, nextProgress, false\),/.test(X));
}

if (failures > 0) {
  console.log(`\n✗ smooth-l3-field-guard: ${failures} failing check(s)`);
  process.exit(1);
}
console.log('\n✓ smooth-l3-field-guard: the field screens rise, glide and write after the feedback');
