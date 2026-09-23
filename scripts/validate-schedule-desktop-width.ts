// scripts/validate-schedule-desktop-width.ts — the schedule's card views stay a
// readable column on a desktop browser (founder, 2026-09-23: "when doing the
// schedules or picking a subtab the boxes are so stretched out and it looks
// terrible").
//
// MEASURED ON app.mageid.app (2056px window, Schedule tab › Today): the routed
// content is 1400 wide and every card in it was 1,368px — a one-line
// "SIMULATED WEATHER" banner 1,368 × 54, an empty-state card 1,368 × 115.
// Schedule Pro is full-bleed, so its Dashboard's four flex:1 stat tiles and
// its Board's four columns stretched across the whole monitor.
//
// THE RULE (constants/designTokens ContentWidth): stacked cards / single-
// column lists sit in a centred column of ContentWidth.reading; a kanban in
// one of ContentWidth.board; timelines and grids (Gantt, List, Workload) keep
// the full width. Each column is `width: 100%` under its cap, so phones,
// tablets and narrow windows are unchanged. Applying exactly this style to
// the live Today view's scroll content (2026-09-23) gave a 1,040px column
// centred to the pixel at 2056, and 100% with no horizontal scroll at 1440
// and 1280.
//
// This is a SOURCE guard: styles are not observable from bun without a
// renderer. It pins each cap to the element that owns the stretch, and pins
// that the Gantt / grid did NOT get one.
//
// Run via: bun run scripts/validate-schedule-desktop-width.ts

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra: unknown = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra !== '' ? `\n      ${JSON.stringify(extra)}` : ''); }
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
/** Comments stripped, so a cap described in a comment never satisfies a check. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

// designTokens imports react-native (Platform), which bun cannot load — read
// the literal instead.
const tokens = code('constants/designTokens.ts');
const cw = /export const ContentWidth = \{\s*reading:\s*(\d+),\s*board:\s*(\d+),\s*\} as const;/.exec(tokens);
const ContentWidth = { reading: Number(cw?.[1] ?? NaN), board: Number(cw?.[2] ?? NaN) };

console.log('\nthe widths:');
ok('ContentWidth is declared', !!cw);
ok('reading column is a reading width (960-1100)', ContentWidth.reading >= 960 && ContentWidth.reading <= 1100, ContentWidth);
ok('board column is wider than reading and inside the 1400 routed content', ContentWidth.board > ContentWidth.reading && ContentWidth.board <= 1400, ContentWidth);
ok('exposed on the Tokens barrel', /contentWidth:\s*ContentWidth,/.test(tokens));

console.log('\nclassic Schedule tab, desktop branch (app/(tabs)/schedule/index.tsx):');
{
  const src = code('app/(tabs)/schedule/index.tsx');
  const desktopAt = src.indexOf('if (layout.isDesktop && hasScheduleData && activeSchedule)');
  const desktop = src.slice(desktopAt, src.indexOf('{renderDesktopStatusBar()}', desktopAt));
  ok('the desktop branch is where it was', desktopAt > 0 && desktop.length > 0);
  const colStyle = /readingColumn:\s*\{\s*width:\s*'100%'[^}]*maxWidth:\s*ContentWidth\.reading,[^}]*alignSelf:\s*'center'/.test(src);
  ok('readingColumn = width 100%, maxWidth ContentWidth.reading, centred', colStyle);
  ok('Today / Lookahead / Resources / Summary scroll in the column (not the Gantt)',
    /contentContainerStyle=\{\[\{ paddingBottom: 60 \}, viewMode !== 'gantt' \? desktopStyles\.readingColumn : null\]\}/.test(desktop));
  const board = desktop.slice(desktop.indexOf('<FlatList'), desktop.indexOf('/>', desktop.indexOf('<FlatList')));
  ok('the Board list scrolls in the column', /contentContainerStyle=\{\[\{ paddingBottom: 60 \}, desktopStyles\.readingColumn\]\}/.test(board), board.slice(0, 200));
  ok('the start bar lines up with the cards (column unless Gantt)', /<View style=\{viewMode !== 'gantt' \? desktopStyles\.readingColumn : null\}>\s*<View\s+style=\{\[styles\.projectStartBar/.test(desktop));
  ok('the Gantt wrapper itself carries no cap', !/ganttWrapper[^\n]*readingColumn/.test(desktop));
}

console.log('\nSchedule Pro sub-tabs (components/schedule/tabs/*):');
{
  const dash = code('components/schedule/tabs/DashboardTab.tsx');
  ok('Dashboard: its scroll content (stat tiles, charts, critical list) is a centred reading column',
    /content:\s*\{[^}]*width:\s*'100%'[^}]*maxWidth:\s*ContentWidth\.reading[^}]*alignSelf:\s*'center'/.test(dash)
    && /<ScrollView style=\{styles\.root\} contentContainerStyle=\{styles\.content\}>/.test(dash));
  const boardTab = code('components/schedule/tabs/BoardTab.tsx');
  ok('Board: the four status columns sit in a centred board-width row',
    /\broot:\s*\{[^}]*flexDirection:\s*'row'[^}]*width:\s*'100%'[^}]*maxWidth:\s*ContentWidth\.board[^}]*alignSelf:\s*'center'/.test(boardTab));
  for (const f of ['GanttTab', 'ListTab', 'WorkloadTab']) {
    ok(`${f} keeps the full width (a timeline / grid, not cards)`, !/ContentWidth/.test(code(`components/schedule/tabs/${f}.tsx`)));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
