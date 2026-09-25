// validate-schedule-classic.ts — the classic Schedule tab on desktop, the ways
// into the schedule, and the schedule tool sheets (wave 6c, lane DC).
//
// WHY. The founder, on a 1512 × 945 MacBook: "when doing the schedules or
// picking a subtab the boxes are so stretched out and it looks terrible".
// Measured on the classic tab: a 260 px chip strip, a flex:1 row of view tabs,
// a 56 px phone FAB, 1,368 px cards, full-width edit sheets with 1,000 px
// number boxes; the ways into Pro took three clicks. This pins:
//   1. utils/scheduleRoute — where a schedule link lands (Pro on desktop web
//      when Pro's own gate opens the job AND its grid fits the window, the
//      classic tab everywhere else) and when the classic tab hands an arrival
//      to Pro; plus the Board's desktop chunking and the
//      classic Gantt's px-per-day (pure, executed here);
//   2. the classic tab's desktop branch (source): no reading column or
//      ContentWidth, no 260 px header strip, a SegmentedControl for the views,
//      a '+ Task' Button instead of the 56 px FAB, TodayView / LookaheadView
//      layout='desktop' ONLY from the desktop branch, the four D6 sheets
//      framed, the Redirect;
//   3. GanttChart keeps its default width formula for every caller that
//      passes no viewport;
//   4. each of the 13 schedule tool sheets frames (or dialog-scopes) every
//      Modal it renders, the Sheet.tsx way;
//   5. schedule-review fits Pro by scheduleProFits and uses ActionBar;
//      discover/schedule routes through scheduleDestination and keeps 6a's
//      552 column; schedule-wizard's dialogs are framed.
//
// Run via: bun scripts/validate-schedule-classic.ts   (test:schedule-classic)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scheduleDestination, classicRedirect, routedTaskKey, chunkBoardRows, ganttPxPerDay,
  proFitsWindow, canOpenSchedulePro, SCHEDULE_PRO_FEATURE,
  GANTT_CHROME, GANTT_MIN_PX_PER_DAY, GANTT_MAX_PX_PER_DAY,
  type BoardChunk,
} from '../utils/scheduleRoute';
import { resolveProjectAccess } from '../utils/collaboratorAccess';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); return; }
  fail++;
  console.error(`  FAIL  ${name}${detail === undefined ? '' : `\n        ${JSON.stringify(detail)}`}`);
}
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Comments blanked (strings and line breaks kept), so a commented-out line
 *  never passes. A small scanner, not a regex: a `/*` inside a line comment or
 *  a string must not open a block. */
function stripComments(src: string): string {
  const out = src.split('');
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  const blank = (at: number) => { if (out[at] !== '\n') out[at] = ' '; };
  for (let i = 0; i < src.length;) {
    const two = src.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; blank(i); blank(i + 1); i += 2; continue; }
      if (two === '/*') { mode = 'block'; blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === "'") mode = 'sq';
      else if (src[i] === '"') mode = 'dq';
      else if (src[i] === '`') mode = 'tpl';
      i++; continue;
    }
    if (mode === 'line') { if (src[i] === '\n') mode = 'code'; else blank(i); i++; continue; }
    if (mode === 'block') {
      if (two === '*/') { mode = 'code'; blank(i); blank(i + 1); i += 2; continue; }
      blank(i); i++; continue;
    }
    if (src[i] === '\\') { i += 2; continue; }
    if ((mode === 'sq' && src[i] === "'") || (mode === 'dq' && src[i] === '"') || (mode === 'tpl' && src[i] === '`')) mode = 'code';
    i++;
  }
  return out.join('');
}
const code = (rel: string) => stripComments(read(rel));
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ═══ 1. utils/scheduleRoute (pure) ═══════════════════════════════════════════
console.log('\nscheduleDestination — where a schedule link lands:');
{
  const pro = scheduleDestination({ projectId: 'p1', webDesktop: true, canPro: true, proFits: true, taskId: 't9', editSeed: 'add', focus: 'n1' });
  ok('desktop web + Pro → /schedule-pro with projectId, taskId, editSeed, focus',
    eq(pro, { pathname: '/schedule-pro', params: { projectId: 'p1', taskId: 't9', editSeed: 'add', focus: 'n1' } }), pro);
  const proBare = scheduleDestination({ projectId: 'p1', webDesktop: true, canPro: true, proFits: true });
  // Object.keys, not JSON: JSON.stringify drops an undefined key, which is
  // exactly the key expo-router would write as ?taskId=undefined.
  ok('…and writes no empty keys (no ?taskId=undefined)', Object.keys(proBare.params).join() === 'projectId', Object.keys(proBare.params));
  const classicBare = scheduleDestination({ projectId: 'p1', webDesktop: false, canPro: false, proFits: false, focus: 'f1' });
  ok('…nor does the classic href', Object.keys(classicBare.params).join() === 'projectId,focus', Object.keys(classicBare.params));
  const redirBare = classicRedirect({ routeProjectId: 'p1', routeFocus: 'n1', webDesktop: true, canPro: true, proFits: true });
  ok('…nor does the redirect', redirBare !== null && Object.keys(redirBare.params).join() === 'projectId,focus', redirBare);
  const phone = scheduleDestination({ projectId: 'p1', webDesktop: false, canPro: true, proFits: false }, 1234);
  ok('phone (webDesktop false) → the classic tab with projectId + a focus nonce — what it always got',
    eq(phone, { pathname: '/(tabs)/schedule', params: { projectId: 'p1', focus: '1234' } }), phone);
  const free = scheduleDestination({ projectId: 'p1', webDesktop: true, canPro: false, proFits: true, taskId: 't9', editSeed: 'x', focus: 'n2' });
  ok('free tier on desktop web → the classic tab, taskId / editSeed / focus passed through',
    eq(free, { pathname: '/(tabs)/schedule', params: { projectId: 'p1', focus: 'n2', editSeed: 'x', taskId: 't9' } }), free);
  ok('a given focus is kept, not re-minted', scheduleDestination({ projectId: 'p', webDesktop: false, canPro: false, proFits: false, focus: 'f' }, 99).params.focus === 'f');
  ok('an empty focus is re-minted (a nonce is always present on the classic tab)',
    scheduleDestination({ projectId: 'p', webDesktop: false, canPro: false, proFits: false, focus: '' }, 77).params.focus === '77');
  // Fix round 1: Pro in a window too narrow for its grid shows the narrow
  // gate, whose "Open classic schedule" lands back on the classic tab.
  const narrow = scheduleDestination({ projectId: 'p1', webDesktop: true, canPro: true, proFits: false, taskId: 't9', focus: 'n3' });
  ok('desktop web + Pro, but Pro does not fit the window → the classic tab (taskId / focus kept), never Pro\'s narrow gate',
    eq(narrow, { pathname: '/(tabs)/schedule', params: { projectId: 'p1', focus: 'n3', taskId: 't9' } }), narrow);
}

console.log('\nproFitsWindow — Pro\'s own narrow-gate sum:');
{
  const DEFAULT_PREF = { canvas: true, workspace: false };
  const PINNED_OPEN = { canvas: false, workspace: false };
  ok('1512 desktop web, the 64 px rail → fits', proFitsWindow(1512, true, DEFAULT_PREF) === true);
  ok('963 desktop web, the rail (899 left) → does not fit', proFitsWindow(963, true, DEFAULT_PREF) === false);
  ok('964 desktop web, the rail (900 left) → fits (the boundary is GRID_BREAKPOINT inclusive)', proFitsWindow(964, true, DEFAULT_PREF) === true);
  ok('1100 desktop web, the full 240 sidebar pinned open on canvas routes (860 left) → does not fit', proFitsWindow(1100, true, PINNED_OPEN) === false);
  ok('the same 1100 with the rail → fits', proFitsWindow(1100, true, DEFAULT_PREF) === true);
  ok('off desktop web the whole window counts: 900 → fits, 390 → does not', proFitsWindow(900, false, PINNED_OPEN) === true && proFitsWindow(390, false, DEFAULT_PREF) === false);
}

console.log('\ncanOpenSchedulePro — Pro\'s own gate, without the hook:');
{
  ok('own tier allows → opens, on his own job (no stamped seat)', canOpenSchedulePro(true, undefined) === true);
  ok('free tier, his own job → does not open', canOpenSchedulePro(false, undefined) === false);
  ok('free tier, invited as field / editor → opens (the collaborator grant, #91)',
    canOpenSchedulePro(false, 'field') === true && canOpenSchedulePro(false, 'editor') === true);
  ok('it is resolveProjectAccess on the feature Pro gates on', SCHEDULE_PRO_FEATURE === 'schedule_gantt_pdf'
    && canOpenSchedulePro(false, 'viewer') === resolveProjectAccess(false, 'viewer', 'schedule_gantt_pdf')
    && canOpenSchedulePro(false, 'owner') === resolveProjectAccess(false, 'owner', 'schedule_gantt_pdf'));
}

console.log('\nclassicRedirect — when the classic tab hands an arrival to Pro:');
{
  const base = { routeProjectId: 'p1', routeFocus: 'n1', webDesktop: true, canPro: true, proFits: true } as const;
  ok('phone / native / tablet (webDesktop false) → stays', classicRedirect({ ...base, webDesktop: false }) === null);
  ok('free tier (!canPro) → stays', classicRedirect({ ...base, canPro: false }) === null);
  ok('Pro does not fit the window (!proFits) → stays: Pro\'s narrow gate would send the GC straight back (the loop)',
    classicRedirect({ ...base, proFits: false }) === null);
  ok('no routed job → stays', classicRedirect({ ...base, routeProjectId: undefined }) === null);
  ok('?classic=<same focus> (Pro\'s classic link) → stays', classicRedirect({ ...base, classic: 'n1' }) === null);
  ok('no focus and no classic → stays (no arrival nonce to act on)', classicRedirect({ ...base, routeFocus: undefined }) === null);
  const stale = classicRedirect({ ...base, classic: 'n0' });
  ok('a stale classic nonce does not pin a NEW arrival → Pro', stale?.pathname === '/schedule-pro', stale);
  const full = classicRedirect({ ...base, taskId: 't9', editSeed: 'add three tasks' });
  ok('taskId, editSeed and focus pass through to Pro',
    eq(full, { pathname: '/schedule-pro', params: { projectId: 'p1', taskId: 't9', editSeed: 'add three tasks', focus: 'n1' } }), full);
  ok('a desktop-web Pro arrival with a job → Pro', classicRedirect(base)?.pathname === '/schedule-pro');
  ok('routedTaskKey is one key per arrival', routedTaskKey('p', 'n', 't') === 'p:n:t' && routedTaskKey('p', undefined, 't') === 'p::t');
}

console.log('\nchunkBoardRows — the Board on desktop:');
{
  type R = { kind: 'phase' | 'task'; key: string };
  const ph = (k: string): R => ({ kind: 'phase', key: `phase:${k}` });
  const tk = (k: string): R => ({ kind: 'task', key: `task:${k}` });
  const rows: R[] = [ph('A'), tk('1'), tk('2'), tk('3'), tk('4'), ph('B'), tk('5'), ph('C'), ph('D'), tk('6'), tk('7')];
  const out = chunkBoardRows(rows, 3);
  const shape = out.map((r) => (r.kind === 'tasks' ? `[${(r as BoardChunk<R>).rows.map((x) => x.key.slice(5)).join(',')}]` : r.key));
  ok('each phase\'s cards are cut into rows of `cols`, phase rows stay in place',
    eq(shape, ['phase:A', '[1,2,3]', '[4]', 'phase:B', '[5]', 'phase:C', 'phase:D', '[6,7]']), shape);
  // Every chunk's cards sit between the same two phase rows: walk the output
  // and check each chunk is contiguous with the task rows of ONE phase.
  const phaseOf = new Map<string, string>();
  { let cur = ''; for (const r of rows) { if (r.kind === 'phase') cur = r.key; else phaseOf.set(r.key, cur); } }
  ok('no chunk spans two phases', out.every((r) => r.kind !== 'tasks'
    || new Set((r as BoardChunk<R>).rows.map((x) => phaseOf.get(x.key))).size === 1));
  ok('every task row appears exactly once, in order',
    out.flatMap((r) => (r.kind === 'tasks' ? (r as BoardChunk<R>).rows : r.kind === 'task' ? [r] : [])).map((r) => r.key).join() === rows.filter((r) => r.kind === 'task').map((r) => r.key).join());
  ok('chunk keys are stable and unique', new Set(out.map((r) => r.key)).size === out.length);
  ok('cols < 1 (before the first layout) is one card per row', chunkBoardRows(rows, 0).filter((r) => r.kind === 'tasks').length === 7);
  ok('a collapsed board (phases only) passes through', eq(chunkBoardRows([ph('A'), ph('B')], 3), [ph('A'), ph('B')]));
}

console.log('\nganttPxPerDay — the classic Gantt sized to its panel:');
{
  ok('no viewport → null (the chart keeps its default formula)', ganttPxPerDay(undefined, 60) === null && ganttPxPerDay(0, 60) === null);
  ok('no days → null', ganttPxPerDay(1000, 0) === null);
  ok('fits the panel between the clamps: (1200 − 200) / 60 ≈ 16.7', Math.abs((ganttPxPerDay(1200, 60) ?? 0) - 1000 / 60) < 1e-9);
  ok('a short job caps at 24 px a day', ganttPxPerDay(1200, 10) === GANTT_MAX_PX_PER_DAY);
  ok('a long job floors at 8 px a day (it scrolls)', ganttPxPerDay(1200, 400) === GANTT_MIN_PX_PER_DAY);
  ok('the chrome is the 200 of the default formula', GANTT_CHROME === 200);
}

// ═══ 2. the classic tab ══════════════════════════════════════════════════════
console.log('\nthe classic tab (app/(tabs)/schedule/index.tsx):');
const TAB = 'app/(tabs)/schedule/index.tsx';
const tab = code(TAB);
const deskStart = tab.indexOf('if (layout.isDesktop && hasScheduleData && activeSchedule) {');
const deskEnd = tab.indexOf('const scheduleScrollHeader = (');
const desk = deskStart >= 0 && deskEnd > deskStart ? tab.slice(deskStart, deskEnd) : '';
const rest = desk ? tab.slice(0, deskStart) + tab.slice(deskEnd) : tab;
ok('the desktop branch is where this guard expects it', desk.length > 2000);
ok('no reading column and no ContentWidth anywhere in the tab', !/readingColumn/.test(tab) && !/\bContentWidth\b/.test(tab));
ok('desktopHeaderLeft is gone (no fixed width: 260 strip)', !/desktopHeaderLeft/.test(tab) && !/\bwidth:\s*260\b/.test(tab));
ok('the project switcher opens the Select Project dialog, 200–360 wide and 36 high',
  /testID="schedule-project-switcher"/.test(desk) && /onPress=\{\(\) => setIsProjectPickerOpen\(true\)\}/.test(desk)
  && /projectSwitcher:\s*\{[^}]*minWidth: Layout\.field\.sm,[^}]*maxWidth: Layout\.field\.md,[^}]*height: Layout\.control\.sm \+ 4,/.test(tab));
ok('the view tabs are a SegmentedControl over the four views',
  /<SegmentedControl\s+options=\{DESKTOP_VIEW_OPTIONS\}\s+value=\{viewMode\}/.test(desk)
  && /DESKTOP_VIEW_OPTIONS: SegmentedOption<ScheduleViewMode>\[\] = \[\s*\{ value: 'today'[\s\S]*?value: 'lookahead'[\s\S]*?value: 'board'[\s\S]*?value: 'gantt'/.test(tab)
  && !/styles\.viewTabBar/.test(desk));
ok('a \'+ Task\' Button (size md, desktopCta) replaces the 56 px FAB on desktop',
  /<Button\s+label="\+ Task"\s+size="md"[\s\S]{0,200}style=\{desktopCta\}/.test(desk) && !/styles\.fab\b/.test(desk));
ok('TodayView and LookaheadView get layout="desktop" ONLY from the desktop branch',
  (desk.match(/layout="desktop"/g) ?? []).length === 2 && !/layout="desktop"/.test(rest)
  && /<TodayView[^>]*layout="desktop"/.test(desk) && /<LookaheadView[^>]*layout="desktop"/.test(desk));
ok('the Gantt in the desktop branch is sized to the measured main panel; the tablet\'s is not',
  /<GanttChart [^>]*viewportWidth=\{mainPanelW > 32 \? mainPanelW - 32 : undefined\}/.test(desk) && !/viewportWidth=/.test(rest)
  && /<View style=\{desktopStyles\.mainPanel\} onLayout=\{onMainPanelLayout\}[^>]*>/.test(desk));
ok('the Board on desktop renders TileGrid chunks (chunkBoardRows × tileGridForPreset content)',
  /data=\{boardRows\}\s+keyExtractor=\{boardRowKey\}\s+renderItem=\{renderDesktopBoardRow\}/.test(desk)
  && /if \(!chunk\) return null;/.test(tab)
  && /chunkBoardRows\(boardRows, boardCols\)/.test(tab) && /tileGridForPreset\(Math\.max\(0, mainPanelW - 32\), 'content'\)\.cols/.test(tab)
  && /<TileGrid\s+preset="content"/.test(tab));
{
  const frames = [
    ['Select Project (dialog)', /const fPicker = useSheetFrame\('dialog', \{ visible: isProjectPickerOpen, animationType: 'fade' \}\);/],
    ['Quick Add (form)', /const fQuickAdd = useSheetFrame\('form', \{ visible: isQuickAddOpen, animationType: 'slide' \}\);/],
    ['task detail (form)', /const fDetail = useSheetFrame\('form', \{ visible: taskDetailModal !== null, animationType: 'fade' \}\);/],
    ['Edit Task (form)', /const fEdit = useSheetFrame\('form', \{ visible: isEditModalOpen, animationType: 'slide' \}\);/],
  ] as const;
  for (const [name, re] of frames) ok(`the ${name} sheet takes a frame`, re.test(tab));
  ok('…applied: picker, quick add and detail in the desktop branch, Edit Task in the shared sheets',
    /\[styles\.modalCard, fPicker\.card\]/.test(desk) && /\[styles\.bottomSheet, \{ paddingBottom: insets\.bottom \+ 16 \}, fQuickAdd\.card\]/.test(desk)
    && /\[styles\.modalCard, \{ maxHeight: '85%' \}, fDetail\.card\]/.test(desk)
    && /\[styles\.bottomSheet, \{ paddingBottom: insets\.bottom \+ 16 \}, fEdit\.card\]/.test(tab)
    && /contentContainerStyle=\{\[\{ flexGrow: 1, justifyContent: 'flex-end' as const \}, fEdit\.scrollContent\]\}/.test(tab));
  ok('Edit Task: Duration and Crew Size are field-sized on desktop; Cancel/Save sit in the frame footer',
    (tab.match(/\[styles\.input, layout\.isDesktop && \(desktopField\('xs'\) as TextStyle\)\]/g) ?? []).length === 2
    && /\[styles\.editActionRow, fEdit\.footer\]/.test(tab) && (tab.match(/fEdit\.footerButton/g) ?? []).length === 2);
  ok('Quick Add and Edit Task save on Cmd/Ctrl+Enter', /useSheetPrimaryHotkey\(isQuickAddOpen, handleQuickAdd\);/.test(tab) && /useSheetPrimaryHotkey\(isEditModalOpen, handleEditSave\);/.test(tab));
  ok('the task detail\'s progress is a numeric SegmentedControl on desktop',
    /<SegmentedControl\s+variant="numeric"\s+options=\{PROGRESS_OPTIONS\}/.test(desk));
}
ok('ScheduleTabRoute redirects a desktop-web Pro arrival once (classicRedirect → <Redirect>)',
  /const pro = classicRedirect\(\{/.test(tab) && /if \(toPro && pro\) return <Redirect href=\{pro\} \/>;/.test(tab)
  && /webDesktop = useIsDesktopWeb\(\)/.test(tab)
  && /canPro: canOpenSchedulePro\(canAccess\(SCHEDULE_PRO_FEATURE\), projects\.find\(p => p\.id === projectId\)\?\.myRole\),/.test(tab)
  && /proFits: proFitsWindow\(layout\.width, webDesktop, getSidebarRail\(\)\.pref\),/.test(tab));
ok('…and a phone still gets MobileScheduleScreen first when there is no redirect',
  /return layout\.isPhone\s*\? <MobileScheduleScreen consumedFocusRef=\{consumedFocusRef\} \/>/.test(tab));
ok('?taskId opens that task\'s detail once per arrival, on desktop, when the schedule has it',
  /if \(layout\.isDesktop && routeProjectId && routeTaskId && selectedProjectId === routeProjectId\) \{/.test(tab)
  && /routedTaskKey\(routeProjectId, routeFocus, routeTaskId\)/.test(tab)
  && /const task = activeSchedule\?\.tasks\.find\(\(t\) => t\.id === routeTaskId\);\s*if \(!task\) return;/.test(tab));
ok('desktop-only extras are gated (phase header, start bar in the desktop branch, empty on-ramp, stats)',
  /layout\.isDesktop && desktopStyles\.phaseHeaderDesktop/.test(tab) && /desktopStyles\.projectStartBarDesktop/.test(desk)
  && /layout\.isDesktop && desktopStyles\.emptyScheduleDesktop/.test(tab) && /layout\.isDesktop && desktopStyles\.topBarStatsDesktop/.test(tab));

console.log('\nTodayView / LookaheadView / GanttChart:');
{
  const today = code('components/schedule/TodayView.tsx');
  ok('TodayView: layout defaults to \'stack\'', /layout = 'stack',/.test(today) && /layout\?: 'stack' \| 'desktop';/.test(today));
  ok('TodayView desktop: a main column capped at the form width and a SIDE_PANEL_MIN rail',
    /if \(isDesktop\) \{/.test(today) && /mainDesktop: \{[^}]*maxWidth: Layout\.page\.form/.test(today) && /railDesktop: \{[^}]*width: SIDE_PANEL_MIN/.test(today));
  ok('TodayView desktop: the outlook is a vertical list; the swipe hint is phone/tablet only; emptyActive has a desktop variant',
    /forecastListDesktop/.test(today) && /activeTasks\.length > 0 && layout === 'stack' && \(/.test(today)
    && /\[s\.emptyActive, isDesktop && s\.emptyActiveDesktop\]/.test(today) && /emptyActiveDesktop: desktopInlineEmpty/.test(today));
  const look = code('components/schedule/LookaheadView.tsx');
  ok('LookaheadView desktop: the weeks sit in a TileGrid \'nav\'; the stack keeps its FlatList',
    /layout = 'stack',/.test(look) && /\{isDesktop \? \(\s*<TileGrid preset="nav"/.test(look) && /<FlatList\s+data=\{weekGroups\}/.test(look));
  const gantt = code('components/schedule/GanttChart.tsx');
  ok('GanttChart: with no viewport the width formula is exactly the old one',
    /const ganttWidth = fitPxPerDay === null\s*\? Math\.max\(SCREEN_WIDTH \* 1\.5, totalDays \* 14 \+ 200\)/.test(gantt)
    && /const fitPxPerDay = ganttPxPerDay\(viewportWidth, totalDays\);/.test(gantt) && /viewportWidth\?: number;/.test(gantt));
}

// ═══ 4. the 13 schedule tool sheets ══════════════════════════════════════════
console.log('\nthe schedule tool sheets frame every Modal they render:');
{
  const SHEETS = [
    'BaselineManagerModal', 'AddTaskModal', 'ClosuresModal', 'CriticalPathPanel', 'COScheduleReflowPreviewModal',
    'ExportSheet', 'QuickBuildModal', 'LevelingPreviewModal', 'PredecessorPicker', 'ScenariosModal',
    'ScheduleAuditModal', 'ScheduleSettingsMenu', 'ScheduleHealthScore',
  ];
  const SIZE: Record<string, string> = {
    PredecessorPicker: 'dialog', ScheduleSettingsMenu: 'dialog',
    CriticalPathPanel: 'wide', LevelingPreviewModal: 'wide', COScheduleReflowPreviewModal: 'wide',
  };
  for (const name of SHEETS) {
    const src = code(`components/schedule/${name}.tsx`);
    const modals = (src.match(/<Modal\b/g) ?? []).length;
    const frames = (src.match(/\buseSheetFrame\(/g) ?? []).length;
    const scopes = (src.match(/\buseSheetDialogScope\(/g) ?? []).length;
    ok(`${name}: ${modals} <Modal, ${frames} frame + ${scopes} dialog scope — one per Modal`, modals > 0 && frames + scopes === modals, { modals, frames, scopes });
    const want = SIZE[name] ?? (name === 'ScenariosModal' ? 'dialog' : 'form');
    ok(`${name}: framed as '${want}'`, new RegExp(`useSheetFrame\\('${want}'`).test(src));
    // A literal slide/fade survives only on a dialog-scoped popover (the frame
    // is what turns a sheet's animation into a desktop fade).
    const literal = (src.replace(/\n\s*/g, ' ').match(/<Modal[^>]*transparent[^>]*animationType="(?:slide|fade)"/g) ?? []).length;
    ok(`${name}: every Modal keeps onRequestClose; every framed one animates by its frame`,
      (src.match(/onRequestClose=/g) ?? []).length >= modals && literal <= scopes, { literal, scopes });
  }
  const scen = code('components/schedule/ScenariosModal.tsx');
  ok('ScenariosModal: the two opaque pageSheets are dialog scopes only; the create dialog takes the recipe',
    /useSheetDialogScope\(visible && !hasAccess\);/.test(scen) && /useSheetDialogScope\(visible && hasAccess\);/.test(scen)
    && /\[styles\.createCard, createFrame\.card\]/.test(scen));
  const co = code('components/schedule/COScheduleReflowPreviewModal.tsx');
  ok('COScheduleReflowPreviewModal: its props are unchanged (project-detail and change-order render it)',
    /export function COScheduleReflowPreviewModal\(props: \{\s*visible: boolean;\s*changeOrder: ChangeOrder;\s*schedule: ProjectSchedule \| null \| undefined;/.test(co)
    && /\{ saveKey: false \}/.test(co));
}

// ═══ 5. the ways in ══════════════════════════════════════════════════════════
console.log('\nthe ways into the schedule:');
{
  const review = code('app/schedule-review.tsx');
  ok('schedule-review: Pro only when scheduleProFits(width, the sidebar Pro will have) and Pro\'s own gate opens (tier OR the seat\'s grant)',
    /scheduleProFits\(width, isDesktopWeb \? sidebarWidthForRoute\('schedule-pro', getSidebarRail\(\)\.pref\) : 0\)\s*&& canOpenSchedulePro\(canAccess\(SCHEDULE_PRO_FEATURE\), project\.myRole\)/.test(review)
    && !/GRID_BREAKPOINT = 900/.test(review));
  ok('schedule-review: the footer buttons sit in an ActionBar (width form); content at Layout.page.form',
    /<ActionBar style=\{\[styles\.footerRow, isDesktop && styles\.footerRowDesktop\]\} width="form">/.test(review)
    && /contentDesktop: \{[^}]*maxWidth: Layout\.page\.form/.test(review) && !/maxWidth: 760/.test(review));
  const disc = code('app/(tabs)/discover/schedule.tsx');
  ok('discover/schedule: openSchedule goes through scheduleDestination with Pro\'s own gate and the window fit',
    /const href = scheduleDestination\(\{\s*projectId,\s*webDesktop,\s*canPro: canOpenSchedulePro\(canAccess\(SCHEDULE_PRO_FEATURE\), projects\.find\(p => p\.id === projectId\)\?\.myRole\),\s*proFits: proFitsWindow\(width, webDesktop, getSidebarRail\(\)\.pref\),\s*\}\);/.test(disc));
  const sum = code('app/(tabs)/summary/index.tsx');
  ok('summary: both schedule links take Pro\'s own gate and the window fit (proRoute)',
    /canPro: canOpenSchedulePro\(canAccess\(SCHEDULE_PRO_FEATURE\), projects\.find\(p => p\.id === projectId\)\?\.myRole\),\s*proFits: proFitsWindow\(width, isDesktopWeb, getSidebarRail\(\)\.pref\),/.test(sum)
    && (sum.match(/\.\.\.proRoute\(projectId\)/g) ?? []).length === 2
    && (sum.match(/scheduleDestination\(\{/g) ?? []).length === 2);
  ok('discover/schedule: keeps 6a\'s 552 column', /existingSection: \{[^}]*maxWidth: 552,/.test(disc));
  const wiz = code('app/schedule-wizard.tsx');
  ok('schedule-wizard: its three dialogs are framed \'dialog\'', (wiz.match(/useSheetFrame\('dialog', \{ visible[^}]*animationType: 'fade' \}\)/g) ?? []).length === 3
    && (wiz.match(/<Modal\b/g) ?? []).length === 3);
  ok('schedule-wizard: steps, top bar and step row in the form column; the two-pane in the dashboard; the left pane at form',
    /columnDesktop: \{[^}]*maxWidth: Layout\.page\.form/.test(wiz) && /desktopTwoPaneRow: \{[^}]*maxWidth: Layout\.page\.dashboard/.test(wiz)
    && /desktopLeftPane: \{[^}]*maxWidth: Layout\.page\.form/.test(wiz) && /stepConnectorDesktop: \{ maxWidth: Layout\.field\.xs \}/.test(wiz));
  ok('schedule-wizard: the bottom CTA is an ActionBar', /<ActionBar style=\{\[styles\.bottomCta, \{ paddingBottom: insets\.bottom \+ 12 \}\]\} width="form">/.test(wiz));
  const sbi = code('components/schedule/ScheduleBuilderInterview.tsx');
  ok('the builder\'s primary buttons hug their labels on desktop', (sbi.match(/\[styles\.primaryBtn, isDesktop && desktopCta\]/g) ?? []).length === 2);
  const hub = code('app/copilot-hub.tsx');
  ok('the hub\'s Paste and Continue hug their labels on desktop', /\[styles\.pasteBtn, isDesktop && desktopCta\]/.test(hub) && /styles\.goBtnDisabled, isDesktop && desktopCta\]/.test(hub));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
