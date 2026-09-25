// utils/logs/rfiLogRows.ts — the RFI log's cells, filters and counts
// (wave 6c, lane G). PURE: scripts/validate-g-logs.ts runs it under bun.
//
// Honesty: an unknown value is null (the table draws '—'), never 0 — an RFI
// with no submitted date has no "days open", not zero of them.

import type { RFI, RFIBallInCourt } from '@/types';
import { overdueCalendarDays } from '@/utils/delayScan/rfiBlocking';

const DAY_MS = 86400000;

/** Local midnight of an ISO instant or a bare 'YYYY-MM-DD', or null. */
function dayStart(v: string | null | undefined): number | null {
  if (!v) return null;
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = bare ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])) : new Date(v);
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Calendar days the RFI has been (or was) open: from dateSubmitted to
 * dateResponded once it is answered / closed / void, otherwise to today.
 * null when dateSubmitted is missing or unreadable (the cell shows '—'), and
 * null for an answered RFI with no response date — its end is unknown.
 */
export function rfiDaysOpen(
  rfi: Pick<RFI, 'dateSubmitted' | 'dateResponded' | 'status'>,
  now: Date,
): number | null {
  const start = dayStart(rfi.dateSubmitted);
  if (start === null) return null;
  const finished = rfi.status === 'answered' || rfi.status === 'closed' || rfi.status === 'void';
  let end: number | null;
  if (finished) {
    end = dayStart(rfi.dateResponded);
    if (end === null) return null;
  } else {
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  return Math.max(0, Math.round((end - start) / DAY_MS));
}

/** Who holds the RFI, in the words the RFI screen's badge uses. */
export function rfiBallLabel(ball: RFIBallInCourt | null | undefined): string | null {
  switch (ball) {
    case 'gc': return 'You (GC)';
    case 'architect': return 'Architect';
    case 'engineer': return 'Engineer';
    case 'owner': return 'Owner';
    case 'sub': return 'Subcontractor';
    case 'landlord': return 'Landlord';
    case 'building_engineer': return 'Building engineer';
    case 'closed': return 'Closed';
    default: return null;
  }
}

/** Days past the required date for an OPEN RFI (0 when not overdue). */
export function rfiOverdueDays(rfi: Pick<RFI, 'status' | 'dateRequired'>, now: Date): number {
  if (rfi.status !== 'open') return 0;
  return overdueCalendarDays(rfi.dateRequired, now);
}

export type RfiLogFilter = 'open' | 'overdue' | 'answered' | 'closed' | 'all';

export const RFI_LOG_FILTERS: readonly { key: RfiLogFilter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'answered', label: 'Answered' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

/** Does the RFI belong under this chip? Closed covers void (withdrawn). */
export function rfiLogFilter(rfi: Pick<RFI, 'status' | 'dateRequired'>, filter: RfiLogFilter, now: Date): boolean {
  switch (filter) {
    case 'open': return rfi.status === 'open';
    case 'overdue': return rfiOverdueDays(rfi, now) > 0;
    case 'answered': return rfi.status === 'answered';
    case 'closed': return rfi.status === 'closed' || rfi.status === 'void';
    case 'all': return true;
    default: return true;
  }
}

/** How many RFIs sit under each chip. */
export function rfiLogChipCounts(
  rfis: readonly Pick<RFI, 'status' | 'dateRequired'>[],
  now: Date,
): Record<RfiLogFilter, number> {
  const out: Record<RfiLogFilter, number> = { open: 0, overdue: 0, answered: 0, closed: 0, all: 0 };
  for (const r of rfis) {
    for (const f of RFI_LOG_FILTERS) if (rfiLogFilter(r, f.key, now)) out[f.key] += 1;
  }
  return out;
}

/** Open and overdue counts — for the wave-6d sidebar badges (not wired here). */
export function rfiLogCounts(
  rfis: readonly Pick<RFI, 'status' | 'dateRequired'>[],
  now: Date,
): { open: number; overdue: number } {
  const c = rfiLogChipCounts(rfis, now);
  return { open: c.open, overdue: c.overdue };
}

/**
 * The chip a log opens on: `preferred` (Open), unless nothing is under it
 * while the log is not empty — then All, so the page never opens on a blank
 * table over records that exist.
 */
export function defaultLogFilter<K extends string>(preferred: K, counts: Readonly<Record<string, number>>, total: number): K | 'all' {
  if ((counts[preferred] ?? 0) === 0 && total > 0) return 'all';
  return preferred;
}

/** The text a row is searched by: number, subject, assignee, question. */
export function rfiSearchText(rfi: Pick<RFI, 'number' | 'subject' | 'assignedTo' | 'question'>): string {
  return [`RFI-${String(rfi.number ?? '').padStart(3, '0')}`, String(rfi.number ?? ''), rfi.subject, rfi.assignedTo, rfi.question]
    .filter((s) => typeof s === 'string' && s.length > 0)
    .join(' ');
}

/** 'Urgent' / 'Normal' / 'Low'. */
export function rfiPriorityLabel(p: string | null | undefined): string | null {
  if (!p) return null;
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/** 'Open' / 'Answered' / 'Closed' / 'Void'. */
export function rfiStatusLabel(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Desktop "Which sub?" rail: past this many subs the rest fold behind "+N more". */
export const RFI_SUB_CHIPS_MAX = 12;

/** The subs a desktop rail shows: the first 12, plus the picked one wherever
 *  it sits; everything once expanded. `hidden` is what "+N more" counts. */
export function rfiVisibleSubs<T extends { id: string }>(
  subs: readonly T[],
  pickedId: string | null | undefined,
  expanded: boolean,
): { shown: T[]; hidden: number } {
  if (expanded || subs.length <= RFI_SUB_CHIPS_MAX) return { shown: [...subs], hidden: 0 };
  const shown = subs.slice(0, RFI_SUB_CHIPS_MAX);
  const picked = pickedId ? subs.find((s) => s.id === pickedId) : undefined;
  if (picked && !shown.includes(picked)) shown.push(picked);
  return { shown, hidden: subs.length - shown.length };
}
