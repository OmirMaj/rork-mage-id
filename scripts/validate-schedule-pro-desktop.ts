// validate-schedule-pro-desktop.ts — the Schedule Pro canvas maths on a desktop
// browser (wave 6c, lane DA), and the source facts behind it.
//
// WHY. The founder, on a 1512 × 945 MacBook: "the scheduler does not work
// well"; "when doing the schedules or picking a subtab the boxes are so
// stretched out and it looks terrible". Measured before this lane: ~9 rows fit,
// the split grid was a flat 38 % and hid Start / Finish / Float, "Fit" assumed
// an 800 px viewport, and the Plan / Track menus opened at a fixed top: 96
// over a dimmed page. The fix is a handful of numbers in
// utils/scheduleProLayout.ts and utils/schedulePreviewOverlay.ts (pure), so
// this executes them, and pins the source lines that would bring the old
// behaviour back.
//
// Run via: bun run scripts/validate-schedule-pro-desktop.ts   (test:schedule-pro-desktop)

import { readFileSync } from 'node:fs';
import {
  DENSITY, DENSITY_STORAGE_KEY, GANTT_FOOTER_STRIP_H, GANTT_SYNC_TAIL, GRID_BREAKPOINT, GRID_GHOST_ROW_H, GRID_MIN,
  GRID_WIDTH_STORAGE_KEY, MORE_VIEWS, PANE, PANE_DOCK_MIN, PRIMARY_VIEWS, SPLIT_COLUMN_WIDTHS, VIEW_LABEL,
  committedGridWidth, dragGridWidth, fitPxPerDay, ganttMaxScroll, gridMaxScroll, isScheduleQuestion, parseDensity,
  parseStoredGrid, proPanes, scheduleInputIntent, scheduleProContentWidth, scheduleProFits, splitGridColumns,
  viewToTab, visibleRows,
} from '../utils/scheduleProLayout';
import { buildSchedulePreviewOverlay, finishDeltaLabel } from '../utils/schedulePreviewOverlay';
import { SIDE_PANEL_DEFAULT, SIDE_PANEL_MIN, SPLIT_DIVIDER } from '../utils/splitViewLayout';
import { runCpm } from '../utils/cpm';
import type { ScheduleTask } from '../types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra: unknown = '') {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra !== '' ? `\n      ${JSON.stringify(extra)}` : ''); }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
/** Comments stripped, so a pin described in a comment never satisfies (or trips) a check. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');

// ─── widths ────────────────────────────────────────────────────────────────
console.log('\nproPanes — the work row W (window minus rail; a docked pane INCLUDED):');
{
  const pick = (p: ReturnType<typeof proPanes>) => ({ grid: p.grid, gantt: p.gantt, pane: p.pane, paneMode: p.paneMode });
  // 1512 MacBook → W 1448.
  ok('1448 closed: 520 | 920', eq(pick(proPanes(1448)), { grid: 520, gantt: 920, pane: 0, paneMode: 'closed' }), pick(proPanes(1448)));
  ok('1448 pane open: docks, 400 | 600 | 440', eq(pick(proPanes(1448, { paneOpen: true })), { grid: 400, gantt: 600, pane: 440, paneMode: 'dock' }), pick(proPanes(1448, { paneOpen: true })));
  // 2560 monitor → W 2496: the default grid stops at 640, the timeline takes the rest.
  ok('2496 closed: 640 | 1848', eq(pick(proPanes(2496)), { grid: 640, gantt: 1848, pane: 0, paneMode: 'closed' }), pick(proPanes(2496)));
  ok('2496 pane open: 640 | 1408 | 440', eq(pick(proPanes(2496, { paneOpen: true })), { grid: 640, gantt: 1408, pane: 440, paneMode: 'dock' }), pick(proPanes(2496, { paneOpen: true })));
  // 1366 laptop → W 1302. The spec's worked value read 469 / 825 — W·0.36 =
  // 468.72 WITHOUT the round8 its own formula states; round8 gives 472 (and
  // 1448 → 520 only holds WITH round8). One rule for every width: round8.
  ok('1302 closed: 472 | 822 (round8(468.72))', eq(pick(proPanes(1302)), { grid: 472, gantt: 822, pane: 0, paneMode: 'closed' }), pick(proPanes(1302)));
  ok('1302 pane open: still docks (≥ 1288), grid floors at 360: 360 | 494 | 440', eq(pick(proPanes(1302, { paneOpen: true })), { grid: 360, gantt: 494, pane: 440, paneMode: 'dock' }), pick(proPanes(1302, { paneOpen: true })));
  // Under 1288 the pane floats over the timeline and the grid does not move.
  ok('1216 closed: 440 | 768', eq(pick(proPanes(1216)), { grid: 440, gantt: 768, pane: 0, paneMode: 'closed' }), pick(proPanes(1216)));
  ok('1216 pane open: OVERLAYS, grid unchanged 440 | 768', eq(pick(proPanes(1216, { paneOpen: true })), { grid: 440, gantt: 768, pane: 440, paneMode: 'overlay' }), pick(proPanes(1216, { paneOpen: true })));
  ok('1287 overlays, 1288 docks', proPanes(1287, { paneOpen: true }).paneMode === 'overlay' && proPanes(1288, { paneOpen: true }).paneMode === 'dock');
  // A dragged (stored) grid may go past the 640 default cap, up to 900.
  ok('stored 800 at 1448: 800 | 640', eq(pick(proPanes(1448, { storedGrid: 800 })), { grid: 800, gantt: 640, pane: 0, paneMode: 'closed' }));
  ok('stored 2000 at 2496: capped at GRID_MAX 900', proPanes(2496, { storedGrid: 2000 }).grid === 900);
  ok('stored 2000 at 1448: capped at 900 (under W − 488 = 960)', proPanes(1448, { storedGrid: 2000 }).grid === 900);
  ok('stored 2000 at 1300: capped so the timeline keeps 480 (812)', proPanes(1300, { storedGrid: 2000 }).grid === 812 && proPanes(1300, { storedGrid: 2000 }).gantt === 480);
  ok('stored 100: floored at GRID_MIN 360', proPanes(1448, { storedGrid: 100 }).grid === 360);
  ok('a stored garbage value is ignored', proPanes(1448, { storedGrid: Number.NaN }).grid === 520);
  ok('grid + divider + gantt (+ docked pane) always equals W', [1216, 1288, 1302, 1448, 1700, 2496].every((W) =>
    [false, true].every((paneOpen) => { const p = proPanes(W, { paneOpen }); return p.grid + SPLIT_DIVIDER + p.gantt + (p.paneMode === 'dock' ? p.pane : 0) === W; })));
  ok('PANE = SIDE_PANEL_DEFAULT = 440; GRID_MIN = SIDE_PANEL_MIN = 360', PANE === SIDE_PANEL_DEFAULT && PANE === 440 && GRID_MIN === SIDE_PANEL_MIN && GRID_MIN === 360);
  ok('PANE_DOCK_MIN = 360 + 8 + 480 + 440 = 1288', PANE_DOCK_MIN === 1288);
  ok('dragGridWidth clamps to [360, min(900, W − 488)]', dragGridWidth(520, 80, 1448) === 600 && dragGridWidth(520, -400, 1448) === 360 && dragGridWidth(520, 900, 1448) === 900 && dragGridWidth(520, 900, 1300) === 812);
  // What a divider drag SAVES is what it SHOWED. Docked, the pane caps the grid
  // at W − 1048 (400 at 1448): a drag past the cap keeps the cap, so closing
  // the pane never jumps the grid to a width he never saw.
  ok('committedGridWidth docked at 1448: +200 from 400 keeps 400 (the cap), −20 keeps 380',
    committedGridWidth(400, 200, 1448, true) === 400 && committedGridWidth(400, -20, 1448, true) === 380,
    [committedGridWidth(400, 200, 1448, true), committedGridWidth(400, -20, 1448, true)]);
  ok('committedGridWidth closed / overlay: the dragged width itself (clamped as dragGridWidth)',
    committedGridWidth(520, 80, 1448, false) === 600 && committedGridWidth(520, 900, 1448, false) === 900
    && committedGridWidth(440, 100, 1216, true) === dragGridWidth(440, 100, 1216) && proPanes(1216, { paneOpen: true }).paneMode === 'overlay');
  ok('committedGridWidth always equals the grid proPanes then draws', [1216, 1302, 1448, 2496].every((W) =>
    [false, true].every((open) => [-300, -40, 0, 60, 400].every((dx) => {
      const start = proPanes(W, { paneOpen: open }).grid;
      const saved = committedGridWidth(start, dx, W, open);
      return saved === proPanes(W, { paneOpen: open, storedGrid: dragGridWidth(start, dx, W) }).grid
        && saved === proPanes(W, { paneOpen: open, storedGrid: saved }).grid;
    }))));
  ok('parseStoredGrid', parseStoredGrid('612') === 612 && parseStoredGrid('x') === null && parseStoredGrid(null) === null && parseStoredGrid('-4') === null);
  ok('GRID_BREAKPOINT 900 on the CONTENT width', GRID_BREAKPOINT === 900 && scheduleProContentWidth(1512, 64) === 1448 && scheduleProFits(1140, 240) && !scheduleProFits(1100, 240));
}

console.log('\nsplitGridColumns — Start / Finish always show:');
{
  const at = (w: number) => splitGridColumns(w);
  ok('360: name Dur Start Finish, name 122', eq(at(360), { keys: ['name', 'duration', 'start', 'finish'], nameWidth: 122 }), at(360));
  ok('400 (1512, pane open): name 162', eq(at(400), { keys: ['name', 'duration', 'start', 'finish'], nameWidth: 162 }), at(400));
  ok('520 (1512, pane closed): + # , name 242', eq(at(520), { keys: ['rowNum', 'name', 'duration', 'start', 'finish'], nameWidth: 242 }), at(520));
  ok('640: + Float, name 266', eq(at(640), { keys: ['rowNum', 'name', 'duration', 'start', 'finish', 'float'], nameWidth: 266 }), at(640));
  ok('700: + WBS', eq(at(700).keys, ['rowNum', 'wbs', 'name', 'duration', 'start', 'finish', 'float']), at(700));
  ok('a 200 grid still gives the name its 120 floor', at(200).nameWidth === 120);
  // The thresholds, at the pixel: '#' from 440, Float from 600, WBS from 680.
  ok('439 has no #, 440 has it', !at(439).keys.includes('rowNum') && at(440).keys.includes('rowNum'));
  ok('599 has no Float, 600 has it', !at(599).keys.includes('float') && at(600).keys.includes('float'), [at(599).keys, at(600).keys]);
  ok('679 has no WBS, 680 has it', !at(679).keys.includes('wbs') && at(680).keys.includes('wbs'), [at(679).keys, at(680).keys]);
  ok('the leading columns fill the grid exactly (≥ the floor)', [360, 400, 440, 520, 600, 640, 680, 900].every((w) => {
    const { keys, nameWidth } = at(w);
    const sum = keys.reduce((s, k) => s + (k === 'name' ? nameWidth : SPLIT_COLUMN_WIDTHS[k]), 0);
    return sum === w;
  }));
  // The widths mirror GridPane's COLUMNS.
  const grid = code('components/schedule/GridPane.tsx');
  const colW = (k: string) => Number(new RegExp(`\\{\\s*key:\\s*'${k}',[^}]*?width:\\s*(\\d+)`).exec(grid)?.[1]);
  const mirrored = (Object.keys(SPLIT_COLUMN_WIDTHS) as (keyof typeof SPLIT_COLUMN_WIDTHS)[]).every((k) => colW(k) === SPLIT_COLUMN_WIDTHS[k]);
  ok('SPLIT_COLUMN_WIDTHS equal GridPane COLUMNS widths', mirrored,
    Object.fromEntries(Object.keys(SPLIT_COLUMN_WIDTHS).map((k) => [k, colW(k)])));
}

console.log('\ngrid and Gantt scroll to the same bottom (one scrollTop drives both):');
{
  // GridPane body: viewport pane − 2 − header, content rows + the 40 px ghost
  // row. InteractiveGantt (toolbar hidden): viewport pane − 2 − 24 (footer
  // strip), content header + rows + tail. Equal maxima for every pane height,
  // row count and density, or the shorter pane clamps first and each bar sits
  // beside the next row's name.
  ok('GANTT_SYNC_TAIL = GRID_GHOST_ROW_H − GANTT_FOOTER_STRIP_H = 40 − 24 = 16',
    GANTT_SYNC_TAIL === GRID_GHOST_ROW_H - GANTT_FOOTER_STRIP_H && GANTT_SYNC_TAIL === 16);
  const mismatches: unknown[] = [];
  for (const d of Object.values(DENSITY)) for (const paneH of [300, 520, 663, 745, 900, 1400]) for (const n of [0, 1, 5, 12, 38, 120, 400]) {
    const rowsH = n * d.row;
    const g = gridMaxScroll(paneH, d.header, rowsH);
    const t = ganttMaxScroll(paneH, d.header, rowsH);
    if (g !== t) mismatches.push({ header: d.header, row: d.row, paneH, n, grid: g, gantt: t });
  }
  ok('grid max scrollTop === Gantt max scrollTop (3 densities × 6 pane heights × 7 row counts)', mismatches.length === 0, mismatches.slice(0, 3));
  ok('the old 48 px guess left the Gantt 32 px deeper (the reviewed bug)', ganttMaxScroll(745, 48, 38 * 32, 48) - gridMaxScroll(745, 48, 38 * 32) === 32);
  // The components read the same constants, so the proof above is about them.
  const gridSrc = code('components/schedule/GridPane.tsx');
  const ganttSrc = code('components/schedule/InteractiveGantt.tsx');
  const tabSrc = code('components/schedule/tabs/GanttTab.tsx');
  ok('GridPane: the ghost row is GRID_GHOST_ROW_H tall', /ghostRow:\s*\{[^}]*height:\s*GRID_GHOST_ROW_H,/.test(gridSrc));
  ok('GridPane: the body viewport is the pane minus the header', /height:\s*gridBodyH > 0 \? Math\.max\(120, gridBodyH - headerHeight\)/.test(gridSrc));
  ok('InteractiveGantt: the footer strip is GANTT_FOOTER_STRIP_H tall', /footerStrip:\s*\{\s*height:\s*GANTT_FOOTER_STRIP_H,/.test(ganttSrc));
  ok('InteractiveGantt: the sync tail is GANTT_SYNC_TAIL, only while syncing with the toolbar hidden',
    /const syncTail = onVerticalScroll && hideToolbar \? GANTT_SYNC_TAIL : 0;/.test(ganttSrc)
    && /const gridHeight = headerH \+ \(tasks\.length \+ previewAddedRows\) \* rowH \+ syncTail;/.test(ganttSrc));
  ok('GanttTab: sync only on the Pro canvas (no Gantt toolbar, no grid conflict banner)',
    /onBodyScroll=\{isDesktop && proCanvas \? onGridScroll : undefined\}/.test(tabSrc)
    && /onVerticalScroll=\{isDesktop && proCanvas \? onGanttScroll : undefined\}/.test(tabSrc)
    && /conflictBanner=\{proCanvas \? 'none' : undefined\}/.test(tabSrc));
}

console.log('\nrows, density and Fit:');
{
  ok('visibleRows(945, 136, 32) = 24', visibleRows(945, 136, 32) === 24, visibleRows(945, 136, 32));
  ok('visibleRows(858, 176, 32) = 20', visibleRows(858, 176, 32) === 20, visibleRows(858, 176, 32));
  ok('visibleRows never negative, 0 for a 0 row', visibleRows(100, 200, 32) === 0 && visibleRows(945, 136, 0) === 0);
  // DENSITY mirrors the Layout.control literals (designTokens imports
  // react-native, so it is read as text).
  const tokens = code('constants/designTokens.ts');
  const control = /control:\s*\{([^}]*)\}/.exec(tokens)?.[1] ?? '';
  const ctl = (k: string) => Number(new RegExp(`\\b${k}:\\s*(\\d+)`).exec(control)?.[1]);
  ok('compact row = Layout.control.sm (32)', DENSITY.compact.row === ctl('sm') && ctl('sm') === 32, ctl('sm'));
  ok('compact / comfortable header = Layout.control.toolbar (48)', DENSITY.compact.header === ctl('toolbar') && DENSITY.comfortable.header === ctl('toolbar'), ctl('toolbar'));
  ok('comfortable row = Layout.control.row (40)', DENSITY.comfortable.row === ctl('row') && ctl('row') === 40, ctl('row'));
  ok('legacy = today\'s 56 / 56 / 26', eq(DENSITY.legacy, { row: 56, header: 56, bar: 26 }));
  ok('every bar fits its row with padding', (Object.values(DENSITY)).every((d) => d.bar < d.row));
  const dialog = Number(/sheet:\s*\{[^}]*\bdialog:\s*(\d+)/.exec(tokens)?.[1]);
  ok('PANE = Layout.sheet.dialog', PANE === dialog, dialog);
  ok('parseDensity', parseDensity('compact') === 'compact' && parseDensity('comfy') === null && parseDensity(null) === null);
  ok('storage keys carry the mageid_ prefix', DENSITY_STORAGE_KEY.startsWith('mageid_') && GRID_WIDTH_STORAGE_KEY.startsWith('mageid_'));
  ok('fit: 1008 viewport, 98-day job → 10 px/day', fitPxPerDay(1008, 98) === 10, fitPxPerDay(1008, 98));
  ok('fit: the whole job + 2-day tail spans the viewport − 8', Math.abs(fitPxPerDay(920, 60) * 62 - 912) < 1e-9);
  ok('fit: clamped to 1–40', fitPxPerDay(1000, 2) === 40 && fitPxPerDay(300, 5000) === 1);
}

console.log('\nviews:');
{
  ok('primary views', eq(PRIMARY_VIEWS, ['split', 'gantt', 'list', 'board', 'overview']));
  ok('more views', eq(MORE_VIEWS, ['workload', 'lanes', 'living', 'calendar']));
  ok("calendar is labelled 'Calendar · soon'", VIEW_LABEL.calendar === 'Calendar · soon');
  ok('split / gantt / lanes / living are timeline layouts', (['split', 'gantt', 'lanes', 'living'] as const).every((v) => eq(viewToTab(v), { tab: 'timeline', layout: v })));
  ok('list / board / overview / workload / calendar are their own tabs', (['list', 'board', 'overview', 'workload', 'calendar'] as const).every((v) => eq(viewToTab(v), { tab: v })));
}

console.log('\nisScheduleQuestion — ask or change:');
{
  const asks = ['Why is drywall late?', 'what drives the finish', "What's on the critical path", 'Show me next week', 'can we finish by May 1', 'Explain the float on framing', 'is inspection before drywall', 'Does paint wait on drywall', 'push framing?',
    // Every one of the 15 lead words, without a '?', so dropping any one from
    // QUESTION_LEAD turns this red (what/show/can/explain/is/does are above).
    'why did the finish move', 'when does paint start', 'how long is framing', 'which tasks are critical',
    'who is on drywall', 'are we on track', 'do we need a crane', 'will we finish by May', 'should I push paint'];
  const changes = ['push drywall a week', 'add three tasks after rough-in', 'Isolate the MEP rough-in', 'Showcase task first', 'delete demo', '', '   ',
    // A lead word as a mere prefix of the first word is still a change (\b).
    'Whoever is free takes punch', 'Doing demo before framing', 'Howard crew takes framing', 'Canopy after roofing',
    'Willow crew on paint', 'Whatever is left moves to Friday'];
  for (const q of asks) ok(`ask: "${q}"`, isScheduleQuestion(q) && scheduleInputIntent(q) === 'ask');
  for (const c of changes) ok(`change: "${c}"`, !isScheduleQuestion(c) && (c.trim() === '' || scheduleInputIntent(c) === 'change'));
}

console.log('\nbuildSchedulePreviewOverlay — A → B → C, one move, one add, one removal:');
{
  const t = (o: Partial<ScheduleTask> & { id: string; title: string; startDay: number; durationDays: number }): ScheduleTask =>
    ({ phase: 'Framing', progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...o } as ScheduleTask);
  const opts = { workingDaysPerWeek: 7 };
  const before = [
    t({ id: 'A', title: 'A', startDay: 1, durationDays: 3 }),
    t({ id: 'B', title: 'B', startDay: 4, durationDays: 2, dependencies: ['A'] }),
    t({ id: 'C', title: 'C', startDay: 6, durationDays: 4, dependencies: ['B'] }),
  ];
  // A grows by 2 (B and C ripple), D is added after C, nothing removed.
  const after = [
    t({ id: 'A', title: 'A', startDay: 1, durationDays: 5 }),
    before[1],
    before[2],
    t({ id: 'D', title: 'Punch walk', startDay: 10, durationDays: 1, dependencies: ['C'] }),
  ];
  const cb = runCpm(before, opts);
  const ca = runCpm(after, opts);
  const o = buildSchedulePreviewOverlay(before, after, cb, ca);
  const B0 = cb.perTask.get('B')!; const B1 = ca.perTask.get('B')!;
  ok('A, B and C moved (A grew; B and C rippled)', eq(o.moved.map((m) => m.id), ['A', 'B', 'C']), o.moved);
  ok('B moved from its old span to its new one (calendar indices)', eq(o.moved[1], { id: 'B', fromEs: B0.es, fromEf: B0.ef, toEs: B1.es, toEf: B1.ef }) && B1.es - B0.es === 2, o.moved[1]);
  ok('D is added after C (afterIndex 2) with the engine\'s span', o.added.length === 1 && o.added[0].id === 'D' && o.added[0].afterIndex === 2
    && o.added[0].es === ca.perTask.get('D')!.es && o.added[0].title === 'Punch walk' && !o.added[0].isMilestone, o.added);
  ok('nothing removed', o.removedIds.length === 0);
  ok('finish moves by the ripple + D', o.finishBefore === cb.projectFinish && o.finishAfter === ca.projectFinish && o.finishDeltaDays === ca.projectFinish - cb.projectFinish && o.finishDeltaDays === 3, o);
  const dropped = buildSchedulePreviewOverlay(before, [before[0], before[2]], cb, runCpm([before[0], before[2]], opts));
  ok('a removed task is listed', eq(dropped.removedIds, ['B']));
  const same = buildSchedulePreviewOverlay(before, before, cb, cb);
  ok('an unchanged schedule draws nothing', same.moved.length === 0 && same.added.length === 0 && same.removedIds.length === 0 && same.finishDeltaDays === 0);
  const ms = buildSchedulePreviewOverlay(before, [...before, t({ id: 'M', title: 'Walk', startDay: 10, durationDays: 0, dependencies: ['C'] })], cb,
    runCpm([...before, t({ id: 'M', title: 'Walk', startDay: 10, durationDays: 0, dependencies: ['C'] })], opts));
  ok('a 0-day add is a milestone', ms.added[0]?.isMilestone === true);
  ok('finish pill labels', finishDeltaLabel(7) === 'Finish +7d' && finishDeltaLabel(-3) === 'Finish −3d' && finishDeltaLabel(0) === 'Finish unchanged');
}

console.log('\nsource pins — the old behaviour cannot come back:');
{
  const gantt = code('components/schedule/InteractiveGantt.tsx');
  ok('InteractiveGantt: no `viewport = 800` Fit guess', !/\bviewport\s*=\s*800\b/.test(gantt));
  ok('InteractiveGantt: Fit reads the measured timeline width (onLayout) through fitPxPerDay', /fitPxPerDay\(/.test(gantt) && /onLayout=\{onTimelineLayout\}/.test(gantt));
  const stickyZ = Number(/position:\s*'sticky'[^}]*top:\s*0[^}]*zIndex:\s*(\d+)/.exec(gantt)?.[1]);
  // Every literal in-canvas z (bars 2 / 10 / 20, link handles 3, preview marks
  // 4 / 5 / 6, the finish marker 7, avatars 15 / 16) under 999 must sit below
  // the sticky header, or it paints over the dates as it scrolls under.
  const canvasZ = [...gantt.matchAll(/zIndex:\s*(?:isDragging \? (\d+)|(\d+))/g)]
    .map((m) => Number(m[1] ?? m[2])).filter((z) => z < 999 && z !== stickyZ);
  ok('InteractiveGantt: the sticky header sits above every in-canvas layer, below the 999+ popovers',
    stickyZ > Math.max(...canvasZ) && stickyZ < 999, { stickyZ, maxCanvas: Math.max(...canvasZ) });
  // The header-band marks share the header's stacking context (the timeline's
  // background Pressable) and are drawn INSIDE the header band, so they must
  // paint ABOVE it: the TODAY line, the TODAY pill and the drag date pill.
  const namedZ = (name: string) => Number(new RegExp(`const ${name} = (\\d+);`).exec(gantt)?.[1]);
  const bandZ = { line: namedZ('TODAY_LINE_Z'), label: namedZ('TODAY_LABEL_Z'), dragPill: namedZ('DRAG_DATE_PILL_Z') };
  ok('InteractiveGantt: the TODAY line, TODAY pill and drag date pill paint above the sticky header, below the 999+ popovers',
    Object.values(bandZ).every((z) => z > stickyZ && z < 999), { stickyZ, bandZ });
  // The TODAY raise rides the same desktop-web gate as the sticky header (the
  // phone / tablet goldens keep 5 / 6); the drag date pill is transient, never
  // in a golden, and sits at 33 everywhere.
  ok('InteractiveGantt: the TODAY line / pill (desktop web) and the drag date pill use those named layers',
    /const TODAY_LINE_WEB: ViewStyle = \{ zIndex: TODAY_LINE_Z \};/.test(gantt) && /const TODAY_LABEL_WEB: ViewStyle = \{ zIndex: TODAY_LABEL_Z \};/.test(gantt)
    && /style=\{\[styles\.todayLine, \{ left: todayX \}, isDesktopWeb && TODAY_LINE_WEB\]\}/.test(gantt)
    && /style=\{\[styles\.todayLabel, \{ left: todayX \}, isDesktopWeb && TODAY_LABEL_WEB\]\}/.test(gantt)
    && /top:\s*bar\.y - 22,[^}]*zIndex:\s*DRAG_DATE_PILL_Z,/.test(gantt));
  ok('InteractiveGantt: preview testIDs', /gantt-preview-moved-\$\{/.test(gantt) && /gantt-preview-added-\$\{/.test(gantt) && /['"]gantt-preview-finish['"]/.test(gantt));
  const tab = code('components/schedule/tabs/GanttTab.tsx');
  // The 38 % share survives ONLY as the tablet / native grid style (the
  // golden 1000 × 700 Android-tablet snapshot pins it byte for byte). On a
  // desktop layout the grid's width is proPanes', appended behind the gate.
  ok("GanttTab: no inline `width: '38%'` literal (the tablet share is the named TABLET_GRID_SHARE)", !/width:\s*'38%'/.test(tab)
    && /const TABLET_GRID_SHARE = '38%';/.test(tab) && /grid:\s*\{\s*width:\s*TABLET_GRID_SHARE,/.test(tab));
  ok('GanttTab: on desktop the grid width is proPanes\' (gated, appended after the tablet style)',
    /proPanes\(rowWidth,/.test(tab) && /style=\{\[styles\.grid,\s*isDesktop\s*&&\s*\{\s*width:\s*panes\.grid/.test(tab));
  ok('GanttTab: W is the tab\'s own measured width (useContainerWidth), the docked pane carved out ONCE', /useContainerWidth\(\)/.test(tab)
    && /onLayout=\{isDesktop \? onRowLayout : undefined\}/.test(tab) && /panes\.paneMode === 'dock' && \{ flex: 0, width: panes\.gantt \}/.test(tab));
  ok('GanttTab: the divider persists under mageid_schedule_grid_width', /GRID_WIDTH_STORAGE_KEY/.test(tab) && /col-resize/.test(tab) && /dragGridWidth\(/.test(tab));
  ok('GanttTab: the drag saves the width it showed (committedGridWidth, pane state included)',
    /const w = committedGridWidth\(dragStart\.current, g\.dx, rowWidthRef\.current, paneOpenRef\.current\);/.test(tab)
    && /AsyncStorage\.setItem\(GRID_WIDTH_STORAGE_KEY, String\(w\)\)/.test(tab));
  ok('GanttTab: grid and Gantt scroll together, guarded against echo', /onBodyScroll=\{isDesktop && proCanvas \? onGridScroll : undefined\}/.test(tab)
    && /onVerticalScroll=\{isDesktop && proCanvas \? onGanttScroll : undefined\}/.test(tab) && /if \(syncing\.current === 'gantt'\) return;/.test(tab)
    && /if \(syncing\.current === 'grid'\) return;/.test(tab));
  ok('GanttTab: a controlled layout hides the local layout bar and the Gantt toolbar', /const proCanvas = controlledLayout !== undefined;/.test(tab)
    && /\{proCanvas \? null : \(\s*<View style=\{styles\.layoutBar\}>/.test(tab) && (tab.match(/hideToolbar=\{proCanvas \|\| undefined\}/g) ?? []).length === 2);
  const grid = code('components/schedule/GridPane.tsx');
  ok('GridPane: splitWidth drives the leading columns through splitGridColumns', /splitGridColumns\(splitWidth\)/.test(grid));
  ok('GridPane: row / header heights default to today\'s 56 and apply only when different',
    /rowHeight = ROW_HEIGHT,/.test(grid) && /headerHeight = HEADER_HEIGHT,/.test(grid)
    && /const rowHeightStyle = rowHeight !== ROW_HEIGHT \? \{ height: rowHeight \} : null;/.test(grid));
  const gantt2 = code('components/schedule/InteractiveGantt.tsx');
  ok('InteractiveGantt: row / header / bar default to the 56 / 56 / 26 module constants',
    /const rowH = props\.rowHeight \?\? ROW_HEIGHT;/.test(gantt2) && /const headerH = props\.headerHeight \?\? HEADER_HEIGHT;/.test(gantt2)
    && /const barH = props\.barHeight \?\? BAR_HEIGHT;/.test(gantt2)
    && /const ROW_HEIGHT = 56;/.test(gantt2) && /const HEADER_HEIGHT = 56;/.test(gantt2) && /const BAR_HEIGHT = 26;/.test(gantt2));
  ok('InteractiveGantt: the sticky header is desktop-web only', /isDesktopWeb && STICKY_HEADER_WEB/.test(gantt2));
  const menu = code('components/schedule/SchedulerMenuBar.tsx');
  ok('SchedulerMenuBar: no `top: 96`', !/\btop:\s*96\b/.test(menu));
  ok('SchedulerMenuBar: the dropdown is placed from measureInWindow + Layout.menu', /measureInWindow/.test(menu) && /Layout\.menu\.offset/.test(menu) && /Layout\.menu\.maxWidth/.test(menu));
  // A dropdown shows only once ITS trigger is measured: no frame under the
  // previous menu's trigger (the position is tagged with the menu's key).
  ok('SchedulerMenuBar: a dropdown is invisible until its own trigger is measured',
    /setPos\(null\);\s*setOpen\(key\);/.test(menu)
    && /const placed = pos && pos\.key === menu\.key \? pos : null;/.test(menu)
    && /placed \? \{ top: placed\.top, left: placed\.left \} : styles\.dropdownUnplaced/.test(menu)
    && /dropdownUnplaced:\s*\{[^}]*opacity:\s*0/.test(menu));
  ok('GridPane: the floating bulk bar takes its shadow from the Shadow token (no hex)',
    /bulkBarFloat:\s*\{[^}]*\.\.\.Shadow\.medium/.test(grid) && !/bulkBarFloat:\s*\{[^}]*#[0-9a-fA-F]{3}/.test(grid));
  ok('SchedulerMenuBar: a handler-less dialog-scope Esc entry', /useHotkeys\(\s*[A-Z_]+\s*,\s*\{\s*scope:\s*'dialog'/.test(menu));
  const row = code('components/schedule/ScheduleRowMenu.tsx');
  ok("ScheduleRowMenu: the popover reads Layout.menu", /Layout\.menu\.minWidth/.test(row) && /Layout\.menu\.maxWidth/.test(row));
  ok('ScheduleRowMenu: the popover is desktop-web only and keeps the iOS ActionSheet', /useIsDesktopWeb\(\)/.test(row) && /ActionSheetIOS\.showActionSheetWithOptions/.test(row));
  ok('ScheduleRowMenu: a handler-less dialog-scope Esc entry', /useHotkeys\(\s*[A-Z_]+\s*,\s*\{\s*scope:\s*'dialog',\s*enabled:\s*visible/.test(row));
  // Integration round 1: the split's leading set fits INSIDE the grid's 1 px
  // container border; the split's Task Name has no (dead) resize handle; an
  // actions-only menu bar highlights no group; the two new surfaces spread
  // cardSurface (validate-ui-adoption's HANDROLLED_CEILING never rises).
  ok('GridPane: the split name width subtracts the container border on both sides',
    /const GRID_CONTAINER_BORDER = 1;/.test(grid) && /borderWidth: GRID_CONTAINER_BORDER,/.test(grid)
    && /Math\.round\(splitWidth - GRID_CONTAINER_BORDER \* 2 - others\)/.test(grid));
  ok("GridPane: no resize handle on the split view's Task Name", /&& !\(splitLead != null && col\.key === 'name'\) &&/.test(grid));
  ok('SchedulerMenuBar: active / onSelectView optional; actionsOnly highlights no group',
    /active\?: SchedulerTabKey;/.test(menu) && /onSelectView\?: \(k: SchedulerTabKey\) => void;/.test(menu)
    && /const isActiveGroup = !actionsOnly && activeMenu\?\.key === menu\.key;/.test(menu) && /onSelectView\?\.\(it\.view\)/.test(menu));
  ok('ScheduleRowMenu popover + InteractiveGantt preview pill spread cardSurface (no hand-rolled surface)',
    /popover:\s*\{[^}]*\.\.\.cardSurface\(t, \{ radius: 'md', pad: 'none' \}\)/.test(row) && !/popover:\s*\{[^}]*backgroundColor:\s*t\.surface/.test(row)
    && /previewFinishPill:\s*\{[^}]*\.\.\.cardSurface\(t, \{ radius: 'xs', pad: 'none' \}\)/.test(gantt2) && !/previewFinishPill:\s*\{[^}]*backgroundColor:\s*t\.surface/.test(gantt2));
  const shell = code('components/schedule/SchedulerTabShell.tsx');
  ok("SchedulerTabShell: 'toolbar' chrome renders neither the menu bar nor the header", /desktopChrome\s*===\s*'toolbar'/.test(shell) && /viewToTab\(/.test(shell));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
