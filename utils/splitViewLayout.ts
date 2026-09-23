// utils/splitViewLayout.ts — the width math for the desktop workspace
// primitives: SplitView (list | record), SidePanel, KpiStrip, FormGrid.
//
// PURE: no React, no react-native import, so scripts/validate-desktop-workspace.ts
// executes it under bun.
//
// WHY THIS EXISTS. The wave-6b audits measured the web app on the founder's
// 1512 × 945 MacBook: RFIs, submittals, change orders and invoices open a record
// by PUSHING a full-width screen, so the list he was working through vanishes
// and every record is a round trip. utils/punchEditLayout.ts already fixed one
// of these (the 75/25 punch split he asked for on 2026-09-22); this generalises
// it to "list beside record" for every register.
//
// Every decision is made on the CONTAINER width (what is left after the
// sidebar and any docked panel — hooks/useContainerWidth), never the window:
// the window is 1512 while the content column is ~1270, and a split that
// assumed 1512 would squeeze the record pane under its own minimum.

// ─────────────────────────────────────────────────────────────────────────────
// SplitView
// ─────────────────────────────────────────────────────────────────────────────

/** Below this container width the record REPLACES the list (with a back link):
 *  420 px of list + ~640 px of record is the least that reads as two panes. */
export const SPLIT_MIN_CONTAINER = 1100;
/** The list never gets narrower than this — below it a row's title and status
 *  no longer fit on one line. */
export const SPLIT_LIST_MIN = 420;
/** Default list share (the record gets the rest). */
export const SPLIT_LIST_DEFAULT_RATIO = 0.42;
/** The list never takes more than this — the record is what he opened. */
export const SPLIT_LIST_MAX_RATIO = 0.6;
/** The draggable divider's own width (its visible line is 1 px; the rest is
 *  hit area). */
export const SPLIT_DIVIDER = 8;

export type SplitMode = 'split' | 'single';

/** 'split' only on a desktop layout whose container is SPLIT_MIN_CONTAINER or
 *  wider. The phone is always 'single' — it keeps push navigation. */
export function splitMode(containerWidth: number, isDesktop: boolean): SplitMode {
  if (!isDesktop) return 'single';
  if (typeof containerWidth !== 'number' || !Number.isFinite(containerWidth)) return 'single';
  return containerWidth >= SPLIT_MIN_CONTAINER ? 'split' : 'single';
}

/** Clamp a list ratio so the list is ≥ SPLIT_LIST_MIN px and ≤ 60 %.
 *  A ratio that is not a finite number falls back to the default. */
export function clampSplitRatio(ratio: number, containerWidth: number): number {
  const r = typeof ratio === 'number' && Number.isFinite(ratio) ? ratio : SPLIT_LIST_DEFAULT_RATIO;
  const w = typeof containerWidth === 'number' && Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 0;
  const minRatio = w > 0 ? Math.min(SPLIT_LIST_MAX_RATIO, SPLIT_LIST_MIN / w) : 0;
  return Math.max(minRatio, Math.min(SPLIT_LIST_MAX_RATIO, r));
}

export interface SplitWidths {
  listWidth: number;
  detailWidth: number;
  ratio: number;
}

/** Pixel widths of the two panes for a container and a (stored) ratio. */
export function splitWidths(containerWidth: number, ratio: number = SPLIT_LIST_DEFAULT_RATIO): SplitWidths {
  const w = Math.max(0, Number.isFinite(containerWidth) ? containerWidth : 0);
  const r = clampSplitRatio(ratio, w);
  const listWidth = Math.round(w * r);
  const detailWidth = Math.max(0, Math.round(w - listWidth - SPLIT_DIVIDER));
  return { listWidth, detailWidth, ratio: r };
}

/** The ratio after dragging the divider by `dx` px from where it started. */
export function dragSplitRatio(startRatio: number, dx: number, containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return clampSplitRatio(startRatio, containerWidth);
  const startPx = clampSplitRatio(startRatio, containerWidth) * containerWidth;
  return clampSplitRatio((startPx + (Number.isFinite(dx) ? dx : 0)) / containerWidth, containerWidth);
}

/** mageid_ prefix — swept on sign-out/tenant switch (utils/localCacheKeys). */
export function splitRatioKey(splitId: string): string {
  return `mageid_split_${splitId}`;
}

/** A stored ratio, or null when what is stored is not a usable number. */
export function parseStoredRatio(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SidePanel
// ─────────────────────────────────────────────────────────────────────────────

export const SIDE_PANEL_DEFAULT = 440;
export const SIDE_PANEL_MIN = 360;
export const SIDE_PANEL_MAX = 560;
/** Under this container width the panel overlays the content instead of
 *  squeezing it: 1200 − 440 leaves 760, the form column — any less and the
 *  page beside it stops working. */
export const SIDE_PANEL_OVERLAY_BELOW = 1200;

export function clampSidePanelWidth(w: number): number {
  if (typeof w !== 'number' || !Number.isFinite(w)) return SIDE_PANEL_DEFAULT;
  return Math.round(Math.max(SIDE_PANEL_MIN, Math.min(SIDE_PANEL_MAX, w)));
}

/** 'dock' beside the content, or 'overlay' over it. An unknown container
 *  width docks (the shell's normal case on a laptop). */
export function sidePanelMode(containerWidth: number | null | undefined): 'dock' | 'overlay' {
  if (typeof containerWidth !== 'number' || !Number.isFinite(containerWidth) || containerWidth <= 0) return 'dock';
  return containerWidth < SIDE_PANEL_OVERLAY_BELOW ? 'overlay' : 'dock';
}

/** Dragging the panel's LEFT edge: moving left (negative dx) widens it. */
export function dragSidePanelWidth(startWidth: number, dx: number): number {
  return clampSidePanelWidth(clampSidePanelWidth(startWidth) - (Number.isFinite(dx) ? dx : 0));
}

export function sidePanelWidthKey(panelId: string): string {
  return `mageid_panel_${panelId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// KpiStrip
// ─────────────────────────────────────────────────────────────────────────────

export const KPI_MIN_CELLS = 4;
export const KPI_MAX_CELLS = 8;
/** Under this container width the strip wraps to two rows. */
export const KPI_WRAP_BELOW = 900;

/** Cells per row: all in one row at ≥ 900 px; two rows (ceil half) below it.
 *  Phones always take two columns — a 390 px row of 6 numbers is unreadable. */
export function kpiCellsPerRow(cellCount: number, containerWidth: number, isDesktop: boolean): number {
  const n = Math.max(0, Math.floor(cellCount));
  if (n === 0) return 0;
  if (!isDesktop) return Math.min(2, n);
  if (!Number.isFinite(containerWidth) || containerWidth <= 0 || containerWidth >= KPI_WRAP_BELOW) return n;
  return Math.ceil(n / 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// FormGrid
// ─────────────────────────────────────────────────────────────────────────────

/** Two columns from this container width. */
export const FORM_GRID_TWO_COL_MIN = 1100;
export const FORM_GRID_COL_GAP = 24;
export const FORM_GRID_ROW_GAP = 16;

export function formGridColumns(containerWidth: number, isDesktop: boolean): 1 | 2 {
  if (!isDesktop) return 1;
  return Number.isFinite(containerWidth) && containerWidth >= FORM_GRID_TWO_COL_MIN ? 2 : 1;
}

/** Width of one field slot. `full` spans both columns. */
export function formGridSlotWidth(containerWidth: number, columns: 1 | 2, span: 'half' | 'full'): number {
  const w = Math.max(0, Number.isFinite(containerWidth) ? containerWidth : 0);
  if (columns === 1 || span === 'full') return Math.floor(w);
  return Math.max(0, Math.floor((w - FORM_GRID_COL_GAP) / 2));
}
