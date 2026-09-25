// utils/logs/submittalLogRows.ts — the submittal log's cells and filters
// (wave 6c, lane G). PURE: scripts/validate-g-logs.ts runs it under bun.

import type { Submittal, SubmittalStatus } from '@/types';
import { overdueCalendarDays } from '@/utils/delayScan/rfiBlocking';

type SubmittalLike = Pick<Submittal, 'currentStatus' | 'reviewCycles' | 'requiredDate'>;

const APPROVED: readonly SubmittalStatus[] = ['approved', 'approved_as_noted'];

/**
 * Who has to act next:
 *   pending, revise_resubmit      → "Us" (the GC sends or resends it);
 *   in_review                     → the reviewer on the last OPEN cycle (no
 *                                   return date), or "Reviewer" when that
 *                                   cycle names nobody;
 *   approved, as noted, rejected  → null (the table shows '—': nobody).
 */
export function submittalBallInCourt(s: Pick<Submittal, 'currentStatus' | 'reviewCycles'>): string | null {
  switch (s.currentStatus) {
    case 'pending':
    case 'revise_resubmit':
      return 'Us';
    case 'in_review': {
      const cycles = s.reviewCycles ?? [];
      for (let i = cycles.length - 1; i >= 0; i--) {
        const c = cycles[i];
        if (c && !c.returnDate) {
          const who = (c.reviewer ?? '').trim();
          return who || 'Reviewer';
        }
      }
      return 'Reviewer';
    }
    default:
      return null;
  }
}

/** "Cycle n" (the highest cycle number), or "Not sent" before the first. */
export function submittalCycleLabel(s: Pick<Submittal, 'reviewCycles'>): string {
  const cycles = s.reviewCycles ?? [];
  if (cycles.length === 0) return 'Not sent';
  let n = 0;
  for (const c of cycles) {
    const k = typeof c?.cycleNumber === 'number' && Number.isFinite(c.cycleNumber) ? c.cycleNumber : 0;
    if (k > n) n = k;
  }
  return `Cycle ${n > 0 ? n : cycles.length}`;
}

/** The cycle count as a sortable number (0 = not sent). */
export function submittalCycleCount(s: Pick<Submittal, 'reviewCycles'>): number {
  const cycles = s.reviewCycles ?? [];
  let n = 0;
  for (const c of cycles) if (typeof c?.cycleNumber === 'number' && c.cycleNumber > n) n = c.cycleNumber;
  return n > 0 ? n : cycles.length;
}

export function submittalIsApproved(status: SubmittalStatus | null | undefined): boolean {
  return !!status && APPROVED.includes(status);
}

/** Past its required date and not approved. A submittal with no required
 *  date is never late — nothing says when it was due. */
export function submittalIsLate(s: SubmittalLike, now: Date): boolean {
  if (!s.requiredDate) return false;
  if (submittalIsApproved(s.currentStatus)) return false;
  return overdueCalendarDays(s.requiredDate, now) > 0;
}

export type SubmittalLogFilter = 'open' | 'late' | 'in_review' | 'approved' | 'all';

export const SUBMITTAL_LOG_FILTERS: readonly { key: SubmittalLogFilter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'late', label: 'Late' },
  { key: 'in_review', label: 'In review' },
  { key: 'approved', label: 'Approved' },
  { key: 'all', label: 'All' },
];

export function submittalLogFilter(s: SubmittalLike, filter: SubmittalLogFilter, now: Date): boolean {
  switch (filter) {
    case 'open': return s.currentStatus === 'pending' || s.currentStatus === 'in_review' || s.currentStatus === 'revise_resubmit';
    case 'late': return submittalIsLate(s, now);
    case 'in_review': return s.currentStatus === 'in_review';
    case 'approved': return submittalIsApproved(s.currentStatus);
    case 'all': return true;
    default: return true;
  }
}

export function submittalLogChipCounts(rows: readonly SubmittalLike[], now: Date): Record<SubmittalLogFilter, number> {
  const out: Record<SubmittalLogFilter, number> = { open: 0, late: 0, in_review: 0, approved: 0, all: 0 };
  for (const r of rows) for (const f of SUBMITTAL_LOG_FILTERS) if (submittalLogFilter(r, f.key, now)) out[f.key] += 1;
  return out;
}

const STATUS_LABEL: Readonly<Record<SubmittalStatus, string>> = {
  pending: 'Pending',
  in_review: 'In review',
  approved: 'Approved',
  approved_as_noted: 'Approved as noted',
  revise_resubmit: 'Revise & resubmit',
  rejected: 'Rejected',
};

export function submittalStatusLabel(s: SubmittalStatus | null | undefined): string | null {
  return s ? STATUS_LABEL[s] ?? null : null;
}

export function submittalSearchText(s: Pick<Submittal, 'number' | 'title' | 'specSection' | 'trade' | 'submittedBy'>): string {
  return [String(s.number ?? ''), s.title, s.specSection, s.trade ?? '', s.submittedBy]
    .filter((x) => typeof x === 'string' && x.length > 0)
    .join(' ');
}
