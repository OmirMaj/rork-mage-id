// react-native / expo-print / expo-sharing are imported LAZILY inside
// generateAIAPayAppPDF (the same pattern as utils/wipExport.ts). Keeping them
// off the module's top level is what lets computeAIATotals and
// seedAIAPayApplicationFromInvoice be imported and unit-tested by
// scripts/validate-invoice-billing.ts under bun — a top-level
// `import { Platform } from 'react-native'` makes the whole module unloadable
// outside Metro, and money math this app depends on must be testable.
import type {
  CompanyBranding, Project, Invoice, InvoiceLineItem, ChangeOrder, LinkedEstimateItem,
} from '@/types';
// roundCents / retainageOnWorkValue are the app's shared money math and live
// in utils/invoiceBilling beside netBalanceDue — see MISS-04 there for why
// retainage is withheld on the work value and why the basis is not clamped.
// billedAmountForLine is the one definition of "how much of this line did this
// invoice actually charge", including the anyPreScaled gate.
import { roundCents, retainageOnWorkValue, billedAmountForLine } from '@/utils/invoiceBilling';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
// The namespaced key an approved change order rides on an invoice line, so a
// CO billed through either entry point lands on the right G703 row.
import { changeOrderBillKey } from '@/utils/changeOrderBilling';

// Re-exported so the pay-app module keeps offering the retainage rule it is the
// reference implementation of, and existing importers (utils/portalSnapshot)
// need no change. New callers should import from utils/invoiceBilling, which
// costs them nothing beyond the arithmetic.
export { roundCents, retainageOnWorkValue };

// ──────────────────────────────────────────────────────────────────────────────
// AIA G702/G703 progress pay application generator
// G702 = cover summary (totals, retention, amount due this period)
// G703 = continuation sheet (schedule of values line-by-line with % complete)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * The retainage rate a pay application seeded from `invoice` must start at.
 *
 * MISS-05: this used to fall back to a hardcoded 10% whenever the invoice
 * carried no percentage — and app/invoice.tsx persisted a deliberate 0% as
 * `undefined`, so *every* no-retainage invoice seeded a G702 withholding 10%
 * and understating "current payment due" by roughly that much.
 *
 * A missing percentage and a stored 0 are treated the SAME here, and both mean
 * 0: an invoice the app has no retainage figure for is not evidence that the
 * contract holds any, and inventing a rate is what MISS-05 was. The screen's
 * chips are there for the GC to enter the contract's actual rate, and
 * app/aia-pay-app.tsx says on the certificate where the rate came from.
 */
export function retainagePercentForInvoice(invoice: Pick<Invoice, 'retentionPercent'>): number {
  const pct = invoice.retentionPercent;
  if (pct == null || !Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

export interface AIASOVLine {
  id: string;
  itemNo: string;          // "1.0", "2.1", etc.
  description: string;
  scheduledValue: number;  // column C
  fromPreviousApp: number; // column D — work completed before this period
  thisPeriod: number;      // column E — work completed this period
  materialsPresentlyStored: number; // column F
  retainagePercent: number; // default from cover
  /**
   * v2.4 — Optional binding to a schedule task. When set, the
   * "Sync from schedule" action uses this task's progress instead of
   * the project-level EV percentage to fill thisPeriod. Lets a GC
   * billing per-trade get per-trade accuracy instead of one
   * project-wide average across all SOV lines.
   */
  linkedTaskId?: string;
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

  /**
   * Where column C (Scheduled Value) came from — see buildAIASovLines. The
   * screen prints it under the SOV so the GC can tell a bank whether the
   * schedule of values is the signed contract's or was reconstructed from one
   * invoice. Optional so a hand-built application (tests, older records) still
   * type-checks.
   */
  sovBasis?: AIASovBasis;
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
  const totalCompletedAndStored = roundCents(app.lines.reduce(
    (s, l) => s + l.fromPreviousApp + l.thisPeriod + l.materialsPresentlyStored,
    0,
  ));
  const totalScheduledValue = roundCents(app.lines.reduce((s, l) => s + l.scheduledValue, 0));
  // Sum retainage PER LINE at cent precision, not once over an unrounded sum:
  // the G703 continuation sheet prints a per-line retainage column, and the
  // G702 cover has to equal the column it says it came from. Rounding the sum
  // instead of the lines leaves the two sheets a cent apart.
  const retainageOnCompleted = roundCents(app.lines.reduce(
    (s, l) => s + retainageOnWorkValue(l.fromPreviousApp + l.thisPeriod, l.retainagePercent),
    0,
  ));
  const retainageOnStored = roundCents(app.lines.reduce(
    (s, l) => s + retainageOnWorkValue(l.materialsPresentlyStored, l.retainagePercent),
    0,
  ));
  const totalRetainage = roundCents(retainageOnCompleted + retainageOnStored);
  const totalEarnedLessRetainage = roundCents(totalCompletedAndStored - totalRetainage);
  const currentPaymentDue = roundCents(totalEarnedLessRetainage - app.lessPreviousCertificates);
  const balanceToFinish = roundCents(app.contractSumToDate - totalEarnedLessRetainage);
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

// ─────────────────────────────────────────────────────────────────────────────
// THE SCHEDULE OF VALUES — column C is the CONTRACT, column E is this month.
//
// DEFECT (app-experience audit 2026-09-07, "Do next" #3). The seeding below
// used to be, verbatim:
//
//     invoice.lineItems.map(li => ({ scheduledValue: li.total,
//                                    thisPeriod:     li.total, ... }))
//
// — the same dollar in column C and column E. computeAIATotals then divided a
// number by itself, so EVERY G702 opened at "100% Complete" no matter how
// little of the job had been built. On a partial billing that is four numbers
// on one page that cannot all be true at once: Contract Sum to Date states the
// full contract, Total Completed & Stored states one draw, Balance to Finish
// states the remainder, and % Complete says the job is finished. That page
// goes to a bank and to a surety, over the GC's signature.
//
// Column C is the SCHEDULE OF VALUES: what each contract line is worth in
// total, for the life of the contract. Column E is what was put in place THIS
// PERIOD. They coincide only on a final billing — which is why the invoice-line
// fallback below still lets them coincide when the invoice really does bill
// 100% of the line.
// ─────────────────────────────────────────────────────────────────────────────

/** Where column C came from. Reported so the certificate can say so. */
export type AIASovBasis =
  /** The project's linked estimate + approved COs — a real schedule of values
   *  that foots to Contract Sum to Date. */
  | 'linked_estimate'
  /** No linked estimate on the project: column C is reconstructed from this
   *  invoice's own lines, grossed back up by what fraction of each line the
   *  invoice bills. Honest but partial — it only knows the scope this invoice
   *  touched, so it will not foot to the contract. */
  | 'invoice_lines';

/**
 * Full value of the contract line an invoice line is billing a piece of.
 *
 * The two invoice-creation paths store `total` in incompatible units (see
 * progressSubtotal in utils/invoiceBilling):
 *   • Bill-from-Estimate stores an ALREADY-scaled amount + `billedPercent`, so
 *     the whole line grosses back up as total ÷ (billedPercent/100).
 *   • The native editor stores the FULL line total and scales once at the
 *     invoice level, so `total` already IS column C.
 * A full (non-progress) invoice bills the whole line, so C = E there and the
 * certificate legitimately reads 100%.
 */
function scheduledValueForInvoiceLine(
  li: Pick<InvoiceLineItem, 'total' | 'billedPercent'>,
  invoice: Pick<Invoice, 'type' | 'progressPercent'>,
  anyPreScaled: boolean,
): number {
  const billed = li.total || 0;
  if (li.billedPercent != null) {
    // 0% would divide by zero and 100% is already the whole line; anything
    // outside (0,100) is a data-integrity edge where the safe answer is "this
    // is the whole line", which understates % complete rather than inventing
    // contract value that was never signed.
    if (li.billedPercent > 0 && li.billedPercent < 100) {
      return roundCents(billed / (li.billedPercent / 100));
    }
    return roundCents(billed);
  }
  // Native-editor progress line (and the mixed-invoice case the anyPreScaled
  // gate covers): `total` is the full line either way.
  void invoice; void anyPreScaled;
  return roundCents(billed);
}

/** What this invoice actually charged against one of its own lines. */
function thisPeriodForInvoiceLine(
  li: InvoiceLineItem,
  invoice: Invoice,
  anyPreScaled: boolean,
): number {
  return roundCents(billedAmountForLine(li, invoice, anyPreScaled));
}

/**
 * Build the G703 schedule of values for a pay application seeded from
 * `invoice`.
 *
 * PREFERRED BASIS — the project's linked estimate. Every estimate item becomes
 * one SOV line at its full `lineTotal`, and every approved change order becomes
 * one lump-sum line at its `changeAmount`.
 *
 * WHETHER IT FOOTS depends on which screen built the estimate, and the honest
 * answer is "usually, not always". app/(tabs)/estimate/full.tsx builds
 * grandTotal as Σ lineTotal exactly (materials carry their markup INSIDE
 * lineTotal; labor and assemblies are all-in), so Σ column C + Σ changeAmount
 * === Contract Sum to Date on the mainline path. But app/area-takeoff.tsx:394
 * and app/plan-intelligence.tsx:222 append an item whose lineTotal EXCLUDES
 * markup while bumping grandTotal by lineTotal + its share of markup, so after
 * either flow the SOV under-foots by exactly that markup. That is not
 * something this builder can invent its way out of — column C must stay the
 * line values the GC priced — so reconcileAIASov reports the gap and
 * app/aia-pay-app.tsx prints it. A certificate that does not foot must say so.
 *
 * Column E is then attributed to those lines by `sourceEstimateItemId`, the
 * same key Bill-from-Estimate and the CO billing path write, falling back to a
 * name match for invoices written before that field existed (mirroring
 * app/bill-from-estimate.tsx).
 *
 * Any invoice line that matches NO contract line is appended as its own SOV
 * row. Money that was billed must never fall off the certificate — a G702
 * whose column E omits a charge under-certifies the payment due.
 *
 * FALLBACK BASIS — no linked estimate: reconstruct column C from the invoice's
 * own lines. The result is honest about what it is (`sovBasis` says so, and
 * reconcileAIASov flags the gap against the contract), and the GC edits from
 * there.
 */
export function buildAIASovLines(
  invoice: Invoice,
  project: Pick<Project, 'linkedEstimate'>,
  approvedCOs: ChangeOrder[],
  retainagePercent: number,
): { lines: AIASOVLine[]; basis: AIASovBasis } {
  const anyPreScaled = invoice.lineItems.some(l => l.billedPercent != null);
  const consumed = new Set<number>();

  // SOV line ids must be UNIQUE. `sov_${materialId}` is not, on its own: the
  // merge branch of app/(tabs)/estimate/full.tsx handleConfirmLink
  // concatenates two item lists, so one materialId can legitimately appear
  // twice on a linked estimate — and a materialId-less legacy item keys on its
  // name, which repeats even more easily. app/aia-pay-app.tsx renders the rows
  // with `key={line.id}` and edits them with
  // `lines.map(l => l.id === lineId ? …)`, so two rows sharing an id means
  // typing this period's draw into the first row silently writes the same
  // dollars into the second — a doubled draw on a certificate a bank funds
  // against. Suffixed by occurrence rather than by row position so the id of a
  // contract line does not move when an off-contract line appears above it.
  const usedIds = new Set<string>();
  const uniqueId = (base: string): string => {
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}__${n}`;
    usedIds.add(id);
    return id;
  };

  /** Σ of the invoice lines belonging to one contract line, each consumed once. */
  const billedAgainst = (key: string, name: string): number => {
    let sum = 0;
    invoice.lineItems.forEach((li, i) => {
      if (consumed.has(i)) return;
      const matches = li.sourceEstimateItemId
        ? li.sourceEstimateItemId === key
        : li.name === name;
      if (!matches) return;
      consumed.add(i);
      sum += thisPeriodForInvoiceLine(li, invoice, anyPreScaled);
    });
    return roundCents(sum);
  };

  const estimateItems: LinkedEstimateItem[] = project.linkedEstimate?.items ?? [];
  const lines: AIASOVLine[] = [];
  const basis: AIASovBasis = estimateItems.length > 0 ? 'linked_estimate' : 'invoice_lines';

  if (basis === 'linked_estimate') {
    estimateItems.forEach((item) => {
      // Bill-from-Estimate keys a linked item as `materialId || name`; a legacy
      // item has no materialId, so the name IS the key there too.
      const key = item.materialId || item.name;
      lines.push({
        id: uniqueId(`sov_${key}`),
        itemNo: String(lines.length + 1),
        description: item.name,
        scheduledValue: roundCents(item.lineTotal),
        fromPreviousApp: 0,
        thisPeriod: billedAgainst(key, item.name),
        materialsPresentlyStored: 0,
        retainagePercent,
      });
    });
    approvedCOs.forEach((co) => {
      const key = changeOrderBillKey(co.id);
      const label = `CO #${co.number}${co.description ? ` — ${co.description}` : ''}`;
      lines.push({
        id: uniqueId(`sov_${key}`),
        itemNo: String(lines.length + 1),
        description: label,
        scheduledValue: roundCents(co.changeAmount),
        fromPreviousApp: 0,
        thisPeriod: billedAgainst(key, label),
        materialsPresentlyStored: 0,
        retainagePercent,
      });
    });
  }

  // Everything this invoice billed that no contract line claimed. In the
  // fallback basis that is every line; in the estimate basis it is the manual
  // adds (a voice-entered line, a T&M ticket) that still belong on the G703.
  invoice.lineItems.forEach((li, i) => {
    if (consumed.has(i)) return;
    consumed.add(i);
    lines.push({
      id: uniqueId(li.id),
      itemNo: String(lines.length + 1),
      description: [li.name, li.description].filter(Boolean).join(' — '),
      scheduledValue: scheduledValueForInvoiceLine(li, invoice, anyPreScaled),
      fromPreviousApp: 0,
      thisPeriod: thisPeriodForInvoiceLine(li, invoice, anyPreScaled),
      materialsPresentlyStored: 0,
      retainagePercent,
    });
  });

  return { lines, basis };
}

/**
 * Carry a prior period's billed-through onto a freshly seeded application.
 *
 * MATCH ON `id` FIRST, itemNo only as a fallback (review 2026-09-07).
 * `itemNo` is a POSITION, and buildAIASovLines above just changed what it
 * counts: it numbers the estimate's lines, then the approved COs, then
 * whatever the invoice billed off-contract. So approving one CO between
 * periods shifts every off-contract row's number by one, and a pay app SAVED
 * BEFORE this change numbered its rows over the INVOICE's line items instead
 * of the estimate's. Either way the next period's carry-forward lands a row
 * off and the G703 states billed-through against work that row never billed —
 * a line can be pushed past its own scheduled value, and every per-line %
 * complete and balance-to-finish on the continuation sheet is wrong. The G702
 * cover still totals correctly, which is exactly why nobody would catch it.
 *
 * `id` is the contract line's identity — `sov_<materialId>` for an estimate
 * line, `sov_co:<coId>` for a change order — and stays put for as long as the
 * estimate does. itemNo remains the fallback, and ONLY the fallback, so a
 * record saved under the old numbering carries its history forward exactly as
 * it does today rather than losing it.
 *
 * Each prior line is consumed at most once, ids before itemNos: a prior line
 * claimed by both an id match on one row and an itemNo match on another would
 * count the same billed-through twice on the cover. Description is NOT a key —
 * two SOV lines sharing one ("Concrete — slab on grade" for two phases) had
 * the second silently inherit the first's billed-through, which is why that
 * fallback was removed. Lines with no prior match get fromPreviousApp = 0 and
 * the GC enters this period only.
 */
export type PriorSOVLine = Pick<
  AIASOVLine, 'id' | 'itemNo' | 'fromPreviousApp' | 'thisPeriod'
>;

export function carryForwardPriorLines(
  lines: AIASOVLine[],
  priorLines: PriorSOVLine[],
): AIASOVLine[] {
  const claimed = new Set<number>();
  const take = (pick: (prior: PriorSOVLine) => boolean): PriorSOVLine | null => {
    const i = priorLines.findIndex((prior, idx) => !claimed.has(idx) && pick(prior));
    if (i < 0) return null;
    claimed.add(i);
    return priorLines[i];
  };
  const matched: (PriorSOVLine | null)[] = lines.map(line => take(prior => prior.id === line.id));
  lines.forEach((line, i) => {
    if (matched[i]) return;
    matched[i] = take(prior => prior.itemNo === line.itemNo);
  });
  return lines.map((line, i) => {
    const prior = matched[i];
    if (!prior) return line;
    return {
      ...line,
      fromPreviousApp: roundCents((prior.fromPreviousApp || 0) + (prior.thisPeriod || 0)),
    };
  });
}

/**
 * Does the schedule of values foot to the contract it is billing against?
 *
 * G702 line 3 (Contract Sum to Date) and the G703 column C total are two
 * statements of the same contract. When they disagree, at least one of the
 * certificate's numbers is wrong and the GC must fix the SOV before signing —
 * so the screen shows this, rather than the app quietly printing both.
 */
export interface AIASovReconciliation {
  totalScheduledValue: number;
  contractSumToDate: number;
  /** Scheduled − contract. Positive = the SOV claims more than the contract. */
  difference: number;
  reconciled: boolean;
}

export function reconcileAIASov(app: AIAPayApplication): AIASovReconciliation {
  const totalScheduledValue = roundCents(app.lines.reduce((s, l) => s + l.scheduledValue, 0));
  const contractSumToDate = roundCents(app.contractSumToDate);
  const difference = roundCents(totalScheduledValue - contractSumToDate);
  return {
    totalScheduledValue,
    contractSumToDate,
    difference,
    // A cent of float rounding is not a discrepancy; anything the certificate
    // would actually print as a different number is.
    reconciled: Math.abs(difference) <= 0.01,
  };
}

/**
 * Prefill an AIA pay application from a MAGE ID invoice + project + approved COs.
 * Column C comes from the contract (buildAIASovLines); column E is what THIS
 * invoice bills. The contractor edits both on the screen.
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
  // MISS-05: carry the invoice's ACTUAL retainage rate — including a
  // deliberate 0%. See retainagePercentForInvoice for why there is no 10%
  // fallback any more.
  const retainagePercent = opts?.retainagePercent ?? retainagePercentForInvoice(invoice);
  const originalContractSum = roundCents(effectiveEstimateTotal(project));
  const netChangeByCO = roundCents(approvedCOs.reduce((s, co) => s + co.changeAmount, 0));
  const contractSumToDate = roundCents(originalContractSum + netChangeByCO);

  const { lines, basis } = buildAIASovLines(invoice, project, approvedCOs, retainagePercent);

  return {
    sovBasis: basis,
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
    lessPreviousCertificates: roundCents(opts?.lessPreviousCertificates ?? 0),
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
    const balanceToFinish = roundCents(l.scheduledValue - totalCompletedAndStored);
    // Split the same way computeAIATotals does (completed work + stored
    // material, each rounded) so this column foots to G702 line 5 exactly.
    const retainage = roundCents(
      retainageOnWorkValue(totalCompleted, l.retainagePercent)
      + retainageOnWorkValue(l.materialsPresentlyStored, l.retainagePercent),
    );
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
    roundCents(app.lines.reduce((s, l) => s + (l[key] as number), 0));

  const g703TotalScheduled = sumCol('scheduledValue');
  const g703TotalFromPrev = sumCol('fromPreviousApp');
  const g703TotalThisPeriod = sumCol('thisPeriod');
  const g703TotalStored = sumCol('materialsPresentlyStored');
  const g703TotalCompletedStored = roundCents(g703TotalFromPrev + g703TotalThisPeriod + g703TotalStored);
  // Same per-line, cent-rounded split as computeAIATotals, so the continuation
  // sheet's retainage column total IS G702 line 5's "Total Retainage".
  const g703TotalRetainage = totals.totalRetainage;

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
        <td class="num">${fmt(roundCents(g703TotalScheduled - g703TotalCompletedStored))}</td>
        <td class="num">${fmt(g703TotalRetainage)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="page-footer">
    Generated by MAGE ID · Application #${app.applicationNumber} · Page 2 of 2 · G703 Continuation
  </div>

  <div style="margin-top:24px;padding:14px 16px;border-radius:8px;border:1px solid #ddd;background:#fafaf6;font-size:9px;color:#444;line-height:1.5">
    <div style="font-weight:700;color:#222;margin-bottom:4px;font-size:9.5px;letter-spacing:0.4px;text-transform:uppercase">Important &mdash; please read</div>
    This is an AIA-style draft pay application generated by MAGE ID. AIA<sup>&reg;</sup> and &ldquo;AIA Document G702/G703&rdquo; are registered trademarks of The American Institute of Architects, which is not affiliated with MAGE ID. Some lenders and architects require the official AIA Contract Documents. Verify all amounts, retainage percentages, and certification language with the parties involved before submission. The contractor named above is solely responsible for the accuracy of every figure on this document. MAGE ID makes no warranty, express or implied, regarding completeness, accuracy, or fitness for any particular use.
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

  const { Platform } = await import('react-native');
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
    const Print = await import('expo-print');
    const Sharing = await import('expo-sharing');
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
