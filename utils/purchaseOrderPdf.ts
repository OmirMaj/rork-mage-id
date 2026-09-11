// purchaseOrderPdf — the purchase order MAGE ID never issued.
//
// THE GAP. The app generates nine construction documents (A401, G704, G706,
// G706A, G707, G714, estimates, invoices, DFRs, submittals, field tickets) and
// not a PO. So a GC ordering $18k of windows types a PO number into Job Costing
// for the budget math and then places the actual order by phone. Worse,
// app/material-receipt.tsx is built around matching a delivered receipt back to
// "a purchase-order Commitment" — receipt-to-PO matching against a PO the
// product never issued.
//
// WHAT THIS PRINTS AND WHERE IT COMES FROM. Everything on the page is a value
// the app already holds; nothing is invented to fill a slot:
//
//   PO number        commitment.number
//   Issue date       commitment.signedDate
//   Vendor           commitment.vendorName (or the linked Subcontractor)
//   Ship to          the project's jobsite address
//   Project          project.name
//   Line items       the estimate lines this commitment is linked to
//                    (commitment.linkedEstimateItems → project.linkedEstimate)
//   Order total      commitment.amount + changeAmount
//   Required by      the earliest delivery scheduled against this commitment
//   Terms            the ordering terms below
//
// TWO THINGS THE DATA MODEL DOES NOT HOLD, and which this file therefore does
// NOT print as if it did:
//
//   • SALES TAX. A Commitment has no tax field, and no flag saying whether the
//     agreed amount is tax-inclusive. Printing a tax row against the app's
//     configured estimating tax rate would produce a total that disagrees with
//     the amount the GC actually signed for — a money bug on the document a
//     vendor invoices against. The order states the tax treatment as a term
//     instead, and the total is exactly the committed amount.
//   • A PER-COMPANY TERMS BLOCK. AppSettings has no purchase-terms field, so
//     the terms below are the same for everyone. They are deliberately narrow:
//     each one describes something this product actually does.
//
// MONEY BASIS. Every figure on a PO is a COST — money the GC pays out to a
// vendor. Estimate lines carry both a cost (unitPrice/bulkPrice) and a marked-
// up sell figure (lineTotal); this file prices the order at cost, because the
// vendor is not being handed the GC's margin.
//
// Design system is the shared one in utils/pdfDesign.ts — same header, same
// vendor/licence strip, same footer as buildInvoiceHtml and the field ticket.

import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  pdfShell, pdfHeader, pdfTitle, pdfFooter, pdfTable, pdfSectionHeader,
  escHtml, fmtMoney, PDF_PALETTE,
} from './pdfDesign';
import { formatCalendarDay } from './calendarDate';
import { commitmentValue } from './jobCostEngine';
import type { Commitment, CompanyBranding, Project, Subcontractor } from '@/types';
import type { Delivery } from './deliverySchedule';

/**
 * Both dates on this order are CALENDAR DAYS, not instants: `signedDate` is
 * written as `new Date().toISOString().slice(0, 10)` by the Job Costing form,
 * and `Delivery.expectedDate` is documented 'YYYY-MM-DD'. pdfDesign's fmtDate
 * runs them through `new Date()`, which reads a bare day as UTC midnight — so a
 * PO issued in Los Angeles on 2026-08-31 printed "August 30, 2026", and a
 * delivery booked for 2026-10-05 printed "October 4". The second is the one
 * that costs money: a vendor schedules a truck off the Required-by line.
 */
function poDay(value: string | null | undefined): string {
  return formatCalendarDay(value) || '—';
}

/** One priced row on the order. All money here is COST to the GC. */
export interface PurchaseOrderLine {
  description: string;
  quantity: number;
  unit: string;
  /** What the vendor charges per unit — cost, never the marked-up sell price. */
  unitCost: number;
  /** quantity × unitCost. */
  extended: number;
}

export interface PurchaseOrderDoc {
  poNumber: string;
  /** Calendar day the PO was issued (commitment.signedDate). */
  issueDate: string;
  vendorName: string;
  /** Free-text jobsite address the material ships to. */
  shipTo: string;
  projectName: string;
  /** What is being bought, in the GC's words. */
  scope: string;
  lines: PurchaseOrderLine[];
  /** Sum of the line extendeds. Zero when nothing is linked. */
  lineSubtotal: number;
  /** The agreed order value — commitment.amount + changeAmount. Authoritative. */
  orderTotal: number;
  /** Earliest expected delivery date scheduled against this PO, or ''. */
  requiredBy: string;
  /** Where requiredBy came from, so the document does not imply a promise. */
  requiredByNote: string;
  /** Set when the linked estimate lines do not add up to the agreed amount. */
  adjustmentNote?: string;
  phase?: string;
  csiDivision?: string;
}

/**
 * The GC's ordering terms.
 *
 * Every clause here is something the product actually does or a plain fact
 * about the order. There is deliberately no warranty language, no indemnity
 * and no promise about payment timing — none of that is anywhere in the data
 * model, and inventing it on a document a vendor may rely on is the same class
 * of defect as the generic lien waiver.
 */
export const PURCHASE_ORDER_TERMS: readonly string[] = [
  'Reference this PO number on every packing slip, delivery ticket and invoice. An invoice that does not name it cannot be matched and will be returned.',
  'Deliver to the ship-to address above. Deliveries are received against this order — quantities and condition are recorded at the tailgate, and short or damaged loads are noted on the receipt.',
  'The order total above is the agreed price for the scope described. Any change to scope, quantity or price requires a written change order before the material ships; material delivered against a verbal change is delivered at the vendor\'s risk.',
  'Amounts are stated exclusive of sales tax. Invoice tax as required by law in the delivery jurisdiction, as a separate line, and reference this PO number.',
  'Invoices are matched to this order and to the delivery receipt before payment.',
] as const;

/**
 * The order lines this commitment implies, priced at cost.
 *
 * A commitment links to estimate lines by `materialId`. Those lines carry the
 * quantity, the unit, and both a plain and a bulk unit price; `usesBulk` says
 * which one was bought at. An unlinked commitment yields no lines at all —
 * which prints as a single scope line rather than as a fabricated table.
 */
export function purchaseOrderLinesFor(
  commitment: Commitment, project: Project,
): PurchaseOrderLine[] {
  const items = project.linkedEstimate?.items ?? [];
  if (items.length === 0) return [];
  const ids = new Set(commitment.linkedEstimateItems ?? []);
  if (ids.size === 0) return [];
  return items
    .filter(it => ids.has(it.materialId))
    .map(it => {
      // COST basis: the bulk price when the estimate bought at bulk, the plain
      // unit price otherwise. `lineTotal` is deliberately not used — it carries
      // the GC's markup, which is not what the vendor is owed.
      const unitCost = it.usesBulk && it.bulkPrice > 0 ? it.bulkPrice : it.unitPrice;
      const quantity = it.quantity ?? 0;
      return {
        description: it.name,
        quantity,
        unit: it.unit || 'ea',
        unitCost,
        extended: unitCost * quantity,
      };
    });
}

/**
 * The earliest delivery scheduled against this commitment.
 *
 * This is the only real "required by" the app holds — a date somebody entered
 * on the Deliveries screen for this PO. Cancelled deliveries are ignored; a
 * cancelled date is not a requirement. When there is none, the document says
 * so rather than printing a date nobody agreed to.
 */
export function requiredByFor(commitment: Commitment, deliveries: Delivery[]): { date: string; note: string } {
  const linked = deliveries
    .filter(d => d.commitmentId === commitment.id && d.status !== 'cancelled')
    .map(d => d.expectedDate)
    .filter(Boolean)
    .sort();
  if (linked.length === 0) {
    return {
      date: '',
      note: 'No delivery has been scheduled against this order. Schedule one on the Deliveries screen so the date on this PO is one the crew is planned around.',
    };
  }
  const confirmed = deliveries.some(
    d => d.commitmentId === commitment.id && d.status === 'confirmed' && d.expectedDate === linked[0],
  );
  return {
    date: linked[0],
    note: confirmed
      ? 'Confirmed by the supplier on the Deliveries screen.'
      : 'Scheduled but not yet confirmed by the supplier.',
  };
}

/** Assemble the printable document from the records the app holds. */
export function buildPurchaseOrderDoc(
  commitment: Commitment,
  project: Project,
  subcontractors: Subcontractor[],
  deliveries: Delivery[],
): PurchaseOrderDoc {
  const lines = purchaseOrderLinesFor(commitment, project);
  const lineSubtotal = lines.reduce((s, l) => s + l.extended, 0);
  // Money OUT: the signed order value including any approved change amount.
  // Read through jobCostEngine's commitmentValue so the number on the vendor's
  // PO is the same number Job Costing calls committed — a PO that disagrees
  // with the budget line it came from is an argument waiting to happen.
  const orderTotal = commitmentValue(commitment);
  const sub = commitment.subcontractorId
    ? subcontractors.find(s => s.id === commitment.subcontractorId)
    : undefined;
  const required = requiredByFor(commitment, deliveries);

  // The estimate lines are the SCOPE; the committed amount is the PRICE the GC
  // and the vendor agreed. When buyout moved the number, saying so beats
  // silently printing a subtotal the vendor will invoice against and a total
  // that does not match it.
  const gap = orderTotal - lineSubtotal;
  const adjustmentNote = lines.length > 0 && Math.abs(gap) >= 0.01
    ? `The linked estimate lines total ${fmtMoney(lineSubtotal, { decimals: 2 })} at cost; the agreed order value is ${fmtMoney(orderTotal, { decimals: 2 })}. The agreed value governs.`
    : undefined;

  return {
    poNumber: commitment.number || '—',
    issueDate: commitment.signedDate,
    vendorName: sub?.companyName ?? commitment.vendorName ?? '',
    shipTo: project.location ?? '',
    projectName: project.name,
    scope: commitment.description || '',
    lines,
    lineSubtotal,
    orderTotal,
    requiredBy: required.date,
    requiredByNote: required.note,
    adjustmentNote,
    phase: commitment.phase,
    csiDivision: commitment.csiDivision,
  };
}

function buildPurchaseOrderHtml(doc: PurchaseOrderDoc, branding: CompanyBranding): string {
  const headerHtml = pdfHeader(branding);
  const titleHtml = pdfTitle({
    eyebrow: `Purchase order ${doc.poNumber}`,
    title: doc.projectName,
    subtitle: doc.scope || undefined,
    meta: [
      { label: 'Issued', value: poDay(doc.issueDate) },
      { label: 'Required by', value: doc.requiredBy ? poDay(doc.requiredBy) : 'Not scheduled' },
      { label: 'Order total', value: fmtMoney(doc.orderTotal, { decimals: 2 }) },
    ],
  });

  const partyCell = (label: string, body: string) => `
    <td style="width:50%;vertical-align:top;padding:14px 16px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone2};border-radius:12px">
      <div style="font-size:9px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:${PDF_PALETTE.textMuted};margin-bottom:5px">${escHtml(label)}</div>
      <div style="font-size:13px;line-height:1.6;color:${PDF_PALETTE.text}">${body}</div>
    </td>`;

  const vendorBody = doc.vendorName
    ? `<strong>${escHtml(doc.vendorName)}</strong>`
    : `<span style="color:${PDF_PALETTE.error};font-weight:700">No vendor recorded on this commitment</span>`;
  const shipToBody = doc.shipTo
    ? `<strong>${escHtml(doc.projectName)}</strong><br/>${escHtml(doc.shipTo)}`
    : `<strong>${escHtml(doc.projectName)}</strong><br/><span style="color:${PDF_PALETTE.error};font-weight:700">No jobsite address on this project</span>`;

  const partiesHtml = `
    <table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin-bottom:18px;table-layout:fixed">
      <tr>${partyCell('Vendor', vendorBody)}${partyCell('Ship to', shipToBody)}</tr>
    </table>`;

  // A PO with linked estimate lines prints them priced. One without prints the
  // scope as a single line rather than an empty table — an unpriced order is
  // still a real order, and inventing rows to fill the grid would not be.
  const linesHtml = doc.lines.length > 0
    ? pdfTable(
        [
          { header: 'Description', align: 'left', width: '44%' },
          { header: 'Qty', align: 'right' },
          { header: 'Unit', align: 'left' },
          { header: 'Unit price', align: 'right' },
          { header: 'Extended', align: 'right' },
        ],
        doc.lines.map(l => [
          `<span style="font-weight:600">${escHtml(l.description)}</span>`,
          `<span class="num">${l.quantity}</span>`,
          escHtml(l.unit),
          `<span class="num">${fmtMoney(l.unitCost, { decimals: 2 })}</span>`,
          `<span class="num" style="font-weight:700">${fmtMoney(l.extended, { decimals: 2 })}</span>`,
        ]),
      )
    : `<div style="padding:14px 16px;border:1px solid ${PDF_PALETTE.bone};border-radius:12px;margin-bottom:18px;font-size:13px;line-height:1.6;color:${PDF_PALETTE.text}">
         <strong>${escHtml(doc.scope || 'Materials per this order')}</strong>
         <div style="margin-top:6px;font-size:11.5px;color:${PDF_PALETTE.text2}">This order is not itemised. Link the estimate lines it covers in Job Costing to print quantities and unit prices.</div>
       </div>`;

  const row = (label: string, value: string, muted = false) =>
    `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12px"><span style="color:${muted ? PDF_PALETTE.textMuted : PDF_PALETTE.text2}">${escHtml(label)}</span><span class="num" style="color:${muted ? PDF_PALETTE.textMuted : PDF_PALETTE.text2}">${value}</span></div>`;

  const totalsHtml = `
    <div class="no-break" style="background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone2};border-radius:14px;padding:18px 20px;margin-top:4px">
      ${doc.lines.length > 0 ? row('Line item subtotal (at cost)', fmtMoney(doc.lineSubtotal, { decimals: 2 })) : ''}
      ${row('Sales tax', 'Not itemised — see terms', true)}
      <div style="height:1.5px;background:${PDF_PALETTE.ink};margin:8px 0"></div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0">
        <span style="font-family:'Fraunces',Georgia,serif;font-size:16px;font-weight:700">Order total</span>
        <span class="num" style="font-family:'Fraunces',Georgia,serif;font-size:24px;font-weight:700;color:${PDF_PALETTE.amber};letter-spacing:-0.012em">${fmtMoney(doc.orderTotal, { decimals: 2 })}</span>
      </div>
      ${doc.adjustmentNote ? `<div style="margin-top:8px;font-size:11px;line-height:1.55;color:${PDF_PALETTE.text2}">${escHtml(doc.adjustmentNote)}</div>` : ''}
    </div>`;

  const deliveryHtml = pdfSectionHeader('Delivery') + `
    <div style="padding:14px 16px;border:1px solid ${PDF_PALETTE.bone};border-radius:12px;margin-bottom:18px;font-size:13px;line-height:1.6;color:${PDF_PALETTE.text}">
      <div><strong>Required by:</strong> ${doc.requiredBy ? escHtml(poDay(doc.requiredBy)) : 'not scheduled'}</div>
      <div style="margin-top:5px;font-size:11.5px;color:${PDF_PALETTE.text2}">${escHtml(doc.requiredByNote)}</div>
    </div>`;

  const termsHtml = pdfSectionHeader('Terms of this order') + `
    <ol style="margin:0 0 18px 18px;padding:0;font-size:12px;line-height:1.65;color:${PDF_PALETTE.text2}">
      ${PURCHASE_ORDER_TERMS.map(t => `<li style="margin-bottom:6px">${escHtml(t)}</li>`).join('')}
    </ol>`;

  const authHtml = `
    <div class="no-break" style="margin-top:8px;padding:18px 20px;border:1px solid ${PDF_PALETTE.bone};border-radius:12px">
      <div style="font-size:9px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:${PDF_PALETTE.textMuted}">Authorised by</div>
      <div style="margin-top:26px;height:1.5px;background:${PDF_PALETTE.ink2};max-width:300px"></div>
      <div style="font-size:11px;color:${PDF_PALETTE.textMuted};margin-top:6px">${escHtml(branding.contactName || branding.companyName || '')} &middot; ${escHtml(branding.companyName || '')}${branding.licenseNumber ? ` &middot; License ${escHtml(branding.licenseNumber)}` : ''}</div>
    </div>`;

  const refsHtml = (doc.phase || doc.csiDivision)
    ? `<div style="margin-top:14px;font-size:11px;color:${PDF_PALETTE.textMuted}">${[doc.phase ? `Phase ${escHtml(doc.phase)}` : '', doc.csiDivision ? `CSI division ${escHtml(doc.csiDivision)}` : ''].filter(Boolean).join(' · ')}</div>`
    : '';

  return pdfShell({
    title: `Purchase Order ${doc.poNumber} — ${doc.projectName}`,
    branding,
    bodyHtml:
      headerHtml + titleHtml + partiesHtml + linesHtml + totalsHtml +
      deliveryHtml + termsHtml + authHtml + refsHtml +
      pdfFooter(
        branding,
        `Purchase order ${escHtml(doc.poNumber)}`,
        'This purchase order states the scope and the agreed order value recorded by the contractor. Sales tax is not itemised. Verify quantities and prices against your quote before shipping.',
      ),
  });
}

/** Share the PO as a PDF. Mirrors generateFieldTicketPDF's platform handling. */
export async function sharePurchaseOrderPDF(
  commitment: Commitment,
  project: Project,
  branding: CompanyBranding,
  subcontractors: Subcontractor[],
  deliveries: Delivery[],
): Promise<void> {
  const doc = buildPurchaseOrderDoc(commitment, project, subcontractors, deliveries);
  const html = buildPurchaseOrderHtml(doc, branding);
  const title = `Purchase Order ${doc.poNumber} — ${doc.projectName}`;

  if (Platform.OS === 'web') {
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.print();
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
