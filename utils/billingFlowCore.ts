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
// which is pure arithmetic with no imports of its own (MONEY-F5).

import { invoiceOutstanding, billedAmountForLine } from './invoiceBilling';

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
      return `${m(ceiling.billed)} of this ${m(ceiling.contractValue)} contract has already been invoiced against contract scope, leaving ${m(ceiling.remaining)} — this milestone is ${m(amount)}. Billing it would take the total past the contract. Bill the remainder from Bill from Estimate, or update the contract value here if it has changed and the schedule will follow.`;
    }
  }
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
// `defaultPaymentSchedule` (utils/contractEngine.ts) seeds 25/25/25/25 on EVERY
// contract, and app/contract.tsx puts the milestone "Create invoice" action and
// a "Create first invoice" button that routes to /bill-from-estimate on the
// SAME screen. A milestone invoice used to carry no billing key at all, so
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
export function milestoneTriggerText(m: MilestoneLike): string {
  switch (m.trigger) {
    case 'on_signing': return 'Due on contract signing';
    case 'on_final':   return 'Due on final completion';
    case 'on_invoice': return 'Due on invoice';
    case 'on_date':    return m.triggerDate ? `Due ${m.triggerDate}` : 'Due on scheduled date';
    default:           return m.triggerMilestone?.trim() || 'Contract payment milestone';
  }
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
 * TWO shipped writers violate it: app/area-takeoff.tsx and
 * app/plan-intelligence.tsx each append an item whose `lineTotal` is the raw
 * COST with `markup: 0`, while bumping `grandTotal` by that cost PLUS its
 * share of markup — and both persist through `commitEstimatePatch`, so the
 * divergence is on the project, not in a draft.
 *
 * The consequence is only visible where the estimate is BILLED: the schedule
 * of values under-foots by exactly that markup, every row bills to 100%, the
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
  | 'too_soon';

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
  if (!Number.isFinite(input.dueMs)) return base('bad_due_date', 0, 0);

  const days = daysOverdue(input.dueMs, input.nowMs);
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
