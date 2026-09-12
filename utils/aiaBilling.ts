// react-native / expo-print / expo-sharing are imported LAZILY inside
// generateAIAPayAppPDF (the same pattern as utils/wipExport.ts). Keeping them
// off the module's top level is what lets computeAIATotals and
// seedAIAPayApplicationFromInvoice be imported and unit-tested by
// scripts/validate-invoice-billing.ts under bun — a top-level
// `import { Platform } from 'react-native'` makes the whole module unloadable
// outside Metro, and money math this app depends on must be testable.
import type {
  CompanyBranding, Project, Invoice, InvoiceLineItem, ChangeOrder, LinkedEstimateItem,
  SavedAIAPayApp, SavedAIAPayAppLine,
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
import { changeOrderBillKey, CO_BILL_KEY_PREFIX } from '@/utils/changeOrderBilling';

// Re-exported so the pay-app module keeps offering the retainage rule it is the
// reference implementation of, and existing importers (utils/portalSnapshot)
// need no change. New callers should import from utils/invoiceBilling, which
// costs them nothing beyond the arithmetic.
export { roundCents, retainageOnWorkValue };

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTED CERTIFICATE FIELDS
//
// These extend SavedAIAPayApp / SavedAIAPayAppLine, which live in types/index.ts.
// They are declared here as a module augmentation rather than edited into
// types/index.ts directly ONLY because this change landed while other work was
// in flight in that file; the fields are ordinary parts of the saved record and
// SHOULD be folded into the interfaces themselves when the tree is quiet.
// Type-only, so there is no runtime cost and no behaviour attached to where
// they are written.
//
// All optional, because every pay application saved before they existed is
// still a valid record and must keep loading unchanged.
// ─────────────────────────────────────────────────────────────────────────────
declare module '@/types' {
  interface SavedAIAPayAppLine {
    /** G702 line 5b's rate for this line. Undefined = same as retainagePercent. */
    storedRetainagePercent?: number;
  }
  interface SavedAIAPayApp {
    /** Start of the billing window. PERIOD TO is the form's field; this is the
     *  other end of it, which the portal narrative previously had to guess. */
    periodFrom?: string;
    /** G702 line 5b's rate. Undefined = same as retainagePercent. */
    storedRetainagePercent?: number;
    /** What the architect actually certified. A201 §9.5/§9.6 let it differ from
     *  the amount applied for, and the NEXT application's line 7 is "Line 6
     *  from prior Certificate" — this figure, not the requested one. */
    amountCertified?: number;
    certifiedDate?: string;
    certifiedExplanation?: string;
    /**
     * The four-row CHANGE ORDER SUMMARY as it stood when this certificate was
     * saved. Stored, not recomputed: reprinting a certified application must
     * reproduce the document that was SENT, and recomputing this table from
     * today's change-order list would quietly restate it the moment a CO
     * approved inside the period was entered after the fact.
     */
    changeOrderSummary?: AIAChangeOrderSummary;
    /** Jurat. Off by default; a residential GC should not print empty notary
     *  lines on every certificate. */
    notarize?: boolean;
    notaryState?: string;
    notaryCounty?: string;
    /**
     * Where column C came from when this certificate was built.
     *
     * The screen prints a provenance note under the schedule of values — "the
     * linked estimate plus approved change orders" vs "reconstructed from this
     * one invoice, so it covers only the scope the invoice touched". Without
     * this on the record, hydrating a saved application left `sovBasis`
     * undefined and EVERY reopened certificate printed the second note,
     * telling a GC whose job DOES have a linked estimate to go and link one.
     * That note is the honesty instrumentation this feature is differentiated
     * by; a hydrate that silently inverts it is worse than not having it.
     */
    sovBasis?: AIASovBasis;
  }
}

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
   * G702 line 5b's rate — the percentage withheld on STORED MATERIAL (column
   * F), which is a different blank on the form from line 5a's rate on
   * completed work (columns D+E), and is different precisely because the
   * owner's exposure on material sitting in a yard is not the owner's exposure
   * on work in place. Contracts routinely hold 10% on work and 0% on stored
   * material. Undefined means "same as this line's completed-work rate", which
   * is what every pay app saved before this field existed meant.
   */
  storedRetainagePercent?: number;
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
  /**
   * Start of the billing period. Not a G702 field (the form carries PERIOD TO
   * only) but the portal's narrative already needs a window and derives one
   * from the prior application's periodTo (utils/portalOwnerCore
   * derivePayAppPeriods). Carried here so a GC who sets the period explicitly
   * is believed instead of inferred from.
   */
  periodFrom?: string;
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
  /** G702 line 5b's rate. Undefined = same as `retainagePercent`. */
  storedRetainagePercent?: number;

  // Previous certificate values (from prior pay apps, if known)
  lessPreviousCertificates: number;

  /**
   * What the architect actually certified, when it has come back.
   *
   * A201 §9.5 and §9.6 let the architect certify an amount DIFFERENT from the
   * amount applied for, and the G702 carries an AMOUNT CERTIFIED line for
   * exactly that. It matters twice: the owner pays the certified figure, and
   * the NEXT application's line 7 is "Line 6 from prior Certificate" — the
   * certified amount, not the requested one. Left undefined until the
   * certificate comes back, in which case the form prints a blank rule for the
   * architect to write on.
   */
  amountCertified?: number;
  certifiedDate?: string;
  /** Why the certified amount differs — the form asks for an explanation. */
  certifiedExplanation?: string;

  /**
   * Notary jurat. AIA's own instructions say the Contractor should sign G702,
   * have it notarized and submit it with the G703; on public work and most
   * lender-funded private work an un-notarized application comes back. Off by
   * default so residential GCs who never need it are not printing empty notary
   * lines on every certificate.
   */
  notarize?: boolean;
  notaryState?: string;
  notaryCounty?: string;

  /**
   * The four-row CHANGE ORDER SUMMARY the G702 prints, when the caller has the
   * change-order history to build it (see summarizeChangeOrders). Optional
   * because the pure seeding path only knows the net figure; when it is absent
   * the form falls back to the single net row it printed before.
   */
  changeOrderSummary?: AIAChangeOrderSummary;

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

/**
 * A DATE ON THIS FORM IS A CALENDAR DAY, NOT AN INSTANT.
 *
 * `new Date('2026-08-31')` parses as UTC midnight, and toLocaleDateString then
 * renders it in the viewer's zone — so west of Greenwich a GC who sets PERIOD
 * TO to the last day of August gets a certificate that says August 30. That
 * was survivable while every date on here was silently copied from the
 * invoice; it is not survivable now that PERIOD TO, PERIOD FROM, APPLICATION
 * DATE and the certified date are fields a contractor fills in and an
 * architect reconciles against his own file. The portal page had already hit
 * this and carries its own fmtCalendarDate for the same reason.
 *
 * A bare YYYY-MM-DD is therefore built from local components. Anything else (a
 * full ISO timestamp from an older record) keeps the previous behaviour.
 */
function fmtDate(iso?: string): string {
  if (!iso) return '';
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  const d = ymd
    ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
    : new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Compute the derived totals for a G702 cover from the SOV lines.
 */
/**
 * The rate withheld on THIS line's stored material — G702 line 5b's blank.
 *
 * `undefined` means "same as this line's completed-work rate", which is what
 * every pay application saved before storedRetainagePercent existed meant, and
 * what a contract that does not distinguish the two bases means today. So the
 * fallback is not a default: it is the historical record's own semantics, and
 * changing it would silently restate retainage on every archived certificate.
 */
export function storedRetainagePercentForLine(
  l: Pick<AIASOVLine, 'retainagePercent' | 'storedRetainagePercent'>,
): number {
  const s = l.storedRetainagePercent;
  return s == null || !Number.isFinite(s) ? l.retainagePercent : s;
}

/** Cover-level line 5b rate. Same fallback rule as the per-line one. */
export function storedRetainagePercentForApp(
  app: Pick<AIAPayApplication, 'retainagePercent' | 'storedRetainagePercent'>,
): number {
  const s = app.storedRetainagePercent;
  return s == null || !Number.isFinite(s) ? app.retainagePercent : s;
}

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
  // Line 5b's basis is column F and 5b's RATE is its own blank on the form.
  // Holding 10% on work in place and nothing on material sitting in a yard is
  // an ordinary contract term, and until this split the certificate withheld
  // the work rate on stored material too — money the GC was contractually owed
  // that period.
  const retainageOnStored = roundCents(app.lines.reduce(
    (s, l) => s + retainageOnWorkValue(l.materialsPresentlyStored, storedRetainagePercentForLine(l)),
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
 *
 * COLUMN F CARRIES FORWARD TOO (audit 2026-09-11, F4/C14). Column F is
 * "Materials Presently Stored (Not in D or E)" — a point-in-time BALANCE
 * restated on each application, not a per-period flow. It used to start at
 * zero on every new period, so a GC with $180,000 of millwork in a warehouse
 * opened App #2, saw 0.00 on every Stored field, and either retyped fourteen
 * figures or billed $162,000 light. Carrying the prior period's balance
 * forward as this period's OPENING column F is what the form means by a
 * balance, and it does not double-count: D is (D + E) of the prior period and
 * the form says in as many words that F is NOT in D or E, so column G stays
 * continuous across the boundary. When the material is installed, the GC moves
 * it out of F and into E with `installStoredMaterialOnLine` below — the one
 * action that keeps column G from dipping.
 */
export type PriorSOVLine = Pick<
  AIASOVLine, 'id' | 'itemNo' | 'fromPreviousApp' | 'thisPeriod'
> & Partial<Pick<AIASOVLine, 'materialsPresentlyStored' | 'storedRetainagePercent'>>;

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
      // The stored-material BALANCE, carried. `?? 0` and not `|| 0` would be
      // identical here, but a prior record predating the field is genuinely
      // "no stored balance known", which is 0.
      materialsPresentlyStored: roundCents(prior.materialsPresentlyStored || 0),
      // A line-level 5b rate is a contract term, not a period figure — it
      // survives the period boundary the same way retainagePercent does.
      storedRetainagePercent: prior.storedRetainagePercent ?? line.storedRetainagePercent,
    };
  });
}

/**
 * Move stored material out of column F and into column E because it got
 * installed this period.
 *
 * Without this action a GC zeroes the Stored field by hand and forgets to add
 * the same dollars to This Period, so column G drops on that line and the G703
 * shows the job going BACKWARDS on work that was actually completed. That is a
 * phone call from the architect at best. `amount` is clamped to what is
 * actually stored, because installing more material than the certificate says
 * is in the yard is not a thing that can have happened.
 */
export function installStoredMaterialOnLine(line: AIASOVLine, amount: number): AIASOVLine {
  const want = Number.isFinite(amount) ? amount : 0;
  const moved = roundCents(Math.max(0, Math.min(line.materialsPresentlyStored, want)));
  if (moved === 0) return line;
  return {
    ...line,
    materialsPresentlyStored: roundCents(line.materialsPresentlyStored - moved),
    thisPeriod: roundCents(line.thisPeriod + moved),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OVER-BILLING
//
// Billing a line past its scheduled value is a PRACTICE problem, not a form
// rule: the G703-1992 sheet prints no constraint that column G must not exceed
// column C, and AIA's G703 instructions state none (verified against AIA's own
// published forms — an earlier version of this warning claimed the form
// required it, which it does not). What is true is that an architect returns a
// continuation sheet showing 130% on a line, and the GC waits another 30-day
// cycle for money he has already spent.
//
// So: WARN, never clamp. A GC sometimes needs to enter an over-bill
// deliberately and then correct column C. What must not happen is the screen
// HIDING it — which it did, because the progress bar rendered Math.min(100,
// pct) while the numeral beside it was unclamped.
// ─────────────────────────────────────────────────────────────────────────────

export interface AIAOverBill {
  lineId: string;
  itemNo: string;
  description: string;
  /** D + E + F on this line. */
  billedToDate: number;
  scheduledValue: number;
  /** billedToDate − scheduledValue, always > 0 for a returned entry. */
  overBy: number;
}

/**
 * How far past its scheduled value one line is billed — 0 when it is not.
 *
 * ONE DEFINITION, used by the aggregate banner AND by the row that paints
 * itself red. The screen used to compute its own `over` inline, so the row
 * warning and `findOverBilledLines` were two implementations of the same
 * sentence and nothing tied them together; the guard suite could only grep the
 * screen for a string. Both go through here now, so a change to the rule
 * changes both and a unit test of this function is a test of the row.
 */
export function lineOverBill(
  l: Pick<AIASOVLine, 'fromPreviousApp' | 'thisPeriod' | 'materialsPresentlyStored' | 'scheduledValue'>,
): number {
  const billedToDate = roundCents(l.fromPreviousApp + l.thisPeriod + l.materialsPresentlyStored);
  const overBy = roundCents(billedToDate - l.scheduledValue);
  // A cent of float noise is not an over-bill. A negative scheduled value is a
  // deductive CO line, where "over" has no meaning — report nothing rather
  // than warn on every credit.
  return overBy > 0.01 && l.scheduledValue > 0 ? overBy : 0;
}

/** Every line whose D+E+F exceeds its column C by more than a cent. */
export function findOverBilledLines(app: Pick<AIAPayApplication, 'lines'>): AIAOverBill[] {
  const out: AIAOverBill[] = [];
  app.lines.forEach((l) => {
    const overBy = lineOverBill(l);
    if (overBy > 0) {
      out.push({
        lineId: l.id, itemNo: l.itemNo, description: l.description,
        billedToDate: roundCents(l.fromPreviousApp + l.thisPeriod + l.materialsPresentlyStored),
        scheduledValue: l.scheduledValue, overBy,
      });
    }
  });
  return out;
}

/**
 * Does the certificate as a whole bill past the contract? Line-level warnings
 * can all be clean while the cover still over-certifies (an off-contract row
 * the SOV grossed up, a CO billed before it was approved), and line 4 vs line
 * 3 is the comparison the architect makes first.
 */
export function totalOverBill(app: AIAPayApplication): number {
  const totals = computeAIATotals(app);
  return roundCents(totals.totalCompletedAndStored - app.contractSumToDate);
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

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE ORDERS BELONG TO A PERIOD
//
// G702 line 2 is the net change by change orders approved THROUGH THE END OF
// THIS PERIOD, and the G703 carries a line for each. A CO approved in April is
// not on the March application. Before this filter the screen passed every
// currently-approved CO into the seeding with no date comparison, so reopening
// a March certificate in June silently grew Contract Sum to Date, added SOV
// lines at 0% complete, and dropped the percent complete — on a certificate
// the architect had already signed.
// ─────────────────────────────────────────────────────────────────────────────

/** The fields this module needs to date a change order's approval. */
export type DatableChangeOrder = Pick<ChangeOrder, 'status' | 'date' | 'updatedAt'>
  & Partial<Pick<ChangeOrder, 'approvers' | 'auditTrail'>>;

/**
 * When was this change order approved?
 *
 * Best evidence first: an approver's own recorded response, then the audit
 * trail entry that names an approval, then `updatedAt` (the row last changed
 * when it was approved, on a CO nobody has touched since), then the CO's own
 * date. Returns null only when the CO carries no usable date at all.
 */
export function changeOrderApprovalDate(co: DatableChangeOrder): string | null {
  const responses = (co.approvers ?? [])
    .filter(a => a.status === 'approved' && a.responseDate)
    .map(a => a.responseDate as string)
    .sort();
  // The LAST approver to sign is when the CO became approved — an earlier
  // signature on a sequential chain is not the approval of the change order.
  if (responses.length) return responses[responses.length - 1];
  const audit = (co.auditTrail ?? [])
    .filter(e => /approve/i.test(e.action) && e.timestamp)
    .map(e => e.timestamp)
    .sort();
  if (audit.length) return audit[audit.length - 1];
  return co.updatedAt || co.date || null;
}

/**
 * Is this a date this module can reason about — a bare YYYY-MM-DD, or an ISO
 * timestamp whose first ten characters are one?
 *
 * EXPORTED BECAUSE THE FAILURE IS SILENT. Every date consumer here degrades
 * quietly on an unparseable string: `dayKey` returns null and
 * selectPriorApplication drops to sequence ordering; `onOrBeforeDay` returns
 * true and splitApprovedCOsByPeriod sweeps EVERY approved change order onto the
 * certificate. Both of those are the exact defects the period fields were added
 * to fix, undone by a GC typing "3/31/26" with nothing telling him. The screen
 * validates with this and says so at the field instead.
 */
export function isCalendarDay(value: string | undefined | null): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').slice(0, 10));
}

/** Calendar-day compare, so a timestamp late on the period's last day is IN. */
function onOrBeforeDay(iso: string, boundaryIso: string): boolean {
  const a = String(iso).slice(0, 10);
  const b = String(boundaryIso).slice(0, 10);
  if (!isCalendarDay(a) || !isCalendarDay(b)) return true;
  return a <= b;
}

export interface PeriodCOSplit<T> {
  /** Approved on or before `periodTo` — these belong on THIS certificate. */
  inPeriod: T[];
  /** Approved after it — they belong on the next one, and the screen says so. */
  afterPeriod: T[];
}

/**
 * Split approved change orders into the ones this period may bill and the ones
 * it may not. An undated period (or an undated CO) falls back to INCLUDING the
 * CO: dropping contract value the GC can see in his change-order log, without
 * saying why, is the worse failure.
 */
export function splitApprovedCOsByPeriod<T extends DatableChangeOrder>(
  cos: T[],
  periodTo: string | undefined,
): PeriodCOSplit<T> {
  const approved = cos.filter(co => co.status === 'approved');
  if (!periodTo) return { inPeriod: approved, afterPeriod: [] };
  const inPeriod: T[] = [];
  const afterPeriod: T[] = [];
  approved.forEach((co) => {
    const when = changeOrderApprovalDate(co);
    if (!when || onOrBeforeDay(when, periodTo)) inPeriod.push(co);
    else afterPeriod.push(co);
  });
  return { inPeriod, afterPeriod };
}

/**
 * The four-row CHANGE ORDER SUMMARY the G702 actually prints: additions and
 * deductions for changes approved in PREVIOUS months, this month, the totals,
 * and the net. Collapsing that to one signed net row printed a $50,000 add and
 * a $20,000 deduct as a single $30,000 addition, which is not what happened.
 */
export interface AIAChangeOrderSummary {
  priorAdditions: number; priorDeductions: number;
  thisPeriodAdditions: number; thisPeriodDeductions: number;
  totalAdditions: number; totalDeductions: number;
  netChange: number;
}

export function summarizeChangeOrders<T extends DatableChangeOrder & { changeAmount: number }>(
  cos: T[],
  periodFrom: string | undefined,
  periodTo: string | undefined,
): AIAChangeOrderSummary {
  const { inPeriod } = splitApprovedCOsByPeriod(cos, periodTo);
  let priorAdditions = 0, priorDeductions = 0, thisPeriodAdditions = 0, thisPeriodDeductions = 0;
  inPeriod.forEach((co) => {
    const amt = co.changeAmount || 0;
    const when = changeOrderApprovalDate(co);
    // No period start (or no date on the CO) means the app cannot say WHICH
    // month it was approved in. "Previous months" is the honest bucket: it is
    // approved and it is in the contract, it just is not news this period.
    const isThisPeriod = !!(periodFrom && when && !onOrBeforeDay(when, periodFrom))
      || !!(periodFrom && when && String(when).slice(0, 10) === String(periodFrom).slice(0, 10));
    if (isThisPeriod) {
      if (amt >= 0) thisPeriodAdditions += amt; else thisPeriodDeductions += -amt;
    } else {
      if (amt >= 0) priorAdditions += amt; else priorDeductions += -amt;
    }
  });
  const totalAdditions = roundCents(priorAdditions + thisPeriodAdditions);
  const totalDeductions = roundCents(priorDeductions + thisPeriodDeductions);
  return {
    priorAdditions: roundCents(priorAdditions),
    priorDeductions: roundCents(priorDeductions),
    thisPeriodAdditions: roundCents(thisPeriodAdditions),
    thisPeriodDeductions: roundCents(thisPeriodDeductions),
    totalAdditions,
    totalDeductions,
    netChange: roundCents(totalAdditions - totalDeductions),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// APPLICATION NUMBER
//
// APPLICATION NO. on a G702 is a strict 1..N sequence of pay applications on
// ONE contract. Lenders and architects reconcile draws by it. It used to be the
// source INVOICE's number, which counts every invoice type on the project — so
// a GC who billed a deposit (#1) and a mobilization invoice (#2) had his first
// ever G702 read "Application No. #3" beside "Less Previous Certificates
// $0.00", two facts that cannot both be true, and the draw administrator asked
// for applications 1 and 2, which do not exist.
// ─────────────────────────────────────────────────────────────────────────────

/** Enough of a saved pay application to place it in the project's sequence. */
export interface PayAppSequenceEntry {
  applicationNumber: number;
  /** Which invoice/period it certifies — the identity that survives a reopen. */
  invoiceId?: string;
}

/**
 * The application number for the period keyed by `invoiceId`.
 *
 * REOPENING MUST NOT MINT A SUCCESSOR. If this project already has a saved
 * application for this invoice, that IS this application's number — returning
 * max+1 instead is the bug that defeated the edit-after-send lock, minted a
 * second live Stripe payment link for already-certified money, wrote a phantom
 * record, and (because getAIAPayAppsForProject sorts by applicationNumber
 * descending) handed the WIP report's contract baseline to a certificate that
 * does not exist.
 *
 * Only a genuinely new period gets max+1, and the sequence starts at 1.
 */
export function nextApplicationNumber(
  saved: PayAppSequenceEntry[],
  invoiceId: string | undefined,
): number {
  if (invoiceId) {
    const mine = saved.find(a => a.invoiceId === invoiceId);
    if (mine && Number.isFinite(mine.applicationNumber)) return mine.applicationNumber;
  }
  const max = saved.reduce(
    (m, a) => (Number.isFinite(a.applicationNumber) ? Math.max(m, a.applicationNumber) : m),
    0,
  );
  return max + 1;
}

/**
 * WHICH APPLICATION IS "THE PREVIOUS APPLICATION"?
 *
 * Column D is "Work Completed From Previous Application (D + E)" and line 7 is
 * "Line 6 from prior Certificate" — both singular and both ORDERED. Picking the
 * wrong one puts a LATER period's billed-through into this certificate's column
 * D, which reads to an architect as work already paid for that the GC is now
 * billing again.
 *
 * ORDER BY PERIOD FIRST, because that is what the form's word "previous" means
 * and it is only now knowable: PERIOD TO used to be whatever date the invoice
 * happened to be cut on, with no field to change it, so ordering on it would
 * have been ordering on noise. It is a field the GC fills in now.
 *
 * The failure this fixes: a GC with progress invoices #4 and #5 sees the period
 * picker newest-first, certifies #5, then goes back to do #4. Numbered ordering
 * hands #4 the billed-through of #5 — the later period — and the July
 * certificate claims August's work as already billed.
 *
 * FALL BACK TO THE SEQUENCE, never to nothing. If no saved application's period
 * precedes this one (undated records, or a GC genuinely billing the earliest
 * period last) the highest application number below this one is used instead.
 * Returning null there would zero column D on a job that HAS been billed, and a
 * silently-zeroed column D over-bills the owner — strictly worse than carrying
 * from a period the GC can see named on screen ("Carried forward from Pay App
 * #N", which is why that label exists).
 */
export interface PriorPayAppCandidate extends PayAppSequenceEntry {
  periodTo?: string;
}

function dayKey(iso: string | undefined): string | null {
  const d = String(iso ?? '').slice(0, 10);
  return isCalendarDay(d) ? d : null;
}

export function selectPriorApplication<T extends PriorPayAppCandidate>(
  saved: T[],
  opts: { excludeInvoiceId?: string; thisApplicationNumber: number; thisPeriodTo?: string },
): T | null {
  const others = saved.filter(a => !opts.excludeInvoiceId || a.invoiceId !== opts.excludeInvoiceId);
  if (others.length === 0) return null;

  const mine = dayKey(opts.thisPeriodTo);
  if (mine) {
    const dated = others.filter((a) => {
      const theirs = dayKey(a.periodTo);
      return theirs != null && theirs < mine;
    });
    if (dated.length) {
      return [...dated].sort((a, b) => (
        String(dayKey(b.periodTo)).localeCompare(String(dayKey(a.periodTo)))
        || b.applicationNumber - a.applicationNumber
      ))[0];
    }
  }

  const bySequence = others.filter(a => a.applicationNumber < opts.thisApplicationNumber);
  if (!bySequence.length) return null;
  return [...bySequence].sort((a, b) => (
    b.applicationNumber - a.applicationNumber
    // Two records at one number is a state the pre-fix numbering bug could
    // create; the later period end is the better answer of the two.
    || String(b.periodTo ?? '').localeCompare(String(a.periodTo ?? ''))
  ))[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SCHEDULE OF VALUES IS EDITABLE
//
// A schedule of values is NEGOTIATED with the owner. It is organised by CSI
// division, it is broken down finer than the estimate where the owner wants
// visibility, and it routinely does not match the estimate's line structure at
// all. Until now the G703 had no add, delete, rename, reorder or item-number
// control of any kind — the screen's own comment conceded it — and itemNo was
// always String(index + 1) even though this file's own doc comment for itemNo
// promises "1.0", "2.1".
//
// These are pure list operations so the money math stays testable. They
// deliberately do NOT renumber on every change: a GC who types "3.1" means it,
// and silently rewriting it to "7" the moment a row moves is the behaviour
// that makes people stop trusting the grid. `renumberSovLines` is offered as
// an explicit action instead.
// ─────────────────────────────────────────────────────────────────────────────

/** A blank SOV row. `existing` is only read to keep the id unique. */
export function newSovLine(
  existing: AIASOVLine[],
  retainagePercent: number,
  seed?: Partial<AIASOVLine>,
): AIASOVLine {
  const used = new Set(existing.map(l => l.id));
  let id = seed?.id ?? `sov_manual_${Date.now().toString(36)}`;
  for (let n = 2; used.has(id); n++) id = `${seed?.id ?? `sov_manual_${Date.now().toString(36)}`}__${n}`;
  return {
    id,
    itemNo: seed?.itemNo ?? String(existing.length + 1),
    description: seed?.description ?? '',
    scheduledValue: seed?.scheduledValue ?? 0,
    fromPreviousApp: seed?.fromPreviousApp ?? 0,
    thisPeriod: seed?.thisPeriod ?? 0,
    materialsPresentlyStored: seed?.materialsPresentlyStored ?? 0,
    retainagePercent: seed?.retainagePercent ?? retainagePercent,
    storedRetainagePercent: seed?.storedRetainagePercent,
    linkedTaskId: seed?.linkedTaskId,
  };
}

/** Move one line up or down. Out-of-range moves are no-ops, not throws. */
export function moveSovLine(lines: AIASOVLine[], lineId: string, delta: number): AIASOVLine[] {
  const i = lines.findIndex(l => l.id === lineId);
  if (i < 0) return lines;
  const j = i + delta;
  if (j < 0 || j >= lines.length) return lines;
  const next = [...lines];
  const [moved] = next.splice(i, 1);
  next.splice(j, 0, moved);
  return next;
}

/**
 * Renumber every row 1..N.
 *
 * DESTRUCTIVE OF CSI-STYLE NUMBERS BY DESIGN, and only ever run when the GC
 * asks for it: itemNo is ALSO carryForwardPriorLines' fallback key, so
 * renumbering a schedule of values whose prior period was saved under the old
 * numbers loses the itemNo match for rows whose `id` also moved. `id` is the
 * primary key there and it does not move, so the ordinary case is safe — but
 * this is why the editor does not renumber on its own after every insert.
 */
export function renumberSovLines(lines: AIASOVLine[]): AIASOVLine[] {
  return lines.map((l, i) => ({ ...l, itemNo: String(i + 1) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SCREEN'S OWN LOGIC, LIFTED OUT WHERE IT CAN BE EXECUTED
//
// Everything below used to live inline in app/aia-pay-app.tsx. A React screen
// cannot be run by scripts/validate-invoice-billing.ts, so the only coverage
// those rules had was a grep of the source — and the 2026-09-11 adversarial
// review proved what that is worth: replacing the record→application line
// mapper's `materialsPresentlyStored: l.materialsPresentlyStored` with `0`
// (i.e. saving a certificate silently zeroes column F, the exact blocker this
// wave was opened for) left the guard suite entirely GREEN, as did switching
// review mode off and neutering the read-only lock.
//
// A guard that stays green while the bug is reinstated is worse than no guard,
// because it certifies the bug. These functions are pure and exported, the
// screen calls them, and the validator executes them.
// ─────────────────────────────────────────────────────────────────────────────

/** The application ↔ record line mapping, in one place, both directions. */
export function sovLineToSaved(l: AIASOVLine): SavedAIAPayAppLine {
  return {
    id: l.id,
    itemNo: l.itemNo,
    description: l.description,
    scheduledValue: l.scheduledValue,
    fromPreviousApp: l.fromPreviousApp,
    thisPeriod: l.thisPeriod,
    // COLUMN F. Nothing in the invoice can reproduce a stored-materials figure
    // the GC typed, so if this mapper drops it the certificate a bank funded
    // against is rewritten to zero by the act of saving or reopening it.
    materialsPresentlyStored: l.materialsPresentlyStored,
    retainagePercent: l.retainagePercent,
    storedRetainagePercent: l.storedRetainagePercent,
    linkedTaskId: l.linkedTaskId,
  };
}

export function savedLineToSov(l: SavedAIAPayAppLine): AIASOVLine {
  return {
    id: l.id,
    itemNo: l.itemNo,
    description: l.description,
    scheduledValue: l.scheduledValue,
    fromPreviousApp: l.fromPreviousApp,
    thisPeriod: l.thisPeriod,
    materialsPresentlyStored: l.materialsPresentlyStored,
    retainagePercent: l.retainagePercent,
    storedRetainagePercent: l.storedRetainagePercent,
    linkedTaskId: l.linkedTaskId,
  };
}

/**
 * Rebuild the editable application from the record that was SAVED.
 *
 * Not a re-derivation: every hand-entered figure on the certificate — column
 * F, a negotiated scheduled value, an item number, the notary state, what the
 * architect certified — exists only here, and re-seeding from the invoice
 * cannot reproduce any of it.
 */
export function applicationFromSavedRecord(rec: SavedAIAPayApp): AIAPayApplication {
  return {
    applicationNumber: rec.applicationNumber,
    applicationDate: rec.applicationDate,
    periodTo: rec.periodTo,
    periodFrom: rec.periodFrom,
    contractDate: rec.contractDate,
    ownerName: rec.ownerName,
    contractorName: rec.contractorName,
    architectName: rec.architectName,
    projectName: rec.projectName,
    projectLocation: rec.projectLocation,
    contractForDescription: rec.contractForDescription,
    originalContractSum: rec.originalContractSum,
    netChangeByCO: rec.netChangeByCO,
    contractSumToDate: rec.contractSumToDate,
    retainagePercent: rec.retainagePercent,
    storedRetainagePercent: rec.storedRetainagePercent,
    lessPreviousCertificates: rec.lessPreviousCertificates,
    amountCertified: rec.amountCertified,
    certifiedDate: rec.certifiedDate,
    certifiedExplanation: rec.certifiedExplanation,
    // The CO summary that was CERTIFIED, not a fresh one. Review mode's whole
    // promise is that it renders the stored record.
    changeOrderSummary: rec.changeOrderSummary,
    notarize: rec.notarize,
    notaryState: rec.notaryState,
    notaryCounty: rec.notaryCounty,
    // The provenance note under the schedule of values branches on this. It
    // was omitted from the hand-written mapper this replaces, so every
    // reopened certificate claimed the project had no linked estimate.
    sovBasis: rec.sovBasis,
    lines: rec.lines.map(savedLineToSov),
    notes: rec.notes,
  };
}

export interface PayAppEditability {
  /** Showing the stored certificate rather than an editor. */
  isReviewMode: boolean;
  /** Every mutating handler funnels through this. */
  isReadOnly: boolean;
  /**
   * May the GC record what the architect sent back?
   *
   * DELIBERATELY NOT `!isReadOnly`. AMOUNT CERTIFIED is not an edit of the
   * application — it is the answer to it, and it arrives AFTER the application
   * was sent. A GC with Stripe Connect gets a pay link minted on the first
   * Save, so `isReadOnly` is true on every certificate an architect ever
   * responds to; gating the field on it made the whole feature unreachable in
   * the only flow it exists for, and left the next period's line 7 seeding
   * from the amount applied for — the exact defect it was built to fix.
   *
   * The one real stop is payment: once the money has moved against this
   * certificate the certified figure is history, not a field.
   */
  canRecordCertification: boolean;
}

/**
 * Can this certificate be edited, and is the screen presenting it or editing
 * it?
 *
 * `isLocked` (a Stripe link was minted, or the webhook stamped it paid) can
 * never be left. A saved DRAFT opens in review — there was no read-only view
 * of a submitted pay application anywhere in the product, and app/documents
 * routes a tap straight into this editor — but the GC can choose to edit it.
 */
export function payAppEditability(state: {
  hasSavedRecord: boolean; isLocked: boolean; editRequested: boolean; isPaid?: boolean;
}): PayAppEditability {
  const isReviewMode = state.hasSavedRecord && (state.isLocked || !state.editRequested);
  return {
    isReviewMode,
    isReadOnly: state.isLocked || isReviewMode,
    canRecordCertification: !state.isPaid,
  };
}

/**
 * INITIALISE ONCE PER CERTIFICATE — the stamp and the gate, together.
 *
 * The screen's hydration effect rebuilds the whole application object, so
 * anything that re-runs it throws away every figure the GC has typed and not
 * saved; and every one of its dependencies is a context callback whose identity
 * changes on a BACKGROUND write (a sync flush, another screen saving a change
 * order). It therefore keys on the identity of what is being edited — this
 * invoice, and the record backing it — and returns early when that has not
 * changed.
 *
 * The stamp and the gate live in one function on purpose. They were two lines
 * in the component, `if (ref.current === key) return;` and `ref.current = key;`,
 * and a guard can pin the first while the second is deleted — at which point
 * the gate never arms, the effect re-runs on every dependency churn, and the
 * data-loss bug is back verbatim with the suite still green. That mutation was
 * demonstrated. Here it is one indivisible rule the guard can EXECUTE.
 *
 * Takes the ref object rather than a value so the caller keeps ownership of the
 * lifetime; returns true when the caller should (re)initialise.
 */
export function claimInitKey(ref: { current: string | null }, key: string): boolean {
  if (ref.current === key) return false;
  ref.current = key;
  return true;
}

/**
 * WHAT THE REVIEW BANNER SAYS ABOUT A CERTIFICATE THAT HAS BEEN SENT.
 *
 * F20 asked for an "edit-after-send lock". A HARD lock on send is the wrong
 * shape here and would make the screen worse, for a reason that is worth
 * writing down rather than arguing every time it comes up:
 *
 *   Sending freezes `portalState.lastSentSnapshot` and THE PORTAL RENDERS THAT,
 *   not live state (see PortalState in types/index.ts). So an edit after a send
 *   cannot reach the client at all until the GC sends again. The hazard the
 *   lock was asked for — the owner quietly looking at different figures from
 *   the ones on screen — is already closed structurally.
 *
 *   What a hard lock WOULD do is strand a GC who shared a draft and then found
 *   a typo, on a screen whose only escape is to bill a period he has not
 *   worked. `payLinkUrl`/`paidAt` still lock, because those mean Stripe is
 *   holding a live obligation for these exact figures and that genuinely
 *   cannot be edited.
 *
 * So: say it, do not lock it. A sent certificate opens in review like any
 * other, and the banner names what the client is looking at, when it went, and
 * that editing does not change it until it is re-sent. Pure, so the wording is
 * executed by a guard rather than grepped.
 */
export interface PayAppReviewNotice {
  title: string;
  body: string;
  /** The edit affordance's label — different once a client has a copy. */
  editLabel: string;
}

export function payAppReviewNotice(state: {
  isLocked: boolean;
  savedAt?: string;
  portalStatus?: 'draft' | 'sent' | 'recalled';
  sentAt?: string;
}): PayAppReviewNotice {
  const day = (iso?: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  if (state.isLocked) {
    return {
      title: 'Certified record',
      body: 'These are the figures on the application that went out. They cannot be changed — bill the next period instead.',
      editLabel: 'Edit draft',
    };
  }
  if (state.portalStatus === 'sent') {
    const when = day(state.sentAt);
    return {
      title: 'Sent to the client',
      body: `Your client has had this certificate${when ? ` since ${when}` : ''}, and the portal shows the copy that was sent. `
        + 'Editing changes YOUR record only — the client keeps seeing the sent version until you send it again.',
      editLabel: 'Edit and re-send',
    };
  }
  const when = day(state.savedAt);
  return {
    title: 'Saved certificate',
    body: `Saved${when ? ` ${when}` : ''}. This is exactly what was stored, not a fresh calculation. Editing replaces the saved figures.`,
    editLabel: 'Edit draft',
  };
}

/**
 * WHAT TO DO WHEN G702 LINE 2 AND THE PRINTED CHANGE ORDER SUMMARY DISAGREE.
 *
 * The banner used to give one instruction on every certificate — "Re-enter
 * Period To, or tap the refresh button above" — and on a read-only record
 * NEITHER target is on the screen: `setPeriodTo` bails on `isReadOnly`, the
 * PERIOD TO input is `editable={!isReadOnly}`, and the refresh chip renders
 * only under `!isReadOnly`. That is not a rare state. Every SAVED certificate
 * opens read-only (see payAppEditability) until the GC taps Edit, and one
 * carrying a pay link or a paid_at is read-only for good — which is precisely
 * the legacy population where the two figures can still disagree.
 *
 * Three states, three instructions, and the locked one has to admit there is
 * nothing to tap. Pure, so the guard EXECUTES the advice instead of grepping
 * the JSX for a sentence.
 */
export function coFiguresAdvice(state: {
  isReadOnly: boolean; isLocked: boolean; editLabel: string;
}): string {
  if (state.isLocked) {
    return 'This certificate is locked against a live payment, so PERIOD TO and the refresh button '
      + 'are both off the screen — it cannot be corrected here. Print it only if the owner already '
      + 'holds this copy, and restate the change orders on the next application.';
  }
  if (state.isReadOnly) {
    return `Tap ${state.editLabel} above first — a saved certificate is read-only, so PERIOD TO and `
      + 'the refresh button are not reachable until you do. Then re-enter PERIOD TO before printing.';
  }
  return 'Re-enter PERIOD TO, or tap the refresh button above, before printing — the two figures are '
    + 'on the same page.';
}

/**
 * Where column C came from, for a record that may predate the field.
 *
 * `sovBasis` is stamped by `seedAIAPayApplicationFromInvoice` and is now
 * persisted, but every certificate SAVED BEFORE that has none — and review
 * mode, which is the default for a saved pay application, renders the stored
 * record. Defaulting an absent basis to the else branch made the honesty note
 * lie on exactly the screen the wave made the default: a GC whose job DOES have
 * a linked estimate was told to go and link one, on a certificate a bank may
 * have funded against.
 *
 * A missing basis is UNKNOWN, and the best evidence available for it is whether
 * the project has an itemised estimate today. That can differ from the truth at
 * build time — a job that has been linked since — but "the estimate is linked"
 * is then a statement about the project, which is true, and the note's advice
 * ("tap Edit lines") is right either way. Guessing the other direction is the
 * one that reads as a false accusation.
 */
export function resolveSovBasis(
  recorded: AIASovBasis | undefined,
  projectHasEstimateItems: boolean,
): AIASovBasis {
  return recorded ?? (projectHasEstimateItems ? 'linked_estimate' : 'invoice_lines');
}

/** Why a schedule-of-values row may not be deleted, or null if it may. */
export interface SovDeletionRefusal { title: string; body: string; billedToDate: number }

/**
 * Deleting a row that has already been billed takes money OFF the certificate.
 *
 * Refuse rather than quietly under-certify: the GC can zero the figures first
 * if dropping the scope is really what he means. Pure, and separate from the
 * screen, because the refusal used to be a `showAlert` call INSIDE a `setApp`
 * updater — impure (StrictMode fires it twice in development) and reachable
 * only through a renderer, so the rule itself could never be executed by a
 * test.
 *
 * A missing line is not a refusal: the row is already gone.
 */
export function sovLineDeletionRefusal(
  line: Pick<AIASOVLine, 'itemNo' | 'description' | 'fromPreviousApp' | 'thisPeriod' | 'materialsPresentlyStored'> | undefined,
): SovDeletionRefusal | null {
  if (!line) return null;
  const billedToDate = roundCents(
    (line.fromPreviousApp || 0) + (line.thisPeriod || 0) + (line.materialsPresentlyStored || 0),
  );
  // A credit row (a deductive CO billed as a negative) is still money on the
  // certificate, so "has been billed" is a non-zero balance, not a positive one.
  if (Math.abs(billedToDate) <= 0.005) return null;
  const money = billedToDate.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return {
    title: 'This line has been billed',
    body: `"${line.description || `Item ${line.itemNo}`}" carries ${money} of billed and stored value. `
      + 'Removing it takes that money off the certificate. Zero the amounts first if you meant to drop the scope.',
    billedToDate,
  };
}

/**
 * G702 line 2, line 3 and the change-order rows on the G703 all state ONE
 * fact: the change orders approved through the end of this period. Restate all
 * of them from a single CO set.
 *
 * WHY THIS EXISTS. Line 2 and the CO rows were frozen at seed time against the
 * invoice's issue date, while the printed four-row CHANGE ORDER SUMMARY was
 * computed live from `app.periodTo` — the field the GC had just been given.
 * The moment he used it the two disagreed ON THE SAME PAGE: an invoice issued
 * 2026-04-10 with PERIOD TO set back to 2026-03-31 printed NET CHANGE BY
 * CHANGE ORDERS of $70,000 on line 2 and $50,000 in the summary, and the
 * "held back" banner named 2026-03-31 while listing nothing.
 *
 * A CO row that has already been BILLED is never removed, even if the new
 * period end excludes it — taking billed money off a certificate silently is
 * worse than carrying a row the summary does not count, and the over-bill and
 * reconciliation banners both surface the result.
 */
export function applyApprovedCOsToApplication<T extends DatableChangeOrder & {
  id: string; number: number; description?: string; changeAmount: number;
}>(
  app: AIAPayApplication,
  inPeriodCOs: T[],
): AIAPayApplication {
  const netChangeByCO = roundCents(inPeriodCOs.reduce((s, co) => s + (co.changeAmount || 0), 0));
  const contractSumToDate = roundCents(app.originalContractSum + netChangeByCO);

  const wantedById = new Map(inPeriodCOs.map(co => [`sov_${changeOrderBillKey(co.id)}`, co]));
  // buildAIASovLines ids a change-order row `sov_<CO_BILL_KEY_PREFIX><coId>`,
  // and uniqueId may suffix a collision with `__2`. Match the prefix, never the
  // whole id, so a suffixed row is still recognised as a CO row.
  const isCOLine = (id: string) => id.startsWith(`sov_${CO_BILL_KEY_PREFIX}`);

  const kept = app.lines.filter((l) => {
    if (!isCOLine(l.id)) return true;               // contract + manual rows stay
    if (wantedById.has(l.id)) return true;           // still in the period
    // Approved after the new period end. Drop the row only if it carries no
    // money; a billed row stays and the banners explain it.
    return !!(l.fromPreviousApp || l.thisPeriod || l.materialsPresentlyStored);
  });

  const present = new Set(kept.map(l => l.id));
  const added: AIASOVLine[] = [];
  wantedById.forEach((co, id) => {
    if (present.has(id)) return;
    added.push({
      id,
      itemNo: String(kept.length + added.length + 1),
      description: `CO #${co.number}${co.description ? ` — ${co.description}` : ''}`,
      scheduledValue: roundCents(co.changeAmount),
      fromPreviousApp: 0,
      thisPeriod: 0,
      materialsPresentlyStored: 0,
      retainagePercent: app.retainagePercent,
      storedRetainagePercent: app.storedRetainagePercent,
    });
  });

  return {
    ...app,
    netChangeByCO,
    contractSumToDate,
    lines: [...kept, ...added],
    // A frozen summary from a different period end is exactly the
    // contradiction this function exists to prevent. Let the caller's live
    // summary (built from the same CO set) print.
    changeOrderSummary: undefined,
  };
}

/**
 * Pull contract drift into an already-entered certificate WITHOUT throwing the
 * GC's work away.
 *
 * The version this replaces spread `...fresh` and then re-applied a hand-picked
 * list of header fields, so it silently dropped AMOUNT CERTIFIED, the certified
 * date and explanation, the notes, and any manual `lessPreviousCertificates`;
 * and because `fresh.lines` is rebuilt from the estimate, every line the GC had
 * added with the SOV editor simply vanished, along with every item number he
 * had typed. The button is only offered on a saved draft — i.e. exactly the
 * certificate someone has come back to and annotated.
 *
 * What refresh IS for is column C and new rows, so on a line the contract still
 * has, the contract's scheduled value and description win; that is the whole
 * point of tapping it, and the confirmation copy says so in those words.
 * Everything else is the GC's.
 */
export function mergeRefreshedContract(
  prev: AIAPayApplication,
  fresh: AIAPayApplication,
): AIAPayApplication {
  const freshById = new Map(fresh.lines.map(l => [l.id, l]));

  // MATCHED ON `id` ONLY, deliberately. carryForwardPriorLines falls back to
  // itemNo because losing a match there zeroes column D and over-bills the
  // owner; here losing a match only means a row keeps the scheduled value it
  // already had, while a WRONG match would overwrite a negotiated manual line
  // with a contract line's description and value because both happened to be
  // numbered "7".
  const claimed = new Set<string>();
  const merged: AIASOVLine[] = prev.lines.map((mine) => {
    const contract = freshById.get(mine.id);
    if (!contract || claimed.has(contract.id)) {
      // A row the contract does not have: a manual SOV line the GC negotiated,
      // or a CO row that fell out of the period. Keep it verbatim.
      return mine;
    }
    claimed.add(contract.id);
    return {
      ...mine,
      // The contract's, because refreshing column C is what the tap is for.
      scheduledValue: contract.scheduledValue,
      description: contract.description,
      // The GC's: item numbers, every entered amount, both retainage rates,
      // and the schedule binding.
    };
  });

  // New estimate lines and newly approved change orders, appended so nothing
  // the GC ordered moves.
  const appended = fresh.lines.filter(l => !claimed.has(l.id) && !prev.lines.some(p => p.id === l.id));

  return {
    ...prev,
    // The three contract scalars are the refresh.
    originalContractSum: fresh.originalContractSum,
    netChangeByCO: fresh.netChangeByCO,
    contractSumToDate: fresh.contractSumToDate,
    sovBasis: fresh.sovBasis ?? prev.sovBasis,
    // Recomputed from the refreshed change-order set by the caller; a frozen
    // summary would restate a table the refresh has just changed.
    changeOrderSummary: undefined,
    lines: [...merged, ...appended],
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
    /** G702 line 5b's rate when the contract holds a different one on stored
     *  material. Undefined leaves 5b reading the same blank as 5a, which is
     *  what a contract that does not distinguish them means. */
    storedRetainagePercent?: number;
    /** PERIOD TO — the end of the billing period. Falls back to the invoice's
     *  issue date, which is where it came from before the screen had a field,
     *  and which is a date the GC can at least recognise. */
    periodTo?: string;
    /** APPLICATION DATE — the day the GC signs. Same fallback. */
    applicationDate?: string;
    /** Start of the billing window. */
    periodFrom?: string;
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
    // `invoice.number` is NOT an application number — see nextApplicationNumber
    // for why a first G702 used to open at "#3". Callers pass the project's own
    // pay-app sequence; the invoice number survives only as the last-resort
    // fallback for a caller that has no sequence to offer (tests, and the
    // seed-only unit path), and the screen prints "invoice #N" separately as
    // the source-period reference.
    applicationNumber: opts?.applicationNumber ?? invoice.number,
    // APPLICATION DATE and PERIOD TO are two different dates on the form — the
    // day the contractor signs, and the last day of the work being certified.
    // Seeding both from invoice.issueDate (which is all this function knows)
    // meant PERIOD TO was never the end of a billing period, it was whenever
    // the invoice happened to be cut. The screen now owns both; these stay as
    // the starting values.
    applicationDate: opts?.applicationDate ?? invoice.issueDate,
    periodTo: opts?.periodTo ?? invoice.issueDate,
    periodFrom: opts?.periodFrom,
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
    storedRetainagePercent: opts?.storedRetainagePercent,
    lessPreviousCertificates: roundCents(opts?.lessPreviousCertificates ?? 0),
    lines,
    notes: invoice.notes,
  };
}

/**
 * Build the HTML for a G702+G703 pay application. Paginates naturally via @media print.
 */
/**
 * PRINT NOTES — verified by rendering this function's output through headless
 * Chrome with --print-to-pdf and extracting the text page by page. All three
 * of these were reproduced before the fix and re-checked after.
 *
 * 1. NO position:fixed FOOTER AT ALL. There used to be two .page-footer divs,
 *    both position:fixed at the same bottom offset, one reading "…Page 1 of 2 ·
 *    G702 Cover" and one "…Page 2 of 2 · G703 Continuation". position:fixed
 *    repeats an element on EVERY page of a paged rendering, so BOTH repeated on
 *    every page, overprinted character by character: every page of every
 *    certificate read
 *    "GenGeratedbyMAGEID·Application#3·Page2of1of2·G703G702ContinuationCover".
 *
 *    Collapsing that to ONE fixed div fixed the garble and NOT the collision,
 *    which is the half that lands on the printed money. A fixed element in
 *    paged media is positioned against the PAGE AREA — the box inside the @page
 *    margins — and normal content flows through that same box, with nothing
 *    reserved underneath. Widening the bottom margin moves the footer up
 *    together with the content it is sitting on. Measured on a 60-line SOV
 *    (headless Chrome --print-to-pdf, `pdftotext -bbox`): the footer printed at
 *    y 715.79–722.77, x 208.8–402.8 while SOV row 43 occupied y 710.19–717.60,
 *    x 44.0–572.2 — the footer struck through that row's columns D, E and F.
 *    Pushing the fixed element into the margin with a NEGATIVE `bottom` does
 *    not help either: Chrome then reflows it onto the TOP of the following
 *    page, where it lands on the repeated column headers instead (also
 *    measured).
 *
 *    So the provenance line is not an element in the flow at all any more. It
 *    goes in two places, neither of which can overlap anything:
 *      · `@page { @bottom-left }`, beside the page counter, in the margin box —
 *        the print engine reserves that band.
 *      · a `<th class="sheet-caption" colspan="10">` as the FIRST row of the
 *        G703 `<thead>`. A thead repeats at the top of every continuation page
 *        in normal flow, in every engine, so an orphaned continuation sheet
 *        still names its project and application number even where the margin
 *        box is ignored. That matters: page 2+ of the G703 is the same `.page`
 *        div, so without it those sheets carry no identification at all.
 *
 * 2. THE PAGE COUNT COMES FROM THE PRINT ENGINE. A literal "Page 1 of 2" is a
 *    lie the moment a schedule of values runs to three pages, which a 60-line
 *    SOV does. Chromium (the web print path, and expo-print on Android)
 *    supports @page margin boxes and generates the real count — verified, not
 *    assumed: a 60-line SOV renders "Page 1 of 3" … "Page 3 of 3". WebKit
 *    (expo-print on iOS) ignores those rules silently, which is why the count
 *    appears nowhere else — better absent than wrong — and why the thead
 *    caption above carries the identification WebKit would otherwise lose.
 *
 * 3. THE GRAND TOTAL FOOTS ONCE. A <tfoot> is a REPEATING row group in paged
 *    media, so page 2 of a 60-line SOV printed the whole contract's GRAND
 *    TOTAL immediately beneath line 28 of 60 — a continuation page that
 *    visibly does not foot, which is the thing that gets a payment packet
 *    returned for a reason nobody can quite articulate.
 *    `display: table-row-group` demotes it to an ordinary run of rows.
 *
 * 4. BREAK BEFORE, NOT AFTER. `page-break-after: always` with a
 *    `.page:last-child { auto }` override stopped working the moment a running
 *    footer div became body's last child — :last-child then matched no .page,
 *    the G703 kept its trailing break, and every certificate printed a blank
 *    final page. `.page + .page { page-break-before }` is immune to whatever
 *    else ends up in body, so it stayed when the footer div was removed
 *    (note 1): there is nothing after the last sheet to break before.
 *
 * CERTIFICATION NOTES.
 * The G702 carries TWO certificates signed by two different people. The
 * architect's half used to be a second .sig-row inside the CONTRACTOR's
 * .cert-block, under a heading with no certification language at all — so it
 * printed as a second signature rule under the contractor's signature, the
 * architect was being asked to sign nothing, and the page read as an invoice
 * wearing AIA words rather than a Certificate for Payment. It is its own block
 * now, with its own paragraph, the AMOUNT CERTIFIED line, the
 * initial-all-changed-figures instruction and the closing non-negotiability
 * clause.
 *
 * The contractor's paragraph is MAGE's own wording of the same undertaking. It
 * previously reproduced AIA's G702-1992 certification sentence character for
 * character, on a document AIA licenses and prints a copyright-violation
 * reporting address on. Nothing in this repo ever claimed otherwise — the
 * disclaimer at the foot of page 2 is about TRADEMARK and affiliation and
 * stands unchanged — but the obligation is the contractor's, not AIA's, so it
 * can be stated in plain words. Do not "restore" the original text.
 *
 * The jurat prints only when the GC asks for it. AIA's own instructions say
 * the Contractor should sign G702, have it notarized and submit it with the
 * G703, and on public work an un-notarized application comes back — but a
 * residential GC should not print empty notary lines on every certificate.
 */
export function buildAIAPayAppHtml(
  app: AIAPayApplication,
  branding: CompanyBranding,
): string {
  const totals = computeAIATotals(app);

  // Line 5a and 5b print a PERCENTAGE beside an AMOUNT, and the amount is
  // summed from the per-line rates while the label used to come from the cover
  // — so the moment any line carries its own rate (which is the entire reason
  // G703 column I exists) the cover would print a percentage that does not
  // produce the figure printed next to it. Print the cover's rate only while
  // every line agrees with it; otherwise say "variable" and let the amount and
  // column I speak, which is what the form's own "or Total in Column I of
  // G703" annotation contemplates.
  const coverStoredRate = storedRetainagePercentForApp(app);
  const rateBlank = (uniform: boolean, pct: number, what: string): string => (uniform
    ? `${pct}% of ${what}`
    : `${what} at variable rates &mdash; see Column I on G703`);
  const workRateLabel = rateBlank(
    app.lines.length === 0 || app.lines.every(l => l.retainagePercent === app.retainagePercent),
    app.retainagePercent,
    'Completed Work',
  );
  const storedRateLabel = rateBlank(
    app.lines.length === 0 || app.lines.every(l => storedRetainagePercentForLine(l) === coverStoredRate),
    coverStoredRate,
    'Stored Material',
  );

  const coSummary = app.changeOrderSummary;

  const logoBlock = branding.logoUri
    ? `<img src="${escapeHtml(branding.logoUri)}" class="logo" alt="logo" />`
    : '';

  /**
   * The provenance line. It goes in TWO places, and in neither of them can it
   * land on top of a money row — see PRINT NOTES #1.
   *
   * `provenanceContent` is a CSS `content:` string, so it is escaped for a CSS
   * string literal (backslash and double quote), not for HTML. A project called
   * `4" Slab "Phase 2"` would otherwise terminate the string and drop the whole
   * @page rule on the floor.
   */
  const provenanceText =
    `Generated by MAGE ID · ${app.projectName} · Application #${app.applicationNumber} · G702 / G703`;
  const provenanceContent = provenanceText.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

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
      + retainageOnWorkValue(l.materialsPresentlyStored, storedRetainagePercentForLine(l)),
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
  /* Page numbering: generated by the print engine. See PRINT NOTES in source. */
  @page {
    size: letter;
    margin: 0.5in 0.5in 0.7in 0.5in;
    @bottom-left { content: "${provenanceContent}"; font-size: 8px; color: #666; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 8px; color: #666; }
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    color: #111;
    margin: 0;
    padding: 0;
  }
  .page + .page { page-break-before: always; }

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

  /* DISTRIBUTION TO — one of the six header fields the 1992 G702 carries and
     this generator did not (audit 2026-09-11, F18). It is a hand-ticked field:
     the GC marks who the executed certificate goes to, and the owner's office
     files against it. There is nothing to source from the app, and nothing to
     invent either — printing the five labelled boxes empty is exactly what the
     paper form does. Kept to one row so it costs no vertical space on a cover
     page that already has to fit nine numbered lines. */
  .distribution {
    border: 1px solid #111;
    padding: 6px 10px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .distribution .label {
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #555;
  }
  .dist-item { display: flex; align-items: center; gap: 4px; font-size: 9px; }
  .dist-box {
    width: 9px;
    height: 9px;
    border: 1px solid #111;
    display: inline-block;
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

  /* Two side-by-side certificates. See CERTIFICATION NOTES in source. */
  .cert-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
  .cert-grid > .cert-block { margin-top: 0; }
  .cert-block .cert-head {
    font-weight: 700;
    font-size: 9px;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    border-bottom: 1px solid #111;
    padding-bottom: 3px;
    margin-bottom: 6px;
  }
  .amount-certified {
    border: 1px solid #111;
    padding: 5px 8px;
    margin: 8px 0 6px 0;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 10px;
  }
  .amount-certified .ac-label { font-weight: 700; letter-spacing: 0.4px; }
  .amount-certified .ac-value { font-variant-numeric: tabular-nums; font-weight: 700; }
  .cert-note { font-size: 8px; color: #444; line-height: 1.35; margin-top: 4px; }
  .cert-closing {
    font-size: 8.5px;
    font-weight: 700;
    margin-top: 8px;
    padding-top: 5px;
    border-top: 1px solid #111;
  }

  /* Jurat — rendered only when the GC turns notarization on. */
  .jurat { border: 1px solid #111; padding: 8px 10px; margin-top: 10px; font-size: 9px; line-height: 1.5; }
  .jurat .jurat-head { font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; font-size: 8.5px; margin-bottom: 5px; }
  .rule { display: inline-block; border-bottom: 1px solid #111; min-width: 90px; }

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
  /* Foots ONCE, after the last line — see PRINT NOTES. */
  table.g703 tfoot { display: table-row-group; }

  /* The provenance strip that repeats at the top of every continuation page.
     It is a THEAD ROW, not a fixed element — see PRINT NOTES #1. */
  table.g703 thead th.sheet-caption {
    background: #fff;
    color: #444;
    font-weight: 600;
    font-size: 8px;
    text-transform: none;
    letter-spacing: 0.4px;
    text-align: left;
    border-bottom: 1px solid #111;
    padding: 3px 4px;
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

  <div class="grid-2">
    <div class="info-box">
      <span class="label">Contract For</span>
      <div class="value">${escapeHtml(app.contractForDescription || '—')}</div>
    </div>
    <div class="info-box">
      <span class="label">Contract Date</span>
      <div class="value">${escapeHtml(fmtDate(app.contractDate) || '—')}</div>
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
      ${app.periodFrom ? `<div style="font-size:8px;color:#555;margin-top:1px;">from ${fmtDate(app.periodFrom)}</div>` : ''}
    </div>
    <div>
      <span class="label" style="font-size:8px;color:#555;text-transform:uppercase;letter-spacing:0.5px;">Application Date</span>
      <div style="font-size:11px;font-weight:600;">${fmtDate(app.applicationDate)}</div>
    </div>
  </div>

  <div class="distribution">
    <span class="label">Distribution to:</span>
    ${['Owner', 'Architect', 'Contractor', 'Field', 'Other'].map(who =>
      `<span class="dist-item"><span class="dist-box"></span>${who.toUpperCase()}</span>`).join('')}
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
        <td style="padding-left:24px;">&nbsp;&nbsp;&nbsp;a. ${workRateLabel} <span style="color:#666;">(Columns D + E on G703)</span></td>
        <td class="num">$ ${fmt(totals.retainageOnCompleted)}</td>
      </tr>
      <tr>
        <td style="padding-left:24px;">&nbsp;&nbsp;&nbsp;b. ${storedRateLabel} <span style="color:#666;">(Column F on G703)</span></td>
        <td class="num">$ ${fmt(totals.retainageOnStored)}</td>
      </tr>
      <tr>
        <td style="padding-left:24px;"><b>&nbsp;&nbsp;&nbsp;Total Retainage</b> <span style="color:#666;font-weight:400;">(Lines 5a + 5b, or Total in Column I of G703)</span></td>
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
      ${coSummary ? `
      <tr>
        <td>Total changes approved in previous months by Owner</td>
        <td class="num">$ ${fmt(coSummary.priorAdditions)}</td>
        <td class="num">$ ${fmt(coSummary.priorDeductions)}</td>
      </tr>
      <tr>
        <td>Total approved this month</td>
        <td class="num">$ ${fmt(coSummary.thisPeriodAdditions)}</td>
        <td class="num">$ ${fmt(coSummary.thisPeriodDeductions)}</td>
      </tr>
      <tr>
        <td><b>TOTAL</b></td>
        <td class="num"><b>$ ${fmt(coSummary.totalAdditions)}</b></td>
        <td class="num"><b>$ ${fmt(coSummary.totalDeductions)}</b></td>
      </tr>
      <tr>
        <td><b>NET CHANGES by Change Order</b></td>
        <td class="num" colspan="2"><b>${coSummary.netChange >= 0 ? '' : '-'}$ ${fmt(Math.abs(coSummary.netChange))}</b></td>
      </tr>
      ` : `
      <tr>
        <td>Net change by Change Orders</td>
        <td class="num">$ ${fmt(Math.max(0, app.netChangeByCO))}</td>
        <td class="num">$ ${fmt(Math.max(0, -app.netChangeByCO))}</td>
      </tr>
      `}
    </tbody>
  </table>

  <!-- Two certificates, two signatories. See CERTIFICATION NOTES in source. -->
  <div class="cert-grid">
    <div class="cert-block">
      <div class="cert-head">Contractor's Certification</div>
      <div class="cert-body">
        By signing below, the Contractor states that, so far as the Contractor knows and believes, the work billed on this Application has been carried out as the Contract Documents require; that everything owed for work covered by Certificates for Payment already issued has been paid out of the money the Owner has already paid; and that the amount requested on line 8 is properly due now.
      </div>
      <div class="sig-row">
        <div class="sig-col">
          <div style="font-weight:600;">Contractor</div>
          <div style="color:#666;font-size:8px;">${escapeHtml(app.contractorName)}</div>
        </div>
        <div class="sig-col">
          <div style="font-weight:600;">By · Date</div>
          <div style="color:#666;font-size:8px;">Signature</div>
        </div>
      </div>
      ${app.notarize ? `
      <div class="jurat">
        <div class="jurat-head">State of ${app.notaryState ? escapeHtml(app.notaryState) : '<span class="rule">&nbsp;</span>'} &nbsp;·&nbsp; County of ${app.notaryCounty ? escapeHtml(app.notaryCounty) : '<span class="rule">&nbsp;</span>'}</div>
        Subscribed and sworn to before me this <span class="rule" style="min-width:40px">&nbsp;</span> day of <span class="rule">&nbsp;</span>, <span class="rule" style="min-width:50px">&nbsp;</span>.
        <div class="sig-row" style="margin-top:16px;">
          <div class="sig-col">
            <div style="font-weight:600;">Notary Public</div>
          </div>
          <div class="sig-col">
            <div style="font-weight:600;">My commission expires</div>
          </div>
        </div>
      </div>` : ''}
    </div>

    <div class="cert-block">
      <div class="cert-head">Architect's Certificate for Payment</div>
      <div class="cert-body">
        On the basis of site observations and of the data in this Application, the Architect certifies to the Owner that the Work has progressed as stated, that its quality is in accordance with the Contract Documents so far as the Architect can judge, and that the Contractor is entitled to payment of the AMOUNT CERTIFIED.
      </div>
      <div class="amount-certified">
        <span class="ac-label">AMOUNT CERTIFIED</span>
        <span class="ac-value">${app.amountCertified != null
          ? `$ ${fmt(app.amountCertified)}`
          : '$ <span class="rule" style="min-width:120px">&nbsp;</span>'}</span>
      </div>
      <div class="cert-note">
        (Attach an explanation if the amount certified differs from the amount applied for. Initial every figure on this Application and on the Continuation Sheet that is changed to match the amount certified.)
      </div>
      ${app.amountCertified != null && Math.abs(roundCents(app.amountCertified - totals.currentPaymentDue)) > 0.01 ? `
      <div class="cert-note" style="margin-top:5px;color:#111;font-weight:600;">
        Certified ${app.amountCertified > totals.currentPaymentDue ? 'above' : 'below'} the amount applied for by $ ${fmt(Math.abs(roundCents(app.amountCertified - totals.currentPaymentDue)))}.${app.certifiedExplanation ? ` ${escapeHtml(app.certifiedExplanation)}` : ' Explanation attached.'}
      </div>` : ''}
      <div class="sig-row">
        <div class="sig-col">
          <div style="font-weight:600;">Architect</div>
          <div style="color:#666;font-size:8px;">${escapeHtml(app.architectName || '—')}</div>
        </div>
        <div class="sig-col">
          <div style="font-weight:600;">By · Date</div>
          <div style="color:#666;font-size:8px;">${app.certifiedDate ? escapeHtml(fmtDate(app.certifiedDate)) : 'Signature'}</div>
        </div>
      </div>
      <div class="cert-closing">
        This Certificate is not negotiable. The AMOUNT CERTIFIED is payable only to the Contractor named herein. Issuance, payment and acceptance of payment are without prejudice to any rights of the Owner or Contractor under this Contract.
      </div>
    </div>
  </div>

  ${app.notes ? `<div style="margin-top:10px;font-size:9px;color:#333;"><b>Notes:</b> ${escapeHtml(app.notes)}</div>` : ''}

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
      <span class="label">Application No. · Application Date · Period To</span>
      <div class="value">#${app.applicationNumber} · ${fmtDate(app.applicationDate)} · ${fmtDate(app.periodTo)}</div>
    </div>
  </div>

  <table class="g703">
    <thead>
      <tr>
        <th class="sheet-caption" colspan="10">${escapeHtml(provenanceText)}</th>
      </tr>
      <tr>
        <th class="ctr" rowspan="2">A<br/>Item</th>
        <th rowspan="2">B<br/>Description of Work</th>
        <th class="num" rowspan="2">C<br/>Scheduled Value</th>
        <th class="num" colspan="2">Work Completed</th>
        <th class="num" rowspan="2">F<br/>Materials Presently Stored<br/>(Not in D or E)</th>
        <th class="num" rowspan="2">G<br/>Total Completed &amp; Stored to Date<br/>(D + E + F)</th>
        <th class="num" rowspan="2">%<br/>(G ÷ C)</th>
        <th class="num" rowspan="2">H<br/>Balance to Finish<br/>(C − G)</th>
        <th class="num" rowspan="2">I<br/>Retainage<br/>(If variable rate)</th>
      </tr>
      <tr>
        <th class="num">D<br/>From Previous Application<br/>(D + E)</th>
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
