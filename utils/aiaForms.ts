// AIA-styled closeout + change-directive forms
//
// Generators for the AIA documents the GC produces during construction
// closeout and on fast-track change work — currently the gap between
// MAGE ID and a real CM tool. None of these reproduce AIA's copyrighted
// language; they replicate the field structure and informational layout
// that contractors/architects/owners expect, with MAGE ID branding +
// the standard "AIA® and the document numbers are registered trademarks
// of The American Institute of Architects, which is not affiliated with
// MAGE ID" disclaimer.
//
// Forms in this file:
//   - G704  Certificate of Substantial Completion + Punch List
//   - G706  Contractor's Affidavit of Payment of Debts and Claims
//   - G706A Contractor's Affidavit of Release of Liens
//   - G707  Consent of Surety to Final Payment
//   - G714  Construction Change Directive (CCD)
//
// The G702/G703 pay app already lives in utils/aiaBilling.ts under the
// same disclaimer pattern. New forms here follow the same shell/header
// conventions so a printed packet (G702 → G704 → G706/A/G707) feels
// like one consistent document family.

import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { CompanyBranding } from '@/types';

// ─── Shared HTML helpers ────────────────────────────────────────────

function escapeHtml(text: string | number | null | undefined): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '$0.00';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Common page shell — A4-width portrait, Inter font, Print-friendly.
function pageShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>
  @page { size: letter; margin: 0.6in; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    color: #111; font-size: 11px; line-height: 1.45; margin: 0;
  }
  h1 { font-size: 18px; margin: 0 0 4px; letter-spacing: -0.3px; }
  h2 { font-size: 13px; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #111; text-transform: uppercase; letter-spacing: 0.6px; }
  h3 { font-size: 12px; margin: 14px 0 6px; font-weight: 700; }
  p  { margin: 0 0 8px; }
  .small { font-size: 10px; color: #555; }
  .label { font-size: 9px; font-weight: 700; color: #555; letter-spacing: 0.5px; text-transform: uppercase; }
  .field { margin-bottom: 10px; }
  .field-value { font-size: 12px; font-weight: 600; color: #111; padding: 6px 10px; border: 1px solid #ccc; border-radius: 3px; background: #fafafa; min-height: 18px; }
  .row { display: flex; gap: 16px; }
  .row .field { flex: 1; }
  .table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  .table th, .table td { border: 1px solid #999; padding: 6px 8px; text-align: left; vertical-align: top; }
  .table th { background: #f0f0f0; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; }
  .num { font-variant-numeric: tabular-nums; text-align: right; }
  .header-band {
    border: 2px solid #111; border-radius: 4px; padding: 14px 16px; margin-bottom: 18px;
    display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
  }
  .header-band-left { flex: 1; }
  .header-band-right { text-align: right; }
  .doc-eyebrow { font-size: 9px; font-weight: 700; color: #555; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 4px; }
  .doc-title { font-size: 17px; font-weight: 800; letter-spacing: -0.2px; }
  .doc-number { font-size: 10px; color: #555; margin-top: 4px; }
  .stamp {
    margin-top: 22px; padding: 14px; border: 1px dashed #999; border-radius: 4px;
    font-size: 11px; line-height: 1.5; color: #333;
  }
  .signature-block { margin-top: 22px; display: flex; gap: 24px; }
  .signature-block .sig { flex: 1; padding-top: 36px; border-top: 1px solid #111; font-size: 10px; }
  .disclaimer {
    margin-top: 28px; padding-top: 12px; border-top: 1px solid #ddd;
    font-size: 8.5px; color: #888; line-height: 1.55;
  }
  .pill { display: inline-block; padding: 2px 8px; background: #111; color: #fff; font-size: 9px; font-weight: 700; letter-spacing: 0.6px; border-radius: 999px; text-transform: uppercase; }
</style>
</head><body>${bodyHtml}</body></html>`;
}

// Standard AIA disclaimer — required wherever we render an AIA-styled form.
// Lives once in this file to keep the legal copy consistent.
const AIA_DISCLAIMER = `This document is generated by MAGE ID and styled after AIA® standard forms. AIA® and the corresponding document numbers (e.g. G704, G706, G706A, G707, G714) are registered trademarks of The American Institute of Architects, which is not affiliated with MAGE ID. Some lenders, sureties, and architects require the official AIA Contract Documents — verify acceptance with your owner / architect / surety before submitting. The contractor named above is solely responsible for the accuracy of every figure and signature on this document.`;

function header(branding: CompanyBranding, eyebrow: string, title: string, docNumber: string): string {
  const company = escapeHtml(branding.companyName || 'MAGE ID');
  const license = branding.licenseNumber ? `License #${escapeHtml(branding.licenseNumber)}` : '';
  return `<div class="header-band">
    <div class="header-band-left">
      <div class="doc-eyebrow">${escapeHtml(eyebrow)}</div>
      <div class="doc-title">${escapeHtml(title)}</div>
      <div class="doc-number">${escapeHtml(docNumber)}</div>
    </div>
    <div class="header-band-right">
      <div style="font-weight:800;font-size:13px;">${company}</div>
      ${branding.address ? `<div class="small">${escapeHtml(branding.address)}</div>` : ''}
      ${branding.phone ? `<div class="small">${escapeHtml(branding.phone)}</div>` : ''}
      ${license ? `<div class="small">${license}</div>` : ''}
    </div>
  </div>`;
}

function field(label: string, value: string | number | null | undefined): string {
  return `<div class="field">
    <div class="label">${escapeHtml(label)}</div>
    <div class="field-value">${escapeHtml(value || ' ')}</div>
  </div>`;
}

function signatures(...labels: string[]): string {
  return `<div class="signature-block">
    ${labels.map(l => `<div class="sig">${escapeHtml(l)}</div>`).join('')}
  </div>`;
}

function disclaimer(): string {
  return `<div class="disclaimer">${AIA_DISCLAIMER}</div>`;
}

// ─── G704 — Certificate of Substantial Completion ──────────────────

export interface G704Data {
  ownerName: string;
  ownerAddress?: string;
  contractorName: string;
  architectName?: string;
  projectName: string;
  projectAddress?: string;
  contractDate?: string;
  /** Date the work was substantially complete per the certificate. */
  dateOfSubstantialCompletion: string;
  /** Items still to be completed or corrected (the "punch"). */
  punchList: Array<{
    description: string;
    location?: string;
    trade?: string;
    estimatedCost?: number;
  }>;
  /** Date by which the contractor will complete the punch. */
  punchCompletionDate?: string;
  /** Warranty / responsibility transfer date — usually = SC date. */
  warrantyStartDate?: string;
  /** Notes on owner responsibilities (security, utilities, insurance) post-SC. */
  ownerResponsibilitiesNote?: string;
}

function buildG704Html(data: G704Data, branding: CompanyBranding): string {
  const totalEstPunchCost = data.punchList.reduce((s, p) => s + (p.estimatedCost ?? 0), 0);
  const punchRows = data.punchList.length === 0
    ? `<tr><td colspan="4" style="text-align:center;color:#777;padding:14px;">No outstanding items at substantial completion.</td></tr>`
    : data.punchList.map(item => `
      <tr>
        <td>${escapeHtml(item.description)}</td>
        <td>${escapeHtml(item.location || '—')}</td>
        <td>${escapeHtml(item.trade || '—')}</td>
        <td class="num">${item.estimatedCost != null ? fmtMoney(item.estimatedCost) : '—'}</td>
      </tr>`).join('');

  return pageShell(`G704 — ${data.projectName}`, `
    ${header(branding, 'Certificate', 'Substantial Completion', 'Document G704 — styled')}

    <p style="font-size:11px;line-height:1.55;">
      The work performed under this contract has been reviewed and found, to the best of the
      ${escapeHtml(data.architectName ? "Architect's" : "Contractor's")} knowledge, information, and belief, to be substantially
      complete. <strong>Substantial Completion</strong> is the stage of the work when the work or designated portion is
      sufficiently complete in accordance with the contract documents so the owner can occupy or utilize the work for its intended use.
    </p>

    <h2>Project</h2>
    <div class="row">
      ${field('Project name', data.projectName)}
      ${field('Project address', data.projectAddress || '')}
    </div>
    <div class="row">
      ${field('Owner', data.ownerName)}
      ${field('Contractor', data.contractorName)}
      ${field('Architect', data.architectName || '')}
    </div>
    <div class="row">
      ${field('Contract date', fmtDate(data.contractDate))}
      ${field('Date of substantial completion', fmtDate(data.dateOfSubstantialCompletion))}
      ${field('Warranty start date', fmtDate(data.warrantyStartDate || data.dateOfSubstantialCompletion))}
    </div>

    <h2>Items remaining to be completed or corrected</h2>
    <table class="table">
      <thead>
        <tr>
          <th style="width:55%;">Description</th>
          <th style="width:20%;">Location</th>
          <th style="width:15%;">Trade</th>
          <th style="width:10%;text-align:right;">Est. cost</th>
        </tr>
      </thead>
      <tbody>${punchRows}</tbody>
      ${data.punchList.length > 0 ? `<tfoot>
        <tr>
          <td colspan="3" style="text-align:right;font-weight:700;">Total estimated punch cost</td>
          <td class="num" style="font-weight:700;">${fmtMoney(totalEstPunchCost)}</td>
        </tr>
      </tfoot>` : ''}
    </table>

    <p class="small" style="margin-top:10px;">
      The contractor will complete or correct the items above by
      <strong>${escapeHtml(fmtDate(data.punchCompletionDate) || '[date to be set]')}</strong>.
      Failure to complete the work above does not alter the responsibility of the contractor under the contract for completing all the work in accordance with the contract documents.
    </p>

    <h2>Responsibility transfer</h2>
    <p style="font-size:11px;">
      As of the date of substantial completion, responsibility for security, maintenance, heat, utilities, damage to the work, and insurance
      shall be as set forth in the contract documents. ${data.ownerResponsibilitiesNote ? `<br/><br/><em>${escapeHtml(data.ownerResponsibilitiesNote)}</em>` : ''}
    </p>

    <div class="stamp">
      <strong>Warranty period</strong> — The warranty period required by the contract begins on the
      <strong>warranty start date</strong> stated above. The contractor's warranty of workmanship and materials runs
      from that date for the term stated in the contract documents (typically one year, unless extended by specific
      manufacturer warranties or the contract).
    </div>

    ${signatures(
      `Architect (acceptance of substantial completion) — date`,
      `Contractor (representative) — date`,
      `Owner (acceptance of substantial completion) — date`,
    )}

    ${disclaimer()}
  `);
}

export async function generateG704PDF(data: G704Data, branding: CompanyBranding): Promise<void> {
  const html = buildG704Html(data, branding);
  await renderAndShare(html, `G704 Substantial Completion — ${data.projectName}`);
}

// ─── G706 — Contractor's Affidavit of Payment of Debts and Claims ──

export interface G706Data {
  ownerName: string;
  contractorName: string;
  projectName: string;
  projectAddress?: string;
  contractDate?: string;
  contractorState: string;     // for notary jurat
  contractorCounty?: string;
  /** Optional: note any unsettled debts/claims (rare — usually "none"). */
  exceptions?: string;
}

function buildG706Html(data: G706Data, branding: CompanyBranding): string {
  return pageShell(`G706 — ${data.projectName}`, `
    ${header(branding, "Contractor's Affidavit", 'Payment of Debts and Claims', 'Document G706 — styled')}

    <h2>Project</h2>
    <div class="row">
      ${field('Project name', data.projectName)}
      ${field('Project address', data.projectAddress || '')}
    </div>
    <div class="row">
      ${field('Owner', data.ownerName)}
      ${field('Contractor', data.contractorName)}
      ${field('Contract date', fmtDate(data.contractDate))}
    </div>

    <h2>Affidavit</h2>
    <p>
      State of <strong>${escapeHtml(data.contractorState)}</strong>, County of <strong>${escapeHtml(data.contractorCounty || ' ')}</strong>:
    </p>
    <p>
      The undersigned, being duly sworn, deposes and says that:
    </p>
    <p>
      <strong>1.</strong> The undersigned is the contractor identified above and is authorized to execute this affidavit on behalf of the contractor.
    </p>
    <p>
      <strong>2.</strong> Except as listed below, the contractor has paid in full all bills and claims for labor, materials, equipment, services, and other indebtedness, including taxes, that have been incurred by the contractor in connection with the work performed under the above-referenced contract for which the owner or the owner's property might in any way be held responsible.
    </p>
    <p>
      <strong>3.</strong> All releases of liens (where required) have been obtained from each subcontractor, supplier, and laborer who has performed work or supplied materials for the project for the period through the date of this affidavit, and copies of those releases either accompany this affidavit or are on file with the contractor.
    </p>
    ${data.exceptions ? `
    <p><strong>Exceptions / unsettled items:</strong></p>
    <div class="field-value" style="white-space:pre-wrap;min-height:60px;">${escapeHtml(data.exceptions)}</div>
    ` : `<p style="font-style:italic;color:#555;">No exceptions or unsettled items.</p>`}

    <p style="margin-top:20px;">
      Executed this <strong>${fmtDate(new Date().toISOString())}</strong>.
    </p>

    ${signatures(
      'Contractor — authorized signatory',
      'Notary Public — my commission expires',
    )}

    ${disclaimer()}
  `);
}

export async function generateG706PDF(data: G706Data, branding: CompanyBranding): Promise<void> {
  const html = buildG706Html(data, branding);
  await renderAndShare(html, `G706 Affidavit of Debts — ${data.projectName}`);
}

// ─── G706A — Contractor's Affidavit of Release of Liens ────────────

export interface G706AData {
  ownerName: string;
  contractorName: string;
  projectName: string;
  projectAddress?: string;
  contractDate?: string;
  contractorState: string;
  contractorCounty?: string;
  /** Subcontractors / suppliers who have NOT yet provided final waivers. */
  unreleasedClaimants?: Array<{ name: string; reason: string; amount?: number }>;
}

function buildG706AHtml(data: G706AData, branding: CompanyBranding): string {
  const claimants = data.unreleasedClaimants ?? [];
  return pageShell(`G706A — ${data.projectName}`, `
    ${header(branding, "Contractor's Affidavit", 'Release of Liens', 'Document G706A — styled')}

    <h2>Project</h2>
    <div class="row">
      ${field('Project name', data.projectName)}
      ${field('Project address', data.projectAddress || '')}
    </div>
    <div class="row">
      ${field('Owner', data.ownerName)}
      ${field('Contractor', data.contractorName)}
      ${field('Contract date', fmtDate(data.contractDate))}
    </div>

    <h2>Affidavit</h2>
    <p>
      State of <strong>${escapeHtml(data.contractorState)}</strong>, County of <strong>${escapeHtml(data.contractorCounty || ' ')}</strong>:
    </p>
    <p>
      The undersigned, being duly sworn, deposes and says that to the best of the contractor's knowledge,
      information, and belief, all releases or waivers of liens have been received from any subcontractor,
      supplier, or other party who has performed work or supplied material in connection with the
      above-referenced project, except as listed below.
    </p>

    <h3>Unreleased claimants</h3>
    ${claimants.length === 0 ? `
      <p style="font-style:italic;color:#555;">None — all claimants have provided final waivers.</p>
    ` : `
      <table class="table">
        <thead>
          <tr><th style="width:35%;">Claimant</th><th>Reason</th><th class="num" style="width:15%;">Amount</th></tr>
        </thead>
        <tbody>
          ${claimants.map(c => `<tr>
            <td>${escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.reason)}</td>
            <td class="num">${c.amount != null ? fmtMoney(c.amount) : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `}

    <p style="margin-top:18px;">
      The contractor agrees to indemnify the owner against any lien or claim of lien filed against the project
      by any party for whom payment is due from the contractor for work or materials supplied to the project
      through the date of this affidavit.
    </p>

    <p style="margin-top:18px;">
      Executed this <strong>${fmtDate(new Date().toISOString())}</strong>.
    </p>

    ${signatures(
      'Contractor — authorized signatory',
      'Notary Public — my commission expires',
    )}

    ${disclaimer()}
  `);
}

export async function generateG706APDF(data: G706AData, branding: CompanyBranding): Promise<void> {
  const html = buildG706AHtml(data, branding);
  await renderAndShare(html, `G706A Affidavit of Lien Release — ${data.projectName}`);
}

// ─── G707 — Consent of Surety to Final Payment ─────────────────────

export interface G707Data {
  ownerName: string;
  contractorName: string;
  projectName: string;
  projectAddress?: string;
  contractDate?: string;
  /** Performance / payment bond surety company. */
  suretyName: string;
  bondNumber?: string;
  bondDate?: string;
  /** Final contract sum (after all approved COs). */
  finalContractSum: number;
}

function buildG707Html(data: G707Data, branding: CompanyBranding): string {
  return pageShell(`G707 — ${data.projectName}`, `
    ${header(branding, 'Consent of Surety', 'Final Payment', 'Document G707 — styled')}

    <h2>Project</h2>
    <div class="row">
      ${field('Project name', data.projectName)}
      ${field('Project address', data.projectAddress || '')}
    </div>
    <div class="row">
      ${field('Owner', data.ownerName)}
      ${field('Contractor', data.contractorName)}
      ${field('Contract date', fmtDate(data.contractDate))}
    </div>
    <div class="row">
      ${field('Surety company', data.suretyName)}
      ${field('Bond number', data.bondNumber || '')}
      ${field('Bond date', fmtDate(data.bondDate))}
    </div>
    ${field('Final contract sum', fmtMoney(data.finalContractSum))}

    <h2>Consent</h2>
    <p style="font-size:11px;line-height:1.55;">
      In accordance with the provisions of the contract between the owner and the contractor identified above, the
      <strong>${escapeHtml(data.suretyName)}</strong> (<em>surety</em>), on bond of
      <strong>${escapeHtml(data.contractorName)}</strong> (<em>contractor</em>), hereby approves the final payment to the contractor
      of <strong>${fmtMoney(data.finalContractSum)}</strong>, and agrees that final payment to the contractor shall not relieve the surety
      of any of its obligations to <strong>${escapeHtml(data.ownerName)}</strong> (<em>owner</em>) under the bond on the project.
    </p>

    <p style="margin-top:18px;">
      In witness whereof, the surety has hereunto set its hand on this date:
      <strong>${fmtDate(new Date().toISOString())}</strong>.
    </p>

    ${signatures(
      'Surety — by authorized representative',
      'Attorney-in-fact — printed name & title',
    )}

    ${disclaimer()}
  `);
}

export async function generateG707PDF(data: G707Data, branding: CompanyBranding): Promise<void> {
  const html = buildG707Html(data, branding);
  await renderAndShare(html, `G707 Consent of Surety — ${data.projectName}`);
}

// ─── G714 — Construction Change Directive ──────────────────────────
//
// G714 is issued when work needs to proceed BEFORE the change order
// price/time has been agreed. Differs from G701 (which is the executed
// CO) in that G714 directs the contractor to perform with payment basis
// stated (lump sum / unit price / cost+ / time and materials) but final
// adjustment to the contract pending mutual agreement.

export type CCDPaymentBasis =
  | 'lump_sum'           // sum agreed, just signing later
  | 'unit_prices'        // unit prices in contract
  | 'cost_plus'          // cost + fee
  | 'time_and_materials' // T&M
  | 'pending_negotiation'; // basis itself not yet agreed

export interface G714Data {
  ownerName: string;
  contractorName: string;
  architectName?: string;
  projectName: string;
  projectAddress?: string;
  contractDate?: string;
  /** Sequential CCD number for this project. */
  ccdNumber: number;
  ccdDate: string;
  /** Description of the change ordered. */
  changeDescription: string;
  /** Reason / basis (e.g. owner-directed, field condition). */
  reason?: string;
  /** Drawings, sketches, or specifications attached. */
  attachments?: string[];
  /** Payment basis for the CCD. */
  paymentBasis: CCDPaymentBasis;
  /** Estimated cost adjustment (may be range, can be 0 for pending). */
  estimatedCostAdjustment?: number;
  /** Time impact in days (+/-). */
  estimatedTimeAdjustmentDays?: number;
  /** Notes on T&M rates or unit prices to apply. */
  paymentBasisNotes?: string;
}

function ccdBasisLabel(basis: CCDPaymentBasis): string {
  switch (basis) {
    case 'lump_sum':            return 'Lump-sum (amount stated)';
    case 'unit_prices':         return 'Unit prices in contract';
    case 'cost_plus':           return 'Cost-plus fee';
    case 'time_and_materials':  return 'Time and materials';
    case 'pending_negotiation': return 'Pending negotiation';
  }
}

function buildG714Html(data: G714Data, branding: CompanyBranding): string {
  return pageShell(`G714 #${data.ccdNumber} — ${data.projectName}`, `
    ${header(branding, 'Construction Change Directive', `CCD #${data.ccdNumber}`, 'Document G714 — styled')}

    <h2>Project</h2>
    <div class="row">
      ${field('Project name', data.projectName)}
      ${field('Project address', data.projectAddress || '')}
    </div>
    <div class="row">
      ${field('Owner', data.ownerName)}
      ${field('Contractor', data.contractorName)}
      ${field('Architect', data.architectName || '')}
    </div>
    <div class="row">
      ${field('Contract date', fmtDate(data.contractDate))}
      ${field('CCD number', String(data.ccdNumber))}
      ${field('CCD date', fmtDate(data.ccdDate))}
    </div>

    <h2>Directive</h2>
    <p>The contractor is hereby directed to make the following change(s):</p>
    <div class="field-value" style="white-space:pre-wrap;min-height:80px;font-size:12px;">${escapeHtml(data.changeDescription)}</div>
    ${data.reason ? `
      <h3>Reason / basis</h3>
      <div class="field-value" style="white-space:pre-wrap;min-height:40px;">${escapeHtml(data.reason)}</div>
    ` : ''}
    ${data.attachments && data.attachments.length > 0 ? `
      <h3>Attachments</h3>
      <ul style="margin:0;padding-left:18px;font-size:11px;">
        ${data.attachments.map(a => `<li>${escapeHtml(a)}</li>`).join('')}
      </ul>
    ` : ''}

    <h2>Adjustment</h2>
    <p>
      The proposed adjustments to the contract sum and contract time, if any, are as follows.
      <span class="pill">${escapeHtml(ccdBasisLabel(data.paymentBasis))}</span>
    </p>
    <div class="row">
      ${field('Estimated cost adjustment', data.estimatedCostAdjustment != null ? fmtMoney(data.estimatedCostAdjustment) : '— (to be determined)')}
      ${field('Estimated time impact (days)', data.estimatedTimeAdjustmentDays != null ? `${data.estimatedTimeAdjustmentDays >= 0 ? '+' : ''}${data.estimatedTimeAdjustmentDays} days` : '— (to be determined)')}
    </div>
    ${data.paymentBasisNotes ? `
      <h3>Payment basis notes</h3>
      <div class="field-value" style="white-space:pre-wrap;min-height:40px;">${escapeHtml(data.paymentBasisNotes)}</div>
    ` : ''}

    <div class="stamp">
      <strong>Important:</strong> when signed by the contractor below, this CCD becomes a directive to perform
      the work described above. The final adjustment to the contract sum and contract time will be determined
      by mutual agreement of the parties and converted to a Change Order. The contractor's signature
      acknowledges the directive only — it does not waive the right to negotiate the final price/time.
    </div>

    ${signatures(
      'Architect (or owner if no architect) — date',
      'Contractor (acknowledgement to proceed) — date',
      'Owner (authorization) — date',
    )}

    ${disclaimer()}
  `);
}

export async function generateG714PDF(data: G714Data, branding: CompanyBranding): Promise<void> {
  const html = buildG714Html(data, branding);
  await renderAndShare(html, `G714 CCD #${data.ccdNumber} — ${data.projectName}`);
}

// ─── Render + share helper (shared across forms) ────────────────────

async function renderAndShare(html: string, title: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
        setTimeout(() => w.print(), 400);
      }
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
