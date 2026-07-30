// utils/systemOfAction.ts
//
// "Software that does the work." The 2026 diagnosis of why construction teams
// fail isn't missing software — it's that their software only STORES:
//   "software stores RFIs and submittals, but none of them chase the architect
//    for a response ... People still do that."
//
// This is the chase engine. It finds every item parked with someone ELSE
// (architect sitting on an RFI, reviewer on a submittal, owner on a change
// order), ranks by how overdue it is, and drafts the actual follow-up message
// — so the app does the chasing instead of the PM.
//
// Pure: no React/network/clock (caller passes nowMs).

import type { RFI, Submittal, ChangeOrder, Project } from '@/types';

export type ChaseKind = 'rfi' | 'submittal' | 'co_approval';
export type ChaseSeverity = 'critical' | 'high' | 'normal';

export interface ChaseItem {
  id: string;
  kind: ChaseKind;
  projectId: string;
  projectName: string;
  /** What's waiting — "RFI #12: Beam conflict at grid B". */
  title: string;
  /** Who is sitting on it. */
  waitingOn: string;
  /** Days past the date it was needed. Negative = not due yet. */
  daysOverdue: number;
  severity: ChaseSeverity;
  /** Ready-to-send follow-up the app can fire on the user's behalf. */
  nudge: string;
  /** Route to open the underlying record. */
  route: { pathname: string; params: Record<string, string> };
}

const DAY_MS = 86400000;

function daysPast(dueISO: string | undefined, nowMs: number): number | null {
  if (!dueISO) return null;
  const ms = Date.parse(dueISO.length === 10 ? dueISO + 'T12:00:00' : dueISO);
  if (!Number.isFinite(ms)) return null;
  return Math.floor((nowMs - ms) / DAY_MS);
}

function severityFor(daysOverdue: number): ChaseSeverity {
  if (daysOverdue >= 7) return 'critical';
  if (daysOverdue >= 3) return 'high';
  return 'normal';
}

/**
 * Build the chase list: everything parked with someone else and past due.
 * Only items where the ball is genuinely in someone ELSE'S court are included —
 * chasing yourself is noise.
 */
export function buildChaseList(opts: {
  rfis: RFI[];
  submittals: Submittal[];
  changeOrders: ChangeOrder[];
  projects: Project[];
  nowMs: number;
  /** Include items not yet overdue (default false — overdue only). */
  includeUpcoming?: boolean;
}): ChaseItem[] {
  const { rfis, submittals, changeOrders, projects, nowMs } = opts;
  const includeUpcoming = opts.includeUpcoming ?? false;
  const nameById = new Map(projects.map((p) => [p.id, p.name]));
  const items: ChaseItem[] = [];

  const keep = (d: number | null): d is number => d != null && (includeUpcoming || d > 0);

  // ── RFIs parked with the architect/engineer ──────────────────────────────
  for (const r of rfis) {
    if (r.dateResponded) continue; // answered
    if (r.status === 'closed') continue;
    // Ball must be with someone else. Legacy rows without ballInCourt are
    // treated as out-for-response once they have an assignee.
    const ball = r.ballInCourt ?? (r.assignedTo ? 'architect' : 'gc');
    if (ball === 'gc' || ball === 'closed') continue;

    const d = daysPast(r.dateRequired, nowMs);
    if (!keep(d)) continue;

    const who = r.assignedTo?.trim() || 'the design team';
    const label = `RFI #${r.number}: ${r.subject}`;
    items.push({
      id: r.id,
      kind: 'rfi',
      projectId: r.projectId,
      projectName: nameById.get(r.projectId) ?? 'Project',
      title: label,
      waitingOn: who,
      daysOverdue: d,
      severity: severityFor(d),
      nudge:
        `Following up on ${label}, which was due ${d} day${d === 1 ? '' : 's'} ago. ` +
        `We need an answer to keep the schedule on track — can you respond today?`,
      route: { pathname: '/rfi', params: { projectId: r.projectId, rfiId: r.id } },
    });
  }

  // ── Submittals awaiting review ───────────────────────────────────────────
  for (const s of submittals) {
    const status = String(s.currentStatus ?? '');
    // Anything already dispositioned is not a chase.
    if (/approved|rejected|closed/i.test(status)) continue;

    const d = daysPast(s.requiredDate, nowMs);
    if (!keep(d)) continue;

    const label = `Submittal #${s.number}: ${s.title}`;
    items.push({
      id: s.id,
      kind: 'submittal',
      projectId: s.projectId,
      projectName: nameById.get(s.projectId) ?? 'Project',
      title: label,
      waitingOn: 'the reviewer',
      daysOverdue: d,
      severity: severityFor(d),
      nudge:
        `${label} has been awaiting review for ${d} day${d === 1 ? '' : 's'} past the required date. ` +
        `Material orders are held until it's returned — please review or advise.`,
      route: { pathname: '/submittal', params: { projectId: s.projectId, submittalId: s.id } },
    });
  }

  // ── Change orders sitting with the owner ─────────────────────────────────
  for (const co of changeOrders) {
    if (co.status !== 'submitted' && co.status !== 'under_review') continue;
    const d = daysPast(co.date, nowMs);
    if (d == null) continue;
    // COs have no "required by" date, so treat >3 days with the owner as due.
    const overdue = d - 3;
    if (!includeUpcoming && overdue <= 0) continue;

    const label = `CO #${co.number}`;
    items.push({
      id: co.id,
      kind: 'co_approval',
      projectId: co.projectId,
      projectName: nameById.get(co.projectId) ?? 'Project',
      title: `${label}: ${(co.description ?? 'Change order').slice(0, 60)}`,
      waitingOn: 'the owner',
      daysOverdue: Math.max(0, overdue),
      severity: severityFor(Math.max(0, overdue)),
      nudge:
        `Checking in on ${label}, sent ${d} day${d === 1 ? '' : 's'} ago. ` +
        `We can't schedule this work until it's approved — let us know if you have questions.`,
      route: { pathname: '/change-order', params: { projectId: co.projectId, coId: co.id } },
    });
  }

  return items.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

/** Headline counts for a card/badge. */
export function chaseSummary(items: ChaseItem[]): {
  total: number;
  critical: number;
  byKind: Record<ChaseKind, number>;
} {
  const byKind: Record<ChaseKind, number> = { rfi: 0, submittal: 0, co_approval: 0 };
  let critical = 0;
  for (const i of items) {
    byKind[i.kind] += 1;
    if (i.severity === 'critical') critical += 1;
  }
  return { total: items.length, critical, byKind };
}
