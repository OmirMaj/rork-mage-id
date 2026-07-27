// utils/ganttLabelSide.ts — pure geometry for the mobile Gantt's outside-bar
// label. No React / RN imports so it runs under Bun for the validator.
//
// Bars too narrow to fit a readable title inside render their label OUTSIDE
// the bar. The label normally sits to the RIGHT of the bar end, but for a
// short task near the right edge of the timeline that overflows the chart
// content width and gets clipped by the horizontal ScrollView — the exact
// "unlabeled 1d square" the outside-label change set out to fix. When the
// right-side label would overflow, flip it to the LEFT of the bar instead.

export type LabelSide = 'right' | 'left';

/** Default max width of the outside label text box (matches barTextOutside). */
export const OUTSIDE_LABEL_MAX_W = 150;

/**
 * Decide which side the outside label renders on.
 *
 * @param barStartX  bar's left edge x (px, from chart content origin)
 * @param barW       bar width (px)
 * @param chartW     total chart CONTENT width (px) — the scrollable timeline
 * @param labelMaxW  reserved label width (px); default OUTSIDE_LABEL_MAX_W
 * @returns 'right' when the label fits to the right of the bar without
 *          overflowing the chart content; otherwise 'left' (right-aligned,
 *          ending at the bar's left edge) so it stays inside the viewport.
 */
export function outsideLabelSide(
  barStartX: number,
  barW: number,
  chartW: number,
  labelMaxW: number = OUTSIDE_LABEL_MAX_W,
): LabelSide {
  const barEndX = barStartX + Math.max(0, barW);
  // A small gap sits between the bar end and the label (barRow gap).
  const rightRoom = chartW - barEndX;
  return rightRoom >= labelMaxW ? 'right' : 'left';
}
