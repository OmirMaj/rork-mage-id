// utils/followUp/rules.ts — the starter rule set.
//
// Each rule names the checklist controls it answers, cites the records it
// reads, and states how it closes. Adding a follow-up type is adding an entry
// here — not a switch case in two other engines.
//
// A rule may NOT: invent a date, name a person it cannot find, or close an
// item by ceasing to mint it. The engine enforces all three (guards G0-G6);
// these rules are written so it never has to.

import type { FollowUpBasis } from '@/types';
import {
  type FollowUpRule, type FollowUpContext, type MintedFollowUp, daysBetween,
} from './engine';

const NONE: FollowUpBasis = { kind: 'none' };

function dayMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isFinite(ms) ? ms : null;
}

/** A schedule day number as a calendar date, using the schedule's own anchor.
 *  Returns null on an undated schedule — the rule then refuses rather than
 *  inventing an anchor of "today", which is the bug that made every task on
 *  two real schedules march forward a day, every day. */
function dateForStartDay(startDay: number | undefined, scheduleStartDate: string | undefined): string | null {
  if (startDay == null || !scheduleStartDate) return null;
  const base = dayMs(scheduleStartDate);
  if (base === null) return null;
  return new Date(base + (startDay - 1) * 86400000).toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// R1 — a change order past the turnaround the owner himself agreed to.
// Controls 17, 18, 24.
//
// `ChangeOrder.approvalDeadlineDays` is declared in types/index.ts and has
// exactly TWO references in the whole repo, both in the Supabase row mapper
// (contexts/ProjectContext.tsx, read and write). Nothing has ever consumed it.
// The field was created for precisely this question and never asked it.
// ─────────────────────────────────────────────────────────────────────────────
const PENDING_CO = new Set(['submitted', 'under_review']);

export const coPastItsOwnTurnaround: FollowUpRule = {
  id: 'co_past_its_own_turnaround',
  category: 'change_order',
  controls: [17, 18, 24],
  reads: ['changeOrders'],
  joins: false,
  closeMode: 'evidence',

  mint(ctx: FollowUpContext): MintedFollowUp[] {
    const out: MintedFollowUp[] = [];
    for (const co of ctx.changeOrders ?? []) {
      if (!PENDING_CO.has(co.status)) continue;
      const sentAt = co.portalState?.sentAt ?? co.date;
      const sentMs = dayMs(sentAt);
      if (sentMs === null) continue;

      const deadline = co.approvalDeadlineDays;
      // When no turnaround was ever agreed, the item still mints — it IS out
      // for approval — but with no basis, so it can never be called late.
      // Its action becomes "set a turnaround for this owner".
      const basis: FollowUpBasis = deadline != null
        ? { kind: 'stated', field: 'approvalDeadlineDays' }
        : NONE;
      const targetDate = deadline != null
        ? new Date(sentMs + deadline * 86400000).toISOString().slice(0, 10)
        : undefined;

      // The first approver still PENDING — the person actually holding it.
      // Falls back to the first approver, and stays undefined when the CO
      // has none, which disables the drafted nudge (guard G4).
      const holder = co.approvers?.find(a => a.status === 'pending') ?? co.approvers?.[0];
      const ballName = holder?.name;
      const daysOut = daysBetween(ctx.nowMs, sentMs);

      out.push({
        id: `co_past_its_own_turnaround:changeOrder:${co.id}`,
        ruleId: 'co_past_its_own_turnaround',
        category: 'change_order',
        title: `CO #${co.number} has been out for approval ${daysOut} days`,
        because: deadline != null
          ? `Sent ${daysOut} days ago and you agreed a ${deadline}-day turnaround on this change order.`
          : `Sent ${daysOut} days ago. No turnaround is set on this change order, so nothing can call it late.`,
        ball: 'owner',
        ballName,
        targetDate,
        targetBasis: basis,
        evidence: [{
          ref: { kind: 'changeOrder', id: co.id, projectId: ctx.projectId, label: `CO #${co.number}` },
          says: deadline != null
            ? `status ${co.status}, sent ${sentAt.slice(0, 10)}, ${deadline}-day turnaround`
            : `status ${co.status}, sent ${sentAt.slice(0, 10)}, no turnaround set`,
        }],
        costImpact: { amount: co.changeAmount, basis: 'the change order amount' },
        originatedAt: sentAt,
        nudge: ballName
          ? `Following up on CO #${co.number} (${co.description}) — sent ${daysOut} days ago and still showing as ${co.status}. Can you confirm where it sits?`
          : undefined,
      });
    }
    return out;
  },

  /** Closed only when the record itself leaves the pending set. */
  closed(ctx: FollowUpContext): string[] {
    return (ctx.changeOrders ?? [])
      .filter(co => !PENDING_CO.has(co.status))
      .map(co => `co_past_its_own_turnaround:changeOrder:${co.id}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// R2 — an RFI past the date the GC himself required.
// Controls 38, 39, 40.
// ─────────────────────────────────────────────────────────────────────────────
const OPEN_RFI = new Set(['open', 'pending']);

export const rfiPastRequiredDate: FollowUpRule = {
  id: 'rfi_past_required_date',
  category: 'rfi_submittal',
  controls: [38, 39, 40],
  reads: ['rfis'],
  joins: false,
  closeMode: 'evidence',

  mint(ctx: FollowUpContext): MintedFollowUp[] {
    const out: MintedFollowUp[] = [];
    for (const r of ctx.rfis ?? []) {
      if (r.dateResponded) continue;
      if (!OPEN_RFI.has(String(r.status))) continue;
      const req = dayMs(r.dateRequired);
      if (req === null) continue;
      if (ctx.nowMs <= req) continue;

      const late = daysBetween(ctx.nowMs, req);
      // assignedTo is a plain string on RFI, so it names a person when the GC
      // filled it in and is absent otherwise. No placeholder is substituted —
      // "the reviewer" is not a person and cannot be chased.
      const ballName = r.assignedTo?.trim() || undefined;

      out.push({
        id: `rfi_past_required_date:rfi:${r.id}`,
        ruleId: 'rfi_past_required_date',
        category: 'rfi_submittal',
        title: `RFI #${r.number} is ${late} day${late === 1 ? '' : 's'} past the date you needed it`,
        because: `You required an answer by ${r.dateRequired.slice(0, 10)} and no response is recorded.`,
        ball: 'architect',
        ballName,
        targetDate: r.dateRequired.slice(0, 10),
        targetBasis: { kind: 'stated', field: 'dateRequired' },
        evidence: [{
          ref: { kind: 'rfi', id: r.id, projectId: ctx.projectId, label: `RFI #${r.number}` },
          says: `required ${r.dateRequired.slice(0, 10)}, no response recorded`,
        }],
        originatedAt: r.dateSubmitted,
        nudge: ballName
          ? `Chasing RFI #${r.number} — "${r.subject}". We needed an answer by ${r.dateRequired.slice(0, 10)} and it is holding work. Where does it stand?`
          : undefined,
      });
    }
    return out;
  },

  closed(ctx: FollowUpContext): string[] {
    return (ctx.rfis ?? [])
      .filter(r => !!r.dateResponded || !OPEN_RFI.has(String(r.status)))
      .map(r => `rfi_past_required_date:rfi:${r.id}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// R3 — THE FLAGSHIP JOIN. A sub's COI expires before that sub is on site.
// Controls 76, 80, 83.
//
// The app holds `Subcontractor.coiExpiry` and it holds the schedule, including
// `ScheduleTask.assignedSubId`. Nothing has ever compared them. This is the
// exact shape the six mappers kept finding: both halves present, joined by
// human memory. The building turns the crew away at the dock, and the day is
// gone.
// ─────────────────────────────────────────────────────────────────────────────
export const coiExpiresBeforeSubIsOnSite: FollowUpRule = {
  id: 'coi_expires_before_sub_is_on_site',
  category: 'insurance',
  controls: [76, 80, 83],
  reads: ['subcontractors', 'tasks', 'scheduleStartDate'],
  joins: true,
  closeMode: 'evidence',

  mint(ctx: FollowUpContext): MintedFollowUp[] {
    const out: MintedFollowUp[] = [];
    const tasks = ctx.tasks ?? [];

    for (const sub of ctx.subcontractors ?? []) {
      const expiryMs = dayMs(sub.coiExpiry);
      if (expiryMs === null) continue; // no COI on file is a DIFFERENT item

      // The sub's earliest task that has not already finished.
      const upcoming = tasks
        .filter(t => t.assignedSubId === sub.id && t.status !== 'done')
        .sort((a, b) => (a.startDay ?? 0) - (b.startDay ?? 0))[0];
      if (!upcoming) continue;

      const startDate = dateForStartDay(upcoming.startDay, ctx.scheduleStartDate);
      // An undated schedule cannot answer "before". Refusing is correct —
      // the alternative is anchoring on today, which is a bug this codebase
      // has already been bitten by twice.
      if (!startDate) continue;

      const startMs = dayMs(startDate);
      if (startMs === null || expiryMs >= startMs) continue;

      const gap = daysBetween(startMs, expiryMs);

      out.push({
        id: `coi_expires_before_sub_is_on_site:subcontractor:${sub.id}`,
        ruleId: 'coi_expires_before_sub_is_on_site',
        category: 'insurance',
        title: `${sub.companyName}'s COI expires ${gap} day${gap === 1 ? '' : 's'} before they start`,
        because: `Their certificate expires ${sub.coiExpiry} and their first open task, "${upcoming.title}", starts ${startDate}.`,
        ball: 'sub',
        ballName: sub.companyName,
        // The date that matters is the expiry, not the start — that is when he
        // loses the ability to fix it quietly.
        targetDate: sub.coiExpiry,
        targetBasis: { kind: 'derived', from: 'COI expiry vs the first scheduled task' },
        evidence: [
          {
            ref: { kind: 'subcontractor', id: sub.id, label: sub.companyName },
            says: `COI expires ${sub.coiExpiry}`,
          },
          {
            ref: { kind: 'task', id: upcoming.id, projectId: ctx.projectId, label: upcoming.title },
            says: `starts ${startDate}, assigned to ${sub.companyName}`,
          },
        ],
        scheduleImpact: {
          taskId: upcoming.id,
          onCriticalPath: upcoming.isCriticalPath === true,
          floatDays: 0,
        },
        originatedAt: sub.coiExpiry,
        nudge: `${sub.contactName || sub.companyName} — your certificate of insurance expires ${sub.coiExpiry} and you are scheduled on site ${startDate} for "${upcoming.title}". Please send a renewed COI before then or the building will turn the crew away.`,
      });
    }
    return out;
  },

  /** Closed when the certificate is renewed past the start, or the task is
   *  done. Never closed by the sub simply disappearing from the list. */
  closed(ctx: FollowUpContext): string[] {
    const tasks = ctx.tasks ?? [];
    const out: string[] = [];
    for (const sub of ctx.subcontractors ?? []) {
      const expiryMs = dayMs(sub.coiExpiry);
      const upcoming = tasks
        .filter(t => t.assignedSubId === sub.id && t.status !== 'done')
        .sort((a, b) => (a.startDay ?? 0) - (b.startDay ?? 0))[0];
      const startDate = upcoming ? dateForStartDay(upcoming.startDay, ctx.scheduleStartDate) : null;
      const startMs = startDate ? dayMs(startDate) : null;
      const resolved = expiryMs !== null && (startMs === null || expiryMs >= startMs);
      if (resolved) out.push(`coi_expires_before_sub_is_on_site:subcontractor:${sub.id}`);
    }
    return out;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// R4 — work started with no commitment behind it.
// Controls 8, 13.
//
// `Commitment` carries `signedDate` and no issued/sent stamp, so "was the PO
// issued before work began" cannot be answered from the commitment side. It
// can be answered from the other side: a task that has actually started, with
// a sub assigned, and no non-draft commitment for that sub.
// ─────────────────────────────────────────────────────────────────────────────
export const workStartedWithoutCommitment: FollowUpRule = {
  id: 'work_started_without_commitment',
  category: 'budget',
  controls: [8, 13],
  // subcontractors IS declared, because mint() reads it for the sub's name.
  // It was omitted at first, and G3 only checks DECLARED reads — so an
  // unloaded sub vault produced no refusal and the rule silently degraded to
  // assignedSubName. That is the precise failure G3 exists to prevent,
  // committed inside the first four rules. scripts/validate-follow-up-engine.ts
  // now scans each rule's source and fails on any ctx.<collection> that is
  // not declared, so a rule author cannot make this mistake again.
  reads: ['tasks', 'commitments', 'subcontractors'],
  joins: true,
  closeMode: 'evidence',

  mint(ctx: FollowUpContext): MintedFollowUp[] {
    const out: MintedFollowUp[] = [];
    const committedSubIds = new Set(
      (ctx.commitments ?? [])
        .filter(c => c.status !== 'draft' && !!c.subcontractorId)
        .map(c => c.subcontractorId as string),
    );
    const subName = new Map((ctx.subcontractors ?? []).map(s => [s.id, s.companyName]));

    for (const t of ctx.tasks ?? []) {
      const started = t.actualStartDay != null || t.status === 'in_progress' || t.status === 'done';
      if (!started) continue;
      // No assigned sub means "somebody started something", which is not
      // actionable — so no item at all rather than an item he cannot chase.
      if (!t.assignedSubId) continue;
      if (committedSubIds.has(t.assignedSubId)) continue;

      const name = subName.get(t.assignedSubId) ?? t.assignedSubName;

      out.push({
        id: `work_started_without_commitment:task:${t.id}`,
        ruleId: 'work_started_without_commitment',
        category: 'budget',
        title: `"${t.title}" has started with no signed commitment`,
        because: `The task is ${t.status} and assigned to ${name ?? 'a subcontractor'}, and no contract or PO on this project names them.`,
        ball: 'gc',
        ballName: name,
        // Deliberately no target date. The app cannot know when the PO was due,
        // and inventing one would make this item shout at a date it made up.
        targetBasis: NONE,
        evidence: [
          {
            ref: { kind: 'task', id: t.id, projectId: ctx.projectId, label: t.title },
            says: `status ${t.status}${t.actualStartDay != null ? `, actually started day ${t.actualStartDay}` : ''}`,
          },
          {
            ref: { kind: 'subcontractor', id: t.assignedSubId, label: name ?? t.assignedSubId },
            says: 'no commitment on this project with a status other than draft',
          },
        ],
        originatedAt: t.actualStartDate,
        nudge: undefined, // this one is his own move, not somebody else's
      });
    }
    return out;
  },

  closed(ctx: FollowUpContext): string[] {
    const committedSubIds = new Set(
      (ctx.commitments ?? [])
        .filter(c => c.status !== 'draft' && !!c.subcontractorId)
        .map(c => c.subcontractorId as string),
    );
    return (ctx.tasks ?? [])
      .filter(t => !!t.assignedSubId && committedSubIds.has(t.assignedSubId))
      .map(t => `work_started_without_commitment:task:${t.id}`);
  },
};

/** The registry. Order here is display order within equal rank. */
export const FOLLOW_UP_RULES: readonly FollowUpRule[] = [
  coiExpiresBeforeSubIsOnSite,
  coPastItsOwnTurnaround,
  rfiPastRequiredDate,
  workStartedWithoutCommitment,
];

/**
 * The subset /waiting-on surfaces, and the reason it is a subset.
 *
 * /waiting-on is already the chase screen, built on utils/systemOfAction
 * buildChaseList, and two of the four rules above ask a question that screen
 * already answers: `co_past_its_own_turnaround` overlaps ChaseKind
 * 'co_approval' and `rfi_past_required_date` overlaps 'rfi'. Running all four
 * there would put the SAME change order on screen twice with two different
 * overdue counts — buildChaseList calls a CO late after a hardcoded three days
 * (systemOfAction.ts), the rule calls it late after the turnaround the owner
 * actually agreed to — and a list that disagrees with itself about how late
 * something is teaches him to trust neither number.
 *
 * What the chase list CANNOT say is anything in this array. Every row it
 * renders means "someone is already late". These two mean "this is about to go
 * wrong", which is the more valuable claim and the only one that is still
 * cheap to act on:
 *
 *   - coiExpiresBeforeSubIsOnSite — the building turns the crew away at the
 *     dock on the morning they were booked. Nothing is late yet; there is
 *     still time to get the certificate renewed.
 *   - workStartedWithoutCommitment — a sub is on the tools with no signed
 *     contract or PO. Nobody is late; the exposure is that the invoice, when
 *     it lands, has nothing behind it.
 *
 * Adding the other two here means first replacing buildChaseList's hardcoded
 * three-day CO turnaround and its RFI branch with the rules, in one change —
 * not rendering both.
 */
export const PREVENTIVE_FOLLOW_UP_RULES: readonly FollowUpRule[] = [
  coiExpiresBeforeSubIsOnSite,
  workStartedWithoutCommitment,
];
