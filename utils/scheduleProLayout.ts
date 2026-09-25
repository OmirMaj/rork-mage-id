// utils/scheduleProLayout.ts — the width, height and view maths of the Schedule
// Pro canvas on a desktop browser (wave 6c, lane DA).
//
// WHY THIS EXISTS. The founder, on a 1512 × 945 MacBook: "the scheduler does
// not work well"; "when doing the schedules or picking a subtab the boxes are
// so stretched out and it looks terrible". Measured: about 9 rows fit (56 px
// rows under a 56 px header and a toolbar), the split grid was a flat 38 % of
// the window and hid Start / Finish / Float, and "Fit" assumed an 800 px
// viewport whatever the real one was. Every number the canvas lays out by now
// comes from here, so it is one place to read and one place bun can execute.
//
// PURE: no React, no react-native import (bun runs it in
// scripts/validate-schedule-pro-desktop.ts). Widths that mirror a design token
// say which one in a comment; the validator reads constants/designTokens.ts as
// text and checks they still agree.

import { SIDE_PANEL_DEFAULT, SIDE_PANEL_MIN, SPLIT_DIVIDER } from './splitViewLayout';

// ─────────────────────────────────────────────────────────────────────────────
// Does the Pro canvas fit at all?
// ─────────────────────────────────────────────────────────────────────────────

/** Below this CONTENT width the grid + Gantt split is unusable (moved here from
 *  app/schedule-pro.tsx, which compared it to the WINDOW). */
export const GRID_BREAKPOINT = 900;

/** The width the Pro canvas actually has: the window minus whatever rail or
 *  sidebar sits beside it. */
export function scheduleProContentWidth(windowWidth: number, sidebarWidth: number): number {
  const w = Number.isFinite(windowWidth) ? windowWidth : 0;
  const s = Number.isFinite(sidebarWidth) ? sidebarWidth : 0;
  return Math.max(0, w - s);
}

export function scheduleProFits(windowWidth: number, sidebarWidth: number): boolean {
  return scheduleProContentWidth(windowWidth, sidebarWidth) >= GRID_BREAKPOINT;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row density
// ─────────────────────────────────────────────────────────────────────────────

export type Density = 'compact' | 'comfortable' | 'legacy';

/** Row / header / bar heights per density. 'legacy' is today's 56 / 56 / 26
 *  (InteractiveGantt's ROW_HEIGHT / HEADER_HEIGHT / BAR_HEIGHT), the value
 *  every caller that passes no density keeps. Desktop defaults to 'compact':
 *  at 32 px a 945 px window shows ~24 rows instead of ~9. */
export const DENSITY: Readonly<Record<Density, { row: number; header: number; bar: number }>> = {
  compact:     { row: 32 /* Layout.control.sm */,  header: 48 /* Layout.control.toolbar */, bar: 20 },
  comfortable: { row: 40 /* Layout.control.row */, header: 48 /* Layout.control.toolbar */, bar: 24 },
  legacy:      { row: 56, header: 56, bar: 26 },
};

/** The density a desktop user gets before he picks one. */
export const DEFAULT_DESKTOP_DENSITY: Density = 'compact';

/** AsyncStorage key for the picked density (mageid_ prefix — swept on sign-out). */
export const DENSITY_STORAGE_KEY = 'mageid_schedule_density';

/** A stored density, or null when what is stored is not one. */
export function parseDensity(raw: string | null | undefined): Density | null {
  return raw === 'compact' || raw === 'comfortable' || raw === 'legacy' ? raw : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid | Gantt | pane widths
// ─────────────────────────────────────────────────────────────────────────────

/** The grid is never narrower than a side panel's minimum. */
export const GRID_MIN = SIDE_PANEL_MIN; // 360
/** A dragged grid never takes more than this. */
export const GRID_MAX = 900;
/** Default grid share of the work row, before he drags the divider. */
export const GRID_DEFAULT_RATIO = 0.36;
/** The default (un-dragged) grid stops growing here — on a 2560 monitor the
 *  extra width goes to the timeline, which is what it is for. */
export const GRID_DEFAULT_CAP = 640;
/** With the pane docked, the timeline keeps at least this much before the grid shrinks. */
export const GANTT_KEEP = 600;
/** The timeline is never squeezed under this by a dragged grid. */
export const GANTT_MIN = 480;
/** The right-hand pane (AI / inspector / sub updates): SIDE_PANEL_DEFAULT = Layout.sheet.dialog. */
export const PANE = SIDE_PANEL_DEFAULT; // 440
/** The narrowest work row that can dock the pane beside grid + divider + timeline. */
export const PANE_DOCK_MIN = GRID_MIN + SPLIT_DIVIDER + GANTT_MIN + PANE; // 1288
/** AsyncStorage key for the dragged grid width (mageid_ prefix). */
export const GRID_WIDTH_STORAGE_KEY = 'mageid_schedule_grid_width';

const round8 = (n: number) => Math.round(n / 8) * 8;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface ProPanes {
  grid: number;
  gantt: number;
  pane: number;
  paneMode: 'dock' | 'overlay' | 'closed';
}

/**
 * The split for a work row W px wide (the window minus the rail / sidebar, a
 * docked pane INCLUDED — it is carved out of W here, never subtracted twice).
 *
 *   gridClosed = clamp(storedGrid ?? round8(W·0.36), 360, min(640 | 900 when stored, W − 8 − 480))
 *   pane open, W ≥ 1288 → dock:    grid = clamp(W − 440 − 8 − 600, 360, gridClosed)
 *   pane open, W <  1288 → overlay: grid unchanged (the pane floats over the timeline)
 *   gantt = W − grid − 8 − (dock ? 440 : 0)
 */
export function proPanes(W: number, opts: { paneOpen?: boolean; storedGrid?: number | null } = {}): ProPanes {
  const w = Number.isFinite(W) && W > 0 ? W : 0;
  const stored = typeof opts.storedGrid === 'number' && Number.isFinite(opts.storedGrid) && opts.storedGrid > 0
    ? opts.storedGrid
    : null;
  const hi = Math.min(stored != null ? GRID_MAX : GRID_DEFAULT_CAP, w - SPLIT_DIVIDER - GANTT_MIN);
  const gridClosed = Math.round(clamp(stored ?? round8(w * GRID_DEFAULT_RATIO), GRID_MIN, hi));
  if (!opts.paneOpen) {
    return { grid: gridClosed, gantt: Math.max(0, w - gridClosed - SPLIT_DIVIDER), pane: 0, paneMode: 'closed' };
  }
  if (w >= PANE_DOCK_MIN) {
    const grid = Math.round(clamp(w - PANE - SPLIT_DIVIDER - GANTT_KEEP, GRID_MIN, gridClosed));
    return { grid, gantt: Math.max(0, w - grid - SPLIT_DIVIDER - PANE), pane: PANE, paneMode: 'dock' };
  }
  return { grid: gridClosed, gantt: Math.max(0, w - gridClosed - SPLIT_DIVIDER), pane: PANE, paneMode: 'overlay' };
}

/** The grid width after dragging the divider `dx` px from `startGrid`. */
export function dragGridWidth(startGrid: number, dx: number, W: number): number {
  const w = Number.isFinite(W) && W > 0 ? W : 0;
  const next = (Number.isFinite(startGrid) ? startGrid : GRID_MIN) + (Number.isFinite(dx) ? dx : 0);
  return Math.round(clamp(next, GRID_MIN, Math.min(GRID_MAX, w - SPLIT_DIVIDER - GANTT_MIN)));
}

/**
 * The width a divider drag leaves ON SCREEN, which is also what gets saved.
 * Closed or overlay: the dragged width itself. Docked: the pane caps the grid
 * at W − 440 − 8 − 600, so a drag past that cap shows (and saves) the cap —
 * never a wider value he did not see, that the grid would jump to the moment
 * the pane closed.
 */
export function committedGridWidth(startGrid: number, dx: number, W: number, paneOpen: boolean): number {
  return proPanes(W, { paneOpen, storedGrid: dragGridWidth(startGrid, dx, W) }).grid;
}

/** A stored grid width, or null when what is stored is not a usable number. */
export function parseStoredGrid(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Which grid columns the split view shows
// ─────────────────────────────────────────────────────────────────────────────

export type SplitGridKey = 'rowNum' | 'wbs' | 'name' | 'duration' | 'start' | 'finish' | 'float';

/** components/schedule/GridPane.tsx COLUMNS widths for the leading keys (the
 *  validator reads GridPane as text and checks they still agree). */
export const SPLIT_COLUMN_WIDTHS: Readonly<Record<Exclude<SplitGridKey, 'name'>, number>> = {
  rowNum: 40, wbs: 70, duration: 62, start: 88, finish: 88, float: 96,
};
/** The task name never gets narrower than this, however narrow the grid. */
export const SPLIT_NAME_MIN = 120;
/** Display order of the leading keys — GridPane's own COLUMNS order. */
const SPLIT_ORDER: SplitGridKey[] = ['rowNum', 'wbs', 'name', 'duration', 'start', 'finish', 'float'];

/**
 * The leading columns the split grid shows at `gridWidth`, in display order,
 * and the width the name column gets so they fill it exactly:
 *   always name · Dur. · Start · Finish (the founder could not see his dates);
 *   + '#' (the row number and the select target) from 440;
 *   + Float from 600; + WBS from 680.
 *   name = max(120, grid − Σ the others).
 * Every other column follows and scrolls horizontally.
 */
export function splitGridColumns(gridWidth: number): { keys: SplitGridKey[]; nameWidth: number } {
  const g = Number.isFinite(gridWidth) ? gridWidth : 0;
  const shown = new Set<SplitGridKey>(['name', 'duration', 'start', 'finish']);
  if (g >= 440) shown.add('rowNum');
  if (g >= 600) shown.add('float');
  if (g >= 680) shown.add('wbs');
  const keys = SPLIT_ORDER.filter((k) => shown.has(k));
  const others = keys.reduce((s, k) => (k === 'name' ? s : s + SPLIT_COLUMN_WIDTHS[k]), 0);
  return { keys, nameWidth: Math.max(SPLIT_NAME_MIN, Math.round(g - others)) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Views
// ─────────────────────────────────────────────────────────────────────────────

export type ProView = 'split' | 'gantt' | 'list' | 'board' | 'overview' | 'workload' | 'lanes' | 'living' | 'calendar';
/** SchedulerTabShell's tab keys (components/schedule/SchedulerTabShell.tsx SchedulerTabKey). */
export type ProTabKey = 'overview' | 'timeline' | 'list' | 'board' | 'workload' | 'calendar';
/** GanttTab's layouts (components/schedule/tabs/GanttTab.tsx GanttPaneMode). */
export type ProGanttLayout = 'split' | 'gantt' | 'lanes' | 'living';

export const PRIMARY_VIEWS: readonly ProView[] = ['split', 'gantt', 'list', 'board', 'overview'];
export const MORE_VIEWS: readonly ProView[] = ['workload', 'lanes', 'living', 'calendar'];
export const VIEW_LABEL: Readonly<Record<ProView, string>> = {
  split: 'Split', gantt: 'Gantt', list: 'List', board: 'Board', overview: 'Overview',
  workload: 'Workload', lanes: 'Lanes', living: 'Living Plan', calendar: 'Calendar · soon',
};

// ─── Toolbar row 2: collapse instead of overflowing (wave 6d, C4) ──────────
// Row 2 is a fixed-height, no-wrap row, and RN-web children do not shrink, so
// under ~1236 px of content it ran past the right edge and Track / Share were
// cut off (1366 with the sidebar pinned, 1280, even 1440). The minimum widths
// of what it holds, from Layout:
//   gutters                Layout.gutter 24 × 2                          48
//   view segmented         5 × Layout.segment.minWidth 88 + 4 × 2 + 6   454
//   More ▾                                                              ≈72
//   zoom group             32 + Fit ≈38 + Today ≈58 + 32 + gaps        ≈166
//   "Rows" ≈36 + density   88 + "Comfortable" ≈108 + 8                 ≈240
//   Plan / Track / Share                                               ≈216
//   5 gaps                 Layout.rowGap 8 × 5                           40
//                                                                     ≈1236
// Each step below the one before it drops the next thing he needs least.
export const ROW2_NEEDS = {
  /** Everything as it was: the sum above. */
  full: 1236,
  /** No "Rows" label and density is one ≈112 text toggle: 1236 − 240 + 112. */
  noRowsLabel: 1108,
  /** Board and Overview move into More ▾: 1108 − 2 × (88 + 2). */
  twoViewsInMore: 928,
} as const;

/** The three views the segmented control keeps once Board / Overview move into More ▾. */
export const ROW2_NARROW_VIEWS: readonly ProView[] = ['split', 'gantt', 'list'];

export interface Row2Plan {
  /** The "Rows" caption before the density control. */
  rowsLabel: boolean;
  /** Two segments, or one text button that flips Compact ⇄ Comfortable. */
  density: 'segmented' | 'toggle';
  /** The views on the segmented control; every other view is under More ▾. */
  primary: readonly ProView[];
  /** "Fit" / "Today" as words; false = 32 px icon buttons (same labels). */
  zoomLabels: boolean;
}

/**
 * What toolbar row 2 shows at a measured content width. Unmeasured (0, NaN)
 * or ≥ ROW2_NEEDS.full: everything as it was.
 *   < full            no "Rows" label; density is one toggle
 *   < noRowsLabel     + Board and Overview move into More ▾
 *   < twoViewsInMore  + Fit and Today become icons
 */
export function row2Plan(width: number): Row2Plan {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  if (w === 0 || w >= ROW2_NEEDS.full) {
    return { rowsLabel: true, density: 'segmented', primary: PRIMARY_VIEWS, zoomLabels: true };
  }
  return {
    rowsLabel: false,
    density: 'toggle',
    primary: w < ROW2_NEEDS.noRowsLabel ? ROW2_NARROW_VIEWS : PRIMARY_VIEWS,
    zoomLabels: w >= ROW2_NEEDS.twoViewsInMore,
  };
}

/** Every view, primary first: the More ▾ list is this minus the plan's primary. */
export const ALL_VIEWS: readonly ProView[] = [...PRIMARY_VIEWS, ...MORE_VIEWS];

/** Which shell tab (and, for the timeline, which GanttTab layout) a view is. */
export function viewToTab(v: ProView): { tab: ProTabKey; layout?: ProGanttLayout } {
  switch (v) {
    case 'split': case 'gantt': case 'lanes': case 'living':
      return { tab: 'timeline', layout: v };
    case 'list': return { tab: 'list' };
    case 'board': return { tab: 'board' };
    case 'workload': return { tab: 'workload' };
    case 'calendar': return { tab: 'calendar' };
    case 'overview':
    default:
      return { tab: 'overview' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The copilot bar: a question or a change?
// ─────────────────────────────────────────────────────────────────────────────

const QUESTION_LEAD = /^(what|why|when|how|which|who|is|are|can|does|do|will|should|explain|show)\b/i;

/** "Why is drywall late?" asks; "push drywall a week" changes. */
export function isScheduleQuestion(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  return t.endsWith('?') || QUESTION_LEAD.test(t);
}

export function scheduleInputIntent(text: string): 'ask' | 'change' {
  return isScheduleQuestion(text) ? 'ask' : 'change';
}

// ─────────────────────────────────────────────────────────────────────────────
// Rows and the timeline
// ─────────────────────────────────────────────────────────────────────────────

/** Whole rows that fit in the viewport under the chrome and a horizontal scrollbar. */
export function visibleRows(viewportH: number, chromeH: number, rowH: number, scrollbar = 12): number {
  if (!(rowH > 0)) return 0;
  return Math.max(0, Math.floor((viewportH - chromeH - scrollbar) / rowH));
}

// ─── Grid and Gantt scroll to the same bottom ───────────────────────────────
// The two panes share one scrollTop, so their MAXIMUM scrollTops must be equal
// or the shorter one clamps first and every bar sits beside the wrong row.
//   grid  (GridPane, conflict banner off): body viewport = pane − 2 − header;
//          body content = rows + GRID_GHOST_ROW_H (the "type a task" row).
//   Gantt (InteractiveGantt, toolbar hidden): viewport = pane − 2 − GANTT_FOOTER_STRIP_H;
//          content = header + rows + tail.
// Equal maxima ⇔ tail = GRID_GHOST_ROW_H − GANTT_FOOTER_STRIP_H, for every
// pane height, row count and density. Both components read these constants.

/** components/schedule/GridPane.tsx styles.ghostRow height. */
export const GRID_GHOST_ROW_H = 40;
/** components/schedule/InteractiveGantt.tsx styles.footerStrip height (hideToolbar). */
export const GANTT_FOOTER_STRIP_H = 24;
/** The empty tail under the Gantt's last row while it scrolls with the grid. */
export const GANTT_SYNC_TAIL = GRID_GHOST_ROW_H - GANTT_FOOTER_STRIP_H; // 16

/** The grid body's maximum scrollTop in a pane `paneH` tall (1 px border each side). */
export function gridMaxScroll(paneH: number, headerH: number, rowsH: number): number {
  return Math.max(0, rowsH + GRID_GHOST_ROW_H - (paneH - 2 - headerH));
}
/** The Gantt timeline's maximum scrollTop in a pane `paneH` tall, toolbar hidden. */
export function ganttMaxScroll(paneH: number, headerH: number, rowsH: number, tail = GANTT_SYNC_TAIL): number {
  return Math.max(0, headerH + rowsH + tail - (paneH - 2 - GANTT_FOOTER_STRIP_H));
}

/** Fit: the px-per-day that lays the whole project (plus a 2-day tail) across
 *  the MEASURED timeline viewport, clamped to the zoom slider's 1–40. */
export const FIT_TAIL_DAYS = 2;
export function fitPxPerDay(viewportW: number, projectFinish: number): number {
  const span = Math.max(1, Number.isFinite(projectFinish) ? projectFinish : 1) + FIT_TAIL_DAYS;
  const room = Math.max(0, (Number.isFinite(viewportW) ? viewportW : 0) - 8);
  return clamp(room / span, 1, 40);
}
