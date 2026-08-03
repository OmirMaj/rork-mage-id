// utils/recoveredValue.ts
//
// "MAGE recovered $X for you." The realized counterpart to draftedRevenue.
//
// WHY THIS EXISTS. utils/draftedRevenue answers "what's ready to send" — money
// the Brain found that is still sitting in draft. That number is a to-do list,
// not a result. This module answers the harder and far more valuable question:
// of the change orders MAGE drafted off its own profit-leak scans, how much did
// the contractor ACTUALLY get approved and billed?
//
// That distinction is the whole point. A tool that says "I found $40k of leaks"
// is making a claim about itself. A tool that says "$12,400 of what I found got
// signed and billed" is reporting an outcome the contractor can verify against
// their own bank account. Only the second one is worth anything, and only the
// second one survives the question "prove it."
//
// The marker is the same one leakCoDraft stamps into auditTrail, so a CO counts
// here only if MAGE actually drafted it. A CO the contractor wrote by hand is
// their win, not ours, and quietly folding those in would inflate the number
// into a lie — the exact failure mode utils/brain/autonomyGate.ts and the
// published accuracy thresholds exist to prevent. Hand-written COs are tracked
// separately so the UI can show the honest split.
//
// Pure: no React, no network, no clock (callers pass `now`).

import type { ChangeOrder, ChangeOrderStatus, Project } from '@/types';
import { isAutoLeakDraft } from '@/utils/brain/leakCoDraft';

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
}

const EMPTY: RecoveredValue = {
  rows: [], count: 0, total: 0,
  pendingCount: 0, pendingTotal: 0,
  manualTotal: 0, hasData: false,
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
  if (!Array.isArray(changeOrders) || changeOrders.length === 0) return EMPTY;

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

  return {
    rows,
    count: rows.length,
    total,
    pendingCount,
    pendingTotal,
    manualTotal,
    hasData: rows.length > 0 || pendingCount > 0,
  };
}

/**
 * The one-line claim. Deliberately plain: no exclamation, no "amazing", and
 * never a number MAGE didn't earn.
 */
export function recoveredHeadline(v: RecoveredValue, windowLabel?: string): string | null {
  if (v.count === 0) return null;
  const money = `$${Math.round(v.total).toLocaleString('en-US')}`;
  const suffix = windowLabel ? ` ${windowLabel}` : '';
  const co = v.count === 1 ? 'change order' : 'change orders';
  return `MAGE found ${money} you billed${suffix} — ${v.count} ${co} drafted from job-site notes.`;
}

/** Secondary line: what's still sitting with the owner. */
export function recoveredPendingLine(v: RecoveredValue): string | null {
  if (v.pendingCount === 0) return null;
  const money = `$${Math.round(v.pendingTotal).toLocaleString('en-US')}`;
  return v.pendingCount === 1
    ? `${money} more is waiting on your client's signature.`
    : `${money} more is waiting across ${v.pendingCount} change orders.`;
}
