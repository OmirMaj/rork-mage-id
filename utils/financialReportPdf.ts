// financialReportPdf.ts — branded PDF builders for the Reports hub.
// WIP, Profit, AR Aging — bank/owner ready.

import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { CompanyBranding } from '@/types';
import {
  pdfShell, pdfHeader, pdfTitle, pdfFooter, pdfTable,
  escHtml, fmtMoney, fmtDate, PDF_PALETTE,
} from './pdfDesign';
import type { WIPReport, ARAgingReport , ProfitRow } from './financialReports';
import { wipRowEarned, wipRowOverbilled, wipRowCostToComplete, wipReportRowHasCostBasis, profitRowHasCostBasis } from './financialReports';
import type { ReportCsvDocument } from './financialReports';
import { csvHandoverOutcome } from './wipExport';
import { describePortfolioCostBasis, type WipEstimatedCost } from './wip';

/**
 * The cost basis behind the margins in a report, as one sentence for the
 * footnote block. Same helper the two screens use, so the exported document and
 * the screen it came from cannot explain one schedule two different ways.
 * Returns '' when no row carries a basis (rows built by older code), because a
 * blank is honest and a guessed basis on a bank document is not.
 */
function costBasisNote(rows: { costAtCompletion?: WipEstimatedCost; costToDate?: number }[]): string {
  const withBasis = rows.filter(r => r.costAtCompletion != null);
  if (withBasis.length === 0) return '';
  const bases = withBasis.map(r => r.costAtCompletion as WipEstimatedCost);
  // COST paid out across the same rows, so the sentence can say when the book
  // has already spent past the cost at completion the margins are struck
  // against. A row that cannot say what it has cost makes the whole sum
  // undefined rather than short: on a document a lender reads, a partial spend
  // compared against a full cost is a false reassurance.
  const incurred = withBasis.every(r => r.costToDate != null)
    ? withBasis.reduce((sum, r) => sum + (r.costToDate ?? 0), 0)
    : undefined;
  return describePortfolioCostBasis(bases, incurred);
}

// ─── WIP PDF ─────────────────────────────────────────────────────────

function buildWIPHtml(report: WIPReport, branding: CompanyBranding): string {
  const meta = [
    { label: 'Report type', value: 'Work in Progress (WIP)' },
    { label: 'Generated',   value: fmtDate(report.asOf) },
    { label: 'Projects',    value: String(report.rows.length) },
  ];

  // WHAT THIS TABLE USED TO LEAVE OUT (audit 2026-09-11). It printed contract,
  // approved COs, revised contract and retainage — and NO cost to date, NO
  // earned revenue, NO over/under billing and NO cost to complete. Those four
  // are what an underwriter reads: earned revenue ties the schedule to the
  // income statement, over/under billing says whether the contractor is
  // financing his client, and the cost-to-date / cost-to-complete pair is how
  // profit fade is detected. `unbilled` was computed and rendered nowhere at
  // all. Every figure below already existed on the row.
  //
  // Over/(under) is ONE signed column PER ROW, the way a CPA-prepared WIP prints
  // it: positive is billed ahead of earned, parenthesised is the contractor's
  // own money in the job.
  //
  // THE TOTAL OF THAT COLUMN IS NOT A SUM (adversarial review 2026-09-11). It
  // was `overbilled − unbilled` across the book, which NETS billings in excess
  // of costs — a LIABILITY, money the owner has advanced — against costs in
  // excess of billings, an ASSET. That is the same offsetting this module's own
  // loss-provision disclosure refuses under ASC 605-35-25-46, applied to the two
  // figures a lender reads first: a book $550,000 overbilled beside $50,000
  // underbilled printed "$500,000", and a symmetric $300,000/$300,000 book
  // printed "$0" — "exactly on billing" over a $300,000 liability and a
  // $300,000 asset. Both sides are therefore printed, both positive, in the one
  // footer cell, and neither is allowed to cancel the other. (The CSV has always
  // kept them as two separate totals.)
  //
  // The Paid column was removed from this table in the same 2026-09-11 change
  // that added the four above, on the argument that cash collected is a
  // receivable figure and fifteen columns is unreadable. Restored: the spec
  // asked for additions, dropping a shipped column from a bank document was
  // nobody's request, and a downstream reader comparing last month's PDF to
  // this one would find a column simply gone. It is labelled and disclosed as
  // CASH — tax-inclusive, unlike every contract figure beside it.
  const overUnderCell = (v: number): string => {
    const color = v < 0 ? PDF_PALETTE.warning : PDF_PALETTE.text2;
    const text = v < 0 ? `(${fmtMoney(Math.abs(v))})` : fmtMoney(v);
    return `<span class="num" style="color:${color}">${text}</span>`;
  };
  const rows = report.rows.map(r => {
    const earned = wipRowEarned(r);
    const ctc = wipRowCostToComplete(r);
    const overUnder = wipRowOverbilled(r) - r.unbilled;
    const measurable = wipReportRowHasCostBasis(r);
    return [
      `<div style="font-weight:700">${escHtml(r.projectName)}</div><div style="font-size:10px;color:${PDF_PALETTE.textMuted};text-transform:capitalize">${escHtml(r.status.replace('_',' '))}</div>`,
      `<span class="num">${fmtMoney(r.contractValue)}</span>`,
      `<span class="num">${fmtMoney(r.approvedChangeOrders)}</span>`,
      `<span class="num" style="font-weight:700">${fmtMoney(r.revisedContract)}</span>`,
      // A row that cannot say what it has cost prints an em dash, not $0 — a
      // zero here reads as "this job has cost nothing", which a reader would
      // total. Same rule as the CSV.
      r.costToDate == null ? '—' : `<span class="num">${fmtMoney(r.costToDate)}</span>`,
      `<span class="num">${fmtMoney(r.estimatedFinalCost)}</span>`,
      ctc == null ? '—' : `<span class="num">${fmtMoney(ctc)}</span>`,
      `<span class="num">${r.percentComplete.toFixed(0)}%</span>`,
      `<span class="num">${fmtMoney(earned)}</span>`,
      `<span class="num">${fmtMoney(r.billedToDate)}</span>`,
      `<span class="num">${fmtMoney(r.paidToDate)}</span>`,
      overUnderCell(overUnder),
      `<span class="num">${fmtMoney(r.retainageHeld)}</span>`,
      // A CONTRACT WITH NO COST BASIS HAS NO MEASURABLE MARGIN (F14). Its
      // "projected profit" is the entire contract and its margin is 100%,
      // because the contract chain falls back to a target budget while the
      // cost chain deliberately does not. An em dash, the same rule Cost to
      // Date follows two columns over; the disclosure below the table names
      // the jobs so the suppression is not silent.
      measurable
        ? `<span class="num" style="color:${r.projectedProfit >= 0 ? PDF_PALETTE.success : PDF_PALETTE.error};font-weight:700">${fmtMoney(r.projectedProfit)}</span>`
        : '—',
      measurable
        ? `<span class="num" style="color:${r.projectedMargin >= 10 ? PDF_PALETTE.success : r.projectedMargin >= 0 ? PDF_PALETTE.warning : PDF_PALETTE.error};font-weight:700">${r.projectedMargin.toFixed(1)}%</span>`
        : '—',
    ];
  });

  const totalsRow = [
    `<div style="font-family:'Fraunces',Georgia,serif;font-weight:800;font-size:13px">PORTFOLIO</div>`,
    `<span class="num">${fmtMoney(report.totals.contractValue)}</span>`,
    `<span class="num">${fmtMoney(report.totals.approvedChangeOrders)}</span>`,
    `<span class="num">${fmtMoney(report.totals.revisedContract)}</span>`,
    `<span class="num">${fmtMoney(report.totals.costToDate)}</span>`,
    `<span class="num">${fmtMoney(report.totals.estimatedFinalCost)}</span>`,
    `<span class="num">${fmtMoney(Math.max(0, report.totals.estimatedFinalCost - report.totals.costToDate))}</span>`,
    '—',
    `<span class="num">${fmtMoney(report.totals.earnedRevenue)}</span>`,
    `<span class="num">${fmtMoney(report.totals.billedToDate)}</span>`,
    `<span class="num">${fmtMoney(report.totals.paidToDate)}</span>`,
    // BOTH SIDES, NEITHER NETTED — see the note above the row builder.
    `<span class="num">${fmtMoney(report.totals.overbilled)} over</span>`
      + `<br/><span class="num" style="color:${PDF_PALETTE.warning}">`
      + `(${fmtMoney(report.totals.unbilled)}) under</span>`,
    `<span class="num">${fmtMoney(report.totals.retainageHeld)}</span>`,
    // Σ over MEASURABLE jobs, matching the cells above it and the margin beside
    // it — the whole-book sum silently re-admitted every costless job's
    // contract as pure profit into the figure a reader totals by eye.
    `<span class="num" style="color:${report.totals.measurableProjectedProfit >= 0 ? PDF_PALETTE.success : PDF_PALETTE.error};font-weight:800">${fmtMoney(report.totals.measurableProjectedProfit)}</span>`,
    `<span class="num" style="font-weight:800">${report.totals.projectedMargin.toFixed(1)}%</span>`,
  ];

  const tableHtml = pdfTable(
    [
      { header: 'Project', width: '13%' },
      { header: 'Contract',          align: 'right', width: '6%' },
      { header: 'Approved COs',      align: 'right', width: '6%' },
      { header: 'Revised',           align: 'right', width: '6%' },
      { header: 'Cost to Date',      align: 'right', width: '6%' },
      { header: 'Est. Final Cost',   align: 'right', width: '6%' },
      { header: 'Cost to Complete',  align: 'right', width: '6%' },
      { header: '% Complete',        align: 'right', width: '5%' },
      { header: 'Earned Rev.',       align: 'right', width: '7%' },
      { header: 'Billed',            align: 'right', width: '7%' },
      { header: 'Paid',              align: 'right', width: '6%' },
      { header: 'Over/(Under)',      align: 'right', width: '8%' },
      { header: 'Retainage',         align: 'right', width: '6%' },
      { header: 'Profit',            align: 'right', width: '7%' },
      { header: 'Margin',            align: 'right', width: '5%' },
    ],
    [...rows, totalsRow],
  );

  const disclaimer = 'Estimates as of report generation date. Final costs subject to change as commitments are placed and invoices settle.';

  const bodyHtml = `
    ${pdfHeader(branding)}
    ${pdfTitle({
      eyebrow: 'Financial Report',
      title:   'Work in Progress',
      subtitle: 'Bank-ready WIP across active projects.',
      meta,
    })}
    ${tableHtml}
    <div style="margin-top:14px;padding:14px 16px;border-radius:10px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2};line-height:1.6">
      <strong style="color:${PDF_PALETTE.ink}">Methodology.</strong>
      Revised Contract = Original Contract + Approved Change Orders.
      % Complete = Cost to Date ÷ Estimated Final Cost. On a job with no cost recorded yet it is 0%,
      which means UNMEASURED, not "not started" — this schedule recognises revenue on cost only, and
      never substitutes schedule progress for it.
      Estimated Final Cost = the greatest of your estimate's cost before markup (grown by the cost of
      approved change orders), the total you have signed in subcontracts and POs, and the cost you
      have already paid out — a job cannot finish for less than what it has already cost. Where a
      cost to complete has been entered on a job in the WIP schedule, that replaces the forecast
      outright: Estimated Final Cost = Cost to Date + Cost to Complete, and every percentage, earned
      revenue and margin figure on that row is measured against it.
      Earned Revenue = Revised Contract × % Complete. Over/(Under) = Billed − Earned; a parenthesised
      figure is work performed and not yet billed, which is the contractor's own money in the job.
      The PORTFOLIO line reports both sides separately and does not net them: billings in excess of
      costs is a liability and costs in excess of billings is an asset, and a single netted figure
      would report a book that is $300,000 over on one job and $300,000 under on another as exactly
      on billing.
      Retainage is money the owner is holding out of the billings shown and is a receivable, not
      revenue. Paid is CASH collected against issued invoices — it is tax-inclusive, unlike every
      contract figure on this schedule, so it is disclosed here and never compared against them or
      used in any figure derived from them.
      Projected Profit = Revised Contract − Estimated Final Cost.
      ${report.totals.noCostBasisCount > 0
        ? escHtml(`${report.totals.noCostBasisCount} contract`
            + `${report.totals.noCostBasisCount === 1 ? '' : 's'} on this schedule, totalling `
            + `${fmtMoney(report.totals.noCostBasisContract)}, carry a contract value with no cost `
            + 'estimate, no signed subcontract or PO and nothing spent. A contract with no cost '
            + 'basis has no measurable margin, so their profit and margin cells are blank and they '
            + 'are excluded from the PORTFOLIO profit and margin rather than reported at 100%.')
        : ''}
      ${escHtml(costBasisNote(report.rows))}
    </div>
    ${pdfFooter(branding, undefined, disclaimer)}
  `;

  return pdfShell({
    bodyHtml,
    branding,
    title: `WIP Report — ${fmtDate(report.asOf)}`,
    pageMargin: '28px 22px',
  });
}

// ─── Profit PDF ──────────────────────────────────────────────────────

/**
 * THE PROFIT PDF APPLIES THE SAME NO-COST-BASIS SUPPRESSION AS THE WIP PDF
 * (F14, adversarial review 2026-09-11).
 *
 * A job carrying a contract and no cost — a target budget or a GMP cap with no
 * estimate, no signed commitment and nothing spent — reports its ENTIRE
 * contract as profit at a 100% margin. The WIP schedule beside it prints an em
 * dash for both and names the exclusion; this document printed the fabricated
 * figure, in green, with a health dot.
 *
 * `noCostBasisCount` / `noCostBasisRevenue` come straight off computeProfitReport
 * so the page, the screen and the WIP tab all exclude the same rows.
 */
function buildProfitHtml(
  rows: ProfitRow[],
  totalRevenue: number,
  totalProfit: number,
  weightedMargin: number,
  branding: CompanyBranding,
  noCostBasisCount = 0,
  noCostBasisRevenue = 0,
): string {
  const meta = [
    { label: 'Report type', value: 'Profit & Margin' },
    { label: 'Generated',   value: fmtDate(new Date().toISOString()) },
    { label: 'Projects',    value: String(rows.length) },
  ];

  const tableRows = rows.map(r => {
    const measurable = profitRowHasCostBasis(r);
    // No cost basis → no health verdict either. A green dot on a job whose
    // "margin" is its whole contract is the same fabrication as the figure.
    const dot = !measurable            ? PDF_PALETTE.textMuted
              : r.health === 'green'   ? PDF_PALETTE.success
              : r.health === 'yellow'  ? PDF_PALETTE.warning
              :                          PDF_PALETTE.error;
    return [
      `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:4px;background:${dot};display:inline-block"></span><div><div style="font-weight:700">${escHtml(r.projectName)}</div><div style="font-size:10px;color:${PDF_PALETTE.textMuted};text-transform:capitalize">${escHtml(r.status.replace('_',' '))}</div></div></div>`,
      `<span class="num">${fmtMoney(r.revenue)}</span>`,
      `<span class="num">${fmtMoney(r.costToDate)}</span>`,
      `<span class="num">${fmtMoney(r.estimatedFinalCost)}</span>`,
      measurable
        ? `<span class="num" style="color:${r.projectedProfit >= 0 ? PDF_PALETTE.success : PDF_PALETTE.error};font-weight:700">${fmtMoney(r.projectedProfit)}</span>`
        : '<span class="num">—</span>',
      measurable
        ? `<span class="num" style="color:${dot};font-weight:800">${r.projectedMargin.toFixed(1)}%</span>`
        : '<span class="num">—</span>',
    ];
  });

  const totalRow = [
    `<div style="font-family:'Fraunces',Georgia,serif;font-weight:800;font-size:13px">PORTFOLIO</div>`,
    `<span class="num">${fmtMoney(totalRevenue)}</span>`,
    '—',
    '—',
    // Both struck on the MEASURABLE subset, matching the cells above them.
    `<span class="num" style="color:${totalProfit >= 0 ? PDF_PALETTE.success : PDF_PALETTE.error};font-weight:800">${fmtMoney(totalProfit)}</span>`,
    `<span class="num" style="font-weight:800">${weightedMargin.toFixed(1)}%</span>`,
  ];

  // Suppressing a figure without saying it was suppressed is its own quiet lie.
  const noBasisHtml = noCostBasisCount > 0
    ? `<div style="margin-top:14px;padding:14px 16px;border-radius:10px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2};line-height:1.6">
        <strong style="color:${PDF_PALETTE.ink}">No cost basis — ${noCostBasisCount} project${noCostBasisCount === 1 ? '' : 's'} totalling ${fmtMoney(noCostBasisRevenue)}.</strong>
        ${noCostBasisCount === 1 ? 'It carries' : 'They carry'} a contract value with no cost estimate, no signed subcontract or PO, and nothing spent.
        A contract with no cost basis has no measurable margin, so ${noCostBasisCount === 1 ? 'it is' : 'they are'} shown with an em dash and excluded from the
        PORTFOLIO profit and margin above rather than reported at 100%.
      </div>`
    : '';

  const tableHtml = pdfTable(
    [
      { header: 'Project', width: '32%' },
      { header: 'Revenue',          align: 'right', width: '13%' },
      { header: 'Cost to Date',     align: 'right', width: '13%' },
      { header: 'Est. Final Cost',  align: 'right', width: '14%' },
      { header: 'Profit',            align: 'right', width: '14%' },
      { header: 'Margin',            align: 'right', width: '14%' },
    ],
    [...tableRows, totalRow],
  );

  const bodyHtml = `
    ${pdfHeader(branding)}
    ${pdfTitle({
      eyebrow: 'Financial Report',
      title:   'Profit by Project',
      subtitle: 'Running margin across the active portfolio.',
      meta,
    })}
    ${tableHtml}
    ${noBasisHtml}
    <div style="margin-top:14px;padding:14px 16px;border-radius:10px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2};line-height:1.6">
      <strong style="color:${PDF_PALETTE.ink}">Health bands.</strong>
      <span style="color:${PDF_PALETTE.success};font-weight:700">●</span> ≥12% margin (green) ·
      <span style="color:${PDF_PALETTE.warning};font-weight:700">●</span> 5–11% (watch) ·
      <span style="color:${PDF_PALETTE.error};font-weight:700">●</span> &lt;5% (risk).
      ${escHtml(costBasisNote(rows))}
    </div>
    ${pdfFooter(branding, undefined, 'Margins are struck against the cost at completion named above. Final outcome subject to change as the project closes out.')}
  `;

  return pdfShell({
    bodyHtml, branding,
    title: `Profit Report — ${fmtDate(new Date().toISOString())}`,
  });
}

// ─── AR Aging PDF ────────────────────────────────────────────────────

function buildARAgingHtml(report: ARAgingReport, branding: CompanyBranding): string {
  const meta = [
    { label: 'Report type', value: 'A/R Aging' },
    { label: 'Generated',   value: fmtDate(report.asOf) },
    { label: 'Open invoices', value: String(report.rows.length) },
  ];

  const bucketSummary = `
    <div style="display:flex;gap:8px;margin-bottom:18px">
      ${[
        { label: 'Current',  value: report.totals.current,  color: PDF_PALETTE.text2 },
        { label: '0–30 d',   value: report.totals['0-30'],  color: PDF_PALETTE.warning },
        { label: '31–60 d',  value: report.totals['31-60'], color: PDF_PALETTE.warning },
        { label: '61–90 d',  value: report.totals['61-90'], color: PDF_PALETTE.error },
        { label: '90+ d',    value: report.totals['90+'],   color: PDF_PALETTE.error },
      ].map(b => `
        <div style="flex:1;padding:14px 12px;border-radius:10px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone}">
          <div style="font-size:10px;font-weight:800;letter-spacing:1px;color:${PDF_PALETTE.textMuted};text-transform:uppercase">${b.label}</div>
          <div class="num" style="font-family:'Fraunces',Georgia,serif;font-size:18px;font-weight:800;color:${b.color};margin-top:4px">${fmtMoney(b.value)}</div>
        </div>
      `).join('')}
    </div>
    <div style="padding:14px 16px;border-radius:10px;background:${PDF_PALETTE.ink};color:${PDF_PALETTE.amber};margin-bottom:18px;display:flex;justify-content:space-between;align-items:baseline">
      <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:${PDF_PALETTE.cream}">Total Outstanding</div>
      <div class="num" style="font-family:'Fraunces',Georgia,serif;font-size:26px;font-weight:800">${fmtMoney(report.totals.totalOutstanding)}</div>
    </div>`;

  const rows = report.rows.map(r => {
    const bucketColor = r.bucket === 'current' ? PDF_PALETTE.text2
                      : r.bucket === '0-30'   ? PDF_PALETTE.warning
                      : r.bucket === '31-60'  ? PDF_PALETTE.warning
                      :                          PDF_PALETTE.error;
    return [
      `<div style="font-weight:700">#${escHtml(String(r.invoiceNumber))}</div><div style="font-size:10px;color:${PDF_PALETTE.textMuted}">${escHtml(r.projectName)}</div>`,
      `<span class="num">${fmtDate(r.issueDate)}</span>`,
      `<span class="num">${fmtDate(r.dueDate)}</span>`,
      `<span class="num">${fmtMoney(r.totalDue)}</span>`,
      `<span class="num">${fmtMoney(r.amountPaid)}</span>`,
      `<span class="num" style="font-weight:700">${fmtMoney(r.outstanding)}</span>`,
      `<span class="num" style="color:${bucketColor};font-weight:800">${r.bucket === 'current' ? 'Current' : r.bucket}</span>`,
    ];
  });

  const tableHtml = report.rows.length === 0
    ? `<div style="padding:40px;text-align:center;color:${PDF_PALETTE.textMuted};font-style:italic">No outstanding invoices. Nice work.</div>`
    : pdfTable(
        [
          { header: 'Invoice', width: '20%' },
          { header: 'Issued',     align: 'right', width: '12%' },
          { header: 'Due',        align: 'right', width: '12%' },
          { header: 'Total Due',  align: 'right', width: '13%' },
          { header: 'Paid',       align: 'right', width: '13%' },
          { header: 'Outstanding',align: 'right', width: '15%' },
          { header: 'Bucket',     align: 'right', width: '15%' },
        ],
        rows,
      );

  const bodyHtml = `
    ${pdfHeader(branding)}
    ${pdfTitle({
      eyebrow: 'Financial Report',
      title:   'Accounts Receivable — Aging',
      subtitle: 'Open invoices bucketed by days past due.',
      meta,
    })}
    ${bucketSummary}
    ${tableHtml}
    ${pdfFooter(branding, undefined, 'Aged from the invoice due date to the report generation date. Status updates may take up to 24h to flow back from payment processors.')}
  `;

  return pdfShell({
    bodyHtml, branding,
    title: `A/R Aging — ${fmtDate(report.asOf)}`,
  });
}

// ─── Public share helpers ────────────────────────────────────────────

async function shareHtml(html: string, title: string): Promise<void> {
  if (Platform.OS === 'web') {
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(html);
      newWindow.document.close();
      newWindow.print();
    }
    return;
  }
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ uri });
  }
}

export async function shareWIPReport(report: WIPReport, branding: CompanyBranding): Promise<void> {
  await shareHtml(buildWIPHtml(report, branding), `WIP Report ${fmtDate(report.asOf)}`);
}

export async function shareProfitReport(
  rows: ProfitRow[],
  totalRevenue: number,
  totalProfit: number,
  weightedMargin: number,
  branding: CompanyBranding,
  /** From computeProfitReport — the rows the profit and margin above exclude. */
  noCostBasisCount = 0,
  noCostBasisRevenue = 0,
): Promise<void> {
  await shareHtml(
    buildProfitHtml(rows, totalRevenue, totalProfit, weightedMargin, branding,
      noCostBasisCount, noCostBasisRevenue),
    'Profit Report',
  );
}

export async function shareARAgingReport(report: ARAgingReport, branding: CompanyBranding): Promise<void> {
  await shareHtml(buildARAgingHtml(report, branding), `A/R Aging ${fmtDate(report.asOf)}`);
}

/**
 * Hand a report CSV over as a FILE, the way every PDF above already goes — F18
 * (audit 2026-09-11), the /reports half.
 *
 * `shareWIPReport` and its two siblings have handed a document to the share
 * sheet since they shipped. The CSV beside them went to `copyToClipboard` and
 * nowhere else, on a phone: the WIP schedule is eleven columns wide plus a
 * totals line, the A/R aging is nine, and the GC's next move after tapping
 * "Copy CSV" on an iPhone is to email it to his bookkeeper — where there is no
 * attachment to email. The flagship /wip-report screen was fixed in the same
 * audit (`shareWipPeriodCsv`, utils/wipExport.ts); this is the identical defect
 * one sidebar row away, on the SAME WIP schedule, and fixing one and not the
 * other is how this codebase keeps ending up with a change wired at some call
 * sites and not others.
 *
 * THE CLIPBOARD IS STILL THE RIGHT ANSWER ON SOME PLATFORMS, so this reports
 * what it managed instead of throwing:
 *   • 'shared'      — written to cache and handed to the share sheet (native);
 *   • 'downloaded'  — the browser took the file (web: `deliverTextFile` returns
 *                     null there because there is no URI to share);
 *   • 'unavailable' — a real filesystem but no share sheet. The caller falls
 *                     back to the clipboard, which is what it used to do
 *                     unconditionally.
 * A throw from the write itself propagates: a failed export must not report a
 * successful copy, and the screen catches it and says which happened.
 *
 * `deliverTextFile` is imported lazily for the same reason `wipExport` does it —
 * it pulls `expo-file-system/legacy`, and this module is read by
 * scripts/validate-money-basis-parity.ts.
 */
export async function shareReportCsv(
  doc: ReportCsvDocument,
  csv: string,
): Promise<'shared' | 'downloaded' | 'unavailable'> {
  const { deliverTextFile, hasFileSystem } = await import('@/utils/platformFile');
  const uri = await deliverTextFile(doc.fileName, csv, 'text/csv;charset=utf-8');
  // The three-outcome mapping is a pure function in utils/wipExport, shared with
  // the flagship screen's CSV path, because the ternary that used to be inline
  // here could be inverted with every guard in the repo still green — on web
  // that reported 'unavailable' about a file the browser had already taken.
  const outcome = csvHandoverOutcome(
    uri, hasFileSystem(), uri ? await Sharing.isAvailableAsync() : false,
  );
  if (outcome !== 'shared' || !uri) return outcome;
  await Sharing.shareAsync(uri, {
    mimeType: 'text/csv',
    dialogTitle: doc.dialogTitle,
    UTI: 'public.comma-separated-values-text',
  });
  return outcome;
}
