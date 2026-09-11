// NOTE: react-native / expo-print / expo-sharing are imported LAZILY inside
// shareWipPeriodPdf. Importing them at module top level pulls react-native's
// Flow-typed entry, which crashes Bun — and scripts/validate-wip.ts imports
// wipPeriodToCSV from this module. Keeping the pure builders (wipPeriodToCSV,
// buildWipHtml) free of top-level native imports keeps the validator runnable.
// (Same pattern the crew / activation-gating validators document.)
import {
  describeWipRowSources, WIP_COST_TO_DATE_CAVEAT,
  type WipPeriodWithSources, type WipSnapshotRowWithSources,
} from '@/utils/wip';

// Each DERIVED figure is followed immediately by the branch that produced it.
// A surety's first question about a $1.4M contract is where the number came
// from, and before this the answer existed only in deriveOriginalContract's
// branch order — nowhere a GC could reach it (audit 2026-09-07, #26).
const CSV_COLUMNS = [
  'Project',
  'Revised Contract', 'Revised Contract Source',
  'Total Est Cost', 'Total Est Cost Source',
  'Cost to Date', 'Cost to Date Source',
  '% Complete', 'Earned Revenue', 'Billed to Date', 'Overbilling', 'Underbilling',
  'Est Gross Profit', 'Backlog',
];

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Pure CSV builder — CPA/QuickBooks-pasteable WIP schedule. */
export function wipPeriodToCSV(period: WipPeriodWithSources): string {
  const lines: string[] = [CSV_COLUMNS.join(',')];
  for (const r of period.rows) {
    const src = describeWipRowSources(r);
    lines.push([
      r.projectName,
      Math.round(r.output.revisedContract), src.originalContract,
      Math.round(r.input.totalEstimatedCost), src.totalEstimatedCost,
      Math.round(r.input.costToDate), src.costToDate,
      (r.output.percentComplete * 100).toFixed(1),
      Math.round(r.output.earnedRevenue),
      Math.round(r.input.billedToDate),
      Math.round(r.output.overbilling),
      Math.round(r.output.underbilling),
      Math.round(r.output.estGrossProfit),
      Math.round(r.output.backlog),
    ].map(csvCell).join(','));
  }
  const t = period.portfolioTotals;
  // The TOTAL line's source cells stay empty on purpose: a portfolio sum has no
  // single provenance, and repeating one row's branch across the total would
  // claim the whole column came from it.
  lines.push([
    'TOTAL', Math.round(t.revisedContract), '', Math.round(t.totalEstimatedCost), '',
    Math.round(t.costToDate), '', '', Math.round(t.earnedRevenue), Math.round(t.billedToDate),
    Math.round(t.overbilling), Math.round(t.underbilling),
    Math.round(t.revisedContract - t.totalEstimatedCost), Math.round(t.backlog),
  ].map(csvCell).join(','));
  // The caveat the exports used to drop rides in the Cost to Date Source cell
  // itself (WIP_SOURCE_LABELS.commitments_and_receipts) rather than as a
  // trailing note, so it lands next to the number in every row and a CPA
  // filtering the sheet cannot lose it.
  return lines.join('\n');
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function htmlRow(r: WipSnapshotRowWithSources): string {
  return `<tr>
    <td class="l">${escapeHtml(r.projectName)}</td>
    <td>${money(r.output.revisedContract)}</td>
    <td>${money(r.input.totalEstimatedCost)}</td>
    <td>${money(r.input.costToDate)}</td>
    <td>${(r.output.percentComplete * 100).toFixed(0)}%</td>
    <td>${money(r.output.earnedRevenue)}</td>
    <td>${money(r.input.billedToDate)}</td>
    <td>${money(r.output.overbilling)}</td>
    <td>${money(r.output.underbilling)}</td>
    <td>${money(r.output.estGrossProfit)}</td>
    <td>${money(r.output.backlog)}</td>
  </tr>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/**
 * The PDF's provenance footnote. This is the document that actually leaves the
 * building, and it used to print eleven columns of dollars with nothing saying
 * where any of them came from — it dropped even the "est. — tap to add labor"
 * caveat the list row on screen has always carried. A banker holding this page
 * asks one question first: what is this contract figure? The answer is here.
 */
function footnotesHtml(period: WipPeriodWithSources): string {
  const items = period.rows.map((r) => {
    const s = describeWipRowSources(r);
    return `<li><b>${escapeHtml(r.projectName)}</b><br/>`
      + `Revised contract ${money(r.output.revisedContract)} — ${escapeHtml(s.originalContract)}<br/>`
      + `Total estimated cost ${money(r.input.totalEstimatedCost)} — ${escapeHtml(s.totalEstimatedCost)}<br/>`
      + `Cost to date ${money(r.input.costToDate)} — ${escapeHtml(s.costToDate)}</li>`;
  }).join('');
  return `<div class="notes">
    <h2>Where these figures come from</h2>
    <ul>${items}</ul>
    <p class="caveat">${escapeHtml(WIP_COST_TO_DATE_CAVEAT)}</p>
  </div>`;
}

/** CPA-style WIP schedule HTML for PDF export. */
export function buildWipHtml(period: WipPeriodWithSources, companyName: string): string {
  const t = period.portfolioTotals;
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; padding: 24px; }
    h1 { font-size: 20px; margin: 0; }
    .sub { color: #666; font-size: 12px; margin: 4px 0 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th, td { border: 1px solid #ddd; padding: 5px 6px; text-align: right; }
    th { background: #f4f1ea; }
    td.l, th.l { text-align: left; }
    tfoot td { font-weight: 700; background: #faf7f0; }
    .notes { margin-top: 18px; font-size: 10px; color: #333; }
    .notes h2 { font-size: 12px; margin: 0 0 6px; }
    .notes ul { margin: 0; padding-left: 16px; }
    .notes li { margin-bottom: 6px; line-height: 1.45; }
    .caveat { margin-top: 10px; padding: 8px; background: #faf7f0; border: 1px solid #e6ded0; line-height: 1.45; }
  </style></head><body>
    <h1>${escapeHtml(companyName)} — Work-In-Progress Schedule</h1>
    <div class="sub">As of ${escapeHtml(period.periodEndDate)}${period.lockedAt ? ' · LOCKED' : ''}</div>
    <table>
      <thead><tr>
        <th class="l">Project</th><th>Revised Contract</th><th>Est Cost</th><th>Cost to Date</th>
        <th>% Comp</th><th>Earned Rev</th><th>Billed</th><th>Overbill</th><th>Underbill</th>
        <th>Est GP</th><th>Backlog</th>
      </tr></thead>
      <tbody>${period.rows.map(htmlRow).join('')}</tbody>
      <tfoot><tr>
        <td class="l">TOTAL</td><td>${money(t.revisedContract)}</td><td>${money(t.totalEstimatedCost)}</td>
        <td>${money(t.costToDate)}</td><td></td><td>${money(t.earnedRevenue)}</td><td>${money(t.billedToDate)}</td>
        <td>${money(t.overbilling)}</td><td>${money(t.underbilling)}</td>
        <td>${money(t.revisedContract - t.totalEstimatedCost)}</td><td>${money(t.backlog)}</td>
      </tr></tfoot>
    </table>
    ${footnotesHtml(period)}
  </body></html>`;
}

/** Render + share the WIP schedule as a PDF (mirrors financialReportPdf). */
export async function shareWipPeriodPdf(period: WipPeriodWithSources, companyName: string): Promise<void> {
  const Print = await import('expo-print');
  const Sharing = await import('expo-sharing');
  const { Platform } = await import('react-native');
  const html = buildWipHtml(period, companyName);
  if (Platform.OS === 'web') {
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.print(); }
    return;
  }
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `WIP Report ${period.periodEndDate}`, UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ uri });
  }
}
