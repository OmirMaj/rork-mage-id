// utils/projectClone.ts — "Duplicate" on a project, as a template.
//
// WHY THIS IS A WHITELIST AND NOT `{ ...source, <resets> }` (audit wave 5, #60).
// Home's Duplicate used to spread the whole source project and then reset the
// fields somebody had remembered to reset. Everything nobody remembered rode
// through: the copy of 'Smith Kitchen' kept the Smiths as primaryContact, so
// the new job's lien waivers named the previous homeowner as property owner
// (utils/lienWaiverDocument reads primaryContact.name) and accounting exported
// the Jones job to the Smiths — and no screen can edit primaryContact, so he
// could not fix it. It also kept the Handover ticks ("Walkthrough done", "Keys
// handed over"), a schedule with the old job's progress, actual dates and
// baselines, the old estimate revision history, the QuickBooks customer link
// and a zoning-confirmed structuredAddress that jobsiteAddressForProject
// prefers over the location he retypes.
//
// Every new field added to Project would have leaked the same way. So the copy
// is built from a list of what a TEMPLATE is — the scope inputs that took
// effort to set up — and anything not on the list starts empty:
//
//   KEPT     name + ' (copy)', type, location, squareFootage, quality,
//            description, scope, linkedEstimate / estimate, the contract model
//            (contractMode, gmpCap, contractorFee*), a GC-set targetBudget,
//            and the schedule's PLAN (tasks, durations, dependencies, startDay
//            exactly as they were — each task's free-text notes and the
//            schedule's risk list are the old job's, so they start empty).
//   DROPPED  primaryContact, leadSource, targetTimelineNotes (the old client),
//            structuredAddress, coordinates, estimateVersions, qboCustomerId /
//            qboSyncedAt, handoverChecklist (→ {}), closedAt, SC date, warranty
//            walk, photoCount, collaborators, publicProfile, clientPortal (see
//            below), retainage / notice-period terms (that contract's, not this one's;
//            the invoice asks again rather than carry another job's answer),
//            and the loader's per-load stamps (ownerUserId, myRole,
//            financialsLoaded, contractTermsLoaded) — addProject stamps the
//            creator as owner (claimProjectForUser).
//
// THE CLIENT PORTAL MUST NOT RIDE ALONG — two reasons, and the second is fatal
// (moved here from the old home handler):
//   1. clientPortal carries the SOURCE project's portalId AND its accessToken —
//      the secret the homeowner's link authenticates with. A copy that inherits
//      it hands the source job's portal credential to a different project;
//      portal_project_for_token resolves the duplicate id with `limit 1`, so
//      the homeowner's link can serve whichever row Postgres returns.
//   2. 20260904100950 adds a UNIQUE index on client_portal->>'portalId'. With
//      the blob copied, the clone's first sync fails 23505 — and offlineQueue
//      exempts a 23505 from "terminal" only when the constraint name ends in
//      `_pkey`, which this one does not. The write would be DISCARDED and the
//      copy would live on that one device forever, silently.
// A duplicate mints its own portal when the user opens one.
//
// A client-PROPOSED targetBudget is dropped too: it is the old homeowner's
// number (it carries their name and their portal proposal id) and the portal
// prints it as "Contract Value". One the GC set himself is scope and stays.
//
// THE SCHEDULE. The plan is the template value; the execution is the old
// job's. Tasks keep id, title, phase, duration, dependencies and startDay
// EXACTLY (the task ids are only referenced from inside the schedule, and a
// startDay rebase is exactly the latent "finish-day jump" the scheduler notes
// warn about). Each task goes back to progress 0 / 'not_started' with no
// actual dates, photos, field-edit stamps, baseline marks, checklist ticks or
// watchers, and loses the date-bound anchors and deadlines that were calendar
// days of the OLD job. The schedule itself loses startDate (the copy has not
// started), every baseline, scenario, weather log and fragnet.
//
// Pure: no React, no ids minted here, no clock — the caller passes both.
// (Home's Burn map and status-filter reducer live at the bottom for the same
// reason the voice note does: a bun guard can run them.)

import type { ChangeOrder, Invoice, Project, ProjectSchedule, ScheduleTask } from '@/types';
import { formatMoney } from '@/utils/formatters';
import { getContractValue, getInvoicedToDate } from '@/utils/projectFinancials';
import { formatCalendarDay, parseCalendarDay } from '@/utils/calendarDate';

export interface CloneProjectOptions {
  /** The new project's id — a real UUID (projects.id is uuid). */
  id: string;
  /** Defaults to `${source.name} (copy)`. Home passes the name its cap gate
   *  already checked, so the two cannot disagree. */
  name?: string;
  /** The new schedule's id. Defaults to `${id}-schedule`. */
  scheduleId?: string;
}

/** The copy's name when the caller does not pass one. */
export function cloneNameFor(source: Pick<Project, 'name'>): string {
  return `${source.name} (copy)`;
}

/**
 * Task keys that describe what HAPPENED on the old job rather than the plan.
 * `fieldEditedAt` is not on the ScheduleTask type — the field-update path
 * (utils/fieldScheduleUpdate FIELD_EDIT_STAMPS) writes it onto the task — so
 * it is listed by name here and removed from the spread explicitly.
 */
const TASK_EXECUTION_KEYS = [
  'actualStartDay', 'actualEndDay', 'actualStartDate', 'actualEndDate',
  'photos', 'subscribers', 'baselineStartDay', 'baselineEndDay',
  'sourceEventRef', 'anchorDate', 'deadline', 'fieldEditedAt',
] as const;

/** One task of the plan, with the old job's execution taken off it. */
export function resetTaskForTemplate(task: ScheduleTask): ScheduleTask {
  const next: Record<string, unknown> = { ...task };
  for (const k of TASK_EXECUTION_KEYS) delete next[k];
  const out = next as unknown as ScheduleTask;
  out.progress = 0;
  out.status = 'not_started';
  // Free-text task notes are what happened on the OLD job ("Smith's dog bites —
  // text before entering"), not the plan; they would carry the previous
  // homeowner into the copy exactly as primaryContact did. Required string on
  // the type, so it is emptied rather than deleted.
  out.notes = '';
  // A date-bound anchor ('must-start-on 2026-03-02') was a calendar day of the
  // OLD job; with its date gone it would be an anchor to nothing. ALAP carries
  // no date and is a property of the plan, so it survives.
  if (task.anchorType && task.anchorType !== 'as-late-as-possible' && task.anchorType !== 'none') {
    delete (next as { anchorType?: unknown }).anchorType;
  }
  if (Array.isArray(task.checklist)) {
    out.checklist = task.checklist.map(c => ({ id: c.id, label: c.label, done: false }));
  }
  return out;
}

/** The schedule's plan without its execution (see the header). */
export function cloneScheduleAsTemplate(
  schedule: ProjectSchedule,
  projectId: string,
  scheduleId: string,
  names: { from: string; to: string },
  nowIso: string,
): ProjectSchedule {
  const plan: ProjectSchedule = {
    id: scheduleId,
    // "Smith Kitchen schedule" would otherwise title the Jones job's Gantt.
    name: names.from && schedule.name?.includes(names.from)
      ? schedule.name.split(names.from).join(names.to)
      : schedule.name,
    projectId,
    workingDaysPerWeek: schedule.workingDaysPerWeek,
    bufferDays: schedule.bufferDays,
    tasks: (schedule.tasks ?? []).map(resetTaskForTemplate),
    totalDurationDays: schedule.totalDurationDays,
    criticalPathDays: schedule.criticalPathDays,
    laborAlignmentScore: schedule.laborAlignmentScore,
    // The old job's risk list (utils/scheduleEngine derives it from that job's
    // progress and slippage, and a hand-typed one can name the site). The copy
    // has not started, so it starts with none; the engine re-derives them.
    riskItems: [],
    updatedAt: nowIso,
  };
  // Plan-shaped optional fields, copied only when present so the copy has the
  // same shape an authored schedule has (no explicit `undefined` keys).
  if (schedule.nonWorkingDates) plan.nonWorkingDates = [...schedule.nonWorkingDates];
  if (schedule.criticalFloatThresholdDays != null) plan.criticalFloatThresholdDays = schedule.criticalFloatThresholdDays;
  if (schedule.resources) plan.resources = schedule.resources;
  if (schedule.resourceCalendars) plan.resourceCalendars = schedule.resourceCalendars;
  if (schedule.startDayBasis) plan.startDayBasis = schedule.startDayBasis;
  // Deliberately absent: startDate, activeBaselineId, baseline, baselines,
  // healthScore (it is computed from progress), weatherAlerts,
  // weatherDelayLog, scenarios, activeScenarioId, fragnets.
  return plan;
}

/**
 * A new draft project that carries the source's scope and plan and nothing of
 * its execution, its client or its integrations. See the file header for the
 * exact list.
 */
export function cloneProjectAsTemplate(
  source: Project,
  nowIso: string,
  opts: CloneProjectOptions,
): Project {
  const name = opts.name ?? cloneNameFor(source);
  const clone: Project = {
    id: opts.id,
    name,
    type: source.type,
    location: source.location ?? '',
    squareFootage: source.squareFootage ?? 0,
    quality: source.quality,
    description: source.description ?? '',
    // Resetting status and createdAt lets the copy flow through the normal
    // new-project setup (geocode on the address, next-step prompts).
    status: 'draft',
    createdAt: nowIso,
    updatedAt: nowIso,
    estimate: source.estimate ?? null,
    schedule: source.schedule
      ? cloneScheduleAsTemplate(
        source.schedule,
        opts.id,
        opts.scheduleId ?? `${opts.id}-schedule`,
        { from: source.name, to: name },
        nowIso,
      )
      : null,
    // Starts with nothing ticked on Handover — the old job's walkthrough and
    // key hand-off are not this job's.
    handoverChecklist: {},
  };
  if (source.scope) clone.scope = source.scope;
  if (source.linkedEstimate) clone.linkedEstimate = source.linkedEstimate;
  if (source.targetBudget && source.targetBudget.setBy === 'gc') {
    const { clientName: _c, proposalId: _p, ...gcBudget } = source.targetBudget;
    clone.targetBudget = gcBudget;
  }
  if (source.contractMode) clone.contractMode = source.contractMode;
  if (source.gmpCap != null) clone.gmpCap = source.gmpCap;
  if (source.contractorFeePercent != null) clone.contractorFeePercent = source.contractorFeePercent;
  if (source.contractorFeeAmount != null) clone.contractorFeeAmount = source.contractorFeeAmount;
  return clone;
}

// ─── Home's New Project modal: what the voice fill heard but did not keep ───
//
// Lives beside the clone because both are Home's new-project paths and both
// must stay importable by a bun guard (a .tsx screen is not).
//
// Audit wave 5, #157: the modal's voice examples told him to say a budget and a
// start date; the parser extracted both and the handler dropped them without a
// word (targetBudget is deliberately not written — the portal prints it as
// "Contract Value"). Now he is told what was heard and where it belongs.

/** Money exactly as said: whole dollars print whole, anything else to the cent. */
export function formatHeardMoney(n: number): string {
  return formatMoney(n, Number.isInteger(n) ? 0 : 2);
}

/**
 * The one muted line under the voice fill when the dictation carried a budget
 * and/or a start date this form does not keep, or null when it carried
 * neither. The date is a calendar day (utils/calendarDate), never
 * `new Date('YYYY-MM-DD')`, which is the previous evening west of Greenwich;
 * a date the parser returned in any other shape is quoted as it came rather
 * than guessed at.
 */
export function voiceUnappliedNote(
  targetBudget: number | null | undefined,
  startDate: string | null | undefined,
): string | null {
  const budget = typeof targetBudget === 'number' && Number.isFinite(targetBudget) && targetBudget > 0
    ? targetBudget : null;
  const start = typeof startDate === 'string' && startDate.trim() ? startDate.trim() : null;
  if (budget == null && start == null) return null;
  const startLabel = start
    ? (parseCalendarDay(start) ? formatCalendarDay(start, { month: 'long', day: 'numeric', year: 'numeric' }) : start)
    : null;
  const heard = [
    budget != null ? `budget ${formatHeardMoney(budget)}` : null,
    startLabel ? `start ${startLabel}` : null,
  ].filter(Boolean).join(' and ');
  const where = budget != null && startLabel
    ? 'set the budget on the estimate and the start date on the schedule'
    : budget != null ? 'set it on the estimate' : 'set it on the schedule';
  return `Heard ${heard} — not saved here; ${where}.`;
}

// ─── Home's project list: Burn, and the status filter ───────────────────────
//
// Two more pieces of Home that must be provable under a bun guard (the screen
// is .tsx and cannot be imported there). Still pure: no React, no clock.

export interface ProjectBurn {
  /** Non-draft invoice totals on the job (utils/projectFinancials). */
  invoicedToDate: number;
  /** Estimate + approved change orders — the basis client-view uses. */
  revisedContract: number;
}

/**
 * Billed-to-date against the revised contract, per job, for the Burn column
 * (ProjectRow) and bar (ProjectCard) — audit wave 5, #151.
 *
 * A job is LEFT OUT (its row prints '—', its card draws no bar) whenever this
 * device does not hold that job's money, because a burn computed from an empty
 * list is a sourceless 0%:
 *   - until both lists have been read (`invoicesRead`, `changeOrdersLoaded`);
 *   - without a signed-in user (ownership cannot be told);
 *   - a job someone else owns — invoices and change orders are owner-only
 *     under RLS (inv_select_own / co_select_own: auth.uid() = user_id), so an
 *     invited PM or viewer has none of the GC's on this device, however much
 *     the GC has billed. Ownership is the same rule as the free-plan count
 *     (utils/projectCap countsTowardFreeCap): an unset ownerUserId is a job
 *     created here, not yet stamped, and is his;
 *   - a field role (money-blinded) or a job whose financials read failed.
 */
export function buildBurnByProject(input: {
  projects: readonly Project[];
  invoices: readonly Invoice[];
  changeOrders: readonly ChangeOrder[];
  userId: string | null | undefined;
  invoicesRead: boolean;
  changeOrdersLoaded: boolean;
}): Map<string, ProjectBurn> {
  const out = new Map<string, ProjectBurn>();
  const { projects, invoices, changeOrders, userId } = input;
  if (!input.invoicesRead || !input.changeOrdersLoaded || !userId) return out;
  const invoicesBy = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    const list = invoicesBy.get(inv.projectId);
    if (list) list.push(inv); else invoicesBy.set(inv.projectId, [inv]);
  }
  const cosBy = new Map<string, ChangeOrder[]>();
  for (const co of changeOrders) {
    const list = cosBy.get(co.projectId);
    if (list) list.push(co); else cosBy.set(co.projectId, [co]);
  }
  for (const p of projects) {
    if (p.ownerUserId && p.ownerUserId !== userId) continue;
    if (p.myRole === 'field' || p.financialsLoaded === false) continue;
    out.set(p.id, {
      invoicedToDate: getInvoicedToDate(invoicesBy.get(p.id) ?? []),
      revisedContract: getContractValue(p, cosBy.get(p.id) ?? []),
    });
  }
  return out;
}

export type HomeStatusFilter = 'all' | 'active' | 'precon' | 'closeout' | 'closed';

export interface HomeStatusFilterState {
  filter: HomeStatusFilter;
  /** The current filter is the Active bucket the APP chose, not one he tapped. */
  autoPicked: boolean;
  /** The one-time first-load choice has been made (or he chose first). */
  didAuto: boolean;
}

export type HomeStatusFilterAction =
  | { type: 'data'; projectCount: number; activeCount: number }
  | { type: 'pick'; filter: HomeStatusFilter };

export const HOME_STATUS_FILTER_INITIAL: HomeStatusFilterState = { filter: 'all', autoPicked: false, didAuto: false };

/** Chips render at this many projects; below it there is no way to switch back,
 *  so the app never picks a bucket for him. */
export const HOME_STATUS_CHIPS_MIN_PROJECTS = 5;

/**
 * Home's status filter as ONE reducer (audit wave 5, #154).
 *
 * It used to be two effects and a ref: the first-load effect set the ref and
 * filter 'active', and in the SAME commit the reset effect — still holding the
 * stale filter 'all' from its closure — saw "not on Active" and cleared the
 * ref. So when the last active job closed, the reset never fired and he sat on
 * an empty Active bucket he never picked. A reducer reads the state it is
 * given, never a closure, so the order of effects cannot lose the flag.
 *
 *   data  First load with projects: at ≥5 projects (chips shown) and at least
 *         one active, pick Active and remember the app picked it. Afterwards:
 *         when the app-picked Active bucket empties, go back to All. A bucket
 *         HE tapped stays put — the empty-bucket state says what it is.
 *   pick  His choice. Clears the auto flag; the first-load choice is spent.
 *
 * Returns the SAME object when nothing changes, so React bails out of the
 * re-render.
 */
export function homeStatusFilterReducer(
  state: HomeStatusFilterState,
  action: HomeStatusFilterAction,
): HomeStatusFilterState {
  if (action.type === 'pick') {
    if (state.filter === action.filter && !state.autoPicked && state.didAuto) return state;
    return { filter: action.filter, autoPicked: false, didAuto: true };
  }
  if (!state.didAuto) {
    if (action.projectCount === 0) return state;
    if (action.projectCount >= HOME_STATUS_CHIPS_MIN_PROJECTS && action.activeCount > 0) {
      return { filter: 'active', autoPicked: true, didAuto: true };
    }
    return { ...state, didAuto: true };
  }
  if (state.autoPicked && state.filter === 'active' && action.projectCount > 0 && action.activeCount === 0) {
    return { filter: 'all', autoPicked: false, didAuto: true };
  }
  return state;
}
