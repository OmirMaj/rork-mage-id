// utils/recoveredValue.ts
//
// "MAGE recovered $X for you." The realized counterpart to draftedRevenue.
//
// WHY THIS EXISTS. utils/draftedRevenue answers "what's ready to send" — money
// the Brain found that is still sitting in draft. That number is a to-do list,
// not a result. This module answers the harder and far more valuable question:
// of the change orders MAGE drafted off its own profit-leak scans, how much got
// APPROVED — and, for each one, whether the client signed it and whether it
// has been billed, stated only where the record proves it.
//
// That distinction is the whole point. A tool that says "I found $40k of leaks"
// is making a claim about itself. A tool that says "$12,400 of what I found got
// approved" is reporting an outcome the contractor can check on his own change
// orders. Only the second one survives the question "prove it."
//
// WHAT THE STATUS DOES NOT PROVE (audit wave 5, #152). 'approved' is a status
// the GC can set himself ("Mark approved" on the change-order screen) with no
// client signature and no invoice. The card used to say every counted dollar
// was "billed … approved and signed by your client". So the headline claims
// only "approved", and the two stronger words are per-row flags set from
// evidence:
//   • clientSigned — the CO's audit trail carries the portal e-signature entry
//     ('client_signed_via_portal', written by portal_submit_co_approval; the
//     action names are frozen). A GC-marked approval is not a signature.
//   • billedAmount — dollars on NON-DRAFT invoices whose lines carry this CO's
//     bill key (utils/changeOrderBilling, the same math the double-bill guard
//     uses). Zero means not billed, not "unknown".
//
// The marker is the same one leakCoDraft stamps into auditTrail, so a CO counts
// here only if MAGE actually drafted it. A CO the contractor wrote by hand is
// their win, not ours, and quietly folding those in would inflate the number
// into a lie — the exact failure mode utils/brain/autonomyGate.ts and the
// published accuracy thresholds exist to prevent. Hand-written COs are tracked
// separately so the UI can show the honest split.
//
// Pure: no React, no network, no clock (callers pass `now`).

import type { ChangeOrder, ChangeOrderStatus, Invoice, Project } from '@/types';
import { isAutoLeakDraft } from '@/utils/brain/leakCoDraft';
import { billedAgainstChangeOrder } from '@/utils/changeOrderBilling';

/** The audit-trail action the portal's e-signature path writes on a client
 *  approval (20260803120500 / portal_submit_co_approval; frozen name). */
export const CLIENT_SIGNED_ACTION = 'client_signed_via_portal';

/**
 * Trail actions that mean the CO was decided AGAIN after a signature, so the
 * signature no longer vouches for what is approved now:
 *   - the client's later decline (sealed or reconciled);
 *   - a later approval that is not that signature — the GC's own Mark approved
 *     after revising it ('marked_approved', and the legacy manual spellings),
 *     or an unsigned portal approval ('approved_via_portal');
 *   - the reconciler's 'portal_decision_conflict' (two answers on record).
 * The names are the frozen audit actions wave 4 writes (utils/coApproval
 * CONTRACT 7, the portal reconciler, projectContextPure withMarkedApproved);
 * the neutral ones ('portal_decision_applied', schedule markers, the leak
 * draft marker) do not undo anything.
 */
const SUPERSEDES_SIGNATURE: ReadonlySet<string> = new Set([
  'client_declined_via_portal', 'declined_via_portal',
  'marked_approved', 'approved', 'manually_approved', 'approved_via_portal',
  'portal_decision_conflict',
]);

/**
 * True only when the client e-signed this change order in the portal AND
 * nothing re-decided it afterwards (#152 review): signed, then revised and
 * marked approved by the GC, is an amount the client never signed. Timestamps
 * are compared as instants; a superseding entry with no readable time counts
 * as later — under-claiming is the safe direction for "your client signed".
 */
export function isClientSigned(co: Pick<ChangeOrder, 'auditTrail'>): boolean {
  if (!Array.isArray(co.auditTrail)) return false;
  let signedAt = -Infinity;
  let signed = false;
  for (const e of co.auditTrail) {
    if (e?.action !== CLIENT_SIGNED_ACTION) continue;
    const t = Date.parse(e.timestamp);
    if (!Number.isFinite(t)) continue;
    signed = true;
    if (t > signedAt) signedAt = t;
  }
  if (!signed) return false;
  for (const e of co.auditTrail) {
    if (!e || !SUPERSEDES_SIGNATURE.has(e.action)) continue;
    const t = Date.parse(e.timestamp);
    if (!Number.isFinite(t) || t > signedAt) return false;
  }
  return true;
}

/**
 * Statuses that mean the owner said yes and the money is real.
 *
 * 'approved' is the terminal win. 'revised' is deliberately EXCLUDED: a revised
 * CO is back in negotiation, and counting it would let a number go up on a
 * change order that may still be rejected. Under-claiming is the correct
 * direction for a number whose entire job is to be believable.
 */
const REALIZED_STATUSES: ReadonlySet<ChangeOrderStatus> = new Set<ChangeOrderStatus>([
  'approved',
]);

/** Statuses where the owner has it but has not yet said yes. */
const PENDING_STATUSES: ReadonlySet<ChangeOrderStatus> = new Set<ChangeOrderStatus>([
  'submitted',
  'under_review',
]);

export interface RecoveredRow {
  id: string;
  coNumber: number;
  projectId: string;
  projectName: string;
  amount: number;
  /** ISO date the CO was last touched — used for windowing. */
  atISO: string;
  /** The client e-signed it in the portal (audit trail). A GC-marked
   *  approval is NOT a signature. */
  clientSigned: boolean;
  /** Dollars of it on non-draft invoices. 0 when none — or when the caller
   *  passed no invoices (`billingKnown` on the result says which). */
  billedAmount: number;
}

export interface RecoveredValue {
  /** Approved COs that MAGE drafted from a leak scan, newest first. */
  rows: RecoveredRow[];
  /** Count of those COs. */
  count: number;
  /** Dollars approved from MAGE-drafted COs. THE headline number. */
  total: number;
  /** MAGE-drafted COs the owner has but hasn't decided on yet. */
  pendingCount: number;
  pendingTotal: number;
  /**
   * Approved dollars from COs the contractor wrote themselves. Kept separate so
   * the UI never implies MAGE found money a human found.
   */
  manualTotal: number;
  /** True once there is anything real to show. */
  hasData: boolean;
  /** Counted rows the client e-signed in the portal. */
  signedCount: number;
  /** Dollars of the counted rows already on a sent invoice, each row capped
   *  at its own amount. Meaningful only when `billingKnown`. */
  billedTotal: number;
  /** True when the caller passed the invoice list, so billedTotal is a fact
   *  rather than "no invoices were looked at". */
  billingKnown: boolean;
}

const EMPTY: RecoveredValue = {
  rows: [], count: 0, total: 0,
  pendingCount: 0, pendingTotal: 0,
  manualTotal: 0, hasData: false,
  signedCount: 0, billedTotal: 0, billingKnown: false,
};

function parseTime(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Prefer updatedAt (when it was approved) over date (when it was written). */
function effectiveISO(co: ChangeOrder): string {
  return co.updatedAt || co.date || co.createdAt || '';
}

export interface RecoveredOptions {
  /**
   * Only count COs resolved within this many days of `nowISO`. Omit for
   * all-time. A rolling window is what makes the number a *current* claim
   * ("this quarter") rather than a lifetime total that can only ever grow.
   */
  windowDays?: number;
  /** Injected clock — keeps this module pure and testable. */
  nowISO?: string;
  /**
   * Every invoice the caller holds. Passed → each row's billedAmount is read
   * off them. Omitted → billing is unknown and nothing may be called billed.
   */
  invoices?: Invoice[];
}

/**
 * Compute what MAGE actually recovered across every project.
 *
 * Only counts a change order when BOTH are true:
 *   1. MAGE drafted it (the leakCoDraft audit marker is present), and
 *   2. the owner approved it.
 * Anything else is a claim, not a result.
 */
export function computeRecoveredValue(
  projects: Project[],
  changeOrders: ChangeOrder[],
  opts: RecoveredOptions = {},
): RecoveredValue {
  const billingKnown = Array.isArray(opts.invoices);
  if (!Array.isArray(changeOrders) || changeOrders.length === 0) return { ...EMPTY, billingKnown };

  const nameById = new Map<string, string>();
  for (const p of projects ?? []) nameById.set(p.id, p.name);

  const now = parseTime(opts.nowISO) ?? null;
  const windowMs =
    opts.windowDays != null && opts.windowDays > 0
      ? opts.windowDays * 24 * 60 * 60 * 1000
      : null;

  const inWindow = (iso: string): boolean => {
    // No window configured, or no usable clock → don't filter. Silently
    // dropping rows because a date failed to parse would understate the
    // number for reasons the user can't see.
    if (windowMs == null || now == null) return true;
    const t = parseTime(iso);
    if (t == null) return true;
    return now - t <= windowMs;
  };

  const rows: RecoveredRow[] = [];
  let total = 0;
  let pendingCount = 0;
  let pendingTotal = 0;
  let manualTotal = 0;

  for (const co of changeOrders) {
    // A credit CO (negative) is real money moving the other way, but this
    // number is specifically "what MAGE recovered FOR you" — netting credits
    // into it would make a recovery figure shrink for reasons unrelated to
    // recovery. Skip non-positive amounts entirely.
    const amount = co.changeAmount;
    if (!(typeof amount === 'number') || !Number.isFinite(amount) || amount <= 0) continue;

    const iso = effectiveISO(co);
    if (!inWindow(iso)) continue;

    const auto = isAutoLeakDraft(co);

    if (REALIZED_STATUSES.has(co.status)) {
      if (auto) {
        rows.push({
          id: co.id,
          coNumber: co.number,
          projectId: co.projectId,
          projectName: nameById.get(co.projectId) ?? 'Unknown project',
          amount,
          atISO: iso,
          clientSigned: isClientSigned(co),
          billedAmount: billingKnown
            ? billedAgainstChangeOrder(co.id, (opts.invoices ?? []).filter(inv => inv.projectId === co.projectId))
            : 0,
        });
        total += amount;
      } else {
        manualTotal += amount;
      }
      continue;
    }

    if (auto && PENDING_STATUSES.has(co.status)) {
      pendingCount += 1;
      pendingTotal += amount;
    }
  }

  // Newest first — the most recent win is the most motivating one.
  rows.sort((a, b) => (parseTime(b.atISO) ?? 0) - (parseTime(a.atISO) ?? 0));

  // Each row's billed dollars capped at the row's amount, summed in cents so a
  // list of .1s cannot drift off the penny.
  const billedCents = rows.reduce(
    (sum, r) => sum + Math.round(Math.min(Math.max(r.billedAmount, 0), r.amount) * 100), 0);

  return {
    rows,
    count: rows.length,
    total,
    pendingCount,
    pendingTotal,
    manualTotal,
    hasData: rows.length > 0 || pendingCount > 0,
    signedCount: rows.filter(r => r.clientSigned).length,
    billedTotal: billedCents / 100,
    billingKnown,
  };
}

/** Money as the card shows it: whole dollars whole, anything else to the cent.
 *  Math.round used to turn $1,234.50 into "$1,235". */
export function formatRecoveredMoney(n: number): string {
  const cents = Math.round(n * 100);
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

/**
 * The one-line claim. Deliberately plain: no exclamation, no "amazing", and
 * never a number MAGE didn't earn. It says APPROVED — the status is all it
 * knows (#152; this used to say "you billed").
 */
export function recoveredHeadline(v: RecoveredValue, windowLabel?: string): string | null {
  if (v.count === 0) return null;
  const money = formatRecoveredMoney(v.total);
  const suffix = windowLabel ? ` ${windowLabel}` : '';
  const co = v.count === 1 ? 'change order' : 'change orders';
  return `MAGE found ${money} that was approved${suffix} — ${v.count} ${co} drafted from job-site notes.`;
}

/**
 * The card's subline under the money. Claims "approved" for all of it, and the
 * two stronger facts only as far as the rows prove them: how many the client
 * e-signed in the portal, and how much is on a sent invoice. Nothing is said
 * about a fact that is zero or unknown.
 */
export function recoveredProofLine(v: RecoveredValue): string {
  const co = v.count === 1 ? 'change order' : 'change orders';
  const parts: string[] = [`approved on ${v.count} ${co} MAGE drafted off your job-site notes.`];
  if (v.signedCount > 0) {
    parts.push(v.signedCount === v.count
      ? (v.count === 1 ? 'Your client signed it in the portal.' : 'Your client signed all of them in the portal.')
      : `Your client signed ${v.signedCount} of them in the portal.`);
  }
  if (v.billingKnown && v.billedTotal > 0) {
    const all = Math.round(v.billedTotal * 100) >= Math.round(v.total * 100);
    parts.push(all ? 'All of it is billed.' : `${formatRecoveredMoney(v.billedTotal)} of it is billed so far.`);
  }
  return parts.join(' ');
}

/** Secondary line: what's still sitting with the owner. */
export function recoveredPendingLine(v: RecoveredValue): string | null {
  if (v.pendingCount === 0) return null;
  const money = formatRecoveredMoney(v.pendingTotal);
  return v.pendingCount === 1
    ? `${money} more is waiting on your client's signature.`
    : `${money} more is waiting across ${v.pendingCount} change orders.`;
}
