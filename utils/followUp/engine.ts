// utils/followUp/engine.ts — the follow-up engine.
//
// WHAT THIS IS. The founder's PM checklist is 173 controls across 18
// categories. Read the verbs and it collapses to four repeated shapes:
//
//   1. I asked for something — did it come back?
//   2. Is the thing that must happen first actually done?
//   3. Did it really happen, or was it only reported?
//   4. Who has to decide, and by when before it hurts?
//
// The app already holds both halves of nearly every one of those and joins
// them with human memory. This engine is the key.
//
// WHY A REGISTRY AND NOT AN ENUM. Two chase engines already exist:
// utils/systemOfAction.ts (ChaseKind, six members) and utils/brainWatch.ts
// (AttnKind, eleven). Both are good and both are closed sets — a follow-up
// outside those lists cannot exist, so covering his checklist would mean
// sixteen more switch cases in two files. Here a new follow-up is a RULE, and
// the engine enforces the honesty guards so a rule author cannot forget them.
//
// PURE. No React, no network, no clock — `nowMs` arrives on the context, the
// same contract as utils/systemOfAction.ts and utils/noticeClock.ts, which is
// what lets scripts/validate-follow-up-engine.ts execute the whole rule set
// under bun.

import type {
  FollowUp, FollowUpBasis, FollowUpCategory, FollowUpHold, FollowUpStatus,
  ChangeOrder, RFI, Submittal, ScheduleTask, Commitment, Invoice, Permit,
  PlanSheet, Contact, Subcontractor,
} from '@/types';
import type { Delivery } from '@/utils/deliverySchedule';

export const DAY_MS = 86400000;

/**
 * Collections a rule may read.
 *
 * `undefined` means NOT LOADED. `[]` means loaded and empty. The distinction is
 * guard G3 and it is not cosmetic: without it, a COI rule fires on every
 * subcontractor the first time the vault fails to load, and the contractor is
 * told his whole crew is uninsured. utils/brief/composeBrief.ts already holds
 * this discipline in prose ("an empty array there means 'looked, none'"); here
 * it is a contract the engine checks.
 */
export interface FollowUpContext {
  nowMs: number;
  projectId: string;
  projectName: string;
  /** Rule ids that have run against this project before. Drives guard G6. */
  seenRuleIds?: ReadonlySet<string>;
  changeOrders?: readonly ChangeOrder[];
  rfis?: readonly RFI[];
  submittals?: readonly Submittal[];
  tasks?: readonly ScheduleTask[];
  deliveries?: readonly Delivery[];
  commitments?: readonly Commitment[];
  invoices?: readonly Invoice[];
  permits?: readonly Permit[];
  planSheets?: readonly PlanSheet[];
  contacts?: readonly Contact[];
  subcontractors?: readonly Subcontractor[];
  /** The schedule's day-0 anchor, so a task's startDay can be read as a date.
   *  Undefined on an undated schedule — rules that need a date must refuse. */
  scheduleStartDate?: string;
}

export type FollowUpReads = Exclude<keyof FollowUpContext, 'nowMs' | 'projectId' | 'projectName' | 'seenRuleIds'>;

/** What a rule hands back. The engine fills in the parts it owns. */
export type MintedFollowUp =
  Omit<FollowUp, 'daysOverdue' | 'presence' | 'preExisting' | 'severity' | 'projectId'>
  & {
    severity?: FollowUp['severity'];
    /** ISO date of the OLDER joined record. Guard G6 reads this so an item is
     *  not backdated to the day the app update landed. */
    originatedAt?: string;
  };

export interface FollowUpRule {
  id: string;
  category: FollowUpCategory;
  /** HIS control numbers. Drives the coverage report. */
  controls: readonly number[];
  /** Collections this rule needs LOADED. Any one undefined and it does not run. */
  reads: readonly FollowUpReads[];
  /** True when the item's meaning depends on two records agreeing or
   *  disagreeing. The engine then enforces evidence.length >= 2 (guard G1). */
  joins: boolean;
  /** 'evidence' closes itself; 'attested' can only be closed by a person,
   *  because the app has no record that could prove it. */
  closeMode: 'evidence' | 'attested';
  mint(ctx: FollowUpContext): MintedFollowUp[];
  /** Ids this rule considers closed BY EVIDENCE this run. A separate function
   *  from mint() on purpose — see guard G0. */
  closed(ctx: FollowUpContext): string[];
}

/** Items derived from records older than this mint quietly on a rule's first
 *  run. Installing the update must not produce 173 red rows about a job he has
 *  been running for nine months (guard G6). */
export const QUIET_WINDOW_DAYS = 14;

export interface FollowUpRunRefusal {
  ruleId: string;
  /** Which guard refused, and what it was protecting against. */
  guard: 'G1_join_needs_two_records' | 'G3_collection_not_loaded' | 'G2_no_basis_no_overdue';
  detail: string;
}

export interface FollowUpRun {
  items: FollowUp[];
  /** Ids a rule closed by evidence this run. */
  closedByEvidence: string[];
  /** Rules that could not run, and why. Surfaced, never swallowed. */
  refusals: FollowUpRunRefusal[];
  /** Rules that ran. Lets a caller say "checked 9 of 14" honestly. */
  ranRuleIds: string[];
}

function parseDay(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isFinite(ms) ? ms : null;
}

export function daysBetween(laterMs: number, earlierMs: number): number {
  return Math.floor((laterMs - earlierMs) / DAY_MS);
}

function severityFor(daysOverdue: number | null): FollowUp['severity'] {
  if (daysOverdue === null) return 'normal';
  if (daysOverdue >= 7) return 'critical';
  if (daysOverdue >= 3) return 'high';
  return 'normal';
}

/**
 * G2 — no basis, no overdue.
 *
 * `daysOverdue` stays null unless the target date has a stated, derived or
 * learned basis. A row cannot render a red late chip without a number, so an
 * item with no basis renders "no target date — set one" instead. This is
 * "never invent a date", enforced in the type rather than in code review.
 */
export function overdueFor(targetDate: string | undefined, basis: FollowUpBasis, nowMs: number): number | null {
  if (basis.kind === 'none') return null;
  const t = parseDay(targetDate);
  if (t === null) return null;
  return daysBetween(nowMs, t);
}

/**
 * Run the registry for one project.
 *
 * Every guard lives here rather than in the rules, so a rule author cannot
 * forget one and a reviewer does not have to notice.
 */
export function runFollowUpRules(rules: readonly FollowUpRule[], ctx: FollowUpContext): FollowUpRun {
  const items: FollowUp[] = [];
  const refusals: FollowUpRunRefusal[] = [];
  const closedByEvidence: string[] = [];
  const ranRuleIds: string[] = [];

  for (const rule of rules) {
    // G3 — empty is not absent. A collection the caller never loaded is
    // undefined; a collection that is genuinely empty is []. Only the former
    // stops the rule.
    const missing = rule.reads.filter(k => ctx[k] === undefined);
    if (missing.length > 0) {
      refusals.push({
        ruleId: rule.id,
        guard: 'G3_collection_not_loaded',
        detail: `did not run — ${missing.join(', ')} not loaded (undefined, not empty)`,
      });
      continue;
    }

    ranRuleIds.push(rule.id);
    for (const id of rule.closed(ctx)) closedByEvidence.push(id);

    const firstRunForRule = !ctx.seenRuleIds?.has(rule.id);

    for (const m of rule.mint(ctx)) {
      // G1 — a join has to show its two records. This is what stops "your
      // submittal is old" wearing the costume of "your submittal is due after
      // the wall it belongs in gets built".
      if (rule.joins && m.evidence.length < 2) {
        refusals.push({
          ruleId: rule.id,
          guard: 'G1_join_needs_two_records',
          detail: `dropped "${m.title}" — a join rule produced ${m.evidence.length} evidence row(s)`,
        });
        continue;
      }

      const daysOverdue = overdueFor(m.targetDate, m.targetBasis, ctx.nowMs);

      // G6 — first run is quiet. On a rule's first pass, anything derived from
      // records older than the quiet window mints at 'normal' and is flagged
      // pre-existing, so the update does not page him about a nine-month-old
      // job. A product decision, and the difference between adoption and the
      // feature being switched off in week two.
      const originatedMs = parseDay(m.originatedAt);
      const isOld = originatedMs !== null && daysBetween(ctx.nowMs, originatedMs) > QUIET_WINDOW_DAYS;
      const preExisting = firstRunForRule && isOld;

      items.push({
        ...m,
        projectId: ctx.projectId,
        daysOverdue,
        severity: preExisting ? 'normal' : (m.severity ?? severityFor(daysOverdue)),
        presence: 'live',
        preExisting,
        // G4 — no name, no nudge. Enforced here so a rule cannot ship the
        // string "the reviewer" as a person.
        nudge: m.ballName ? m.nudge : undefined,
      });
    }
  }

  return { items, closedByEvidence, refusals, ranRuleIds };
}

/**
 * Merge the derived face with the held face.
 *
 * G0 — ABSENCE IS NOT EVIDENCE. An item that stopped minting is NOT closed; it
 * is marked `stale` and counted separately. If a missing mint closed items,
 * deleting one RFI would close its follow-up, and a single device with a
 * half-loaded cache would silently close twenty of them.
 */
export function mergeHeldFollowUps(
  run: FollowUpRun,
  holds: readonly FollowUpHold[],
  /** Same clock the run used. Passed in, never read — this module has no clock. */
  nowMs: number,
): {
  items: FollowUp[];
  /** Held items whose rule no longer matches. Shown as "stopped matching", never as done. */
  stale: FollowUpHold[];
} {
  const byId = new Map(run.items.map(i => [i.id, i]));
  const holdById = new Map(holds.map(h => [h.id, h]));
  const closedSet = new Set(run.closedByEvidence);
  const HIS_DATE: FollowUpBasis = { kind: 'stated', field: 'your target date' };

  const items = run.items.map(i => {
    const h = holdById.get(i.id);
    if (!h?.targetDate) return i;
    // His date beats the rule's, and carries a basis that says whose it is.
    return {
      ...i,
      targetDate: h.targetDate,
      targetBasis: HIS_DATE,
      daysOverdue: overdueFor(h.targetDate, HIS_DATE, nowMs),
    };
  });

  const stale = holds.filter(h =>
    !byId.has(h.id) &&
    !closedSet.has(h.id) &&
    h.status !== 'closed_verified' &&
    h.status !== 'closed_by_hand');

  return { items, stale };
}

/** The status a held record should take when its rule closes it by evidence. */
export function statusAfterEvidenceClose(): FollowUpStatus {
  return 'closed_verified';
}

/**
 * Rank for display: overdue first, then severity, then a stable id tiebreak so
 * the list does not reshuffle between renders.
 */
export function rankFollowUps(items: readonly FollowUp[]): FollowUp[] {
  const sev = { critical: 0, high: 1, normal: 2 } as const;
  return [...items].sort((a, b) => {
    if (a.preExisting !== b.preExisting) return a.preExisting ? 1 : -1;
    if (sev[a.severity] !== sev[b.severity]) return sev[a.severity] - sev[b.severity];
    const ao = a.daysOverdue ?? -Infinity;
    const bo = b.daysOverdue ?? -Infinity;
    if (ao !== bo) return bo - ao;
    return a.id.localeCompare(b.id);
  });
}

/** Which of his 173 controls the registry currently answers. */
export function coveredControls(rules: readonly FollowUpRule[]): number[] {
  return [...new Set(rules.flatMap(r => [...r.controls]))].sort((a, b) => a - b);
}
