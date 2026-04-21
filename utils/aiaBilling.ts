import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { CompanyBranding, Project, Invoice, ChangeOrder } from '@/types';

// ──────────────────────────────────────────────────────────────────────────────
// AIA G702/G703 progress pay application generator
// G702 = cover summary (totals, retention, amount due this period)
// G703 = continuation sheet (schedule of values line-by-line with % complete)
// ──────────────────────────────────────────────────────────────────────────────

export interface AIASOVLine {
  id: string;
  itemNo: string;          // "1.0", "2.1", etc.
  description: string;
  scheduledValue: number;  // column C
  fromPreviousApp: number; // column D — work completed before this period
  thisPeriod: number;      // column E — work completed this period
  materialsPresentlyStored: number; // column F
  retainagePercent: number; // default from cover
}

export interface AIAPayApplication {
  applicationNumber: number;
  applicationDate: string;  // ISO
  periodTo: string;          // ISO — end of billing period
  contractDate?: string;

  ownerName: string;
  contractorName: string;
  architectName?: string;
  projectName: string;
  projectLocation?: string;
  contractForDescription?: string;

  originalContractSum: number;
  netChangeByCO: number;        // sum of approved COs through this period
  contractSumToDate: number;    // = originalContractSum + netChangeByCO

  retainagePercent: number;     // typically 5-10

  // Previous certificate values (from prior pay apps, if known)
  lessPreviousCertificates: number;

  lines: AIASOVLine[];
  notes?: string;
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Compute the derived totals for a G702 cover from the SOV lines.
 */
export function computeAIATotals(app: AIAPayApplication) {
  const totalCompletedAndStored = app.lines.reduce(
    (s, l) => s + l.fromPreviousApp + l.thisPeriod + l.materialsPresentlyStored,
    0,
  );
  const totalScheduledValue = app.lines.reduce((s, l) => s + l.scheduledValue, 0);
  const retainageOnCompleted = app.lines.reduce(
    (s, l) => s + (l.fromPreviousApp + l.thisPeriod) * (l.retainagePercent / 100),
    0,
  );
  const retainageOnStored = app.lines.reduce(
    (s, l) => s + l.materialsPresentlyStored * (l.retainagePercent / 100),
    0,
  );
  const totalRetainage = retainageOnCompleted + retainageOnStored;
  const totalEarnedLessRetainage = totalCompletedAndStored - totalRetainage;
  const currentPaymentDue = totalEarnedLessRetainage - app.lessPreviousCertificates;
  const balanceToFinish = app.contractSumToDate - totalEarnedLessRetainage;
  const percentComplete = totalScheduledValue > 0
    ? (totalCompletedAndStored / totalScheduledValue) * 100
    : 0;

  return {
    totalCompletedAndStored,
    totalScheduledValue,
    retainageOnCompleted,
    retainageOnStored,
    totalRetainage,
    totalEarnedLessRetainage,
    currentPaymentDue,
    balanceToFinish,
    percentComplete,
  };
}

/**
 * Prefill an AIA pay application from a MAGE ID invoice + project + approved COs.
 * Lines are seeded from the invoice's lineItems, with `thisPeriod` = line total (contractor
 * can edit on the screen).
 */
export function seedAIAPayApplicationFromInvoice(
  invoice: Invoice,
  project: Project,
  approvedCOs: ChangeOrder[],
  branding: CompanyBranding,
  opts?: {
    lessPreviousCertificates?: number;
    retainagePercent?: number;
    applicationNumber?: number;
    architectName?: string;
    ownerName?: string;
  },
): AIAPayApplication {
  const retainagePercent = opts?.retainagePercent ?? invoice.retentionPercent ?? 10;
  const originalContractSum = project.estimate?.grandTotal ?? 0;
  const netChangeByCO = approvedCOs.reduce((s, co) => s + co.changeAmount, 0);
  const contractSumToDate = originalContractSum + netChangeByCO;

  const lines: AIASOVLine[] = invoice.lineItems.map((li, i) => ({
    id: li.id,
    itemNo: String(i + 1),
    description: [li.name, li.description].filter(Boolean).join(' — '),
    scheduledValue: li.total,
    fromPreviousApp: 0,
    thisPeriod: li.total,
    materialsPresentlyStored: 0,
    retainagePercent,
  }));

  return {
    applicationNumber: opts?.applicationNumber ?? invoice.number,
    applicationDate: invoice.issueDate,
    periodTo: invoice.issueDate,
    contractDate: undefined,
    ownerName: opts?.ownerName ?? '',
    contractorName: branding.companyName ?? 'Contractor',
    architectName: opts?.architectName,
    projectName: project.name,
    projectLocation: project.location,
    contractForDescription: project.description,
    originalContractSum,
    netChangeByCO,
    contractSumToDate,
    retainagePercent,
    lessPreviousCertificates: opts?.lessPreviousCertificates ?? 0,
    lines,
    notes: invoice.notes,
  };
}

/**
 * Build the HTML for a G702+G703 pay application. Paginates naturally via @media print.
 */
export function buildAIAPayAppHtml(
  app: AIAPayApplication,
  branding: CompanyBranding,
): string {
  const totals = computeAIATotals(app);

  const logoBlock = branding.logoUri
    ? `<img src="${escapeHtml(branding.logoUri)}" class="logo" alt="logo" />`
    : '';

  const g703Rows = app.lines.map((l, i) => {
    const totalCompleted = l.fromPreviousApp + l.thisPeriod;
    const totalCompletedAndStored = totalCompleted + l.materialsPresentlyStored;
    const pct = l.scheduledValue > 0
      ? (totalCompletedAndStored / l.scheduledValue) * 100
      : 0;
    const balanceToFinish = l.scheduledValue - totalCompletedAndStored;
    const retainage = totalCompletedAndStored * (l.retainagePercent / 100);
    return `
      <tr class="${i % 2 === 0 ? 'alt' : ''}">
        <td class="ctr">${escapeHtml(l.itemNo)}</td>
        <td>${escapeHtml(l.description)}</td>
        <td class="num">${fmt(l.scheduledValue)}</td>
        <td class="num">${fmt(l.fromPreviousApp)}</td>
        <td class="num">${fmt(l.thisPeriod)}</td>
        <td class="num">${fmt(l.materialsPresentlyStored)}</td>
        <td class="num">${fmt(totalCompletedAndStored)}</td>
        <td class="num">${pct.toFixed(1)}%</td>
        <td class="num">${fmt(balanceToFinish)}</td>
        <td class="num">${fmt(retainage)}</td>
      </tr>
    `;
  }).join('');

  // G703 footer totals row
  const sumCol = (key: 'scheduledValue' | 'fromPreviousApp' | 'thisPeriod' | 'materialsPresentlyStored') =>
    app.lines.reduce((s, l) => s + (l[key] as number), 0);

  const g703TotalScheduled = sumCol('scheduledValue');
  const g703TotalFromPrev = sumCol('fromPreviousApp');
  const g703TotalThisPeriod = sumCol('thisPeriod');
  const g703TotalStored = sumCol('materialsPresentlyStored');
  const g703TotalCompletedStored = g703TotalFromPrev + g703TotalThisPeriod + g703TotalStored;
  const g703TotalRetainage = app.lines.reduce(
    (s, l) => s + (l.fromPreviousApp + l.thisPeriod + l.materialsPresentlyStored) * (l.retainagePercent / 100),
    0,
  );

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    color: #111;
    margin: 0;
    padding: 0;
  }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }

  .form-header {
    border: 2px solid #111;
    padding: 8px 12px;
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .form-header .title-block { flex: 1; }
  .form-header h1 {
    margin: 0 0 2px 0;
    font-size: 14px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .form-header .form-number {
    font-size: 9px;
    color: #555;
    letter-spacing: 1px;
  }
  .logo { max-height: 44px; max-width: 140px; object-fit: contain; }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
  .info-box {
    border: 1px solid #111;
    padding: 6px 10px;
  }
  .info-box .label {
    display: block;
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #555;
    margin-bottom: 2px;
  }
  .info-box .value { font-size: 11px; font-weight: 600; }

  .app-meta {
    border: 1px solid #111;
    padding: 8px 10px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-bottom: 10px;
  }

  table { width: 100%; border-collapse: collapse; }
  table.cover th, table.cover td {
    border: 1px solid #111;
    padding: 4px 8px;
    vertical-align: top;
    font-size: 10px;
  }
  table.cover td.num, table.cover th.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.cover .line-label {
    font-weight: 600;
    background: #f5f5f5;
  }
  table.cover .grand {
    background: #111;
    color: #fff;
    font-weight: 700;
    font-size: 11px;
  }

  .cert-block {
    border: 1px solid #111;
    padding: 10px;
    margin-top: 10px;
    font-size: 9px;
    line-height: 1.4;
  }
  .cert-block .cert-body {
    margin-bottom: 20px;
  }
  .cert-block .sig-row {
    display: flex;
    gap: 20px;
    margin-top: 20px;
  }
  .cert-block .sig-col {
    flex: 1;
    border-top: 1px solid #111;
    padding-top: 4px;
    font-size: 9px;
  }

  /* G703 continuation sheet */
  table.g703 {
    font-size: 8.5px;
    margin-top: 6px;
  }
  table.g703 th, table.g703 td {
    border: 1px solid #111;
    padding: 3px 4px;
    vertical-align: top;
  }
  table.g703 thead th {
    background: #111;
    color: #fff;
    font-weight: 700;
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  table.g703 tr.alt td { background: #f9f9f9; }
  table.g703 td.num, table.g703 th.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.g703 td.ctr, table.g703 th.ctr { text-align: center; }
  table.g703 tfoot td {
    font-weight: 700;
    background: #111;
    color: #fff;
  }

  .page-footer {
    position: fixed;
    bottom: 0.25in;
    left: 0.5in;
    right: 0.5in;
    text-align: center;
    font-size: 8px;
    color: #666;
    letter-spacing: 0.5px;
  }
</style>
</head>
<body>

<!-- ═════════ PAGE 1: G702 COVER ═════════ -->
<div class="page">
  <div class="form-header">
    <div class="title-block">
      <h1>Application and Certificate for Payment</h1>
      <div class="form-number">AIA-Style Document G702 · Progress Billing</div>
    </div>
    ${logoBlock}
  </div>

  <div class="grid-2">
    <div class="info-box">
      <span class="label">To Owner</span>
      <div class="value">${escapeHtml(app.ownerName || '—')}</div>
    </div>
    <div class="info-box">
      <span class="label">From Contractor</span>
      <div class="value">${escapeHtml(app.contractorName)}</div>
    </div>
  </div>

  <div class="grid-2">
    <div class="info-box">
      <span class="label">Project</span>
      <div class="value">${escapeHtml(app.projectName)}</div>
      ${app.projectLocation ? `<div style="font-size:9px;color:#555;margin-top:2px">${escapeHtml(app.projectLocation)}</div>` : ''}
    </div>
    <div class="info-box">
      <span class="label">Via Architect</span>
      <div class="value">${escapeHtml(app.architectName || '—')}</div>
    </div>
  </div>

  <div class="app-meta">
    <div>
      <span class="label" style="font-size:8px;color:#555;text-transform:uppercase;letter-spacing:0.5px;">Application No.</span>
      <div style="font-size:14px;font-weight:700;">#${app.applicationNumber}</div>
    </div>
    <div>
      <span class="label" style="font-size:8px;color:#555;text-transform:uppercase;letter-spacing:0.5px;">Period To</span>
      <div style="font-size:11px;font-weight:600;">${fmtDate(app.periodTo)}</div>
    </div>
    <div>
      <span class="label" style="font-size:8px;color:#555;text-transform:uppercase;letter-spacing:0.5px;">Application Date</span>
      <div style="font-size:11px;font-weight:600;">${fmtDate(app.applicationDate)}</div>
    </div>
  </div>

  <!-- Application summary -->
  <table class="cover">
    <tbody>
      <tr>
        <td class="line-label" style="width:70%;">1. Original Contract Sum</td>
        <td class="num">$ ${fmt(app.originalContractSum)}</td>
      </tr>
      <tr>
        <td class="line-label">2. Net Change by Change Orders</td>
        <td class="num">${app.netChangeByCO >= 0 ? '' : '-'}$ ${fmt(Math.abs(app.netChangeByCO))}</td>
      </tr>
      <tr>
        <td class="line-label">3. Contract Sum to Date (Line 1 ± 2)</td>
        <td class="num">$ ${fmt(app.contractSumToDate)}</td>
      </tr>
      <tr>
        <td class="line-label">4. Total Completed &amp; Stored to Date (Column G on G703)</td>
        <td class="num">$ ${fmt(totals.totalCompletedAndStored)}</td>
      </tr>
      <tr>
        <td class="line-label">5. Retainage</td>
        <td class="num"></td>
      </tr>
      <tr>
        <td style="padding-left:24px;">&nbsp;&nbsp;&nbsp;a. ${app.retainagePercent}% of Completed Work</td>
        <td class="num">$ ${fmt(totals.retainageOnCompleted)}</td>
      </tr>
      <tr>
        <td style="padding-left:24px;">&nbsp;&nbsp;&nbsp;b. ${app.retainagePercent}% of Stored Material</td>
        <td class="num">$ ${fmt(totals.retainageOnStored)}</td>
      </tr>
      <tr>
        <td style="padding-left:24px;"><b>&nbsp;&nbsp;&nbsp;Total Retainage</b></td>
        <td class="num"><b>$ ${fmt(totals.totalRetainage)}</b></td>
      </tr>
      <tr>
        <td class="line-label">6. Total Earned Less Retainage (Line 4 − 5)</td>
        <td class="num">$ ${fmt(totals.totalEarnedLessRetainage)}</td>
      </tr>
      <tr>
        <td class="line-label">7. Less Previous Certificates for Payment</td>
        <td class="num">$ ${fmt(app.lessPreviousCertificates)}</td>
      </tr>
      <tr class="grand">
        <td>8. CURRENT PAYMENT DUE</td>
        <td class="num">$ ${fmt(totals.currentPaymentDue)}</td>
      </tr>
      <tr>
        <td class="line-label">9. Balance to Finish, Including Retainage (Line 3 − 6)</td>
        <td class="num">$ ${fmt(totals.balanceToFinish)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Change order summary -->
  <table class="cover" style="margin-top:10px;">
    <thead>
      <tr>
        <th>Change Order Summary</th>
        <th class="num">Additions</th>
        <th class="num">Deductions</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Net change by Change Orders</td>
        <td class="num">$ ${fmt(Math.max(0, app.netChangeByCO))}</td>
        <td class="num">$ ${fmt(Math.max(0, -app.netChangeByCO))}</td>
      </tr>
    </tbody>
  </table>

  <!-- Certification -->
  <div class="cert-block">
    <div class="cert-body">
      <b>CONTRACTOR'S CERTIFICATION:</b> The undersigned Contractor certifies that to the best of the Contractor's knowledge, information and belief the Work covered by this Application for Payment has been completed in accordance with the Contract Documents, that all amounts have been paid by the Contractor for Work for which previous Certificates for Payment were issued and payments received from the Owner, and that current payment shown herein is now due.
    </div>
    <div class="sig-row">
      <div class="sig-col">
        <div style="font-weight:600;">Contractor</div>
        <div style="color:#666;font-size:8px;">${escapeHtml(app.contractorName)}</div>
      </div>
      <div class="sig-col">
        <div style="font-weight:600;">By</div>
        <div style="color:#666;font-size:8px;">Signature · Date</div>
      </div>
    </div>
    <div class="sig-row" style="margin-top:10px;">
      <div class="sig-col">
        <div style="font-weight:600;">Architect / Owner Certification</div>
        <div style="color:#666;font-size:8px;">Amount Certified: $ ______________</div>
      </div>
      <div class="sig-col">
        <div style="font-weight:600;">By</div>
        <div style="color:#666;font-size:8px;">Signature · Date</div>
      </div>
    </div>
  </div>

  ${app.notes ? `<div style="margin-top:10px;font-size:9px;color:#333;"><b>Notes:</b> ${escapeHtml(app.notes)}</div>` : ''}

  <div class="page-footer">
    Generated by MAGE ID · Application #${app.applicationNumber} · Page 1 of 2 · G702 Cover
  </div>
</div>

<!-- ═════════ PAGE 2: G703 CONTINUATION SHEET ═════════ -->
<div class="page">
  <div class="form-header">
    <div class="title-block">
      <h1>Continuation Sheet</h1>
      <div class="form-number">AIA-Style Document G703 · Schedule of Values · App #${app.applicationNumber}</div>
    </div>
    ${logoBlock}
  </div>

  <div class="grid-2" style="grid-template-columns: 2fr 1fr; gap:10px; margin-bottom:8px;">
    <div class="info-box">
      <span class="label">Project</span>
      <div class="value">${escapeHtml(app.projectName)}</div>
    </div>
    <div class="info-box">
      <span class="label">Period To</span>
      <div class="value">${fmtDate(app.periodTo)}</div>
    </div>
  </div>

  <table class="g703">
    <thead>
      <tr>
        <th class="ctr" rowspan="2">A<br/>Item</th>
        <th rowspan="2">B<br/>Description of Work</th>
        <th class="num" rowspan="2">C<br/>Scheduled Value</th>
        <th class="num" colspan="2">Work Completed</th>
        <th class="num" rowspan="2">F<br/>Materials Presently Stored</th>
        <th class="num" rowspan="2">G<br/>Total Completed &amp; Stored</th>
        <th class="num" rowspan="2">%<br/>(G ÷ C)</th>
        <th class="num" rowspan="2">H<br/>Balance to Finish</th>
        <th class="num" rowspan="2">I<br/>Retainage</th>
      </tr>
      <tr>
        <th class="num">D<br/>From Previous</th>
        <th class="num">E<br/>This Period</th>
      </tr>
    </thead>
    <tbody>
      ${g703Rows || '<tr><td colspan="10" style="text-align:center;color:#888;padding:20px;">No schedule of values lines.</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="2" class="ctr">GRAND TOTAL</td>
        <td class="num">${fmt(g703TotalScheduled)}</td>
        <td class="num">${fmt(g703TotalFromPrev)}</td>
        <td class="num">${fmt(g703TotalThisPeriod)}</td>
        <td class="num">${fmt(g703TotalStored)}</td>
        <td class="num">${fmt(g703TotalCompletedStored)}</td>
        <td class="num">${totals.percentComplete.toFixed(1)}%</td>
        <td class="num">${fmt(g703TotalScheduled - g703TotalCompletedStored)}</td>
        <td class="num">${fmt(g703TotalRetainage)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="page-footer">
    Generated by MAGE ID · Application #${app.applicationNumber} · Page 2 of 2 · G703 Continuation
  </div>
</div>

</body>
</html>`;
}

export async function generateAIAPayAppPDF(
  app: AIAPayApplication,
  branding: CompanyBranding,
): Promise<void> {
  const html = buildAIAPayAppHtml(app, branding);
  const title = `${app.projectName} · Pay App #${app.applicationNumber}`;

  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(html);
        newWindow.document.close();
        setTimeout(() => newWindow.print(), 400);
      }
    }
    return;
  }

  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: title,
        UTI: 'com.adobe.pdf',
      });
    } else {
      await Print.printAsync({ uri });
    }
  } catch (err) {
    console.error('[AIA] Error generating pay application PDF:', err);
    throw err;
  }
}
