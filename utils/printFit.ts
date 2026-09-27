// utils/printFit.ts — fitting a canvas wider than the sheet onto it when the
// web app prints (wave 6d restore, lane Z1).
//
// Cmd+P on the Schedule Pro Gantt (or the classic GanttChart) printed the
// timeline straight past the right edge of the sheet: it is a horizontal
// scroller many times wider than a page. hooks/usePrintFit measures the canvas
// on `beforeprint`, sets PRINT_FIT_VAR on its root to printFitZoom(…), and
// appends PRINT_PAGE_CSS (a landscape sheet) in a <style id=PRINT_PAGE_STYLE_ID>;
// components/desktop/webDocument PRINT_CSS applies
// `[data-print='fit'] { zoom: var(--mage-print-fit, 1) }`. Everything is
// removed on `afterprint`.
//
// PURE — no imports, so bun validators can load it.

/** The CSS custom property usePrintFit sets on the canvas root. */
export const PRINT_FIT_VAR = '--mage-print-fit';

/** The id of the <style> usePrintFit appends to <head> while printing. */
export const PRINT_PAGE_STYLE_ID = 'mage-print-page';

/** A landscape sheet with a 10 mm margin — only while a fitted canvas prints. */
export const PRINT_PAGE_CSS = '@page { size: landscape; margin: 10mm; }';

/**
 * The zoom that fits `neededPx` of canvas into `pagePx` of printable width:
 * never enlarged (≤ 1), never below `min` (a Gantt shrunk past legibility
 * helps nobody — it clips instead, see printFitClips), and 1 when there is
 * nothing to measure (0, negative or not a number).
 */
export function printFitZoom(neededPx: number, pagePx: number, min: number): number {
  return !(neededPx > 0) ? 1 : Math.max(min, Math.min(1, pagePx / neededPx));
}

/** True when even the smallest zoom leaves the canvas wider than the sheet
 *  (its right edge is cut off on paper). */
export function printFitClips(neededPx: number, pagePx: number, min: number): boolean {
  return neededPx * min > pagePx;
}
