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

import type { RFI, Submittal, ChangeOrder, Project, DailyFieldReport, SelectionCategory, ScheduleTask } from '@/types';
import { classifyDelivery, type Delivery } from '@/utils/deliverySchedule';
import { buildCrewPresence, findQuietTrades } from '@/utils/crewPresence';
import { formatMoney } from '@/utils/formatters';
import { projectDelayContext, consequenceFor, type ProjectDelayContext } from '@/utils/ownerDelayCost';
import { matchTaskByTitle } from '@/utils/delayScan/matchTask';
import { formatCalendarDay, toCalendarDayString } from '@/utils/calendarDate';

// 'delivery' joins the paperwork kinds because a late load is the same shape
// of problem: someone else is holding something you need, and every day it
// slips costs you. It differs in who pays — a late RFI stalls a decision, a
// late delivery stalls a CREW, and that shows up as labour rather than as a
// late PO. It belongs where the PM already looks.
/**
 * `unsent_rfi` is not a chase in the same sense as the others — nobody else is
 * holding it. It is here because the alternative was worse: an RFI that was
 * never sent used to be emitted as a plain `rfi` and attributed to the
 * architect, so the app told him to chase someone who had never received it.
 * That is the one failure mode a chase list must not have, because acting on it
 * damages a relationship he depends on. Filed as its own kind, with the ball on
 * him, it becomes the useful fact it always was: this question is still in your
 * drafts and the date you need it by is coming.
 *
 * `selection` is an owner decision past its due date (a SelectionCategory not
 * yet decided — see selectionDecided). Like `co_approval` it carries a `consequence`: what the wait
 * costs, from his schedule and his own General Conditions line.
 */
export type ChaseKind = 'rfi' | 'submittal' | 'co_approval' | 'delivery' | 'quiet_trade' | 'unsent_rfi' | 'proposal' | 'selection';
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
  /** True when the item has never been sent (the ball is his, not the other
   *  party's). Set on submittals, which share kind 'submittal' either way. */
  unsent?: boolean;
  /** A muted line under the title (the proposal kind says what MAGE cannot
   *  see: whether the client opened it). */
  note?: string;
  /** What the wait is costing — computed from his schedule and his own
   *  General Conditions line; absent when there is nothing honest to say. */
  consequence?: string;
  /** Route to open the underlying record. */
  route: { pathname: string; params: Record<string, string> };
}

const DAY_MS = 86400000;

/** A sent proposal (a project_contracts row, kind 'proposal'), as
 *  utils/contractEngine.fetchOpenProposals reads it. */
export interface ProposalChaseInput {
  id: string;
  projectId: string;
  title: string;
  contractValue: number;
  status: string;
  kind?: string;
  sentAt?: string;
  signedAt?: string;
  voidedAt?: string;
  supersededBy?: string;
}

/** A proposal gets two days before it is worth a follow-up. */
export const PROPOSAL_GRACE_DAYS = 2;

/** The follow-up for a sent proposal. It never claims the client opened (or
 *  didn't open) it: portal-mark-viewed does not cover project_contracts, so
 *  MAGE cannot know. */
export function proposalNudge(a: { clientName: string; title: string; daysSinceSent: number; sentLabel: string }): string {
  const client = a.clientName?.trim() || 'there';
  const d = a.daysSinceSent;
  if (d < 5) {
    return `Hi ${client}, just checking you received the proposal for ${a.title}. Happy to walk through it or answer any questions.`;
  }
  if (d < 10) {
    return `Hi ${client}, following up on the ${a.title} proposal I sent on ${a.sentLabel}. Is there anything you'd like changed (scope, timing or price)? I can adjust it this week.`;
  }
  return `Hi ${client}, I don't want to keep filling your inbox about ${a.title}. If the timing isn't right, just let me know and I'll close it out for now. If you'd like to go ahead, I can hold a start date for you.`;
}

/** Jobs already won or finished: a proposal on them is not worth chasing. */
const PROPOSAL_DONE_STATUSES = new Set(['in_progress', 'completed', 'closed']);

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
  /** Scheduled deliveries. Optional — omitted means the caller has none loaded
   *  and the list behaves exactly as it did before deliveries existed. */
  deliveries?: Delivery[];
  /** Daily field reports, per project, for crew-presence. Optional for the
   *  same reason as deliveries. */
  dailyReportsByProject?: Record<string, DailyFieldReport[]>;
  nowMs: number;
  /** Include items not yet overdue (default false — overdue only). */
  includeUpcoming?: boolean;
  /** Sent proposals (project_contracts, kind 'proposal'). Optional — omitted
   *  means the list behaves exactly as it did before proposals were chased. */
  proposals?: readonly ProposalChaseInput[];
  /** Owner selections (SelectionCategory rows). Optional — omitted means the
   *  list behaves exactly as it did before selections were chased. */
  selections?: readonly SelectionCategory[];
}): ChaseItem[] {
  const { rfis, submittals, changeOrders, projects, nowMs } = opts;
  const includeUpcoming = opts.includeUpcoming ?? false;
  const nameById = new Map(projects.map((p) => [p.id, p.name]));
  const items: ChaseItem[] = [];
  // Owner-delay context (CPM + his own daily site cost), once per project, and
  // only for projects an owner decision actually needs it for.
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const delayCtx = new Map<string, ProjectDelayContext>();
  const ctxFor = (projectId: string): ProjectDelayContext => {
    let c = delayCtx.get(projectId);
    if (!c) { c = projectDelayContext(projectById.get(projectId)); delayCtx.set(projectId, c); }
    return c;
  };
  // The clock is nowMs; "today" is its LOCAL calendar day.
  const today = toCalendarDayString(new Date(nowMs));

  const keep = (d: number | null): d is number => d != null && (includeUpcoming || d > 0);

  // ── RFIs parked with the architect/engineer ──────────────────────────────
  for (const r of rfis) {
    if (r.dateResponded) continue; // answered, with a date on it

    // STATUS, not just dateResponded. RFIStatus is 'open' | 'answered' |
    // 'closed' | 'void' and this used to skip only 'closed' — so an RFI marked
    // ANSWERED by hand, without a dateResponded ever being filled in, kept
    // generating "chase the architect" every morning after she had already
    // replied. A VOID RFI is one he withdrew himself, and chasing anyone for it
    // is indefensible. Both are now out.
    if (r.status === 'closed' || r.status === 'answered' || r.status === 'void') continue;

    const d = daysPast(r.dateRequired, nowMs);
    if (!keep(d)) continue;

    // NEVER SENT. `dateSubmitted` is what "it went out" means on an RFI. Without
    // this branch the item below would name `assignedTo` as the party sitting on
    // it — and the architect cannot be late answering a question still sitting
    // in his drafts. The ball is his; say so, and route him to send it.
    if (!r.dateSubmitted || !r.dateSubmitted.trim()) {
      const draftLabel = `RFI #${r.number}: ${r.subject}`;
      items.push({
        id: r.id,
        kind: 'unsent_rfi',
        projectId: r.projectId,
        projectName: nameById.get(r.projectId) ?? 'Project',
        title: draftLabel,
        waitingOn: 'you — not sent yet',
        daysOverdue: d,
        severity: severityFor(d),
        nudge:
          `${draftLabel} has never been sent, and you needed the answer ${d} day${d === 1 ? '' : 's'} ago. ` +
          `Nobody is late but you — open it and send it.`,
        route: { pathname: '/rfi', params: { projectId: r.projectId, rfiId: r.id } },
      });
      continue;
    }

    // Ball must be with someone else. Legacy rows without ballInCourt are
    // treated as out-for-response once they have an assignee.
    const ball = r.ballInCourt ?? (r.assignedTo ? 'architect' : 'gc');
    if (ball === 'gc' || ball === 'closed') continue;

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

    // NEVER SENT (#60) — the same rule as the RFI branch above. A submittal
    // with no review round on record and still 'pending' has not reached any
    // reviewer (a send opens an in_review cycle; a portal answer adds one), so
    // "the reviewer" cannot be the one holding it. submittedDate is NOT the
    // test: until #60 every create path stamped it on the day the row was made
    // (the spec-book import did it for all 38 at once), so it proves nothing.
    // Kept under kind 'submittal' so app/waiting-on.tsx's per-kind icon table
    // still covers it; `unsent` carries the difference.
    const cycles = Array.isArray(s.reviewCycles) ? s.reviewCycles : [];
    if (cycles.length === 0 && status === 'pending') {
      items.push({
        id: s.id,
        kind: 'submittal',
        unsent: true,
        projectId: s.projectId,
        projectName: nameById.get(s.projectId) ?? 'Project',
        title: label,
        waitingOn: 'you — not sent yet',
        daysOverdue: d,
        severity: severityFor(d),
        nudge:
          `${label} has not been sent for review yet, and it was needed ${d} day${d === 1 ? '' : 's'} ago. ` +
          `Nobody is late but you — attach the product data and send it.`,
        route: { pathname: '/submittal', params: { projectId: s.projectId, submittalId: s.id } },
      });
      continue;
    }

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
    const ctx = ctxFor(co.projectId);
    const tasks: ScheduleTask[] = ctx.schedule?.tasks ?? [];
    const anchorId = co.scheduleAnchorTaskId ?? co.scheduleImpactTaskIds?.[0];
    const task = anchorId ? tasks.find((t) => t.id === anchorId) ?? null : null;
    const consequence = consequenceFor(ctx, task, task ? 'linked_task' : 'no_task', today).text;
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
      consequence,
    });
  }

  // ── Late deliveries ───────────────────────────────────────────────────────
  // Only genuinely LATE loads chase. An unconfirmed-but-not-yet-due delivery is
  // surfaced by the look-ahead (utils/deliverySchedule); putting it here too
  // would flood the chase list with things nobody is late on yet, and a chase
  // list you scroll past is a chase list that stops working.
  for (const d of opts.deliveries ?? []) {
    const view = classifyDelivery(d, nowMs);
    if (view.flag !== 'late') continue;
    const late = Math.abs(view.daysOut ?? 0);
    items.push({
      id: `delivery:${d.id}`,
      kind: 'delivery',
      projectId: d.projectId,
      projectName: nameById.get(d.projectId) ?? 'Project',
      title: `${d.description.slice(0, 60)} — ${d.supplier}`,
      waitingOn: d.supplier,
      daysOverdue: late,
      severity: severityFor(late),
      nudge:
        `Following up on ${d.description} for ${nameById.get(d.projectId) ?? 'our project'}, ` +
        `due ${d.expectedDate} and now ${late} day${late === 1 ? '' : 's'} out. ` +
        `We have crew scheduled against it — can you confirm a delivery date today?`,
      route: { pathname: '/deliveries', params: { projectId: d.projectId } },
    });
  }

  // ── Trades that went quiet ────────────────────────────────────────────────
  // A sub who worked for days and then vanished is the definition of something
  // you are waiting on, and nothing else in the app catches it. All the honesty
  // rules live in utils/crewPresence — in particular, absence is counted in
  // REPORTED days, so a GC who stops filing daily reports never gets accused of
  // being ghosted by every sub at once.
  for (const [projectId, reports] of Object.entries(opts.dailyReportsByProject ?? {})) {
    const presence = buildCrewPresence(reports);
    for (const q of findQuietTrades(presence)) {
      const who = q.companies.length === 1 ? q.companies[0] : q.tradeKey;
      items.push({
        id: `quiet:${projectId}:${q.tradeKey}`,
        kind: 'quiet_trade',
        projectId,
        projectName: nameById.get(projectId) ?? 'Project',
        title: `${who} off site since ${q.lastSeen}`,
        waitingOn: who,
        // Reported days, NOT calendar days — see crewPresence's header. Feeding
        // a calendar number here would make severity climb on the strength of
        // the GC's own paperwork gap.
        daysOverdue: q.reportedDaysSince,
        severity: severityFor(q.reportedDaysSince),
        nudge:
          `Checking in on ${q.tradeKey} at ${nameById.get(projectId) ?? 'our project'} — ` +
          `our daily reports show your crew last on site ${q.lastSeen}. ` +
          `Can you confirm when they're back so we can sequence the follow-on trades?`,
        route: { pathname: '/daily-report', params: { projectId } },
      });
    }
  }

  // ── Proposals the client has not signed ─────────────────────────────────
  // A sent proposal with no signature is money waiting on the client. MAGE
  // cannot see whether they opened it (portal-mark-viewed does not cover
  // project_contracts), so the item says exactly that and never guesses.
  if (opts.proposals) {
    const projectById = new Map(projects.map((p) => [p.id, p]));
    for (const pr of opts.proposals) {
      if (pr.kind !== 'proposal' || pr.status !== 'sent') continue;
      if (!pr.sentAt || pr.signedAt || pr.voidedAt || pr.supersededBy) continue;
      const project = projectById.get(pr.projectId);
      if (!project) continue;
      if (PROPOSAL_DONE_STATUSES.has(String(project.status ?? ''))) continue;
      const d = daysPast(pr.sentAt, nowMs);
      if (d == null) continue;
      const overdue = d - PROPOSAL_GRACE_DAYS;
      if (!includeUpcoming && overdue <= 0) continue;
      const late = Math.max(0, overdue);
      const client = project.primaryContact?.name?.trim() || '';
      const sentDay = new Date(Date.parse(pr.sentAt.length === 10 ? pr.sentAt + 'T12:00:00' : pr.sentAt));
      const sentLabel = sentDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      items.push({
        id: `proposal:${pr.id}`,
        kind: 'proposal',
        projectId: pr.projectId,
        projectName: project.name ?? 'Project',
        title: `Proposal: ${pr.title} (${formatMoney(pr.contractValue)})`,
        waitingOn: client || 'the client',
        daysOverdue: late,
        severity: severityFor(late),
        note: `Sent ${d} day(s) ago. MAGE can’t see whether they opened it.`,
        nudge: proposalNudge({ clientName: client, title: pr.title, daysSinceSent: d, sentLabel }),
        route: { pathname: '/contract', params: { projectId: pr.projectId } },
      });
    }
  }

  // ── Owner selections past their due date ─────────────────────────────────
  // A selection the owner has not made by the date it was due holds up the
  // install task. Due in the past (calendar day < today) and not decided
  // (selectionDecided — the same rule app/selections.tsx uses for "late").
  for (const sel of opts.selections ?? []) {
    if (selectionDecided(sel)) continue;
    const due = sel.dueDate?.slice(0, 10);
    if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(due) || !(due < today)) continue;
    const d = daysPast(due, nowMs);
    if (d == null) continue;
    const late = Math.max(1, d);
    const ctx = ctxFor(sel.projectId);
    const task = matchTaskByTitle(sel.category, ctx.schedule?.tasks ?? []);
    const dueLabel = formatCalendarDay(due, { month: 'short', day: 'numeric' });
    items.push({
      id: `selection:${sel.id}`,
      kind: 'selection',
      projectId: sel.projectId,
      projectName: nameById.get(sel.projectId) ?? 'Project',
      title: `${sel.category} selection`,
      waitingOn: 'the owner',
      daysOverdue: late,
      severity: severityFor(late),
      nudge:
        `Checking in on the ${sel.category} selection — it was due ${dueLabel}. ` +
        `We need it to keep the schedule on track${task ? ` for ${task.title}` : ''}.`,
      route: { pathname: '/selections', params: { projectId: sel.projectId } },
      consequence: consequenceFor(ctx, task, task ? 'matched_by_name' : 'no_task', today).text,
    });
  }

  return items.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

/**
 * A selection counts as decided when it is 'chosen' or 'exceeded' (a pick over
 * the allowance is still a pick), or when any of its options isChosen — the
 * rule app/selections.tsx (#48, DueDateSection) uses before it calls one late.
 */
export function selectionDecided(sel: Pick<SelectionCategory, 'status' | 'options'>): boolean {
  return sel.status === 'chosen' || sel.status === 'exceeded' || (sel.options ?? []).some(o => o.isChosen);
}

/** Headline counts for a card/badge. */
export function chaseSummary(items: ChaseItem[]): {
  total: number;
  critical: number;
  byKind: Record<ChaseKind, number>;
} {
  const byKind: Record<ChaseKind, number> = { rfi: 0, submittal: 0, co_approval: 0, delivery: 0, quiet_trade: 0, unsent_rfi: 0, proposal: 0, selection: 0 };
  let critical = 0;
  for (const i of items) {
    byKind[i.kind] += 1;
    if (i.severity === 'critical') critical += 1;
  }
  return { total: items.length, critical, byKind };
}
