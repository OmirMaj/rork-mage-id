// utils/printableGanttHtml.ts — pure builder for a printable, fit-to-page Gantt one-pager.
//
// Emits a self-contained landscape HTML document with an inline SVG Gantt
// (title block, week grid, task bars, FS dependency connectors, milestone
// diamonds, red critical path, a dashed "Today" line, and a legend) — the
// thing you actually hand a client or GC, instead of a plain 6-column table.
//
// Pure: no React, no I/O, no imports beyond the domain type. `buildPrintableGanttHtml`
// is deterministic given (tasks, opts) EXCEPT for the generated-on date, which the
// caller-free `todayLabel` covers — the date string is derived here for convenience
// but is the only impurity and it does not affect layout. Consumed by schedule-pro's
// `handleAirPrint` through expo-print (`Print.printAsync({ html })`).
//
// Geometry mirrors InteractiveGantt so the print reads like the on-screen chart:
//   x = LABEL_W + (startDay - 1) * px ; barW = max(3, durationDays * px)
//   y = HEADER_H + i * ROW_H          ; today x = LABEL_W + (todayDayNumber - 1) * px
import type { ScheduleTask } from '../types';

export interface PrintableGanttOpts {
  projectName: string;
  /** 1-based day index of "today" on the project timeline (same value the Gantt uses). */
  todayDayNumber: number;
  /** Project finish in days — sets the horizontal scale so the chart fits one page. */
  totalDays: number;
  /** Optional pre-formatted date for the subtitle (keeps the fn pure when supplied). */
  generatedOnLabel?: string;
}

// ── Layout constants (px). Chosen so a ~3-month plan fits a landscape A4/Letter. ──
const LABEL_W = 190;   // left task-title column
const HEADER_H = 40;   // title strip + week axis
const ROW_H = 22;      // one task row
const BAR_H = 12;      // task bar thickness
const RIGHT_PAD = 24;
const LEGEND_H = 34;
const MS_HALF = 6;     // milestone diamond half-size

// ── Palette (plain hex — this file emits an HTML/SVG string, not RN styles, so
// the design-token lint does not apply; kept named for readability). ──
const C_CRIT = '#b91c1c';       // critical-path bar
const C_BAR = '#4b5563';        // normal bar
const C_PROGRESS = '#1f2937';   // % complete overlay
const C_SUMMARY = '#111827';    // summary (WBS parent) bar
const C_MS = '#1f2937';         // milestone diamond
const C_MS_LAST = '#FF5A51';    // final milestone (project completion) — matches on-screen
const C_DEP = '#9ca3af';        // dependency connector
const C_TODAY = '#2563eb';      // today line
const C_GRID = '#e5e7eb';       // week gridline
const C_TEXT = '#111827';
const C_MUTED = '#6b7280';

/** HTML/XML-escape a string for safe interpolation into markup. */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const isMilestoneTask = (t: ScheduleTask): boolean => !!t.isMilestone || (t.durationDays ?? 0) === 0;

export function buildPrintableGanttHtml(tasks: ScheduleTask[], opts: PrintableGanttOpts): string {
  const { projectName, todayDayNumber } = opts;
  const totalDays = Math.max(1, Math.floor(opts.totalDays));
  // Fit horizontally: scale so totalDays fills a ~980px canvas, clamped 2..24 px/day.
  const px = Math.max(2, Math.min(24, Math.floor(980 / totalDays)));
  const chartW = totalDays * px;
  const canvasW = LABEL_W + chartW + RIGHT_PAD;
  const bodyH = HEADER_H + tasks.length * ROW_H;
  const canvasH = bodyH + LEGEND_H;

  // Row midline + bar geometry for a task at index i.
  const rowMidY = (i: number) => HEADER_H + i * ROW_H + ROW_H / 2;
  const barX = (t: ScheduleTask) => LABEL_W + Math.max(0, (t.startDay ?? 1) - 1) * px;
  const barW = (t: ScheduleTask) => Math.max(3, (t.durationDays ?? 0) * px);

  // Final milestone = the milestone with the latest start day (project completion).
  const milestones = tasks.filter(isMilestoneTask);
  const lastMilestoneId = milestones.length
    ? milestones.reduce((a, b) => ((b.startDay ?? 0) >= (a.startDay ?? 0) ? b : a)).id
    : null;

  const idIndex = new Map<string, number>();
  tasks.forEach((t, i) => idIndex.set(t.id, i));

  // ── Week gridlines + day-number axis labels ──
  const weekLines: string[] = [];
  for (let d = 0; d <= totalDays; d += 7) {
    const gx = LABEL_W + d * px;
    weekLines.push(`<line x1="${gx}" y1="${HEADER_H}" x2="${gx}" y2="${bodyH}" stroke="${C_GRID}" stroke-width="1" />`);
    weekLines.push(`<text x="${gx + 2}" y="${HEADER_H - 6}" font-size="8" fill="${C_MUTED}">D${d + 1}</text>`);
  }

  // ── Dependency connectors: pred right edge → succ left edge (orthogonal FS). ──
  const depLines: string[] = [];
  tasks.forEach((t, i) => {
    for (const predId of t.dependencies ?? []) {
      const pi = idIndex.get(predId);
      if (pi === undefined) continue;
      const pred = tasks[pi];
      const x1 = barX(pred) + barW(pred);
      const y1 = rowMidY(pi);
      const x2 = barX(t);
      const y2 = rowMidY(i);
      const midX = Math.max(x1 + 6, x2 - 6);
      // Orthogonal elbow: out from pred, across, into succ, then a small arrowhead.
      depLines.push(
        `<path d="M ${x1} ${y1} H ${midX} V ${y2} H ${x2}" fill="none" stroke="${C_DEP}" stroke-width="1" />`,
      );
      depLines.push(
        `<polygon points="${x2},${y2} ${x2 - 5},${y2 - 3} ${x2 - 5},${y2 + 3}" fill="${C_DEP}" />`,
      );
    }
  });

  // ── Rows: left label + bar / milestone / summary ──
  const rows: string[] = [];
  tasks.forEach((t, i) => {
    const midY = rowMidY(i);
    const indent = (t.outlineLevel ?? 0) * 12;
    const isSummary = !!t.isSummary;
    const labelWeight = isSummary ? '700' : '400';
    const label = esc(t.title ?? '');
    const clipped = label.length > 30 ? label.slice(0, 29) + '…' : label;
    rows.push(
      `<text x="${6 + indent}" y="${midY + 3}" font-size="9" font-weight="${labelWeight}" fill="${C_TEXT}">${clipped}</text>`,
    );

    if (isMilestoneTask(t)) {
      const cx = barX(t);
      const fill = t.id === lastMilestoneId ? C_MS_LAST : C_MS;
      rows.push(
        `<polygon points="${cx},${midY - MS_HALF} ${cx + MS_HALF},${midY} ${cx},${midY + MS_HALF} ${cx - MS_HALF},${midY}" fill="${fill}" />`,
      );
      return;
    }

    const x = barX(t);
    const w = barW(t);
    const y = midY - BAR_H / 2;
    if (isSummary) {
      // WBS parent: a slim dark spanning bar with down-turned end caps.
      rows.push(`<rect x="${x}" y="${y + 3}" width="${w}" height="4" fill="${C_SUMMARY}" />`);
      rows.push(`<polygon points="${x},${y + 3} ${x + 6},${y + 3} ${x},${y + 11}" fill="${C_SUMMARY}" />`);
      rows.push(`<polygon points="${x + w},${y + 3} ${x + w - 6},${y + 3} ${x + w},${y + 11}" fill="${C_SUMMARY}" />`);
      return;
    }

    const fill = t.isCriticalPath ? C_CRIT : C_BAR;
    rows.push(`<rect x="${x}" y="${y}" width="${w}" height="${BAR_H}" rx="2" fill="${fill}" />`);
    const pct = Math.max(0, Math.min(100, Math.round(t.progress ?? 0)));
    if (pct > 0) {
      rows.push(`<rect x="${x}" y="${y}" width="${(w * pct) / 100}" height="${BAR_H}" rx="2" fill="${C_PROGRESS}" fill-opacity="0.55" />`);
    }
  });

  // ── Today line ──
  let todayEl = '';
  if (todayDayNumber >= 1 && todayDayNumber <= totalDays + 1) {
    const tx = LABEL_W + (todayDayNumber - 1) * px;
    todayEl =
      `<line x1="${tx}" y1="${HEADER_H - 12}" x2="${tx}" y2="${bodyH}" stroke="${C_TODAY}" stroke-width="1.5" stroke-dasharray="4 3" />` +
      `<text x="${tx + 3}" y="${HEADER_H - 14}" font-size="8" font-weight="700" fill="${C_TODAY}">Today</text>`;
  }

  // ── Legend ──
  const legendY = bodyH + 20;
  const legend =
    `<g font-size="9" fill="${C_TEXT}">` +
    `<rect x="${LABEL_W}" y="${legendY - 8}" width="12" height="8" fill="${C_CRIT}" /><text x="${LABEL_W + 16}" y="${legendY}">Critical path</text>` +
    `<rect x="${LABEL_W + 100}" y="${legendY - 8}" width="12" height="8" fill="${C_BAR}" /><text x="${LABEL_W + 116}" y="${legendY}">Task</text>` +
    `<polygon points="${LABEL_W + 168},${legendY - 4} ${LABEL_W + 174},${legendY} ${LABEL_W + 168},${legendY + 4} ${LABEL_W + 162},${legendY}" fill="${C_MS}" /><text x="${LABEL_W + 180}" y="${legendY}">Milestone</text>` +
    `<line x1="${LABEL_W + 250}" y1="${legendY - 8}" x2="${LABEL_W + 250}" y2="${legendY + 2}" stroke="${C_TODAY}" stroke-width="1.5" stroke-dasharray="3 2" /><text x="${LABEL_W + 256}" y="${legendY}">Today</text>` +
    `</g>`;

  const generatedOn = opts.generatedOnLabel ?? new Date().toLocaleDateString();

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(projectName)} — Schedule</title>
<style>
  @page { size: landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, "Segoe UI", sans-serif; margin: 0; padding: 20px; color: ${C_TEXT}; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  p.sub { color: ${C_MUTED}; font-size: 11px; margin: 0 0 14px; }
  .chart { width: 100%; overflow: hidden; }
  svg { width: 100%; height: auto; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>${esc(projectName)}</h1>
  <p class="sub">Gantt schedule from MAGE ID &nbsp;·&nbsp; ${esc(generatedOn)} &nbsp;·&nbsp; ${totalDays} day plan</p>
  <div class="chart">
    <svg viewBox="0 0 ${canvasW} ${canvasH}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMinYMin meet">
      <rect x="0" y="0" width="${canvasW}" height="${canvasH}" fill="#ffffff" />
      <line x1="${LABEL_W}" y1="${HEADER_H}" x2="${LABEL_W}" y2="${bodyH}" stroke="${C_GRID}" stroke-width="1" />
      ${weekLines.join('\n      ')}
      ${depLines.join('\n      ')}
      ${rows.join('\n      ')}
      ${todayEl}
      ${legend}
    </svg>
  </div>
</body>
</html>`;
}
