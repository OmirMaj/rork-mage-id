// utils/billingFlowCore.ts — the React-Native-free half of the
// "work done → money received" path. Two decisions live here:
//
//   1. Contract payment milestone → invoice. What dollars does a milestone
//      bill, and is it still billable at all (double-bill prevention)?
//   2. Invoice payment reminder (dunning). Is this invoice eligible for a
//      reminder right now, at which stage, and does a MANUAL "send reminder
//      now" tap corrupt the automated cadence?
//
// Both are money-critical and both are duplicated across a UI screen and a
// Deno edge function, which is exactly how two copies of a rule drift apart.
// Keeping them here means `bun run scripts/validate-billing-flow.ts` can
// execute them (bun cannot parse a module that imports react-native — same
// reason utils/alertCore.ts and utils/brain/predictionLedgerCore.ts exist).
//
// NOTHING in this file may import react-native, expo-*, @/lib/supabase, or
// anything that transitively does. Types only — plus utils/invoiceBilling.ts,
// which is pure arithmetic with no imports of its own (MONEY-F5), and
// utils/paymentTerms.ts, which imports only types and ./generateId. The
// milestone's printed "when" comes from there so the invoice line, the
// contract screen and the sealed PDF say the same words (Direction B).
// utils/calendarDate.ts has no imports at all; the payment-date readers below
// use it so a bare received-day is never read as UTC midnight.

import { invoiceOutstanding, billedAmountForLine } from './invoiceBilling';
import { milestoneDueText } from './paymentTerms';
import { dayOrInstantDate, parseCalendarDay, toCalendarDayString } from './calendarDate';
// Relative, not '@/types': the header above promises this module resolves
// without app tooling, and an alias only the app's tsconfig knows would break
// that the moment a Deno function or a bare `bun` run imports the file. It is
// type-only today, so the path is erased — the point is that the file stays
// readable as what it claims to be.
import type { PaymentMilestone } from '../types';

// ─── 1. Milestone → invoice ──────────────────────────────────────────

export type MilestoneBillStatus = 'pending' | 'invoiced' | 'paid' | 'skipped';

/** Structural subset of types/index.ts PaymentMilestone this module needs. */
export interface MilestoneLike {
  id: string;
  label: string;
  /** Fixed dollar amount. Cached, and possibly stale, when `percent` is set. */
  amount?: number;
  /** Percent of contract value. Authoritative when present — see below. */
  percent?: number;
  status: MilestoneBillStatus;
  invoiceId?: string;
  trigger?: string;
  triggerMilestone?: string;
  triggerDate?: string;
}

/** Round to cents. Invoices carry cents; the contract schedule does not. */
function toCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * What this milestone actually bills, in dollars.
 *
 * `percent` WINS over the stored `amount` when both are present. The contract
 * editor caches `amount = Math.round(contractValue * percent)` (whole dollars)
 * and only refreshes it inside handleValueChange — so a schedule loaded from an
 * older row, or edited through any other path, can carry an `amount` that no
 * longer matches the contract value it is a percentage OF. Billing the stale
 * cache would under- or over-bill the client against a contract they signed as
 * a percentage. Deriving from percent self-heals that, and the contract screen
 * prints the derived figure on the "Create invoice" button so the GC always
 * sees the exact number before the invoice opens.
 *
 * A percent milestone on a zero-value contract falls back to the stored amount
 * rather than billing $0 — a $0 contract value is a data gap, not an intent to
 * bill nothing.
 */
export function milestoneBillableAmount(m: MilestoneLike, contractValue: number): number {
  const fixed = Math.max(0, m.amount ?? 0);
  if (m.percent != null && Number.isFinite(m.percent) && contractValue > 0) {
    return Math.max(0, toCents(contractValue * (m.percent / 100)));
  }
  return toCents(fixed);
}

export type MilestoneBillBlockReason =
  | 'already_invoiced'
  | 'already_paid'
  | 'skipped'
  | 'zero_amount'
  | 'invoice_exists'
  | 'contract_not_signed'
  | 'contract_fully_billed';

export interface MilestoneBillability {
  billable: boolean;
  /** Dollars this milestone would bill. Always computed, even when blocked. */
  amount: number;
  reason?: MilestoneBillBlockReason;
  /** The invoice already covering this milestone, when one was found. */
  existingInvoiceId?: string;
  /**
   * The arithmetic behind a `contract_fully_billed` refusal, so the message
   * can state it instead of asserting a fact the reader cannot check.
   *
   * The first cut of this refusal said "this project has already been invoiced
   * for the whole contract" on a project invoiced for 75% of it plus a $500
   * extra — a sentence a GC can disprove in ten seconds by opening his own
   * invoice list, which is how a guard rail teaches people to route around it.
   * Present only on that reason.
   */
  ceiling?: { billed: number; contractValue: number; remaining: number };
}

export interface MilestoneBillabilityInput {
  milestone: MilestoneLike;
  contractValue: number;
  /** Contract lifecycle status. Only a signed contract is billable. */
  contractStatus?: string;
  /**
   * Ids of invoices that already name this milestone as their source
   * (Invoice.sourceMilestoneId). This is the SECOND half of the double-bill
   * guard: the milestone's own status is the first, but the flip is a separate
   * write that can fail (offline, RLS, app killed) AFTER the invoice landed.
   * Checking from the invoice side too means a lost flip cannot resurrect a
   * milestone that has already been billed.
   */
  linkedInvoiceIds?: readonly string[];
  /**
   * Dollars already invoiced against the BASE CONTRACT on this project that
   * can actually be ATTRIBUTED to it — i.e. what
   * `attributableContractBilling` below returns. Pre-tax, excluding change
   * orders, and excluding ad-hoc billing that names no contract scope.
   *
   * NOT `contractBilledToDate` (audit 2026-09-11, review round 3). That
   * function counts EVERY non-draft, non-`co:` line, which is the right
   * population to SHOW a GC ("already invoiced on this contract") and the
   * wrong one to REFUSE on. Measured on the $130,052 fixture: three 25%
   * milestones billed plus a single $500 quick invoice put the total at
   * $98,039, leaving $32,013 against a final milestone of $32,513 — so a $500
   * cleanup charge blocked a legitimate closeout draw, under a message that
   * said the contract had been invoiced in full. app/bill-from-estimate.tsx's
   * own banner states why that dollar cannot be judged: a quick invoice
   * records no mode on the row, so ad-hoc billing is unattributable BY
   * CONSTRUCTION. One screen may not BLOCK on the same dollars its sibling
   * only WARNS about.
   *
   * THE OTHER HALF OF "ONE CONTRACT, ONE BILLED-TO-DATE" (audit 2026-09-11,
   * review round 2). The first pass taught Bill-from-Estimate about milestone
   * billing and stopped there, which closed exactly one direction. Run the
   * other way — bill the whole schedule of values from /bill-from-estimate,
   * then tap "Create invoice" on each of the four milestones every contract is
   * seeded with — and nothing objected: `milestoneBillability` looked only at
   * that milestone's own status and its own linked invoices, never at what the
   * contract had already been billed. Measured on the $130,052 fixture: an SOV
   * invoice for the whole contract, then four 25% milestones, totalled
   * $260,104 — 200% of the contract, to a homeowner.
   *
   * OPTIONAL, and omitting it reproduces the old behaviour exactly, so a
   * caller that has not been widened still compiles. It also still has the
   * hole; app/contract.tsx passes it.
   */
  contractBilledToDate?: number;
}

/**
 * Dollars invoiced against the BASE CONTRACT across every non-draft invoice on
 * a project — the cross-ledger figure `milestoneBillability` measures a
 * milestone against.
 *
 * PRE-TAX, because a payment schedule is written against a pre-tax contract
 * value; summing `totalDue` would count sales tax as contract billing and
 * block the last milestone on every taxed job. The population is therefore
 * summed from LINES (through the same `billedAmountForLine` every other
 * billed-to-date in this app uses, including its invoice-level anyPreScaled
 * gate) rather than from the invoice's stored subtotal.
 *
 * CHANGE-ORDER LINES ARE EXCLUDED. A CO is additional contract value with its
 * own billed-through (`billedAgainstChangeOrder`); counting CO billing against
 * the base contract would consume the milestones' capacity and block a
 * legitimate draw. The prefix is inlined rather than imported so this module
 * keeps its one-import discipline (see the header) — utils/changeOrderBilling
 * .ts owns `CO_BILL_KEY_PREFIX` and the two must stay equal; MONEY-LEDGER-1 in
 * scripts/validate-money-definitions.ts asserts they do.
 */
export function contractBilledToDate(
  invoices: readonly {
    status?: string;
    lineItems: readonly { total: number; billedPercent?: number | null; sourceEstimateItemId?: string | null }[];
    type?: string;
    progressPercent?: number | null;
  }[],
): number {
  let sum = 0;
  for (const inv of invoices) {
    if (inv.status === 'draft') continue;
    const anyPreScaled = inv.lineItems.some(l => l.billedPercent != null);
    for (const li of inv.lineItems) {
      if ((li.sourceEstimateItemId ?? '').startsWith('co:')) continue;
      sum += billedAmountForLine(li, inv, anyPreScaled);
    }
  }
  return toCents(sum);
}

/**
 * The slice of `contractBilledToDate` that can be ATTRIBUTED to contract
 * scope — the figure the milestone ceiling refuses on.
 *
 * THREE POPULATIONS COUNT, and each one names the contract:
 *   1. a line carrying a `milestone:<id>` key, or an invoice carrying
 *      `Invoice.sourceMilestoneId` — a draw against the payment schedule;
 *   2. a line carrying a plain `sourceEstimateItemId` — a schedule-of-values
 *      row raised by app/bill-from-estimate.tsx, which stamps that key and the
 *      billed percentage on every line it writes;
 *   3. every line on a `type: 'progress'` invoice — a native progress billing
 *      is a percentage of the contract by definition.
 *
 * WHAT IS DELIBERATELY LEFT OUT: a line with no key on a non-progress invoice.
 * That is a Quick Invoice or a hand-typed extra, and `Invoice.type` only ever
 * persists as 'full' or 'progress', so nothing distinguishes a $500 "final
 * cleanup" charge from a $130,000 hand-typed contract billing. Counting it
 * refused a legitimate final milestone over an unrelated extra (the measured
 * case is on `MilestoneBillabilityInput.contractBilledToDate`); leaving it out
 * means a GC who bills the whole contract by hand and then taps the milestones
 * is WARNED rather than STOPPED.
 *
 * That asymmetry is chosen, not conceded. The over-bill this ceiling exists to
 * stop (audit 2026-09-11 S4) runs through the two paths MAGE itself puts on
 * the contract screen — the milestone "Create invoice" action and the button
 * that opens Bill-from-Estimate — and BOTH of those stamp a key. Hand-typed
 * billing is the population app/bill-from-estimate.tsx already surfaces in its
 * own reconciliation banner, and the two screens now agree on how to treat it:
 * name it, do not adjudicate it. app/contract.tsx prints
 * `contractBilledToDate` beside the schedule for exactly that reason, so the
 * dollars are on screen even where they are not enforced.
 */
export function attributableContractBilling(
  invoices: readonly {
    status?: string;
    sourceMilestoneId?: string | null;
    lineItems: readonly { total: number; billedPercent?: number | null; sourceEstimateItemId?: string | null }[];
    type?: string;
    progressPercent?: number | null;
  }[],
): number {
  let sum = 0;
  for (const inv of invoices) {
    if (inv.status === 'draft') continue;
    const anyPreScaled = inv.lineItems.some(l => l.billedPercent != null);
    const wholeInvoiceCounts = !!inv.sourceMilestoneId || inv.type === 'progress';
    for (const li of inv.lineItems) {
      const key = li.sourceEstimateItemId ?? '';
      if (key.startsWith('co:')) continue;
      if (!wholeInvoiceCounts && !key) continue;
      sum += billedAmountForLine(li, inv, anyPreScaled);
    }
  }
  return toCents(sum);
}

/**
 * Can this milestone be turned into an invoice right now?
 *
 * Blocking order matters: a milestone that is BOTH already-invoiced and
 * zero-dollar should report the billing conflict, not the amount problem,
 * because the conflict is the one that would cost the client money.
 */
export function milestoneBillability(input: MilestoneBillabilityInput): MilestoneBillability {
  const { milestone, contractValue, contractStatus, linkedInvoiceIds, contractBilledToDate: billed } = input;
  const amount = milestoneBillableAmount(milestone, contractValue);

  // An invoice already points at this milestone — authoritative regardless of
  // what the milestone's own status field says.
  const linked = (linkedInvoiceIds ?? []).filter(Boolean);
  if (linked.length > 0) {
    return { billable: false, amount, reason: 'invoice_exists', existingInvoiceId: linked[0] };
  }

  if (milestone.status === 'paid') {
    return { billable: false, amount, reason: 'already_paid', existingInvoiceId: milestone.invoiceId };
  }
  if (milestone.status === 'invoiced') {
    return { billable: false, amount, reason: 'already_invoiced', existingInvoiceId: milestone.invoiceId };
  }
  if (milestone.status === 'skipped') {
    return { billable: false, amount, reason: 'skipped' };
  }
  // A pending milestone that still carries an invoiceId is a half-finished
  // flip from a previous attempt. Treat it as billed, not as pending.
  if (milestone.invoiceId) {
    return { billable: false, amount, reason: 'already_invoiced', existingInvoiceId: milestone.invoiceId };
  }
  if (contractStatus != null && contractStatus !== 'signed') {
    return { billable: false, amount, reason: 'contract_not_signed' };
  }
  if (!(amount > 0)) {
    return { billable: false, amount, reason: 'zero_amount' };
  }
  // THE CROSS-LEDGER CEILING. Checked LAST, after every reason that names this
  // milestone specifically, because "you already billed this one" is a more
  // useful sentence than "the contract is full" when both are true.
  //
  // It REFUSES rather than warns, for the same reason every other branch here
  // does: the money it is protecting is a homeowner's, and the GC has two
  // unblocked ways to bill anyway (raise it on /bill-from-estimate, which nets
  // against the same ledger, or correct the contract value if THAT is what is
  // stale). A refusal costs a tap; an over-bill costs the relationship.
  if (typeof billed === 'number' && Number.isFinite(billed) && contractValue > 0) {
    const counted = Math.max(0, billed);
    const remaining = toCents(contractValue - counted);
    if (amount > remaining + 0.005) {
      return {
        billable: false,
        amount,
        reason: 'contract_fully_billed',
        ceiling: { billed: toCents(counted), contractValue: toCents(contractValue), remaining },
      };
    }
  }
  return { billable: true, amount };
}

/** Human-readable explanation for a blocked milestone, for showAlert copy. */
export function milestoneBlockMessage(
  reason: MilestoneBillBlockReason,
  /** From `MilestoneBillability`: the numbers behind a ceiling refusal, and
   *  the milestone's own amount. Optional — an older caller still compiles and
   *  gets the figure-free sentence. */
  ceiling?: MilestoneBillability['ceiling'],
  amount = 0,
): string {
  switch (reason) {
    case 'already_invoiced':
      return 'This milestone has already been invoiced. Open the existing invoice instead of billing it twice.';
    case 'already_paid':
      return 'This milestone is already paid.';
    case 'invoice_exists':
      return 'An invoice was already created from this milestone. Open it instead of billing the same work twice.';
    case 'skipped':
      return 'This milestone was skipped, so there is nothing to bill.';
    case 'zero_amount':
      return 'Set a dollar amount (or a percentage of the contract value) on this milestone before invoicing it.';
    case 'contract_not_signed':
      return 'Milestones can only be invoiced once the contract is signed by both parties.';
    case 'contract_fully_billed': {
      // SAY THE ARITHMETIC (audit 2026-09-11, review round 3). Without the
      // figures this sentence asserted "already invoiced for the whole
      // contract" on projects that were not, and a refusal a GC can disprove
      // is a refusal he learns to work around.
      if (!ceiling) {
        return 'Billing this milestone would take the total invoiced past the contract value. Check the invoices on this project first — if the contract value has changed, update it here and the schedule will follow.';
      }
      const m = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      // NOTHING LEFT IS A DIFFERENT SENTENCE (review round 6). The remedy
      // clause below is "bill the remainder from Bill from Estimate", which
      // is good advice while a remainder exists — the split's progress row is
      // drawn against there, and a lump row that no longer fits can still take
      // what is left. At a remaining of zero (or below it: `billed` can exceed
      // the value when the contract was revised down) that clause sends him to
      // a screen to bill $0.00, two clauses after the same sentence printed
      // that figure. It is also the only sentence a CLOSED progress row ever
      // prints, since progressRowOpen keeps that row open for every ceiling
      // refusal above zero. Say the one true remedy instead: the work that is
      // left is not contract scope.
      if (ceiling.remaining <= 0.005) {
        return `${m(ceiling.billed)} of this ${m(ceiling.contractValue)} contract has already been invoiced against contract scope, leaving nothing to bill against it — this milestone is ${m(amount)}. Work beyond the contract belongs on a change order, which bills on its own ledger; if the contract value itself has changed, update the contract value here and the schedule will follow.`;
      }
      return `${m(ceiling.billed)} of this ${m(ceiling.contractValue)} contract has already been invoiced against contract scope, leaving ${m(ceiling.remaining)} — this milestone is ${m(amount)}. Billing it would take the total past the contract. Bill the remainder from Bill from Estimate, or update the contract value here if it has changed and the schedule will follow.`;
    }
  }
}

/**
 * Should a progress row (`trigger: 'on_invoice'`) still offer "Bill progress"?
 *
 * WHY THIS IS NOT PLAIN `bill.billable`. The cross-ledger ceiling refuses a
 * milestone whose OWN amount no longer fits in what is left of the contract —
 * the right answer for a row that composes one invoice line for that amount.
 * A progress row composes nothing: the action opens Bill from Estimate, which
 * nets against the same ledger and bills the lines the GC actually picks. So
 * on a 25 / 65 / 10 split the button worked for the first draws and then
 * vanished the moment more than 35% of the contract was invoiced — for the
 * whole back half of the job, on the one row that exists to be drawn against
 * repeatedly — and the sentence that replaced it ends "Bill the remainder from
 * Bill from Estimate", which is where the button went.
 *
 * Every refusal that is about THIS row still hides it: skipped, already
 * invoiced or paid, a zero amount, a contract not signed yet. Only the ceiling
 * is reinterpreted, and only while the contract really does have room left; at
 * a true $0 remaining there is nothing to draw and the reason is printed.
 */
export function progressRowOpen(bill: MilestoneBillability): boolean {
  if (bill.billable) return true;
  if (bill.reason !== 'contract_fully_billed') return false;
  return (bill.ceiling?.remaining ?? 0) > 0.005;
}

export interface MilestoneInvoiceLine {
  name: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
  /** Namespaced billing key — see MILESTONE_BILL_KEY_PREFIX. */
  sourceEstimateItemId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MONEY-LEDGER-1 (audit 2026-09-11). ONE contract, ONE billed-to-date.
//
// Every contract carries a milestone schedule — since 2026-09-17 the GC's own
// deposit / progress / final split (utils/paymentTerms.contractScheduleFromSplit;
// before that a 25/25/25/25 seed nobody chose) — and app/contract.tsx puts the
// milestone "Create invoice" action and a "Create first invoice" button that
// routes to /bill-from-estimate on the SAME screen. The split's progress row is
// never a lump invoice (see `milestoneBillEffect`'s 'progress' arm): it is
// billed through /bill-from-estimate, which nets against this same ledger, so
// only the deposit and the final ever arrive here as milestone invoices.
//
// A milestone invoice used to carry no billing key at all, so
// app/bill-from-estimate.tsx — which attributes prior billing by
// `sourceEstimateItemId` or an exact line-name match — could see none of it and
// printed "Already billed $0.00" over 25/50/75/100% quick-fill buttons. A GC
// who billed the 25% deposit milestone and then quick-filled 100% billed 125%
// of the contract to a homeowner.
//
// The key is namespaced exactly the way utils/changeOrderBilling.ts namespaces
// `co:<id>`, and for the same reason: a bare milestone id is a UUID off the
// same generator as a LinkedEstimateItem.materialId, so an un-prefixed key
// could collide with a real estimate row and bill-from-estimate would credit
// the milestone's dollars against whichever line happened to share the id.
//
// Callers that resolve a key to an estimate item MUST treat a namespaced key as
// "not an estimate item" — supabase/functions/_shared/qbo-mapping/invoice.ts
// used to throw `item co:… not found` and fail the whole QuickBooks push for
// every change-order invoice.
// ─────────────────────────────────────────────────────────────────────────────

export const MILESTONE_BILL_KEY_PREFIX = 'milestone:';

/** Stable invoice-line key for a contract payment milestone. */
export function milestoneBillKey(milestoneId: string): string {
  return `${MILESTONE_BILL_KEY_PREFIX}${milestoneId}`;
}

/** True when this line was written by the milestone billing path. */
export function isMilestoneBillKey(key: string | null | undefined): boolean {
  return !!key && key.startsWith(MILESTONE_BILL_KEY_PREFIX);
}

/** Plain-English description of what triggered the milestone, for the line. */
// Delegates to utils/paymentTerms.milestoneDueText, the wording the signed
// schedule prints: an invoice line that said "Due on invoice" under a contract
// that said "Billed as work is completed" is two documents disagreeing about
// the same payment.
export function milestoneTriggerText(m: MilestoneLike): string {
  return milestoneDueText({
    trigger: m.trigger as PaymentMilestone['trigger'],
    triggerDate: m.triggerDate,
    triggerMilestone: m.triggerMilestone,
  });
}

/**
 * The single invoice line a milestone becomes. Lump-sum, quantity 1, so
 * quantity × unitPrice === total and the printed PDF row foots (the same
 * invariant billFromEstimateUnitPrice protects on estimate-sourced lines).
 *
 * Deliberately NOT tagged with billedPercent: that field means "already scaled
 * by bill-from-estimate" and would flip progressSubtotal's anyPreScaled gate on
 * an invoice that has nothing to do with progress billing.
 *
 * It IS tagged with a namespaced `sourceEstimateItemId` (MONEY-LEDGER-1) — but
 * read `billedAgainstMilestones` before you rely on that key for anything.
 * This line is handed to app/invoice.tsx through the `prefillLines` URL param,
 * and that screen's parser reconstructs each line from name / description /
 * quantity / unit / unitPrice only, so the key does NOT reach the persisted
 * invoice on today's one production path. What does reach it is
 * `Invoice.sourceMilestoneId`, which app/invoice.tsx stamps at creation from
 * the `milestoneId` param, and that is the identifier the billed-to-date
 * function actually runs on.
 *
 * The key stays because it is the durable answer: it is the same namespacing
 * `co:<id>` uses (utils/changeOrderBilling.ts), it survives any path that
 * preserves line keys (bill-from-estimate writes its own lines, so it does),
 * and it keeps milestone dollars out of the estimate namespace so no estimate
 * row can be credited with them. Widening app/invoice.tsx's prefill parser to
 * carry `sourceEstimateItemId` through is the follow-up that makes it live —
 * see docs/audits/2026-09-11-handoff-money-to-wip.md.
 */
export function deriveMilestoneInvoiceLine(m: MilestoneLike, contractValue: number): MilestoneInvoiceLine {
  const total = milestoneBillableAmount(m, contractValue);
  const pctNote = m.percent != null && contractValue > 0
    ? ` (${m.percent}% of contract)`
    : '';
  return {
    name: m.label?.trim() || 'Contract milestone',
    description: `${milestoneTriggerText(m)}${pctNote}`,
    quantity: 1,
    unit: 'lump',
    unitPrice: total,
    total,
    sourceEstimateItemId: milestoneBillKey(m.id),
  };
}

/**
 * Dollars already invoiced against contract payment milestones, across every
 * NON-DRAFT invoice on the project — the milestone twin of
 * `billedAgainstChangeOrder`.
 *
 * TWO populations are counted, and the SECOND one is the one that runs today.
 *
 *   1. Lines carrying the `milestone:<id>` key. Exact, per line, and the shape
 *      every future path should write.
 *   2. Invoices carrying `Invoice.sourceMilestoneId`. app/invoice.tsx stamps
 *      this at creation from the contract screen's `milestoneId` param, and it
 *      is the ONLY identifier that survives that screen's `prefillLines`
 *      parser — which rebuilds each line from name/qty/unitPrice and drops
 *      line keys entirely (see deriveMilestoneInvoiceLine). Counting only the
 *      key would therefore have counted NOTHING on the live flow and left the
 *      over-bill exactly where it was, as well as under-reporting every
 *      contract already in flight.
 *
 * Under (2) the WHOLE invoice counts as milestone billing, not one line. A
 * milestone invoice is a lump sum, so normally it has one line; if the GC
 * added more in the editor they are counted too. That OVER-states milestone
 * billing slightly, which shrinks what Bill-from-Estimate offers — the safe
 * direction. Under-counting is what bills a homeowner twice.
 *
 * Drafts are excluded for the same reason they are everywhere else in this app
 * (utils/wip.ts DEFINITION 1): a document issued to nobody has billed nothing.
 */
export function billedAgainstMilestones(
  invoices: readonly {
    status?: string;
    sourceMilestoneId?: string | null;
    lineItems: readonly { total: number; billedPercent?: number | null; sourceEstimateItemId?: string | null }[];
    type?: string;
    progressPercent?: number | null;
  }[],
): number {
  let sum = 0;
  for (const inv of invoices) {
    if (inv.status === 'draft') continue;
    const anyPreScaled = inv.lineItems.some(l => l.billedPercent != null);
    const keyed = inv.lineItems.filter(li => isMilestoneBillKey(li.sourceEstimateItemId));
    if (keyed.length > 0) {
      for (const li of keyed) sum += billedAmountForLine(li, inv, anyPreScaled);
      continue;
    }
    // Legacy: no key, but the invoice names the milestone it came from.
    if (inv.sourceMilestoneId) {
      for (const li of inv.lineItems) sum += billedAmountForLine(li, inv, anyPreScaled);
    }
  }
  return toCents(sum);
}

/**
 * Spread lump-sum milestone billing across the schedule-of-values rows
 * Bill-from-Estimate offers, so "remaining" on that screen is remaining ON THE
 * CONTRACT and a 100% quick-fill cannot bill past it.
 *
 * WHY THIS IS A SPREAD AND NOT AN ATTRIBUTION. A payment milestone is
 * un-attributed by construction: "25% deposit on signing" is a claim against
 * the whole contract, not against framing. There is no honest line to hang it
 * on, and inventing one would misstate the per-row billed-through. What IS
 * honest — and what protects the homeowner — is that the SUM of the remainders
 * must equal the contract less everything billed against it, from either
 * ledger. So the dollars are spread pro-rata over each row's remaining
 * capacity, floored at that capacity, with whatever cannot fit re-spread over
 * the rows that still have room.
 *
 * CHANGE-ORDER ROWS ARE DELIBERATELY EXCLUDED by the caller. A CO already has
 * an exact billed-through (`billedAgainstChangeOrder`), and a milestone
 * percentage is a percentage of the BASE contract value the schedule was
 * written against — spreading deposit dollars onto a change order signed six
 * weeks later would understate what is still owed on that CO.
 *
 * OVERFLOW IS RETURNED, NOT SWALLOWED. When milestone billing exceeds the
 * whole SOV (a contract value negotiated above the estimate, or a GC who has
 * already billed past the contract), every row floors at zero and the residue
 * comes back so the screen can SAY so instead of quietly printing a remaining
 * balance that does not exist.
 */
export interface MilestoneSpreadRow { key: string; remaining: number }
export interface MilestoneSpreadResult {
  /** key → dollars of milestone billing charged to that row. */
  allocated: Record<string, number>;
  /** Milestone dollars that would not fit anywhere. */
  unallocated: number;
}
export function spreadMilestoneBilling(
  rows: readonly MilestoneSpreadRow[],
  milestoneBilled: number,
): MilestoneSpreadResult {
  const allocated: Record<string, number> = {};
  for (const r of rows) allocated[r.key] = 0;
  let pool = toCents(Math.max(0, milestoneBilled));
  if (pool <= 0 || rows.length === 0) return { allocated, unallocated: pool };

  // Capacity per row, mutated as the waterfall fills it.
  const capacity = new Map<string, number>();
  for (const r of rows) capacity.set(r.key, Math.max(0, r.remaining));

  // Bounded waterfall. Each pass either exhausts the pool or saturates at
  // least one row, so rows.length + 1 passes is a hard ceiling; the guard is
  // here so a rounding pathology can never spin.
  for (let pass = 0; pass <= rows.length && pool > 0.005; pass++) {
    const open = rows.filter(r => (capacity.get(r.key) ?? 0) > 0.005);
    if (open.length === 0) break;
    const openTotal = open.reduce((s, r) => s + (capacity.get(r.key) ?? 0), 0);
    if (openTotal <= 0.005) break;
    let spentThisPass = 0;
    for (const r of open) {
      const cap = capacity.get(r.key) ?? 0;
      const want = pool * (cap / openTotal);
      const take = Math.min(cap, want);
      capacity.set(r.key, toCents(cap - take));
      allocated[r.key] = toCents((allocated[r.key] ?? 0) + take);
      spentThisPass += take;
    }
    pool = toCents(pool - spentThisPass);
    // Pro-rata within capacity can only under-spend (never over), so a pass
    // that moved nothing means every open row is at its cap to the cent.
    if (spentThisPass <= 0.005) break;
  }
  return { allocated, unallocated: Math.max(0, toCents(pool)) };
}

/**
 * Apply milestone billing to the schedule-of-values rows a billing screen
 * renders — spread it, charge it, and hand back what would not fit.
 *
 * WHY THIS LIVES HERE AND NOT IN THE SCREEN (audit 2026-09-11, review round 2).
 * The spread itself (`spreadMilestoneBilling`) was pure and guarded; APPLYING
 * it was eight lines of arithmetic inside app/bill-from-estimate.tsx, and bun
 * cannot import a .tsx, so those eight lines could only ever be regex-checked.
 * They were: changing `const share = allocated[r.key] ?? 0` to
 * `0 * (allocated[r.key] ?? 0)` restored the full 125%-of-contract over-bill —
 * every row keeping its whole remaining — with the guard suite still at
 * 148 passed / 0 failed, because every assertion on that hunk was a regex for a
 * call the mutation did not remove. Money arithmetic that a guard cannot
 * EXECUTE is money arithmetic that has no guard.
 *
 * `isExcluded` names the rows the spread must skip. The caller passes
 * `isChangeOrderBillKey`: a CO has an exact billed-through of its own and a
 * milestone percentage is a percentage of the BASE contract, so spreading
 * deposit dollars onto a change order signed six weeks later would understate
 * what is still owed on it. Excluded rows are returned untouched and still
 * appear in the result in their original order.
 */
export interface MilestoneChargeableRow {
  key: string;
  alreadyBilled: number;
  remaining: number;
  billPercent: number;
}
export function applyMilestoneBilling<T extends MilestoneChargeableRow>(
  rows: readonly T[],
  milestoneBilled: number,
  isExcluded: (key: string) => boolean,
): { rows: T[]; unallocated: number } {
  if (!(milestoneBilled > 0.005)) return { rows: [...rows], unallocated: 0 };
  const spreadable = rows.filter(r => !isExcluded(r.key));
  const { allocated, unallocated } = spreadMilestoneBilling(
    spreadable.map(r => ({ key: r.key, remaining: r.remaining })),
    milestoneBilled,
  );
  const next = rows.map(r => {
    const share = allocated[r.key] ?? 0;
    if (share <= 0) return r;
    const alreadyBilled = toCents(r.alreadyBilled + share);
    const remaining = Math.max(0, toCents(r.remaining - share));
    return {
      ...r,
      alreadyBilled,
      remaining,
      // A row with nothing left to bill must not arrive preselected at 30%.
      billPercent: remaining > 0 ? r.billPercent : 0,
    };
  });
  return { rows: next, unallocated };
}

/**
 * How much of the contract the schedule of values does NOT reach
 * (F4 / verifier C4, audit 2026-09-11).
 *
 * THE INVARIANT. `LinkedEstimateItem.lineTotal` is the MARKED-UP line total,
 * so `Σ items.lineTotal === LinkedEstimate.grandTotal`.
 * app/(tabs)/estimate/full.tsx honours it (`base * (1 + markup/100) * qty`).
 *
 * TWO shipped writers used to violate it — app/area-takeoff.tsx and
 * app/plan-intelligence.tsx each appended an item whose `lineTotal` was the raw
 * COST with `markup: 0` while bumping `grandTotal` by that cost PLUS its share
 * of markup, and both persist through `commitEstimatePatch`, so the divergence
 * landed on the project rather than in a draft. BOTH ARE FIXED (audit
 * 2026-09-11): each now marks the appended line up at the estimate's own
 * effective ratio, leaves at-cost categories alone, and rounds to the cent the
 * way recomputeEstimate rounds. scripts/validate-invoice-billing.ts lifts both
 * append blocks out of the shipped screens and RUNS them, so the invariant is
 * measured rather than asserted here.
 *
 * This function stays, because that was never the only way a schedule can fail
 * to reach the contract — an estimate can simply be missing scope, and the row
 * set can be narrowed. The consequence is only visible where the estimate is
 * BILLED: the schedule of values under-foots, every row bills to 100%, the
 * screen prints "Remaining $0.00", and the margin on that scope is never
 * invoiced. utils/aiaBilling.reconcileAIASov catches it on the AIA screen;
 * this is the same catch for /bill-from-estimate.
 *
 * POSITIVE = the schedule reaches LESS than the contract, which is the
 * direction that costs the GC money and the only one worth a banner. Negative
 * (a schedule footing ABOVE the estimate total) is returned as 0: it means the
 * caller mixed change-order rows into `rowTotal`, and inventing a warning out
 * of the caller's own bookkeeping helps nobody.
 */
export function sovFootingShortfall(rowTotal: number, estimateGrandTotal: number): number {
  if (!Number.isFinite(rowTotal) || !Number.isFinite(estimateGrandTotal)) return 0;
  if (estimateGrandTotal <= 0) return 0;
  return Math.max(0, toCents(estimateGrandTotal - rowTotal));
}

/** Note text seeded onto the invoice so the client sees what they're paying for. */
export function milestoneInvoiceNote(m: MilestoneLike, contractTitle?: string): string {
  const doc = contractTitle?.trim() || 'the construction agreement';
  return `Payment milestone "${m.label?.trim() || 'Contract milestone'}" under ${doc}.`;
}

/**
 * WHAT TAPPING "Create invoice" ON A MILESTONE ROW DOES — the whole decision,
 * as a value.
 *
 * WHY THIS IS NOT INLINE IN app/contract.tsx (repair pass 2026-09-12). The
 * refusal used to live in the screen as `if (!bill.billable) { showAlert(…);
 * return; }`, and the only thing standing between a blocked milestone and the
 * invoice editor was that one `return;`. A screen cannot be executed by
 * `bun run test:money-definitions`, so the guard protecting it grepped for the
 * token — and a grep cannot see control flow. Two mutations proved it: moving
 * the `return;` into the alert's own "Open invoice" button, and weakening it to
 * `if (bill.existingInvoiceId) return;`. Both left the `contract_fully_billed`
 * refusal — the 125%-of-contract over-bill MONEY-LEDGER-1 exists to stop —
 * falling straight through into the editor, and both kept the suite green.
 *
 * Returning a DISCRIMINATED UNION moves that decision somewhere a test can run
 * it, and makes the fall-through a type error rather than a silent one: the
 * navigation payload exists only on the `compose` arm, so a caller that does
 * not stop on `refuse` cannot reach `.line` at all.
 */
export type MilestoneBillEffect =
  | {
      /** An `on_invoice` row — "Billed as work is completed". It is NEVER a
       *  lump invoice: the caller opens /bill-from-estimate, which bills the
       *  work done so far and nets milestone billing. Carries no line, so a
       *  caller cannot compose one from it. */
      kind: 'progress';
      title: string;
      message: string;
    }
  | {
      kind: 'refuse';
      title: string;
      message: string;
      /** Present when the refusal can offer to open the invoice that caused it. */
      existingInvoiceId?: string;
    }
  | {
      kind: 'compose';
      /** The single lump-sum line the invoice editor is prefilled with. */
      line: MilestoneInvoiceLine;
      /** Invoice note naming the milestone and the contract it sits under. */
      note: string;
      /** Stamped onto the invoice as `sourceMilestoneId` — the identifier
       *  `billedAgainstMilestones` actually runs on. */
      milestoneId: string;
      /** The payment terms the SIGNED contract already fixed for this row, or
       *  null when the contract leaves them to his usual terms. See
       *  `milestoneContractTerms`. */
      terms: MilestoneContractTerms | null;
      /** A deposit ('Due on signing'): the invoice opens at 0% retainage and
       *  does not ask. See `milestoneHoldsNoRetainage`. */
      depositNoRetainage: boolean;
    };

/**
 * The payment terms a signed contract row already decided (audit #31).
 *
 * The contract prints "Due on signing" for the deposit and "Due at substantial
 * completion" for the final payment. The invoice for either used to open on
 * his cash-flow terms (or Net 30), so the deposit invoice said "due in 30
 * days" under a contract that said "due on signing" — and dunning and the
 * cash-flow forecast followed the invoice, not the contract. Both rows are due
 * the day they are billed: the event that triggers them has already happened
 * by the time he taps "Create invoice".
 *
 * Every other trigger keeps his usual terms. `on_invoice` never reaches the
 * invoice editor (it bills through Bill from Estimate), and an `on_date` /
 * `on_milestone` row names WHEN it may be billed, not how long the client then
 * has to pay — that is what his terms answer.
 */
export type MilestoneContractTerms = 'due_on_receipt';
export function milestoneContractTerms(trigger: string | null | undefined): MilestoneContractTerms | null {
  return trigger === 'on_signing' || trigger === 'on_final' ? 'due_on_receipt' : null;
}

/** What the invoice's terms caption says when the terms came from the contract. */
export function milestoneContractTermsCaption(trigger: string | null | undefined): string | null {
  if (trigger === 'on_signing') return 'From the signed contract: due on signing.';
  if (trigger === 'on_final') return 'From the signed contract: due at substantial completion.';
  return null;
}

/**
 * A deposit holds no retainage (audit #32). The contract prints the deposit
 * as the amount due on signing; withholding 10% of it bills the homeowner 90%
 * of the figure he signed for, and the retainage ask popping up over a deposit
 * asks a question the contract already answered. Only the deposit: the final
 * payment is where held retainage is usually settled, so it is left to him.
 */
export function milestoneHoldsNoRetainage(trigger: string | null | undefined): boolean {
  return trigger === 'on_signing';
}

export function milestoneBillEffect(
  bill: MilestoneBillability,
  milestone: MilestoneLike,
  contract: { contractValue: number; title?: string },
): MilestoneBillEffect {
  // THE PROGRESS ROW FIRST, before the billable check (Direction B). The split
  // a GC signs prints "Progress payments — Billed as work is completed" for,
  // say, 65% of the contract. Composing that as one invoice would bill the
  // homeowner 65% in a single draw the day after signing — the opposite of
  // what he signed — and billability says nothing about it, because the row
  // IS pending, signed and under the ceiling. So the trigger decides, and the
  // answer carries no line to compose.
  if (milestone.trigger === 'on_invoice') {
    return {
      kind: 'progress',
      title: 'Billed as work is completed',
      message: 'Progress payments are billed from Bill from Estimate as the work gets done, so this row never becomes one lump invoice.',
    };
  }
  if (!bill.billable) {
    return {
      kind: 'refuse',
      title: 'Can’t bill this milestone',
      message: bill.reason
        ? milestoneBlockMessage(bill.reason, bill.ceiling, bill.amount)
        : 'This milestone can’t be invoiced right now.',
      existingInvoiceId: bill.existingInvoiceId,
    };
  }
  return {
    kind: 'compose',
    line: deriveMilestoneInvoiceLine(milestone, contract.contractValue),
    note: milestoneInvoiceNote(milestone, contract.title),
    milestoneId: milestone.id,
    terms: milestoneContractTerms(milestone.trigger),
    depositNoRetainage: milestoneHoldsNoRetainage(milestone.trigger),
  };
}

/**
 * Is this milestone PAID, as far as the money says (audits #132, #136)?
 *
 * The stored `status: 'paid'` is written by exactly one path — the app's own
 * Record Payment, fire-and-forget, straight to Supabase and outside the
 * offline queue. A Pay-link payment (stripe-webhook), a flip lost in a
 * basement, and every row billed before that path existed all leave the
 * milestone at 'invoiced' while its invoice is paid, so the contract kept
 * saying "Billed" on a draw the homeowner had paid.
 *
 * So the invoices decide whenever any are known: a milestone is paid when it
 * has at least one linked invoice (by `sourceMilestoneId`, or the milestone's
 * own `invoiceId`) and EVERY one of them is paid. That also un-pays a draw
 * whose invoice was refunded, which the stored flag never does. With no linked
 * invoice on this device (a hand-set status, or invoices not loaded yet) the
 * stored status stands.
 *
 * `paid` on each invoice is the caller's EFFECTIVE status (getEffectiveInvoiceStatus),
 * not the stored column — this module cannot import it.
 */
export function milestonePaidFromInvoices(
  m: Pick<MilestoneLike, 'id' | 'status' | 'invoiceId'>,
  invoices: readonly { id: string; sourceMilestoneId?: string | null; paid: boolean }[],
): boolean {
  const linked = invoices.filter(i => i.sourceMilestoneId === m.id || (!!m.invoiceId && i.id === m.invoiceId));
  if (linked.length === 0) return m.status === 'paid';
  return linked.every(i => i.paid);
}

/**
 * The stored-status repair the contract screen runs when it opens (#136): the
 * milestones the invoices say are paid but whose row does not, each with the
 * invoice it already names. markMilestonePaidByInvoice keys on that link, so a
 * row that never got its 'invoiced' flip (no `invoiceId`) is not repaired
 * here — the contract screen never writes the invoiced link itself (that is
 * the invoice editor's job, on creation) — and it still SHOWS paid, from
 * milestonePaidFromInvoices.
 */
export function milestonePaidRepairs(
  schedule: readonly Pick<MilestoneLike, 'id' | 'status' | 'invoiceId'>[],
  invoices: readonly { id: string; sourceMilestoneId?: string | null; paid: boolean }[],
): { milestoneId: string; invoiceId: string }[] {
  const out: { milestoneId: string; invoiceId: string }[] = [];
  for (const m of schedule) {
    if (m.status === 'paid' || m.status === 'skipped' || !m.invoiceId) continue;
    if (milestonePaidFromInvoices(m, invoices)) out.push({ milestoneId: m.id, invoiceId: m.invoiceId });
  }
  return out;
}

// ─── 1b. Recording a payment ─────────────────────────────────────────

/**
 * The two facts Record Payment now asks for (audit #133), on top of the
 * InvoicePayment row. `payments` is a jsonb column, so they ride along with no
 * migration; declared here, not required of types/index.ts, so every reader
 * compiles whether or not the shared type carries them yet.
 *
 * `receivedDate` is the LOCAL calendar day the money arrived ('YYYY-MM-DD'),
 * which he picks. `date` stays the instant the entry was recorded — the
 * QuickBooks reconciler matches untagged Payments against that instant
 * (paymentLedger.pairDistanceMs), so it must keep meaning "when MAGE knew".
 */
export interface RecordedPaymentFields {
  receivedDate?: string;
  /** Check number or other reference, as he typed it. */
  reference?: string;
}

/** The calendar day a payment was RECEIVED: his picked day, else the local day it was recorded. */
export function paymentReceivedDay(p: { date?: string | null } & RecordedPaymentFields): string | null {
  if (p.receivedDate && parseCalendarDay(p.receivedDate) && /^\d{4}-\d{2}-\d{2}$/.test(p.receivedDate)) return p.receivedDate;
  if (!p.date) return null;
  const at = dayOrInstantDate(p.date);
  if (!Number.isFinite(at.getTime())) return null;
  return toCalendarDayString(at);
}

/**
 * A Date for when a payment was received, for arithmetic (days-to-pay, the
 * cash-balance cutoff). His received day at LOCAL NOON when he picked one —
 * `new Date('2026-09-11')` is UTC midnight, the previous evening anywhere in
 * the Americas — else the recorded instant, exactly as before. Invalid in,
 * Invalid Date out, so existing NaN guards keep working.
 */
export function paymentReceivedAt(p: { date?: string | null } & RecordedPaymentFields): Date {
  if (p.receivedDate && /^\d{4}-\d{2}-\d{2}$/.test(p.receivedDate) && parseCalendarDay(p.receivedDate)) {
    return dayOrInstantDate(p.receivedDate);
  }
  return dayOrInstantDate(p.date ?? undefined);
}

export type RecordPaymentDecision =
  | { kind: 'refuse'; title: string; message: string }
  /** More than the balance. Overpayments happen (a credit, a combined check),
   *  so this asks rather than blocks. */
  | { kind: 'confirm'; amount: number; title: string; message: string }
  | { kind: 'record'; amount: number };

/**
 * What Record Payment does with the typed amount (audit #134).
 *
 * It used `parseFloat(x) || 0`: '12,500.00' typed on the web (or pasted on
 * iOS) parsed as 12, and a $12 payment went to the ledger and to QuickBooks.
 * `parse` is utils/cashFlowEngine.parseMoneyInput — passed in because that
 * module is not React-Native-free — which reads US thousands separators and
 * returns null on anything ambiguous. Null or not above zero is refused with
 * the reason; the amount is rounded to the cent; more than the balance asks.
 */
export function recordPaymentDecision(
  typed: string,
  balanceDue: number,
  parse: (text: string) => number | null,
  fmt: (n: number) => string,
): RecordPaymentDecision {
  const parsed = parse(typed);
  if (parsed == null || !Number.isFinite(parsed)) {
    return { kind: 'refuse', title: 'Couldn’t read that amount', message: 'Type it like 12500.00 or 12,500.00.' };
  }
  const amount = toCents(parsed);
  if (amount <= 0) {
    return { kind: 'refuse', title: 'Invalid Amount', message: 'Enter a payment amount above $0.00.' };
  }
  const balance = toCents(Math.max(0, balanceDue));
  if (amount > balance + 0.005) {
    return {
      kind: 'confirm',
      amount,
      title: 'More than the balance',
      message: `This is ${fmt(toCents(amount - balance))} more than the ${fmt(balance)} balance. Record ${fmt(amount)} anyway?`,
    };
  }
  return { kind: 'record', amount };
}

/**
 * A typed MONEY figure that must be above zero, rounded to the cent, or null
 * with no fallback to 0. The retention release uses it (#134).
 */
export function parsePositiveMoney(typed: string, parse: (text: string) => number | null): number | null {
  const n = parse(typed);
  if (n == null || !Number.isFinite(n)) return null;
  const cents = toCents(n);
  return cents > 0 ? cents : null;
}

/**
 * A typed PERCENTAGE for the retainage ask. `parseFloat` read '1,5' as 1 and
 * '10abc' as 10; this accepts '10', '7.5' and '10%' and nothing else, and the
 * caller still checks the 0–100 range.
 */
export function parsePercentInput(typed: string): number | null {
  const t = typed.trim().replace(/%$/, '').trim();
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ─── 2. Invoice reminders (dunning) ──────────────────────────────────

export const DAY_MS = 86_400_000;

/**
 * A manual "send reminder now" cannot re-send inside this window. The GC who
 * just got off the phone gets to send immediately; the GC who taps twice, or
 * taps a few hours after the cron already emailed, does not put a second
 * dunning email in the client's inbox the same day.
 */
export const MANUAL_REMINDER_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Days past due, floored, never negative. */
export function daysOverdue(dueMs: number, nowMs: number): number {
  if (!Number.isFinite(dueMs)) return 0;
  return Math.max(0, Math.floor((nowMs - dueMs) / DAY_MS));
}

/**
 * Days-overdue → the dunning stage the cadence has EARNED. 0 = not eligible.
 *   Stage 1 — 1–6 days   (friendly reminder)
 *   Stage 2 — 7–13 days  (second notice)
 *   Stage 3 — 14+ days   (final notice)
 * Must stay identical to the copy in supabase/functions/invoice-dunning.
 */
export function targetDunningStage(days: number): number {
  if (days >= 14) return 3;
  if (days >= 7) return 2;
  if (days >= 1) return 1;
  return 0;
}

export function dunningStageLabel(stage: number): string {
  if (stage >= 3) return 'Final notice';
  if (stage === 2) return 'Second notice';
  if (stage === 1) return 'First reminder';
  return 'No reminder sent';
}

/**
 * The stage to persist after a confirmed send.
 *
 * `Math.max` in both directions on purpose:
 *  - never REGRESS below the stage already emailed (a due-date edit that
 *    lowers days-overdue must not re-arm stage 1 after a final notice);
 *  - never EXCEED what days-overdue has earned, so a manual send at day 3
 *    cannot jump the client straight to "FINAL NOTICE" and cannot consume
 *    stage 2 before the cadence reaches it.
 */
export function nextDunningStage(currentStage: number | null | undefined, targetStage: number): number {
  return Math.max(currentStage ?? 0, targetStage);
}

export type ReminderBlockReason =
  | 'draft'
  | 'paid'
  | 'nothing_outstanding'
  | 'bad_due_date'
  | 'not_overdue'
  | 'unsubscribed'
  | 'stage_already_sent'
  | 'too_soon'
  // Nobody to email (#47): no billing address stored on the invoice and no
  // portal invitee on the project. The cron skips these every day; the card
  // says so up front instead of after a tap.
  | 'no_recipient'
  // #38: invoice-dunning only chases an invoice stored under the job owner's
  // account (it sends under his company name). Server-only.
  | 'not_project_owner'
  // #83: the client's bank payment (ACH) is still settling — see
  // paymentPendingHolds.
  | 'payment_pending';

/**
 * #83 / #135 — mirror of supabase/functions/invoice-dunning's
 * paymentPendingHolds (scripts/validate-w4-money-ledger-pending.ts runs both
 * and requires identical answers). stripe-webhook stamps pay_pending_at when a
 * client's bank payment completes Checkout unpaid; it settles in 3-5 business
 * days. No reminder — cron or manual — while it is under 10 days old; a marker
 * older than that (a lost async event) must not silence dunning for good.
 */
export const PAYMENT_PENDING_HOLD_MS = 10 * DAY_MS;
export function paymentPendingHolds(pendingAt: string | null | undefined, nowMs: number): boolean {
  if (!pendingAt) return false;
  const t = new Date(pendingAt).getTime();
  if (!Number.isFinite(t)) return false;
  return nowMs - t < PAYMENT_PENDING_HOLD_MS;
}

export interface ReminderEligibilityInput {
  /** Stored invoice status. Never trusted alone — the math below rules. */
  status?: string | null;
  totalDue: number;
  amountPaid?: number | null;
  /**
   * MONEY-F5: retention the contract lets the client hold. Outstanding is
   * computed NET of it, so a client who paid everything they were asked for
   * is never chased — least of all with a FINAL NOTICE — for money that is
   * not due until closeout.
   */
  retentionAmount?: number | null;
  retentionReleased?: number | null;
  /**
   * MONEY-05: the work value and the contract percentage the withholding is
   * actually computed from. Without them invoiceOutstanding falls back to the
   * stored `retentionAmount`, and a legacy row's tax-inclusive figure would
   * decide both whether to chase a client and the amount the notice demands.
   */
  subtotal?: number | null;
  retentionPercent?: number | null;
  /** ms epoch. Callers parse the ISO string; NaN is handled as bad_due_date. */
  dueMs: number;
  dunningStage?: number | null;
  /** ms epoch of the last confirmed send, or null if none. */
  lastSentMs?: number | null;
  /** Recipient opted out of payment_reminders (or globally). */
  unsubscribed?: boolean;
  /** true = GC tapped "Send reminder now"; false/undefined = cron. */
  manual?: boolean;
  /**
   * Whether the invoice has anyone to remind (reminderRecipient below).
   * `false` blocks with 'no_recipient'; undefined means "not known here" and
   * leaves the decision to the server, which resolves the address itself.
   */
  hasRecipient?: boolean;
  /** invoices.pay_pending_at (Invoice.paymentPendingAt): a bank payment in flight. */
  paymentPendingAt?: string | null;
  nowMs: number;
}

export interface ReminderEligibility {
  eligible: boolean;
  reason?: ReminderBlockReason;
  daysOverdue: number;
  /** Stage days-overdue has earned. 0 when not yet overdue. */
  targetStage: number;
  /** Stage to write after a confirmed send. Equals current stage on a re-send. */
  nextStage: number;
  outstanding: number;
}

/**
 * Should this invoice get a payment reminder right now?
 *
 * The cron and the manual button share every guard except one:
 *  - CRON only ever advances to a strictly HIGHER stage. That is the whole
 *    dedupe mechanism — it is why the daily tick doesn't email the same
 *    stage-2 notice for seven days straight.
 *  - MANUAL may re-send at the CURRENT stage, but only once the 24h window
 *    since the last confirmed send has elapsed, and it still writes back
 *    nextDunningStage() so it can neither skip a stage nor invent one.
 *
 * Order of the guards is load-bearing: paid/draft/outstanding are checked
 * before overdue-ness so a fully-paid invoice never reports "not_overdue",
 * and unsubscribe is checked before the stage/window logic so an opted-out
 * recipient never burns a stage.
 */
export function reminderEligibility(input: ReminderEligibilityInput): ReminderEligibility {
  // MONEY-F5: one definition of outstanding — net of held retention, never negative.
  const outstanding = invoiceOutstanding({
    totalDue: input.totalDue ?? 0,
    amountPaid: input.amountPaid ?? 0,
    subtotal: input.subtotal ?? undefined,
    retentionPercent: input.retentionPercent ?? undefined,
    retentionAmount: input.retentionAmount ?? 0,
    retentionReleased: input.retentionReleased ?? 0,
  });
  const status = (input.status ?? '').toLowerCase();
  const stage = input.dunningStage ?? 0;

  const base = (
    reason: ReminderBlockReason | undefined,
    days: number,
    target: number,
  ): ReminderEligibility => ({
    eligible: reason === undefined,
    reason,
    daysOverdue: days,
    targetStage: target,
    nextStage: reason === undefined ? nextDunningStage(stage, target) : stage,
    outstanding,
  });

  if (status === 'draft') return base('draft', 0, 0);
  if (status === 'paid') return base('paid', 0, 0);
  // Fully collected even if the stored status lagged behind.
  if (outstanding <= 0) return base('nothing_outstanding', 0, 0);
  // #83: before anything overdue-related — the money is on its way, which is
  // worth saying even on a current invoice, and the server refuses to send.
  if (paymentPendingHolds(input.paymentPendingAt, input.nowMs)) return base('payment_pending', 0, 0);
  if (!Number.isFinite(input.dueMs)) return base('bad_due_date', 0, 0);
  // Before the overdue check ON PURPOSE: "reminders are off, there is no
  // client email" is worth knowing while the invoice is still current — that
  // is when he can still fix it — not only once it is late and the cron has
  // already skipped it (#47).
  // Days are still counted, so the card keeps saying "N days overdue" next to
  // "reminders are off" instead of dropping the lateness it is warning about.
  const days = daysOverdue(input.dueMs, input.nowMs);
  if (input.hasRecipient === false) return base('no_recipient', Math.max(0, days), 0);

  const target = targetDunningStage(days);
  if (target === 0) return base('not_overdue', days, 0);

  // Suppression is checked BEFORE the stage math so a skipped send never
  // advances dunning_stage — the recipient may re-subscribe later and must
  // still receive the cadence from where it left off.
  if (input.unsubscribed) return base('unsubscribed', days, target);

  if (stage < target) return base(undefined, days, target);

  // stage >= target: the cadence has nothing new to say.
  if (!input.manual) return base('stage_already_sent', days, target);

  const last = input.lastSentMs;
  if (last != null && Number.isFinite(last) && input.nowMs - last < MANUAL_REMINDER_MIN_INTERVAL_MS) {
    return base('too_soon', days, target);
  }
  return base(undefined, days, target);
}

/** Why the "Send reminder" button is unavailable — shown to the GC verbatim. */
export function reminderBlockMessage(reason: ReminderBlockReason, lastSentMs?: number | null, nowMs?: number): string {
  switch (reason) {
    case 'draft':
      return 'Send this invoice to the client before chasing payment on it.';
    case 'paid':
    case 'nothing_outstanding':
      return 'This invoice is fully paid — nothing to chase.';
    case 'bad_due_date':
      return 'This invoice has no valid due date, so we cannot tell whether it is overdue.';
    case 'not_overdue':
      return 'This invoice is not past due yet. Reminders start the day after the due date.';
    case 'unsubscribed':
      return 'The client unsubscribed from payment reminders. Call or text them instead.';
    case 'stage_already_sent':
      return 'A reminder for this stage already went out.';
    case 'too_soon': {
      const hoursLeft = lastSentMs != null && nowMs != null
        ? Math.max(1, Math.ceil((MANUAL_REMINDER_MIN_INTERVAL_MS - (nowMs - lastSentMs)) / 3_600_000))
        : 24;
      return `A reminder already went out in the last 24 hours. You can send another in ${hoursLeft}h.`;
    }
    case 'payment_pending':
      return 'The client started a bank payment on this invoice and it is still processing (bank transfers take 3-5 business days). Reminders wait until it clears or fails.';
    case 'not_project_owner':
      return "Reminders go out under the job owner's name, and this invoice was not created from the owner's account — so no reminder is sent for it.";
    case 'no_recipient':
      return 'Automatic reminders are off — no client email on this invoice or project. Send the invoice to the client by email (or add a portal invitee) and reminders start.';
    // The server owns this string's input, so a value the client doesn't know
    // yet is possible across an OTA/edge-function version skew. Never render
    // "undefined" at the GC.
    default:
      return 'This invoice is not eligible for a reminder right now.';
  }
}

/**
 * "Reminder sent · Stage 2 · Nov 14" — the one line that answers
 * "did you get my email?" without the GC having to guess.
 * Returns null when nothing has been sent yet.
 */
export function reminderSentLabel(
  stage: number | null | undefined,
  lastSentMs: number | null | undefined,
): string | null {
  if (!stage || stage < 1 || lastSentMs == null || !Number.isFinite(lastSentMs)) return null;
  const when = new Date(lastSentMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `Reminder sent · Stage ${stage} · ${when}`;
}

// ─── 3. Invoice-list money legibility ────────────────────────────────
//
// Deliberately NOT implemented here. A/R aging — outstanding per invoice,
// days past due, and the bucketed totals — already lives in
// utils/financialReports.ts (computeARAgingReport), which the Reports screen
// renders in full. The project invoice list reuses that function rather than
// growing a second, subtly-different definition of "outstanding": two
// disagreeing A/R numbers in one app is worse than one imperfect one.

// ─── 4. Send → pay → remind: the honest-outcome rules (wave 3) ───────
//
// The invoice screen's Send used to report "Invoice #N sent" whatever happened
// to the Pay button, and the reminder card could not say who (if anyone) the
// cron would chase. These are the decisions, kept pure so
// scripts/validate-invoice-send-pay-honesty.ts executes them.

/** Stripe's per-charge limits for USD, in cents (create-payment-link enforces the same). */
export const STRIPE_MIN_CHARGE_CENTS = 50;
export const STRIPE_MAX_CHARGE_CENTS = 99_999_999;

/**
 * Why a Pay link cannot be minted for `amount` (dollars) at all, or null.
 * Checked BEFORE the round trip: these two never succeed on retry, so the
 * copy says what to do instead (#49). A $1.2M progress draw is the real case —
 * Stripe cannot take it as one card/ACH payment.
 */
export function payLinkAmountBlock(amount: number): string | null {
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(cents) || cents <= 0) return null; // nothing due — callers skip the mint anyway
  if (cents > STRIPE_MAX_CHARGE_CENTS) return STRIPE_OVER_MAX_REASON;
  if (cents < STRIPE_MIN_CHARGE_CENTS) return STRIPE_UNDER_MIN_REASON;
  return null;
}

/** The two limit reasons, shared so every path words them the same way. */
export const STRIPE_OVER_MAX_REASON = "this amount is over Stripe's $999,999.99 per-payment limit. Collect it by ACH or check, or split the draw into smaller invoices";
export const STRIPE_UNDER_MIN_REASON = 'Stripe cannot charge less than $0.50. Collect it another way';

/**
 * Whether trying again could ever produce a Pay link. Stripe's per-charge
 * limits never pass on retry, so their copy must not end in "tap Generate
 * Payment Link" — that button would only hit the same wall.
 */
export function payLinkReasonIsRetryable(reason: string): boolean {
  return reason !== STRIPE_OVER_MAX_REASON
    && reason !== STRIPE_UNDER_MIN_REASON
    // #39: the row is not on the server (queued behind the offline queue, or
    // refused, or unconfirmed). "Tap Generate Payment Link" would 404 on a row
    // the server does not have — the next step is the sync, not the button.
    && reason !== INVOICE_INSERT_QUEUED_REASON
    && reason !== INVOICE_INSERT_UNCONFIRMED_REASON
    && reason !== PAYMENT_PENDING_MINT_REASON
    && reason !== STRIPE_NOT_CONNECTED_REASON;
}

/** #36 — the PDF send's "no Pay button" when Stripe genuinely is not connected
 *  (the check answered). Its next step is Payments setup, not a retry. */
export const STRIPE_NOT_CONNECTED_REASON =
  "your Stripe account isn't connected, so invoices go out without a Pay button — set it up in Settings → Payments";

/**
 * #39 / #36 — why a send carries no Pay button because the invoice row is not
 * (yet) on the server. Constants so payLinkReasonIsRetryable can tell them
 * apart from a Stripe failure a retry could fix.
 *
 * QUEUED is only said when it is true: the INSERT sits in the offline queue,
 * which keeps it across restarts and lists it under "Not saved" if the server
 * later refuses it (utils/offlineQueue, CONTRACT 1). A REFUSED insert is never
 * sent at all — see invoiceInsertRefusedMessage.
 */
export const INVOICE_INSERT_QUEUED_REASON =
  "the invoice is still waiting in this phone's sync queue and is not on the server yet — once it syncs, send it again (or add a payment link from the invoice) so the client gets a Pay button";
export const INVOICE_INSERT_UNCONFIRMED_REASON =
  "the invoice couldn't be confirmed on the server yet, so there was nothing to attach a payment link to — check the sync status, then send it again";

/**
 * #39: the server REFUSED the new invoice's insert. Nothing was emailed — an
 * invoice the server does not have drops off his list, A/R, reminders and
 * QuickBooks on the next refresh while the client holds it. The draft stays
 * on screen so he can try again once the job has synced.
 */
export function invoiceInsertRefusedMessage(invoiceNumber: number): string {
  return `Invoice #${invoiceNumber} was not sent. The server refused to save it — usually because this job is still syncing from when you were offline, or your access to it changed. Nothing went to your client. ${INVOICE_UNSAVED_NEXT_STEP}`;
}

/**
 * #39 (review round 1): the refused write is kept in the sync ledger's
 * "Not saved" list (utils/syncLedger, CONTRACT 1) and is resent ONLY from
 * there — nothing resends it automatically. So "tap Send again" alone can
 * never succeed while it sits there: every later send of this draft would
 * email an invoice the server still does not have. The next step names the
 * one path that fixes it.
 */
export const INVOICE_UNSAVED_NEXT_STEP =
  "Tap the sync badge and Retry the invoice under \"Not saved\" (or Discard it). Once it saves, send it again.";

/**
 * #39: an EARLIER save of this invoice (its insert, or an edit) was refused
 * and still sits in the sync ledger's "Not saved" list, so the server's copy
 * is missing or behind the one on screen. Nothing is emailed until it saves.
 */
export function invoiceUnsavedOnServerMessage(invoiceNumber: number): string {
  return `Invoice #${invoiceNumber} was not sent. An earlier save of it was refused by the server, so the server doesn't have the invoice you're looking at. Nothing went to your client. ${INVOICE_UNSAVED_NEXT_STEP}`;
}

/** #83 — the server-side refusal (create-payment-link 409 'payment_pending'). */
export const PAYMENT_PENDING_MINT_REASON =
  "the client's bank payment for this invoice is still processing — a new link now would invite a second payment";

/**
 * #36 — what the Stripe Connect status check actually answered. A FAILED
 * check (offline, the function down) is not "not connected": treating it as
 * one sent the invoice with no Pay button under a plain "sent" toast, or told
 * him falsely that he had never connected Stripe (and burned the once-ever
 * nudge doing it). connect-status answers success:true for "no account" and
 * "charges disabled", so success:false is always "could not tell".
 */
export type StripeAccountState =
  | { kind: 'connected'; accountId: string }
  | { kind: 'not_connected' }
  | { kind: 'unreachable'; error: string };

export function stripeAccountStateFrom(status: {
  success?: boolean; chargesEnabled?: boolean; accountId?: string | null; error?: string | null;
} | null | undefined): StripeAccountState {
  if (!status || status.success !== true) {
    return { kind: 'unreachable', error: (status?.error ?? '').trim() || 'status check failed' };
  }
  if (status.chargesEnabled && status.accountId) return { kind: 'connected', accountId: status.accountId };
  return { kind: 'not_connected' };
}

export const STRIPE_UNREACHABLE_REASON =
  "we couldn't reach Stripe to check your payment setup (you may be offline)";

/**
 * Plain-words reason for a failed mint, from the edge function's error text.
 * 'invoice not found' is the new invoice not having reached the server yet.
 */
export function payLinkFailureReason(error: string | undefined | null): string {
  const e = (error ?? '').trim();
  // Not "it will arrive": a queued insert is caught before the mint, so a 404
  // here is either an insert still on the wire or one the server rejected —
  // this screen cannot tell which, so the copy names both.
  if (/payment_pending/i.test(e)) return PAYMENT_PENDING_MINT_REASON;
  if (/not found/i.test(e)) return "the server doesn't have this invoice yet — it may still be saving, or the save may have failed (check the sync status)";
  if (/maximum|999,999/i.test(e)) return STRIPE_OVER_MAX_REASON;
  if (/minimum|0\.50/i.test(e)) return STRIPE_UNDER_MIN_REASON;
  return e ? `Stripe said: ${e}` : "Stripe couldn't create the link";
}

/**
 * The toast that replaces "Invoice #N sent" when the email went but the Pay
 * button did not. One message for the new-invoice Send and the PDF send.
 */
export function sentWithoutPayButtonMessage(invoiceNumber: number, reason: string): string {
  if (!payLinkReasonIsRetryable(reason)) return `Sent — without a Pay button: ${reason}.`;
  return `Sent — without a Pay button: ${reason}. Open Invoice #${invoiceNumber} and tap Generate Payment Link to add one.`;
}

/**
 * The next invoice number: one past the highest number on the project's list
 * AND the highest this device issued in this session (#3 part c). The session
 * max covers the window where a just-created invoice is not on the list yet —
 * a refetch that lands before its queued INSERT, or a screen that remounted
 * before the context re-rendered — which is how the same number went out twice.
 */
/**
 * Highest invoice number this DEVICE has issued per project, this session
 * (#3 part c). Module scope, shared by every screen that creates invoices
 * (app/invoice.tsx and app/bill-from-estimate.tsx): a just-created invoice can
 * be missing from the list for a moment (a refetch that lands before its
 * queued INSERT), and max+1 over that list alone handed its number out again —
 * from the other screen too, when only one of them remembered.
 */
export const sessionIssuedInvoiceMax = new Map<string, number>();
export function noteIssuedInvoiceNumber(projectId: string, n: number): void {
  if (!projectId || !Number.isFinite(n)) return;
  sessionIssuedInvoiceMax.set(projectId, Math.max(sessionIssuedInvoiceMax.get(projectId) ?? 0, n));
}

export function nextInvoiceNumberFrom(list: readonly { number?: number | null }[], sessionIssuedMax = 0): number {
  const listMax = list.reduce((max, i) => Math.max(max, Number(i.number) || 0), 0);
  return Math.max(listMax, sessionIssuedMax || 0) + 1;
}

/**
 * Whether the client portal shows this invoice — the same rule as
 * utils/portalSnapshot.isShared (no state = legacy, shown; 'sent' shown;
 * 'draft' / 'recalled' hidden). The pay-link copy may only promise a portal
 * Pay button when this is true (#45).
 */
export function invoiceShownInPortal(portalState: { status?: string } | null | undefined): boolean {
  return portalState == null || portalState.status === 'sent';
}

/**
 * #43 — whether this project's client portal shows invoices at all: it is on
 * AND its Invoices section is not switched off. utils/portalSnapshot only
 * writes invoices into the snapshot when showInvoices is set, so with it off
 * "Also post to client portal", "pay via the portal" and a reminder's "View
 * invoice" all promised a page with no invoice on it. `!== false`: a portal
 * saved before the toggle existed carries no key and has always shown them.
 */
export function invoicesVisibleInPortal(
  clientPortal: { enabled?: boolean | null; showInvoices?: boolean | null } | null | undefined,
): boolean {
  return clientPortal?.enabled === true && clientPortal.showInvoices !== false;
}

/** The one sentence for "the portal is on, its Invoices section is off" (#43). */
export const PORTAL_INVOICES_HIDDEN_HINT =
  "Invoices are hidden on this project's portal. Turn them on in Client Portal to post invoices there.";

/**
 * #43 — the pay-link copy may promise a portal Pay button only when the
 * portal is on, shows invoices, AND shows this one.
 */
export function invoicePayableInPortal(
  clientPortal: { enabled?: boolean | null; showInvoices?: boolean | null } | null | undefined,
  portalState: { status?: string } | null | undefined,
): boolean {
  return invoicesVisibleInPortal(clientPortal) && invoiceShownInPortal(portalState);
}

/**
 * #81 — whether `email` is one of the portal's invitees (trimmed, case-
 * insensitive). Mirrors isPortalInvitee in supabase/functions/invoice-dunning,
 * which withholds the project-wide portal link from a reminder addressed to
 * anyone else: the stored bill-to address is often a lender's draw desk or an
 * AP inbox the homeowner never invited, and that link opens his whole portal.
 */
export function isPortalInvitee(
  email: string | null | undefined,
  invites: readonly { email?: string | null }[] | null | undefined,
): boolean {
  const e = (email ?? '').trim().toLowerCase();
  if (!e.includes('@')) return false;
  return (invites ?? []).some(i => (i.email ?? '').trim().toLowerCase() === e);
}

/**
 * #81 — will a reminder to this invoice's recipient carry the portal's
 * "View invoice" link? Only when the recipient IS an invitee (the fallback
 * recipient always is) and the portal shows invoices (#43). The Pay button is
 * invoice-scoped and unaffected.
 */
export function reminderCarriesPortalLink(
  billToEmail: string | null | undefined,
  clientPortal: {
    enabled?: boolean | null; showInvoices?: boolean | null;
    invites?: readonly { email?: string | null }[] | null;
  } | null | undefined,
): boolean {
  const recipient = reminderRecipient(billToEmail, clientPortal?.invites);
  if (!recipient) return false;
  if (!invoicesVisibleInPortal(clientPortal)) return false;
  return isPortalInvitee(recipient, clientPortal?.invites);
}

// ─── #38: who may bill the client on a job ───────────────────────────
//
// An invoice is stored under the SENDER's user_id and its Pay link is minted
// on the sender's Stripe account. From a collaborator's seat that meant an
// invoice the GC never sees (invoices SELECT is own-rows only) whose money
// lands in the collaborator's bank, while invoice-dunning chased the homeowner
// under the GC's company name. Only the project owner bills — the same rule as
// change orders (#41): the job's stored owner is the signed-in user, else the
// resolved role is 'owner'. The server refuses the insert too
// (20260920030000_invoices_owner_insert.sql).

export const INVOICE_OWNER_ONLY_REASON =
  "Only the job's owner bills the client — their invoices and Pay link go to their bank.";

export type InvoiceRoleGate = 'open' | 'loading' | 'error' | 'paused' | 'collaborator' | 'no_access';

/**
 * The gating contract: spin only while the role is loading, retry on an
 * error, a paused (offline) read says its reason — never a paywall — and a
 * null role that is none of those is NO ACCESS, said, never spun. No job yet
 * (the sidebar entry) is 'open': the screen's picker asks and the gate runs
 * again on the picked job.
 */
export function invoiceRoleGate(o: {
  hasProject: boolean;
  role: string | null;
  isLoading: boolean;
  isError: boolean;
  isPaused?: boolean;
  /** Project.myRole — only ever stamped on a job shared WITH him. */
  stampedRole?: string | null;
  /** The device copy's ownerUserId === the signed-in user. */
  ownedLocally?: boolean;
}): InvoiceRoleGate {
  if (!o.hasProject) return 'open';
  if (o.stampedRole === 'editor' || o.stampedRole === 'viewer' || o.stampedRole === 'field') return 'collaborator';
  // The owner never waits on the network: on a site with no signal the
  // collaborator read fails or pauses, and he must still bill his own job.
  if (o.ownedLocally) return 'open';
  if (o.role === 'owner') return 'open';
  if (o.role === 'editor' || o.role === 'viewer' || o.role === 'field') return 'collaborator';
  if (o.isLoading) return 'loading';
  if (o.isError) return 'error';
  if (o.isPaused) return 'paused';
  return 'no_access';
}

/** The blocked screen's words, per gate (the paused reason comes from the hook). */
export function invoiceRoleBlockedCopy(
  gate: Exclude<InvoiceRoleGate, 'open'>,
  pausedReason?: string | null,
): { title: string; body: string } {
  switch (gate) {
    case 'loading':
      return { title: '', body: 'Checking your role on this job…' };
    case 'error':
      return {
        title: 'Could not check your role on this job',
        body: 'MAGE could not load who is on this project, so it cannot tell whether you may bill the client here. Check your connection and try again.',
      };
    case 'paused':
      return {
        title: 'Waiting for a connection',
        body: `${(pausedReason ?? '').trim() || "You're offline and this phone has not seen your role on this job yet."} Invoices open once it can check who owns the job.`,
      };
    case 'collaborator':
      return { title: 'Billing is the job owner’s', body: `${INVOICE_OWNER_ONLY_REASON} Ask the job's owner to send this invoice.` };
    default:
      return { title: 'You are not on this job', body: `This job is not shared with you. ${INVOICE_OWNER_ONLY_REASON}` };
  }
}

// ─── #66: the tax on a new invoice, and where it came from ──────────

export type InvoiceTaxSeed = { rate: number; source: 'invoice' | 'contract' | 'settings' | 'none' };

/**
 * A contract milestone bills the amount the contract names (deposit, draw,
 * final) — the proposal, portal and contract all print it tax-free, so the
 * homeowner pays exactly that and a 7-and-a-half-percent Settings default on
 * top left the draw "partially paid" forever. So a NEW milestone invoice
 * seeds 0% unless the contract itself states a rate. Every other new invoice
 * seeds the Settings rate (0 when never set, MONEY-F3). An existing invoice
 * keeps its own stored rate — once issued it is frozen; a draft may edit it.
 */
export function invoiceTaxSeed(o: {
  existingTaxRate?: number | null;
  isNew: boolean;
  milestoneId?: string | null;
  contractTaxRate?: number | null;
  settingsTaxRate?: number | null;
}): InvoiceTaxSeed {
  if (!o.isNew) {
    const r = Number(o.existingTaxRate);
    return { rate: Number.isFinite(r) && r >= 0 ? r : 0, source: 'invoice' };
  }
  if (o.milestoneId) {
    const c = Number(o.contractTaxRate);
    if (o.contractTaxRate != null && Number.isFinite(c) && c > 0) return { rate: c, source: 'contract' };
    return { rate: 0, source: 'none' };
  }
  const s = Number(o.settingsTaxRate);
  return { rate: Number.isFinite(s) && s > 0 ? s : 0, source: 'settings' };
}

/** The line beside the tax rate saying where it came from (#66). */
export function invoiceTaxSourceLabel(seed: InvoiceTaxSeed, touched: boolean): string {
  if (touched) return 'set on this invoice';
  switch (seed.source) {
    case 'contract': return `${seed.rate}% — per contract`;
    case 'none': return 'none — per contract (milestone billed as agreed)';
    case 'settings': return seed.rate > 0 ? `from Settings (${seed.rate}%)` : 'none — no tax rate in Settings';
    default: return 'saved on this invoice';
  }
}

/**
 * Who a payment reminder goes to — the SAME order invoice-dunning uses:
 * the address the invoice was emailed to (bill_to_email) first, then the
 * project's first portal invitee with an '@'. Null = nobody, and the cron
 * skips it with 'no_recipient' (#47).
 */
export function reminderRecipient(
  billToEmail: string | null | undefined,
  invites: readonly { email?: string | null }[] | null | undefined,
): string | null {
  const bill = (billToEmail ?? '').trim();
  if (bill.includes('@')) return bill;
  const invite = (invites ?? []).find(i => (i.email ?? '').includes('@'));
  return invite ? (invite.email ?? '').trim() : null;
}
