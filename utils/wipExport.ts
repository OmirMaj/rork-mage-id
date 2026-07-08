// NOTE: react-native / expo-print / expo-sharing are imported LAZILY inside
// shareWipPeriodPdf. Importing them at module top level pulls react-native's
// Flow-typed entry, which crashes Bun — and scripts/validate-wip.ts imports
// wipPeriodToCSV from this module. Keeping the pure builders (wipPeriodToCSV,
// buildWipHtml) free of top-level native imports keeps the validator runnable.
// (Same pattern the crew / activation-gating validators document.)
import type { WipPeriod, WipSnapshotRow } from '@/types';

const CSV_COLUMNS = [
  'Project', 'Revised Contract', 'Total Est Cost', 'Cost to Date', '% Complete',
  'Earned Revenue', 'Billed to Date', 'Overbilling', 'Underbilling',
  'Est Gross Profit', 'Backlog',
];

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Pure CSV builder — CPA/QuickBooks-pasteable WIP schedule. */
export function wipPeriodToCSV(period: WipPeriod): string {
  const lines: string[] = [CSV_COLUMNS.join(',')];
  for (const r of period.rows) {
    lines.push([
      r.projectName,
      Math.round(r.output.revisedContract),
      Math.round(r.input.totalEstimatedCost),
      Math.round(r.input.costToDate),
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
  lines.push([
    'TOTAL', Math.round(t.revisedContract), Math.round(t.totalEstimatedCost),
    Math.round(t.costToDate), '', Math.round(t.earnedRevenue), Math.round(t.billedToDate),
    Math.round(t.overbilling), Math.round(t.underbilling),
    Math.round(t.revisedContract - t.totalEstimatedCost), Math.round(t.backlog),
  ].map(csvCell).join(','));
  return lines.join('\n');
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function htmlRow(r: WipSnapshotRow): string {
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

/** CPA-style WIP schedule HTML for PDF export. */
export function buildWipHtml(period: WipPeriod, companyName: string): string {
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
  </body></html>`;
}

/** Render + share the WIP schedule as a PDF (mirrors financialReportPdf). */
export async function shareWipPeriodPdf(period: WipPeriod, companyName: string): Promise<void> {
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
