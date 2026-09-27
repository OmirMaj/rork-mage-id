// utils/sidebarCounts.ts — the live counts beside the sidebar's THIS JOB rows
// (wave 6d, d6r lane K3; contract D16).
//
// PURE: no React, no react-native — scripts/validate-nav-coverage.ts loads it
// under bun. The domain imports are type-only; the three chip counters come
// from utils/logs, which are themselves pure (validate-g-logs runs them).
//
// ONE DEFINITION PER ROW, BORROWED FROM THE SCREEN IT OPENS. The founder reads
// the number on the rail and then clicks through; if the log's Open chip says
// something else, the rail lied. So:
//   RFIs            rfiLogCounts(...).open          dot = overdue
//   Submittals      submittalLogChipCounts(...).open dot = late
//   Change Orders   coLogChipCounts(...).open        (drafts included — the
//                                                      CO log's Open chip)
//   Punch List      open + in_progress + ready_for_review (useProjectPulse,
//                                                      the job page's KPI)
// validate-nav-coverage ("d6r K3 — sidebar") proves each equals its log chip.
//
// HONEST LOADING (contract D9). A row is OMITTED — never 0, never a guess —
// when there is no active job, when ITS source has not loaded (or failed), or
// when nothing is open. Each source carries its own flag: RFIs and submittals
// settle through useCollectionSettled, change orders and punch items through
// their context `…Loaded` flags, and one slow read never hides another's row.

import type { ChangeOrder, PunchItem, RFI, Submittal } from '@/types';
import { rfiLogCounts } from '@/utils/logs/rfiLogRows';
import { submittalLogChipCounts } from '@/utils/logs/submittalLogRows';
import { coLogChipCounts } from '@/utils/logs/changeOrderLogRows';

/** The THIS JOB rows that carry a count (NavItem keys in DesktopSidebar). */
export type CountedRow = 'rfi' | 'submittal' | 'change-order' | 'punch-list';

export interface RowCount {
  /** Open records — the log's Open chip. Always > 0 (zero rows are omitted). */
  open: number;
  /** Overdue RFIs / late submittals; 0 for change orders and punch. */
  alert: number;
  /** The pill text: the number, or '99+' past 99. */
  pill: string;
  /** Spoken / hover text: '4 open, 1 overdue', '3 open, 1 late', '2 open'. */
  label: string;
}

export interface JobRowCountsInput {
  projectId: string | null | undefined;
  /** One flag per source, each from its own signal. False = unloaded or failed. */
  loaded: { rfis: boolean; submittals: boolean; co: boolean; punch: boolean };
  rfis: readonly Pick<RFI, 'projectId' | 'status' | 'dateRequired'>[];
  submittals: readonly Pick<Submittal, 'projectId' | 'currentStatus' | 'reviewCycles' | 'requiredDate'>[];
  changeOrders: readonly Pick<ChangeOrder, 'projectId' | 'status'>[];
  punchItems: readonly Pick<PunchItem, 'projectId' | 'status'>[];
  now: Date;
}

/** The punch statuses that still need work (useProjectPulse's punch KPI). */
export const OPEN_PUNCH_STATUSES: readonly PunchItem['status'][] = ['open', 'in_progress', 'ready_for_review'];

export const COUNT_PILL_MAX = 99;

export function countPill(open: number): string {
  return open > COUNT_PILL_MAX ? `${COUNT_PILL_MAX}+` : String(open);
}

function row(open: number, alert: number, alertWord: string | null): RowCount | null {
  if (!(open > 0)) return null;
  const a = alertWord && alert > 0 ? `, ${alert} ${alertWord}` : '';
  return { open, alert: alertWord ? alert : 0, pill: countPill(open), label: `${open} open${a}` };
}

export function jobRowCounts(input: JobRowCountsInput): Partial<Record<CountedRow, RowCount>> {
  const out: Partial<Record<CountedRow, RowCount>> = {};
  const pid = input.projectId;
  if (!pid) return out;
  const mine = <T extends { projectId?: string | null }>(xs: readonly T[]): T[] => xs.filter((x) => x.projectId === pid);

  if (input.loaded.rfis) {
    const c = rfiLogCounts(mine(input.rfis), input.now);
    const r = row(c.open, c.overdue, 'overdue');
    if (r) out.rfi = r;
  }
  if (input.loaded.submittals) {
    const c = submittalLogChipCounts(mine(input.submittals), input.now);
    const r = row(c.open, c.late, 'late');
    if (r) out.submittal = r;
  }
  if (input.loaded.co) {
    const c = coLogChipCounts(mine(input.changeOrders));
    const r = row(c.open, 0, null);
    if (r) out['change-order'] = r;
  }
  if (input.loaded.punch) {
    const open = mine(input.punchItems).filter((p) => OPEN_PUNCH_STATUSES.includes(p.status)).length;
    const r = row(open, 0, null);
    if (r) out['punch-list'] = r;
  }
  return out;
}

/** One react-query read of a log collection, as useCollectionSettled reports
 *  it: `settled` is false while ANY fetch is in flight, the first one or a
 *  background refetch. */
export interface CollectionRead { settled: boolean; failed: boolean }

/**
 * Has this source loaded (contract D9: "never before loaded")? A LATCH, not
 * `settled && !failed` read fresh each render: opening the RFI log invalidates
 * ['rfis'] (useRefetchCollectionOnOpen), and a fresh read would drop the row's
 * count for the length of that refetch and bring it back — a blink on the very
 * click the count invited. So:
 *   • a failed read unlatches (unknown, not a stale number);
 *   • a settled, healthy read latches;
 *   • a read in flight keeps whatever the last settled read said.
 * The caller starts it false and restarts it when the signed-in user changes.
 */
export function latchLoaded(prev: boolean, read: CollectionRead): boolean {
  if (read.failed) return false;
  if (read.settled) return true;
  return prev;
}
