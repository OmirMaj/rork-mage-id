// utils/subBillCheck.ts — "Pay what's earned": a sub's bill against the work
// actually in place.
//
// The overage guard (utils/subOverpayment) stops a bill that would push a sub
// past the CONTRACT. This answers the earlier question every GC asks before
// approving: has the work caught up with the money? A sub at 62% billed on
// tasks that are 35% done is being paid ahead of the work, and front-loaded
// billing is how a GC ends up financing a sub who walks.
//
// Honesty rules:
// - All money is integer cents. suggestApprove + hold === this, exactly.
// - Billed-before counts SIBLING invoices (approved or paid, this commitment,
//   not this one). It never reads the commitment's server paid rollup: that
//   rollup already includes approved rows (the double-count computeSubOverpayment
//   documents).
// - Presence is THIS company on the daily reports, by name — never a trade
//   total, never another company in the same trade.
// - A schedule nobody updated (every task 0% while the sub is on the reports)
//   is a stale schedule, not a sub who did nothing: never suggest a hold on it.
//
// Pure: no React, no storage, no network.
import type { Commitment, DailyFieldReport, ScheduleTask, SubSubmittedInvoice } from '@/types';
import { toCents } from '@/utils/brain/scopeCoDraft';
import { calendarDayOf, formatCalendarDay } from '@/utils/calendarDate';
import { formatMoney } from '@/utils/formatters';

export const AHEAD_THRESHOLD_PTS = 10;
export const MIN_HOLD_CENTS = 10000;

export type SubBillVerdict = 'no_commitment' | 'no_tasks' | 'stale_schedule' | 'in_line' | 'ahead_of_work';

/** Shown under every hold suggestion: MAGE has no partial approval. */
export const PARTIAL_APPROVAL_HONESTY =
  'MAGE can’t approve part of an invoice. Reject it with the note below and ask for a revised bill, or approve it anyway.';

export const RETAINAGE_NOTE = 'Percentages are before retainage.';

// ── Presence ────────────────────────────────────────────────────────────────

/** The report's calendar day — the same split utils/crewPresence's private
 *  reportDay makes: a bare YYYY-MM-DD is that day, an instant is the local
 *  day it fell on, junk is null. */
function reportDay(raw: string | null | undefined): string | null {
  return calendarDayOf(raw?.trim());
}

const COMPANY_SUFFIX = /\s+(llc|inc|corp|co|company)$/;

function normalizeCompany(name: string | null | undefined): string {
  let s = (name ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(COMPANY_SUFFIX, '').trim();
  return s;
}

/** Same company? Lowercased, punctuation and a trailing llc/inc/corp/co/company
 *  stripped; equal, or one contains the other when the shorter is at least 5
 *  characters ('acme electric' vs 'acme electric of nj'). */
export function companiesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeCompany(a);
  const y = normalizeCompany(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 5 && long.includes(short);
}

export function companyDaysOnSite(
  reports: readonly Pick<DailyFieldReport, 'date' | 'manpower'>[],
  companyName: string,
): { reportedDaysPresent: number; lastSeen: string | null } | null {
  if (!companyName || !companyName.trim()) return null;
  const days = new Set<string>();
  for (const r of reports ?? []) {
    const day = reportDay(r?.date);
    if (day === null) continue;
    for (const entry of r.manpower ?? []) {
      const headcount = Number(entry?.headcount) || 0;
      if (headcount <= 0) continue;
      if (!companiesMatch(entry?.company, companyName)) continue;
      days.add(day);
      break;
    }
  }
  const sorted = [...days].sort();
  return { reportedDaysPresent: sorted.length, lastSeen: sorted.length ? sorted[sorted.length - 1] : null };
}

// ── The check ───────────────────────────────────────────────────────────────

export interface SubBillCheckInput {
  invoice: Pick<SubSubmittedInvoice, 'id' | 'amount' | 'commitmentId' | 'status' | 'retentionAmount' | 'invoiceNumber'>;
  siblings: readonly Pick<SubSubmittedInvoice, 'id' | 'amount' | 'commitmentId' | 'status'>[];
  commitment: Pick<Commitment, 'amount' | 'changeAmount'> | null;
  tasks: readonly Pick<ScheduleTask, 'id' | 'title' | 'progress' | 'durationDays' | 'isMilestone' | 'assignedSubId'>[];
  subId: string;
  subName: string;
  presence: { reportedDaysPresent: number; lastSeen: string | null } | null;
  openPunchCount: number;
}

export interface SubBillCheck {
  verdict: SubBillVerdict;
  contractCents: number | null;
  billedBeforeCents: number;
  thisCents: number;
  /** 0..n fraction (can pass 1 on an over-billed contract). */
  billedPct: number | null;
  /** 0..1 fraction. */
  workInPlacePct: number | null;
  earnedCents: number | null;
  suggestApproveCents: number | null;
  holdCents: number | null;
  evidence: string[];
  headline: string;
  /** 'Suggest approving $X now and holding $Y…' — ahead_of_work only. */
  suggestion: string | null;
  noteToSub: string | null;
}

/** Cents → '$3,800' (or '$3,800.50' when there are cents). */
export function centsLabel(cents: number): string {
  return formatMoney(cents / 100, cents % 100 === 0 ? 0 : 2);
}

const pct = (f: number): number => Math.round(f * 100);
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function progressOf(t: { progress?: number }): number {
  const p = Number(t.progress);
  return Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
}

function durationOf(t: { durationDays?: number }): number {
  const d = Number(t.durationDays);
  return Number.isFinite(d) ? Math.max(0, d) : 0;
}

export function subBillCheck(input: SubBillCheckInput): SubBillCheck {
  const sub = input.subName?.trim() || 'This sub';
  const thisCents = toCents(Number(input.invoice.amount) || 0);
  const commitmentId = input.invoice.commitmentId;

  let billedBeforeCents = 0;
  if (commitmentId) {
    for (const s of input.siblings ?? []) {
      if (s.id === input.invoice.id) continue;
      if (s.commitmentId !== commitmentId) continue;
      if (s.status !== 'approved' && s.status !== 'paid') continue;
      billedBeforeCents += toCents(Number(s.amount) || 0);
    }
  }

  const tasks = (input.tasks ?? []).filter(t => t.assignedSubId === input.subId && !t.isMilestone);
  const presence = input.presence;

  const evidence: string[] = tasks.map(t => `${t.title}: ${Math.round(progressOf(t))}% (${durationOf(t)} d)`);
  if (presence && presence.reportedDaysPresent > 0 && presence.lastSeen) {
    const last = formatCalendarDay(presence.lastSeen, { month: 'short', day: 'numeric' });
    evidence.push(`${sub} is on your daily reports (by company name) on ${presence.reportedDaysPresent} day(s), last ${last}`);
  } else if (presence) {
    evidence.push(`${sub} isn’t on your daily reports under that company name`);
  }
  if (input.openPunchCount > 0) evidence.push(`${input.openPunchCount} open punch item(s) on this sub`);

  const retainage = (Number(input.invoice.retentionAmount) || 0) > 0;
  const withRetainage = (s: string) => (retainage ? `${s} ${RETAINAGE_NOTE}` : s);

  const base = {
    billedBeforeCents,
    thisCents,
    evidence,
    suggestion: null,
    noteToSub: null,
    suggestApproveCents: null,
    holdCents: null,
  } as const;

  const rawContract = input.commitment
    ? toCents((Number(input.commitment.amount) || 0) + (Number(input.commitment.changeAmount) || 0))
    : 0;
  if (!input.commitment || rawContract <= 0) {
    return {
      ...base,
      verdict: 'no_commitment',
      contractCents: null,
      billedPct: null,
      workInPlacePct: null,
      earnedCents: null,
      headline: 'This invoice isn’t tied to a commitment, so there’s no contract value to compare it with.',
    };
  }
  const contractCents = rawContract;
  const billedPct = (billedBeforeCents + thisCents) / contractCents;

  if (tasks.length === 0) {
    return {
      ...base,
      verdict: 'no_tasks',
      contractCents,
      billedPct,
      workInPlacePct: null,
      earnedCents: null,
      headline: `No schedule tasks are assigned to ${sub}, so MAGE can’t compare this bill with work in place. Assign their tasks in the schedule to get this check.`,
    };
  }

  const totalDays = tasks.reduce((s, t) => s + durationOf(t), 0);
  const wip = clamp01(
    totalDays > 0
      ? tasks.reduce((s, t) => s + (progressOf(t) / 100) * durationOf(t), 0) / totalDays
      : tasks.reduce((s, t) => s + progressOf(t) / 100, 0) / tasks.length,
  );

  const allZero = tasks.every(t => progressOf(t) === 0);
  if (allZero && (presence?.reportedDaysPresent ?? 0) >= 2) {
    return {
      ...base,
      verdict: 'stale_schedule',
      contractCents,
      billedPct,
      workInPlacePct: wip,
      earnedCents: null,
      headline: `Every task assigned to ${sub} still reads 0%, but your daily reports list them on site on ${presence!.reportedDaysPresent} day(s). Update task progress before holding any money.`,
    };
  }

  const earnedCents = Math.round(contractCents * wip);
  const remainingEarned = Math.max(0, earnedCents - billedBeforeCents);
  const approve = Math.min(thisCents, remainingEarned);
  const hold = thisCents - approve;
  const aheadPts = (billedPct - wip) * 100;

  if (aheadPts >= AHEAD_THRESHOLD_PTS && hold >= MIN_HOLD_CENTS) {
    const presenceClause = presence && presence.reportedDaysPresent > 0
      ? `, and your daily reports list them on site on ${presence.reportedDaysPresent} day(s)`
      : '';
    const num = String(input.invoice.invoiceNumber ?? '').trim() || input.invoice.id;
    return {
      ...base,
      verdict: 'ahead_of_work',
      contractCents,
      billedPct,
      workInPlacePct: wip,
      earnedCents,
      suggestApproveCents: approve,
      holdCents: hold,
      headline: withRetainage(
        `${sub} has billed ${pct(billedPct)}% of their ${centsLabel(contractCents)} contract. Their scheduled tasks are ${pct(wip)}% done${presenceClause}.`,
      ),
      suggestion: `Suggest approving ${centsLabel(approve)} now and holding ${centsLabel(hold)} until the work catches up.`,
      noteToSub:
        `Hi ${sub}, we reviewed invoice #${num} for ${centsLabel(thisCents)}. Our schedule shows your work at about ${pct(wip)}% complete. ` +
        `We can approve ${centsLabel(approve)} now, which brings you up to the value of the work in place, and we'll release the remaining ${centsLabel(hold)} as the work progresses. ` +
        `If our progress figures are off, send photos or a quantity breakdown and we'll update them.`,
    };
  }

  return {
    ...base,
    verdict: 'in_line',
    contractCents,
    billedPct,
    workInPlacePct: wip,
    earnedCents,
    headline: withRetainage(`Billing is in line with work in place (${pct(billedPct)}% billed, ${pct(wip)}% done).`),
  };
}
