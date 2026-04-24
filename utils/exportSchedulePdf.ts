// exportSchedulePdf.ts — generate a paginated PDF of the current Schedule
// Pro view. Uses expo-print's printToFileAsync under the hood.
//
// Design notes
// ------------
// We deliberately build an HTML document (not a react-native-svg snapshot)
// so the PDF stays crisp at any zoom, text remains selectable/searchable,
// and the layout reuses the same CSS grid that a browser would render.
// Every section is prefixed with "MAGE Schedule" / MAGE branding so the
// deliverable reads as ours, not MSP's.
//
// The exported PDF has three blocks:
//   1. Title block — project name, schedule window, capture date, owner
//   2. Gantt table — one row per task, left columns (#, title, start,
//      finish, duration, % complete, crew), right half is a simple CSS
//      flex bar with the task's span positioned by day offset. Critical
//      tasks render red; summaries render as a dark band.
//   3. Legend + footer — critical, non-critical, milestone, today line
//
// Long schedules page-break naturally via CSS `page-break-inside: avoid`
// on each row; we don't do explicit pagination.

import * as Print from 'expo-print';
import type { ScheduleTask } from '@/types';
import type { CpmResult } from '@/utils/cpm';
import type { NamedBaseline } from '@/utils/scheduleOps';

interface ExportOpts {
  projectName: string;
  scheduleStartIso: string | undefined;
  tasks: ScheduleTask[];
  cpm: CpmResult;
  /**
   * Optional baseline to compare against. When provided, the PDF adds
   * baseline-start / baseline-finish / variance columns and a summary
   * row of the biggest slippages at the top. Pass undefined to get the
   * classic single-plan export.
   */
  baseline?: NamedBaseline;
}

function addDays(iso: string | undefined, days: number): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (!Number.isFinite(d.getTime())) return '—';
  d.setDate(d.getDate() + days - 1);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml({ projectName, scheduleStartIso, tasks, cpm, baseline }: ExportOpts): string {
  const totalDays = Math.max(1, cpm.projectFinish);
  // Fast lookup from task id → baseline snapshot. Missing means the task
  // was added after baseline was captured — we show em-dashes rather
  // than falsely pretending it slipped from day 1.
  const baselineById = baseline
    ? new Map(baseline.tasks.map(b => [b.id, b]))
    : null;

  // Pre-compute variance summary for the header block. We include every
  // task that slipped (|endDelta| > 0) and rank by absolute slip so the
  // PM sees the worst offenders first. Cap at 5 so the summary doesn't
  // crowd out the Gantt.
  const variances: Array<{ title: string; endDelta: number }> = [];
  if (baselineById) {
    for (const t of tasks) {
      const b = baselineById.get(t.id);
      if (!b) continue;
      const end = (t.startDay ?? 1) + Math.max(0, (t.durationDays ?? 0) - 1);
      const delta = end - b.endDay;
      if (delta !== 0) variances.push({ title: t.title || 'Untitled', endDelta: delta });
    }
    variances.sort((a, b) => Math.abs(b.endDelta) - Math.abs(a.endDelta));
  }

  const rows = tasks.map((t, i) => {
    const row = cpm.perTask.get(t.id);
    const es = row?.es ?? t.startDay ?? 1;
    const ef = row?.ef ?? es + (t.durationDays ?? 0) - 1;
    const dur = t.durationDays ?? 0;
    const leftPct = ((es - 1) / totalDays) * 100;
    const widthPct = Math.max(0.3, (dur / totalDays) * 100);
    const critical = row?.isCritical;
    const isSummary = t.isSummary;
    const isMilestone = t.isMilestone || dur === 0;
    const indent = Math.max(0, (t.outlineLevel ?? 0)) * 12;

    // Baseline bar — rendered underneath the current bar so the slippage
    // is visually obvious. Grey so it doesn't fight with the plan colors.
    const bSnap = baselineById?.get(t.id);
    const baselineBar = bSnap
      ? (() => {
          const bLeftPct = ((bSnap.startDay - 1) / totalDays) * 100;
          const bDur = Math.max(1, bSnap.endDay - bSnap.startDay + 1);
          const bWidthPct = Math.max(0.3, (bDur / totalDays) * 100);
          return `<div style="position:absolute;left:${bLeftPct}%;width:${bWidthPct}%;height:4px;background:#999;opacity:0.55;top:17px;border-radius:2px;"></div>`;
        })()
      : '';

    const barStyle = isMilestone
      ? `left:calc(${leftPct}% - 4px);width:8px;height:8px;transform:rotate(45deg);background:${critical ? '#FF3B30' : '#007AFF'};top:8px;border-radius:1px;`
      : isSummary
        ? `left:${leftPct}%;width:${widthPct}%;height:6px;background:#111;top:9px;border-radius:1px;`
        : `left:${leftPct}%;width:${widthPct}%;height:14px;top:5px;background:${critical ? '#FFDDDA' : '#E5F0FF'};border:1.5px solid ${critical ? '#FF3B30' : '#007AFF'};border-radius:3px;`;

    const progress = Math.max(0, Math.min(100, t.progress ?? 0));
    const progressBar = !isSummary && !isMilestone && progress > 0
      ? `<div style="position:absolute;left:${leftPct}%;width:${(widthPct * progress) / 100}%;height:6px;background:${critical ? '#FF3B30' : '#007AFF'};opacity:0.85;top:9px;border-radius:2px;"></div>`
      : '';

    // Variance columns — only rendered when we have a baseline. We
    // color-code: red = behind (delta > 0), green = ahead (delta < 0).
    // A dash when the task didn't exist in the baseline snapshot.
    let baselineCols = '';
    if (baselineById) {
      if (bSnap) {
        const endDelta = ef - bSnap.endDay;
        const deltaClass = endDelta > 0 ? 'var-bad' : endDelta < 0 ? 'var-good' : '';
        const deltaLabel = endDelta === 0 ? '0d' : `${endDelta > 0 ? '+' : ''}${endDelta}d`;
        baselineCols = `
          <td>${addDays(scheduleStartIso, bSnap.startDay)}</td>
          <td>${addDays(scheduleStartIso, bSnap.endDay)}</td>
          <td class="num ${deltaClass}"><b>${deltaLabel}</b></td>
        `;
      } else {
        baselineCols = `<td>—</td><td>—</td><td class="num var-new"><i>new</i></td>`;
      }
    }

    return `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="title" style="padding-left:${10 + indent}px;">
          ${isSummary ? '<b>' : ''}${escapeHtml(t.title || 'Untitled')}${isSummary ? '</b>' : ''}
          ${critical ? '<span class="crit">critical</span>' : ''}
        </td>
        <td>${addDays(scheduleStartIso, es)}</td>
        <td>${addDays(scheduleStartIso, ef)}</td>
        ${baselineCols}
        <td class="num">${dur}d</td>
        <td class="num">${progress}%</td>
        <td>${escapeHtml(t.crew || '')}</td>
        <td class="timeline">
          ${baselineBar}
          <div class="bar" style="${barStyle}"></div>
          ${progressBar}
        </td>
      </tr>
    `;
  }).join('');

  const capturedOn = new Date().toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });

  // Build the slippage summary block (only when baseline is provided).
  // This is the one-glance answer to "how bad is it?" that a PM needs
  // before they open the full Gantt.
  const slippageSummary = baseline
    ? (() => {
        const behind = variances.filter(v => v.endDelta > 0);
        const ahead = variances.filter(v => v.endDelta < 0);
        const topBehind = behind.slice(0, 5);
        const worstEnd = topBehind[0]?.endDelta ?? 0;
        return `
          <div class="baseline-banner">
            <div class="baseline-banner-head">
              <div class="brand" style="color:#007AFF;">Baseline comparison</div>
              <div class="baseline-meta">
                Snapshot: <b>${escapeHtml(baseline.name)}</b>
                ${baseline.note ? ` · ${escapeHtml(baseline.note)}` : ''}
                · Captured ${new Date(baseline.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
            <div class="baseline-stats">
              <div class="stat-card ${behind.length > 0 ? 'bad' : 'neutral'}">
                <div class="stat-num">${behind.length}</div>
                <div class="stat-label">Tasks behind</div>
              </div>
              <div class="stat-card ${ahead.length > 0 ? 'good' : 'neutral'}">
                <div class="stat-num">${ahead.length}</div>
                <div class="stat-label">Tasks ahead</div>
              </div>
              <div class="stat-card ${worstEnd > 0 ? 'bad' : 'neutral'}">
                <div class="stat-num">${worstEnd > 0 ? `+${worstEnd}d` : '0d'}</div>
                <div class="stat-label">Worst slip</div>
              </div>
            </div>
            ${topBehind.length > 0
              ? `<div class="baseline-list">
                  <div class="baseline-list-title">Biggest slippages</div>
                  ${topBehind.map(v => `<div class="baseline-list-row">
                    <span class="var-bad"><b>+${v.endDelta}d</b></span>
                    <span>${escapeHtml(v.title)}</span>
                  </div>`).join('')}
                </div>`
              : '<div class="baseline-list-title" style="color:#137333;">No slippages against baseline — on plan.</div>'}
          </div>
        `;
      })()
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(projectName)} — MAGE Schedule${baseline ? ' — Baseline comparison' : ''}</title>
<style>
  @page { size: A3 landscape; margin: 18mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 12px; border-bottom: 2px solid #FF9500; margin-bottom: 18px; }
  header .brand { font-size: 12px; font-weight: 800; color: #FF9500; letter-spacing: 3px; text-transform: uppercase; }
  header h1 { font-size: 20px; margin: 4px 0 0; }
  header .meta { text-align: right; font-size: 11px; color: #555; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th { font-size: 10px; text-transform: uppercase; color: #666; text-align: left; padding: 6px 10px; border-bottom: 1.5px solid #ccc; letter-spacing: 0.5px; }
  td { font-size: 11px; padding: 5px 10px; border-bottom: 1px solid #eee; vertical-align: middle; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.title { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.timeline { position: relative; height: 24px; background: repeating-linear-gradient(to right, transparent 0 calc(100% / 30 - 1px), #f4f4f4 calc(100% / 30 - 1px) calc(100% / 30)); }
  .bar { position: absolute; }
  .crit { margin-left: 6px; font-size: 9px; color: #fff; background: #FF3B30; padding: 1px 5px; border-radius: 3px; vertical-align: middle; }
  tr { page-break-inside: avoid; }
  .legend { display: flex; gap: 18px; font-size: 10px; color: #555; margin-top: 14px; flex-wrap: wrap; }
  .legend .swatch { display: inline-block; width: 16px; height: 8px; margin-right: 5px; vertical-align: middle; border-radius: 2px; }
  footer { margin-top: 20px; font-size: 9px; color: #888; text-align: right; }

  /* Baseline-specific styles */
  .var-bad { color: #C2260F; }
  .var-good { color: #137333; }
  .var-new { color: #888; font-style: italic; }
  .baseline-banner { margin-bottom: 20px; padding: 14px 16px; border: 1px solid #DDE6F0; background: #F6FAFF; border-radius: 8px; page-break-inside: avoid; }
  .baseline-banner-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 10px; }
  .baseline-banner .brand { font-size: 11px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; }
  .baseline-meta { font-size: 10px; color: #555; text-align: right; }
  .baseline-stats { display: flex; gap: 12px; margin-bottom: 10px; }
  .stat-card { flex: 1; background: #fff; border: 1px solid #E6EDF5; border-radius: 6px; padding: 10px 12px; }
  .stat-card.bad { border-left: 3px solid #C2260F; }
  .stat-card.good { border-left: 3px solid #137333; }
  .stat-card.neutral { border-left: 3px solid #999; }
  .stat-num { font-size: 22px; font-weight: 800; color: #111; }
  .stat-label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
  .baseline-list { margin-top: 6px; }
  .baseline-list-title { font-size: 10px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .baseline-list-row { display: flex; gap: 10px; font-size: 11px; padding: 3px 0; }
  .baseline-list-row span:first-child { min-width: 48px; }
</style>
</head>
<body>
  <header>
    <div>
      <div class="brand">MAGE Schedule${baseline ? ' · Baseline Comparison' : ''}</div>
      <h1>${escapeHtml(projectName)}</h1>
    </div>
    <div class="meta">
      <div>Schedule start: <b>${scheduleStartIso || '—'}</b></div>
      <div>Span: <b>${totalDays} day${totalDays === 1 ? '' : 's'}</b> · ${tasks.length} task${tasks.length === 1 ? '' : 's'}</div>
      <div>Captured: ${capturedOn}</div>
    </div>
  </header>
  ${slippageSummary}
  <table>
    <colgroup>
      <col style="width:32px" />
      <col style="width:${baseline ? '200px' : '240px'}" />
      <col style="width:80px" />
      <col style="width:80px" />
      ${baseline ? '<col style="width:80px" /><col style="width:80px" /><col style="width:48px" />' : ''}
      <col style="width:44px" />
      <col style="width:44px" />
      <col style="width:90px" />
      <col />
    </colgroup>
    <thead>
      <tr>
        <th>#</th><th>Task</th><th>Start</th><th>Finish</th>
        ${baseline ? '<th>BL Start</th><th>BL Finish</th><th>Δ</th>' : ''}
        <th>Dur</th><th>%</th><th>Crew</th><th>Timeline</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <div class="legend">
    <div><span class="swatch" style="background:#E5F0FF;border:1.5px solid #007AFF;"></span>On-time task</div>
    <div><span class="swatch" style="background:#FFDDDA;border:1.5px solid #FF3B30;"></span>Critical</div>
    <div><span class="swatch" style="background:#111;"></span>Stack summary</div>
    <div><span class="swatch" style="background:#007AFF;width:8px;height:8px;transform:rotate(45deg);"></span>Milestone</div>
    ${baseline ? '<div><span class="swatch" style="background:#999;opacity:0.55;height:4px;"></span>Baseline bar</div><div><span class="var-bad"><b>+Nd</b></span> = behind baseline &nbsp; <span class="var-good"><b>−Nd</b></span> = ahead of baseline</div>' : ''}
  </div>
  <footer>Generated by MAGE ID · ${capturedOn}${baseline ? ` · vs baseline "${escapeHtml(baseline.name)}"` : ''}</footer>
</body>
</html>
`;
}

export async function exportSchedulePdf(opts: ExportOpts): Promise<void> {
  const html = buildHtml(opts);
  // expo-print handles web (opens print dialog) and native (returns a file
  // URI we hand to Share / save). We let the caller decide what to do with
  // the URI; here we just trigger the save/print dialog via Print.printAsync
  // which is the one call that does the right thing on both platforms.
  await Print.printAsync({ html });
}
