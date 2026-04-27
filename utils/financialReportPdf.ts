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
import type { WIPReport, ARAgingReport } from './financialReports';
import type { ProfitRow } from './financialReports';

// ─── WIP PDF ─────────────────────────────────────────────────────────

function buildWIPHtml(report: WIPReport, branding: CompanyBranding): string {
  const meta = [
    { label: 'Report type', value: 'Work in Progress (WIP)' },
    { label: 'Generated',   value: fmtDate(report.asOf) },
    { label: 'Projects',    value: String(report.rows.length) },
  ];

  const rows = report.rows.map(r => [
    `<div style="font-weight:700">${escHtml(r.projectName)}</div><div style="font-size:10px;color:${PDF_PALETTE.textMuted};text-transform:capitalize">${escHtml(r.status.replace('_',' '))}</div>`,
    `<span class="num">${fmtMoney(r.contractValue)}</span>`,
    `<span class="num">${fmtMoney(r.approvedChangeOrders)}</span>`,
    `<span class="num" style="font-weight:700">${fmtMoney(r.revisedContract)}</span>`,
    `<span class="num">${r.percentComplete.toFixed(0)}%</span>`,
    `<span class="num">${fmtMoney(r.billedToDate)}</span>`,
    `<span class="num">${fmtMoney(r.paidToDate)}</span>`,
    `<span class="num">${fmtMoney(r.retainageHeld)}</span>`,
    `<span class="num">${fmtMoney(r.estimatedFinalCost)}</span>`,
    `<span class="num" style="color:${r.projectedProfit >= 0 ? PDF_PALETTE.success : PDF_PALETTE.error};font-weight:700">${fmtMoney(r.projectedProfit)}</span>`,
    `<span class="num" style="color:${r.projectedMargin >= 10 ? PDF_PALETTE.success : r.projectedMargin >= 0 ? PDF_PALETTE.warning : PDF_PALETTE.error};font-weight:700">${r.projectedMargin.toFixed(1)}%</span>`,
  ]);

  const totalsRow = [
    `<div style="font-family:'Fraunces',Georgia,serif;font-weight:800;font-size:13px">PORTFOLIO</div>`,
    `<span class="num">${fmtMoney(report.totals.contractValue)}</span>`,
    `<span class="num">${fmtMoney(report.totals.approvedChangeOrders)}</span>`,
    `<span class="num">${fmtMoney(report.totals.revisedContract)}</span>`,
    '—',
    `<span class="num">${fmtMoney(report.totals.billedToDate)}</span>`,
    `<span class="num">${fmtMoney(report.totals.paidToDate)}</span>`,
    `<span class="num">${fmtMoney(report.totals.retainageHeld)}</span>`,
    `<span class="num">${fmtMoney(report.totals.estimatedFinalCost)}</span>`,
    `<span class="num" style="color:${report.totals.projectedProfit >= 0 ? PDF_PALETTE.success : PDF_PALETTE.error};font-weight:800">${fmtMoney(report.totals.projectedProfit)}</span>`,
    `<span class="num" style="font-weight:800">${report.totals.projectedMargin.toFixed(1)}%</span>`,
  ];

  const tableHtml = pdfTable(
    [
      { header: 'Project', width: '17%' },
      { header: 'Contract',          align: 'right', width: '8%' },
      { header: 'Approved COs',      align: 'right', width: '8%' },
      { header: 'Revised',           align: 'right', width: '9%' },
      { header: '% Complete',        align: 'right', width: '7%' },
      { header: 'Billed',            align: 'right', width: '8%' },
      { header: 'Paid',              align: 'right', width: '8%' },
      { header: 'Retainage',         align: 'right', width: '8%' },
      { header: 'Est. Final Cost',   align: 'right', width: '9%' },
      { header: 'Profit',            align: 'right', width: '9%' },
      { header: 'Margin',            align: 'right', width: '6%' },
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
      % Complete = Billed to Date ÷ Revised Contract.
      Estimated Final Cost = Actual Spend + (Committed − Spent) + max(0, Budget − Committed).
      Projected Profit = Revised Contract − Estimated Final Cost.
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

function buildProfitHtml(
  rows: ProfitRow[],
  totalRevenue: number,
  totalProfit: number,
  weightedMargin: number,
  branding: CompanyBranding,
): string {
  const meta = [
    { label: 'Report type', value: 'Profit & Margin' },
    { label: 'Generated',   value: fmtDate(new Date().toISOString()) },
    { label: 'Projects',    value: String(rows.length) },
  ];

  const tableRows = rows.map(r => {
    const dot = r.health === 'green'  ? PDF_PALETTE.success
              : r.health === 'yellow' ? PDF_PALETTE.warning
              :                         PDF_PALETTE.error;
    return [
      `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:4px;background:${dot};display:inline-block"></span><div><div style="font-weight:700">${escHtml(r.projectName)}</div><div style="font-size:10px;color:${PDF_PALETTE.textMuted};text-transform:capitalize">${escHtml(r.status.replace('_',' '))}</div></div></div>`,
      `<span class="num">${fmtMoney(r.revenue)}</span>`,
      `<span class="num">${fmtMoney(r.costToDate)}</span>`,
      `<span class="num">${fmtMoney(r.estimatedFinalCost)}</span>`,
      `<span class="num" style="color:${r.projectedProfit >= 0 ? PDF_PALETTE.success : PDF_PALETTE.error};font-weight:700">${fmtMoney(r.projectedProfit)}</span>`,
      `<span class="num" style="color:${dot};font-weight:800">${r.projectedMargin.toFixed(1)}%</span>`,
    ];
  });

  const totalRow = [
    `<div style="font-family:'Fraunces',Georgia,serif;font-weight:800;font-size:13px">PORTFOLIO</div>`,
    `<span class="num">${fmtMoney(totalRevenue)}</span>`,
    '—',
    '—',
    `<span class="num" style="color:${totalProfit >= 0 ? PDF_PALETTE.success : PDF_PALETTE.error};font-weight:800">${fmtMoney(totalProfit)}</span>`,
    `<span class="num" style="font-weight:800">${weightedMargin.toFixed(1)}%</span>`,
  ];

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
    <div style="margin-top:14px;padding:14px 16px;border-radius:10px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2};line-height:1.6">
      <strong style="color:${PDF_PALETTE.ink}">Health bands.</strong>
      <span style="color:${PDF_PALETTE.success};font-weight:700">●</span> ≥12% margin (green) ·
      <span style="color:${PDF_PALETTE.warning};font-weight:700">●</span> 5–11% (watch) ·
      <span style="color:${PDF_PALETTE.error};font-weight:700">●</span> &lt;5% (risk).
    </div>
    ${pdfFooter(branding, undefined, 'Margins use the projected final cost from the job-cost engine. Final outcome subject to change as the project closes out.')}
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
): Promise<void> {
  await shareHtml(buildProfitHtml(rows, totalRevenue, totalProfit, weightedMargin, branding), 'Profit Report');
}

export async function shareARAgingReport(report: ARAgingReport, branding: CompanyBranding): Promise<void> {
  await shareHtml(buildARAgingHtml(report, branding), `A/R Aging ${fmtDate(report.asOf)}`);
}
