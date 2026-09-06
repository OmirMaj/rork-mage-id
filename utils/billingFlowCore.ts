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

import { invoiceOutstanding } from './invoiceBilling';

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
  | 'contract_not_signed';

export interface MilestoneBillability {
  billable: boolean;
  /** Dollars this milestone would bill. Always computed, even when blocked. */
  amount: number;
  reason?: MilestoneBillBlockReason;
  /** The invoice already covering this milestone, when one was found. */
  existingInvoiceId?: string;
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
}

/**
 * Can this milestone be turned into an invoice right now?
 *
 * Blocking order matters: a milestone that is BOTH already-invoiced and
 * zero-dollar should report the billing conflict, not the amount problem,
 * because the conflict is the one that would cost the client money.
 */
export function milestoneBillability(input: MilestoneBillabilityInput): MilestoneBillability {
  const { milestone, contractValue, contractStatus, linkedInvoiceIds } = input;
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
  return { billable: true, amount };
}

/** Human-readable explanation for a blocked milestone, for showAlert copy. */
export function milestoneBlockMessage(reason: MilestoneBillBlockReason): string {
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
  }
}

export interface MilestoneInvoiceLine {
  name: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
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
  };
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
